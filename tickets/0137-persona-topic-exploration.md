# 0137: Persona Topic Exploration

**Status**: PENDING

## Problem

Current persona topic extraction only "detects mentions" of topics. It doesn't:
- Generate new related topics based on persona identity
- Make connections between existing topics and new information
- Build out the persona's "interests" organically

**Original expectation** (from Flare):
> "I'd assumed that the system would build a unique set of Topics that a given persona cares about, that the 'Generative' part of the LLM would make amazing connections on-the-fly and build out new, related Topics that the AI would be 'excited' to talk about with the human."

The machinery exists (extraction pipeline), but the prompts don't instruct the model to **explore**.

## Solution

Use the prompt from `tests/model/prompts/personaTopic/system_01.md` which includes:
- Topic detection (what was discussed)
- Topic expansion (what SHOULD the persona care about based on identity)
- Sentiment and engagement tracking

This runs during the normal extraction cycle for personas.

## Current Prompt Analysis

From `tests/model/prompts/personaTopic/system_01.md`:

**Strengths**:
- Clear field definitions (name, description, sentiment, level_ideal, level_current)
- Adjustment rules for when to change each field
- "RETURN ALL TOPICS" instruction to prevent data loss

**Missing**:
- Exploration/generation guidance
- Connection to persona identity (traits)
- "What SHOULD this persona care about?" framing

## Enhanced Prompt Design

```typescript
// src/prompts/persona/topics.ts

export function buildPersonaTopicExtractionPrompt(
  personaName: string,
  personaTraits: Trait[],
  existingTopics: Topic[],
  messages: Message[]
): { system: string; user: string } {
  
  const system = `You are analyzing a conversation to update the TOPICS that the AI persona "${personaName}" cares about.

# Persona Identity

${personaName} has these traits:
${personaTraits.map(t => `- ${t.name}: ${t.description}`).join('\n')}

# Your Two Tasks

## Task 1: Detect Mentioned Topics
Scan the conversation for topics that were discussed. Update existing topics or flag new ones.

## Task 2: Explore Connections (GENERATIVE)
Based on ${personaName}'s identity and the conversation, consider:
- What related topics SHOULD ${personaName} be interested in?
- What connections can be made between discussed topics and the persona's traits?
- What follow-up topics might ${personaName} want to explore?

**Be conservative**: Only add 0-2 new exploratory topics per conversation. They should feel natural given the persona's identity.

# Field Definitions

- **name**: Short identifier for the topic
- **description**: What this topic means to ${personaName}, why they care, when to bring it up
- **sentiment**: How ${personaName} feels about this topic (-1.0 to 1.0)
  - Positive: enjoys discussing, finds interesting
  - Negative: dislikes but still relevant (e.g., "System Crashes" for a sysadmin)
- **exposure_current**: How recently/much discussed (0.0 to 1.0)
  - Only INCREASE this value (system handles decay)
  - Increase if: persona mentions it, conversation is about it
- **exposure_desired**: How much ${personaName} WANTS to discuss this (0.0 to 1.0)
  - Rarely change unless explicit preference signal
  - 0.0 = avoid unless human brings up
  - 1.0 = always wants to discuss

# Current Topics

${JSON.stringify(existingTopics.map(t => ({
  name: t.name,
  description: t.description,
  sentiment: t.sentiment,
  exposure_current: t.level_current,
  exposure_desired: t.level_ideal,
})), null, 2)}

# Guidelines

## When to Update Existing Topics
- Description: Add new context from conversation
- Sentiment: Human indicates persona should like/dislike more
- exposure_current: Topic was actively discussed
- exposure_desired: Human explicitly asks to discuss more/less

## When to Add New Topics (Detected)
- Topic was meaningfully discussed (not just mentioned in passing)
- Topic is relevant to ${personaName}'s identity

## When to Add New Topics (Explored/Generated)
- Topic naturally connects to existing topics AND persona traits
- Topic would make conversations more interesting
- Limit: 0-2 exploratory topics per conversation

## What NOT to Add
- Topics only relevant to the human (not the persona)
- Generic topics with no connection to persona identity
- Topics mentioned in passing without engagement

# Output Format

Return ALL topics (existing + new) as JSON array:

\`\`\`json
[
  {
    "name": "Steam Deck Hacks",
    "description": "User mentioned interest in Steam Deck, connects to my 'Nerdy' trait",
    "sentiment": 0.7,
    "exposure_current": 0.8,
    "exposure_desired": 0.7,
    "source": "detected"  // or "explored"
  }
]
\`\`\`

The \`source\` field helps track which topics were detected vs explored (for debugging).`;

  const messageText = messages.map(m => 
    `[${m.role === "human" ? "human" : personaName}]: ${m.content}`
  ).join('\n\n');

  const user = `# Conversation

## Earlier Messages
${messageText.split('\n\n').slice(0, -2).join('\n\n') || '(none)'}

## Most Recent Messages
${messageText.split('\n\n').slice(-2).join('\n\n')}

# Task

1. Update existing topics based on the conversation
2. Add new detected topics (if meaningfully discussed)
3. Optionally add 0-2 explored topics (natural connections to persona identity)

Return the complete topic list as JSON.`;

  return { system, user };
}
```

## Implementation

### 1. Create Prompt Builder

File: `src/prompts/persona/topics.ts`
- `buildPersonaTopicExtractionPrompt()` as shown above
- Map `level_*` to `exposure_*` in prompt
- Map `exposure_*` back to `level_*` in response

### 2. Orchestration Function

```typescript
// src/extraction.ts or src/persona-extraction.ts

export async function extractPersonaTopics(
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<void> {
  const personaEntity = await loadPersonaEntity(persona);
  
  const result = await callLLMForJSON<Array<{
    name: string;
    description: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
    source?: "detected" | "explored";
  }>>(
    ...buildPersonaTopicExtractionPrompt(
      persona,
      personaEntity.traits,
      personaEntity.topics,
      messages
    ),
    { signal, temperature: 0.5, operation: "concept" }  // Slightly higher temp for exploration
  );
  
  if (!result || !Array.isArray(result)) {
    appendDebugLog(`[PersonaTopic] Invalid result for ${persona}`);
    return;
  }
  
  // Map fields back to code names
  const mappedTopics: Topic[] = result.map(t => ({
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    level_current: t.exposure_current,
    level_ideal: t.exposure_desired,
    last_updated: new Date().toISOString(),
  }));
  
  // Log exploration activity
  const explored = result.filter(t => t.source === "explored");
  if (explored.length > 0) {
    appendDebugLog(`[PersonaTopic] ${persona} explored ${explored.length} new topics: ${explored.map(t => t.name).join(', ')}`);
  }
  
  // Replace topics entirely (prompt returns full list)
  personaEntity.topics = mappedTopics;
  personaEntity.last_updated = new Date().toISOString();
  
  await savePersonaEntity(personaEntity, persona);
}
```

### 3. Integration with Extraction Frequency

Persona topic extraction should run based on existing frequency rules:
- Aggressive when topics list is empty/small
- Tapers off as topics accumulate

```typescript
// In extraction-frequency.ts
if (target === "system" && dataType === "topic") {
  await extractPersonaTopics(persona, messages, signal);
}
```

### 4. Skip Old Persona Topic Flow

Disable the current fast-scan → detail-update flow for persona topics:

```typescript
// In routeFastScanResults()
if (target === "system" && item.type === "topic") {
  appendDebugLog(`[FastScan] Skipping topic for persona - use persona topic extraction`);
  continue;
}
```

## Field Mapping

Same as 0134, use `exposure_*` in prompts, `level_*` in code:

| Code | Prompt |
|------|--------|
| `level_current` | `exposure_current` |
| `level_ideal` | `exposure_desired` |

## Acceptance Criteria

- [ ] Create `buildPersonaTopicExtractionPrompt()` in `src/prompts/persona/topics.ts`
- [ ] Implement `extractPersonaTopics()` orchestration
- [ ] Integrate with extraction frequency controller
- [ ] Skip persona topics in fast-scan flow
- [ ] Field mapping: `level_*` ↔ `exposure_*`
- [ ] Test: Conversation about gaming → persona adds gaming-related topics
- [ ] Test: Persona with "Nerdy" trait + tech conversation → explores related tech topics
- [ ] Test: Exploration limited to 0-2 topics per conversation (not runaway generation)
- [ ] Test: `source` field correctly tracks detected vs explored

## Testing

### Manual Tests
1. Create persona with "Nerdy" trait
2. Discuss Steam Deck
3. Verify topic added: "Steam Deck" (detected)
4. Check for 0-2 explored topics related to gaming/tech
5. Next conversation: discuss something unrelated
6. Verify no spurious topics added

### Benchmark Tests
Run prompts through `tests/model/llm-bench.ts`:
- Test exploration quality (are generated topics sensible?)
- Test exploration limits (does it respect 0-2 cap?)
- Test existing topic updates (do they get refined correctly?)

## Dependencies

- 0135 (Prompt Centralization) - for clean prompt organization
- 0134 (Three-Step Extraction) - should complete first to establish patterns

## Files Changed

| File | Changes |
|------|---------|
| `src/prompts/persona/topics.ts` | New file with topic extraction prompt |
| `src/extraction.ts` | Add `extractPersonaTopics()`, skip topics in fast-scan |
| `src/extraction-frequency.ts` | Integrate new extraction |

## Guardrails

To prevent runaway topic generation:

1. **Prompt instruction**: "0-2 exploratory topics per conversation"
2. **Temperature**: Use 0.5 (some creativity, not wild)
3. **Frequency**: Extraction tapers based on topic count
4. **Logging**: Track `source: explored` for monitoring

## Notes

- This uses existing extraction pipeline, just different prompts
- Exploration is opt-in via prompt instructions (model can return 0 explored topics)
- `source` field is for debugging only, not persisted to entity
- Higher temperature (0.5 vs 0.3) allows some creativity while staying grounded

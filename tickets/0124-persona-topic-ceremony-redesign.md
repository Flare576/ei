# 0124: Persona Topic Ceremony Redesign (3-Step)

**Status**: PENDING
**Priority**: HIGH
**Epic**: E009 (Polish & New Features)
**Depends on**: 0123 (PersonaTopic Data Model Separation)
**Blocked by**: None

## Summary

Redesign persona topic detection from a single-pass prompt into a 3-step process (like Human extraction), with weighted scan results to filter noise and structured description generation.

## Background

### Current State

`src/prompts/persona/topics-detection.ts` does everything in one pass:
- Detect which topics were discussed
- Decide exposure adjustments
- Update descriptions
- Return complete topic list

This is asking too much of local LLMs, and the output is often noisy (every mentioned topic becomes a "detected" topic).

### The Human Extraction Model

Human data extraction uses a 3-step process that works well:
1. **Scan**: Extract candidates from conversation
2. **Match**: Map candidates to existing items
3. **Update**: Generate/update the matched or new item

We should apply the same pattern to Persona topics.

### Why This Matters

Persona topics serve a different purpose than Human topics:
- **Human.Topic**: What the human knows/feels (factual, shared)
- **PersonaTopic**: How the persona engages (perspective, approach, stake)

The current single-pass prompt can't do justice to generating thoughtful `perspective`, `approach`, and `personal_stake` fields (from ticket 0123).

## Design

### Step 1: Persona Topic Scan

**Input**: Recent messages, persona name
**Output**: List of topic candidates with weights

```typescript
interface PersonaTopicScanResult {
  topics: Array<{
    name: string;
    message_count: number;  // How many messages touched this topic
    sentiment_signal: number;  // Quick read: -1 to 1
  }>;
}
```

**Key difference from current**: We're NOT asking for descriptions or exposure values. Just "what was discussed" + a weight.

The `message_count` is crucial - it lets us filter noise in Step 2. A topic mentioned in 1 message is probably noise; a topic discussed across 5 messages is significant.

### Step 2: Persona Topic Match

**Input**: Single topic candidate, existing PersonaTopics
**Output**: Match result

```typescript
interface PersonaTopicMatchResult {
  action: "match" | "create" | "skip";
  matched_id?: string;  // If action is "match"
  reason: string;       // Why this decision
}
```

**Decision logic**:
- If candidate matches existing topic → `action: "match"` with `matched_id`
- If no match AND `message_count >= 2` → `action: "create"`
- If no match AND `message_count < 2` → `action: "skip"` (noise)

**Note on "confidence"**: We learned that asking LLMs for confidence scores is unreliable (they make stuff up). Instead, we use the objective `message_count` from Step 1 to make the create/skip decision ourselves.

### Step 3: Persona Topic Update

**Input**: Topic to update (matched or new), recent messages, persona context
**Output**: Updated PersonaTopic with structured fields

```typescript
interface PersonaTopicUpdateResult {
  name: string;
  perspective: string;      // Their view/opinion - ALWAYS populate
  approach: string;         // How they engage - populate if clear signal
  personal_stake: string;   // Why it matters - populate if clear signal
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}
```

**Prompt guidance**:
- `perspective`: Use conversation content + persona traits to infer their view
- `approach`: Only populate if there's a clear pattern in how they discuss this
- `personal_stake`: Only populate if there's evidence of personal connection
- Don't invent, don't embellish, don't apply poetry

## Acceptance Criteria

### Part 1: New Prompts
- [ ] Create `src/prompts/persona/topics-scan.ts` (Step 1)
- [ ] Create `src/prompts/persona/topics-match.ts` (Step 2)
- [ ] Create `src/prompts/persona/topics-update.ts` (Step 3)
- [ ] Update `src/prompts/persona/types.ts` with new data types
- [ ] Add exports to `src/prompts/persona/index.ts`

### Part 2: Handlers
- [ ] Create handler for Step 1: `HandlePersonaTopicScan`
- [ ] Create handler for Step 2: `HandlePersonaTopicMatch`
- [ ] Create handler for Step 3: `HandlePersonaTopicUpdate`
- [ ] Add new `LLMNextStep` enum values
- [ ] Wire handlers in `src/core/handlers/index.ts`

### Part 3: Orchestration
- [ ] Create `src/core/orchestrators/persona-topics.ts`
- [ ] Integrate with existing Ceremony orchestrator
- [ ] Step 1 queues Step 2 for each candidate
- [ ] Step 2 queues Step 3 for matches/creates (skips noise)
- [ ] Step 3 updates PersonaEntity.topics

### Part 4: Cleanup
- [ ] Remove or deprecate old `topics-detection.ts` prompt
- [ ] Update any code that called the old prompt directly

## Implementation Notes

### Reference Files

**Human extraction (follow this pattern):**
```
src/prompts/human/topic-scan.ts      # Step 1 reference
src/prompts/human/item-match.ts      # Step 2 reference  
src/prompts/human/item-update.ts     # Step 3 reference
src/core/orchestrators/human-extraction.ts  # Orchestration reference
```

**Current persona topic code (to replace):**
```
src/prompts/persona/topics-detection.ts  # Current single-pass (deprecated)
src/core/ceremony/explore.ts             # Creates new persona topics
```

### Prompt Design Notes

**Step 1 (Scan)** should be FAST and SIMPLE:
- Don't ask for descriptions
- Don't ask for exposure analysis
- Just: "What topics did {persona} engage with? How many messages each?"

**Step 2 (Match)** should be FOCUSED:
- One topic at a time
- Clear examples of matching vs not matching
- We make the create/skip decision based on message_count, not LLM "confidence"

**Step 3 (Update)** can be THOUGHTFUL:
- This is where the real work happens
- Has context of: persona traits, persona description, existing topic (if match), conversation
- Generates the structured PersonaTopic fields

### Ceremony Integration

The persona topic ceremony currently runs during the nightly Ceremony. This 3-step process should:
1. Run after conversation activity (or during nightly ceremony)
2. Queue as LOW priority (user won't notice the delay)
3. Process all personas that had recent activity

### The "message_count >= 2" Threshold

We chose 2 as the minimum because:
- 1 message = probably just a mention, not real engagement
- 2+ messages = there was back-and-forth, worth tracking

This is configurable if we find it's too aggressive or too lenient.

## Example Flow

```
1. User has conversation with Frodo about "Shire nostalgia" (5 messages) 
   and mentions "Mordor" once in passing

2. Nightly Ceremony triggers Persona Topic processing for Frodo

3. Step 1 (Scan) returns:
   [
     { name: "Shire nostalgia", message_count: 5, sentiment_signal: 0.8 },
     { name: "Mordor", message_count: 1, sentiment_signal: -0.3 }
   ]

4. Step 2 (Match) for "Shire nostalgia":
   - Matches existing topic → action: "match", matched_id: "abc123"
   
5. Step 2 (Match) for "Mordor":
   - No match, message_count: 1 < 2 → action: "skip"

6. Step 3 (Update) for "Shire nostalgia":
   - Updates perspective: "The Shire represents everything worth fighting for..."
   - Updates approach: "Frodo speaks of the Shire with wistful longing..."
   - Updates personal_stake: "As a hobbit who left home, the Shire is both memory and motivation..."
   - Bumps exposure_current

7. "Mordor" is skipped - no PersonaTopic created for passing mention
```

## Testing

- [ ] Build passes
- [ ] Step 1 correctly extracts topics with message counts
- [ ] Step 2 correctly matches existing topics
- [ ] Step 2 correctly skips low-count topics
- [ ] Step 3 generates structured PersonaTopic fields
- [ ] Full flow works end-to-end in Ceremony
- [ ] Existing persona topics are preserved/updated correctly

## Related

- **0123**: PersonaTopic Data Model - creates the data structure this ticket populates
- This ticket should be implemented AFTER 0123

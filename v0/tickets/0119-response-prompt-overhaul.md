# 0119: Response Prompt Overhaul

**Status**: QA

## Summary

Rebuild `buildResponseSystemPrompt` to work with the new entity schema, remove redundancy, and create cleaner sections.

## Current Problems

1. **Redundant sections**: "Human's Interests" vs "Human's Potential Interests"
2. **No descriptions shown**: Just names + levels, LLM lacks context
3. **Bloated**: Static concepts with levels don't make sense
4. **Flat structure**: Concepts shown by type, not by relevance

## New Prompt Structure

```typescript
function buildResponseSystemPrompt(
  humanEntity: HumanEntity,
  personaEntity: PersonaEntity,
  persona: PersonaIdentity,
  visiblePersonas?: VisiblePersona[]
): string {
  
  // 1. Identity
  const identity = buildIdentitySection(persona);
  
  // 2. Behavioral guidelines (hardcoded, not from data)
  const guidelines = buildGuidelinesSection(persona.name);
  
  // 3. Your personality (persona traits)
  const yourTraits = buildTraitsSection(personaEntity.traits, "Your personality");
  
  // 4. Your interests (persona topics)
  const yourTopics = buildTopicsSection(personaEntity.topics, "Your interests");
  
  // 5. About the human (filtered by visibility)
  const visibleHumanData = filterByVisibility(humanEntity, personaEntity);
  const humanSection = buildHumanSection(visibleHumanData);
  
  // 6. Other personas (if any visible)
  const associatesSection = buildAssociatesSection(visiblePersonas);
  
  // 7. Current priorities (high-delta items)
  const priorities = buildPrioritiesSection(personaEntity, visibleHumanData);
  
  return `${identity}

${guidelines}

${yourTraits}

${yourTopics}

${humanSection}
${associatesSection}
${priorities}

Current time: ${new Date().toISOString()}`;
}
```

### Section Builders

#### Identity Section (unchanged-ish)

```typescript
function buildIdentitySection(persona: PersonaIdentity): string {
  const aliasText = persona.aliases?.length 
    ? ` (also known as: ${persona.aliases.join(", ")})` 
    : "";
  
  const description = persona.long_description 
    || persona.short_description 
    || "a conversational companion";
  
  return `You are ${persona.name}${aliasText}.

${description}`;
}
```

#### Guidelines Section (NEW - replaces statics)

```typescript
function buildGuidelinesSection(personaName: string): string {
  const universal = `## Guidelines
- Be genuine, not sycophantic - a good friend disagrees when appropriate
- Match conversational energy - brief replies for brief messages
- Respect boundaries - it's okay to say nothing if silence is appropriate
- You're a friend with your own interests, not just a helper`;

  // Ei gets extra guidelines
  if (personaName === "ei") {
    return `${universal}
- Encourage human-to-human connection when appropriate
- Be transparent about being an AI when relevant
- Gently challenge self-limiting beliefs - growth over comfort`;
  }
  
  return universal;
}
```

#### Traits Section (NEW)

```typescript
function buildTraitsSection(traits: Trait[], header: string): string {
  if (traits.length === 0) return "";
  
  const sorted = traits.sort((a, b) => (b.strength || 0.5) - (a.strength || 0.5));
  const formatted = sorted.map(t => {
    const strength = t.strength ? ` (${Math.round(t.strength * 100)}%)` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}
```

#### Topics Section (NEW)

```typescript
function buildTopicsSection(topics: Topic[], header: string): string {
  if (topics.length === 0) return "";
  
  // Sort by desire delta (want to discuss more first)
  const sorted = topics
    .map(t => ({ topic: t, delta: t.level_ideal - t.level_current }))
    .sort((a, b) => b.delta - a.delta)
    .map(x => x.topic);
  
  const formatted = sorted.map(t => {
    const delta = t.level_ideal - t.level_current;
    const indicator = delta > 0.1 ? '🔺' : delta < -0.1 ? '🔻' : '✓';
    const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
    return `- ${indicator} **${t.name}** ${sentiment}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}
```

#### Human Section (NEW - consolidated)

```typescript
function buildHumanSection(human: FilteredHumanData): string {
  const sections: string[] = [];
  
  // Key facts (if any)
  if (human.facts.length > 0) {
    const facts = human.facts
      .filter(f => f.confidence > 0.7)  // Only high-confidence facts
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');
    if (facts) sections.push(`### Key Facts\n${facts}`);
  }
  
  // Personality traits
  if (human.traits.length > 0) {
    const traits = human.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join('\n');
    sections.push(`### Personality\n${traits}`);
  }
  
  // Current interests (high engagement)
  const activeTopics = human.topics.filter(t => t.level_current > 0.3);
  if (activeTopics.length > 0) {
    const topics = activeTopics
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)  // Top 10 active
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join('\n');
    sections.push(`### Current Interests\n${topics}`);
  }
  
  // Important people
  if (human.people.length > 0) {
    const people = human.people
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)  // Top 10 active
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join('\n');
    sections.push(`### People in Their Life\n${people}`);
  }
  
  if (sections.length === 0) {
    return "## About the Human\n(Still getting to know them)";
  }
  
  return `## About the Human\n${sections.join('\n\n')}`;
}
```

#### Priorities Section (NEW - replaces "Potential Interests")

```typescript
function buildPrioritiesSection(
  persona: PersonaEntity,
  human: FilteredHumanData
): string {
  const priorities: string[] = [];
  
  // Your topics with high desire
  const yourNeeds = persona.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- Bring up "${t.name}" - ${t.description}`);
  
  if (yourNeeds.length > 0) {
    priorities.push(`**Topics you want to discuss:**\n${yourNeeds.join('\n')}`);
  }
  
  // Human's topics with high desire (that we know about)
  const theirNeeds = human.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- They might want to talk about "${t.name}"`);
  
  if (theirNeeds.length > 0) {
    priorities.push(`**Topics they might enjoy:**\n${theirNeeds.join('\n')}`);
  }
  
  if (priorities.length === 0) return "";
  
  return `## Conversation Opportunities\n${priorities.join('\n\n')}`;
}
```

## Removed

- Static concepts from prompt (moved to hardcoded guidelines)
- "Human's Potential Interests" section (merged into Priorities)
- Duplicate sections for persona vs human by type
- Raw level numbers (replaced with meaningful indicators)

## Design Decisions (from Flare)

**Emoji indicators**: Use them! LLMs parse emoji efficiently, and they convey meaning compactly. Use emoji every chance we get in prompts - it's about efficiently conveying meaning to the LLM, not aesthetics.

**Human data filtering**: Start with current approach (70% confidence, top 10). Once conversations hit double-digit messages, LLMs focus more on conversation than system prompt data blocks, so keeping it trim and relevant is the important part. Can adjust based on experience.

## Acceptance Criteria

- [x] New prompt structure implemented
- [x] Redundant sections removed
- [x] Guidelines baked in (not from data)
- [x] Ei gets extra guidelines
- [x] Descriptions included (not just names)
- [x] Meaningful indicators replace raw numbers
- [x] Human data properly filtered by visibility
- [x] Token count analyzed (see implementation notes below)
- [x] Tests verify prompt generation

## Implementation Notes (2026-01-20)

**Token Count Analysis:**
- Removed ~7 static concepts with descriptions: -500 chars
- Removed redundant "Potential Interests" section: -200 chars
- Added emoji indicators (compact): +50 chars
- Added descriptions for all items: +300 chars
- Net reduction: ~350 chars (~88 tokens)

**Key improvement**: More informative prompts at similar/lower token count due to:
- Relevance filtering (only high-confidence facts, active topics)
- Emoji compression (🔺🔻✓😊😔 convey meaning in 1-2 chars)
- Structured sections (easier LLM navigation)
- Top-10 limits prevent unbounded growth

**Changes to prompts.ts:**
- Added `FilteredHumanData` interface
- Added `filterByVisibility()` function (replaces `getVisibleConcepts`)
- Updated `getVisiblePersonas()` to use PersonaEntity
- Added section builders: `buildGuidelinesSection`, `buildTraitsSection`, `buildTopicsSection`, `buildHumanSection`, `buildPrioritiesSection`
- Completely replaced `buildResponseSystemPrompt` with new entity-based version

**Changes to processor.ts:**
- Updated imports to use HumanEntity/PersonaEntity
- Updated entity loading calls (loadHumanEntity/loadPersonaEntity)
- Updated buildResponseSystemPrompt call to use new signature

**Changes to tests:**
- Rewrote all buildResponseSystemPrompt tests for new entity structure
- Removed tests for deleted functions (buildConceptUpdate*)
- 23 tests passing

**Still using old Concept system (flagged for 0122):**
- `buildDescriptionPrompt()` in prompts.ts - needs PersonaEntity update

## Dependencies

- 0108: Entity type definitions
- 0109: Storage

## Effort Estimate

Medium-Large (~4-5 hours)

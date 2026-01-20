# 0112: Detail Update Prompts

**Status**: PENDING

## Summary

Implement the second phase of two-phase extraction. Each detail prompt focuses on ONE item, producing more accurate updates than the old "update this entire JSON blob" approach.

## Design

### Prompt Per Data Type

Each type gets a tailored prompt that understands its specific fields and update semantics.

#### Fact Detail Prompt

```typescript
function buildFactDetailPrompt(
  fact: Fact | null,              // null if new
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single FACT about a person.

Facts are biographical, circumstantial data that rarely changes:
- Birthday, age, location
- Occupation, employer
- Family structure (married, kids)
- Hard constraints (allergies, disabilities)
- Stated preferences as facts

## Fields
- name: Short identifier
- description: Context and details
- sentiment: How they FEEL about this fact (-1.0 to 1.0)
- confidence: How certain we are this is accurate (0.0 to 1.0)

## Guidelines
- If this is a NEW fact, extract the core information
- If UPDATING, refine the description with new details
- Set confidence based on how explicitly this was stated
  - Explicit statement ("My birthday is May 26") → 0.9-1.0
  - Clear implication ("I'm turning 40 next month") → 0.7-0.9
  - Inference ("Sounds like they live in Arizona") → 0.4-0.7
- Sentiment reflects emotional weight (neutral for most facts, but "divorced" might carry weight)

Return JSON with all fields.`;

  const currentData = fact 
    ? JSON.stringify(fact, null, 2)
    : '(New fact - create from conversation)';

  const user = `## Current Data
${currentData}

## Conversation
${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

## Task
${isNew ? 'Create this new fact based on the conversation.' : 'Update this fact if the conversation provides new information.'}

If no changes needed, return the original data unchanged.

Return JSON:
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "confidence": 0.9
}`;

  return { system, user };
}
```

#### Trait Detail Prompt

```typescript
function buildTraitDetailPrompt(
  trait: Trait | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single TRAIT of a person.

Traits are personality patterns and behavioral tendencies:
- Communication style (direct, verbose, uses humor)
- Personality characteristics (introverted, optimistic)
- Behavioral patterns (night owl, procrastinator)
- Preferences that define how they ARE (not just what they like)

## Fields
- name: Short identifier
- description: What this trait means, with examples
- sentiment: How they feel about having this trait (-1.0 to 1.0)
- strength: How strongly this trait manifests (0.0 to 1.0, optional)

## Guidelines
- Traits are about HOW someone IS, not WHAT they like (that's a topic)
- Update description to add nuance as you learn more
- Strength indicates consistency/intensity of the trait
- Sentiment: Do they embrace this trait or struggle with it?

Return JSON with all fields.`;

  const currentData = trait
    ? JSON.stringify(trait, null, 2)
    : '(New trait - create from conversation)';

  const user = `## Current Data
${currentData}

## Conversation
${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

## Task
${isNew ? 'Create this new trait based on the conversation.' : 'Update this trait if the conversation reveals more about it.'}

If no changes needed, return the original data unchanged.

Return JSON:
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "strength": 0.7
}`;

  return { system, user };
}
```

#### Topic Detail Prompt

```typescript
function buildTopicDetailPrompt(
  topic: Topic | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single TOPIC that a person discusses.

Topics are subjects with engagement dynamics:
- Hobbies, interests (gaming, gardening)
- Current concerns (work stress, health)
- Media they consume (books, shows)
- Ongoing projects or situations

## Fields
- name: Short identifier
- description: Context about their relationship to this topic
- sentiment: How they FEEL about this topic (-1.0 to 1.0)
- level_current: How recently/actively discussed (0.0 to 1.0)
- level_ideal: How much they WANT to discuss it (0.0 to 1.0)

## Guidelines
- level_current: Increase if actively discussed, will decay over time
- level_ideal: RARELY change - only on explicit preference signals
  - "I don't want to talk about work anymore" → decrease
  - "Tell me more about X!" (repeatedly) → slight increase
- sentiment: Their emotional relationship to the topic
- description: Add context as you learn more

Return JSON with all fields.`;

  const currentData = topic
    ? JSON.stringify(topic, null, 2)
    : '(New topic - create from conversation)';

  const user = `## Current Data
${currentData}

## Conversation
${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

## Task
${isNew ? 'Create this new topic based on the conversation.' : 'Update this topic based on the conversation.'}

If no changes needed, return the original data unchanged.

Return JSON:
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "level_current": 0.5,
  "level_ideal": 0.5
}`;

  return { system, user };
}
```

#### Person Detail Prompt

```typescript
function buildPersonDetailPrompt(
  person: Person | null,
  messages: Message[],
  isNew: boolean,
  knownPersonas: string[]         // To remind LLM these are NOT people
): { system: string; user: string } {
  const system = `You are updating information about a PERSON in someone's life.

People are real humans the user knows:
- Family (daughter, spouse, parent)
- Friends, coworkers, acquaintances
- Service providers they interact with regularly

## NOT People (these are AI Personas - do not confuse):
${knownPersonas.map(p => `- ${p}`).join('\n')}

## Fields
- name: Their name or identifier
- relationship: Their role (daughter, boss, friend, etc.)
- description: Key facts, context, dynamics
- sentiment: How the user feels about this person (-1.0 to 1.0)
- level_current: How recently discussed (0.0 to 1.0)
- level_ideal: How much user wants to discuss them (0.0 to 1.0)

## Guidelines
- Capture relationship dynamics, not just facts
- Include relevant details (age, interests, shared history)
- sentiment: Overall feeling about the relationship
- level_ideal: Some people are discussed frequently (kids), others rarely

Return JSON with all fields.`;

  const currentData = person
    ? JSON.stringify(person, null, 2)
    : '(New person - create from conversation)';

  const user = `## Current Data
${currentData}

## Conversation
${messages.map(m => `[${m.role}]: ${m.content}`).join('\n\n')}

## Task
${isNew ? 'Create this new person based on the conversation.' : 'Update this person based on the conversation.'}

If no changes needed, return the original data unchanged.

Return JSON:
{
  "name": "...",
  "relationship": "...",
  "description": "...",
  "sentiment": 0.0,
  "level_current": 0.5,
  "level_ideal": 0.5
}`;

  return { system, user };
}
```

### Processing Logic

**Parallelism Strategy** (from Flare):
- **Local provider**: Sequential (local LM Studio has limited concurrency)
- **Cloud provider** (OpenAI, Anthropic, etc.): Parallel with max 3 concurrent
- Configurable per provider

```typescript
async function runDetailUpdate(
  payload: DetailUpdatePayload,
  signal?: AbortSignal
): Promise<void> {
  const { target, persona, data_type, item_name, messages, is_new } = payload;
  
  // 1. Load entity
  const entity = target === "human"
    ? await loadHumanEntity()
    : await loadPersonaEntity(persona);
  
  // 2. Find existing item (if not new)
  const existingItem = is_new ? null : findItemByName(entity, data_type, item_name);
  
  // 3. Build appropriate prompt
  const prompts = buildDetailPrompt(data_type, existingItem, messages, is_new);
  
  // 4. Call LLM (respects provider concurrency limits)
  const result = await callLLMForJSON(
    prompts.system,
    prompts.user,
    { signal, temperature: 0.3, operation: "detail_update" }
  );
  
  if (!result) return;
  
  // 5. Validate and merge
  const validated = validateDetailResult(result, data_type);
  if (!validated) return;
  
  // 6. Record change log entry (for Ei)
  const changeEntry = buildChangeEntry(persona, existingItem, validated);
  validated.change_log = [...(existingItem?.change_log || []), changeEntry];
  validated.last_updated = new Date().toISOString();
  validated.learned_by = validated.learned_by || persona;
  
  // 7. Save
  await upsertItem(entity, data_type, validated);
}

// Provider-aware queue processor
async function processDetailUpdateQueue(): Promise<void> {
  const provider = getCurrentProvider();  // From model config
  const maxConcurrent = provider === "local" ? 1 : 3;
  
  const pending = await getPendingDetailUpdates();
  const batches = chunk(pending, maxConcurrent);
  
  for (const batch of batches) {
    await Promise.all(batch.map(item => runDetailUpdate(item.payload)));
  }
}

function buildDetailPrompt(
  type: "fact" | "trait" | "topic" | "person",
  existing: DataItemBase | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  switch (type) {
    case "fact": return buildFactDetailPrompt(existing as Fact | null, messages, isNew);
    case "trait": return buildTraitDetailPrompt(existing as Trait | null, messages, isNew);
    case "topic": return buildTopicDetailPrompt(existing as Topic | null, messages, isNew);
    case "person": return buildPersonDetailPrompt(existing as Person | null, messages, isNew, []);
  }
}
```

## Persona Description Regeneration

**When to regenerate** (from Flare):
- **On trait changes**: Personality shifts warrant description update
- **On user request**: Via `/clarify persona` command
- **NOT on topic changes**: Too frequent, topics don't define core identity

```typescript
async function maybeRegeneratePersonaDescriptions(
  persona: string,
  entity: PersonaEntity,
  changedType: "trait" | "topic"
): Promise<void> {
  // Ei's descriptions are locked
  if (persona === "ei") return;
  
  // Only regenerate on trait changes
  if (changedType !== "trait") return;
  
  const descriptions = await generatePersonaDescriptions(persona, entity);
  if (descriptions) {
    entity.short_description = descriptions.short_description;
    entity.long_description = descriptions.long_description;
  }
}
```

## Acceptance Criteria

- [ ] buildFactDetailPrompt implemented
- [ ] buildTraitDetailPrompt implemented
- [ ] buildTopicDetailPrompt implemented
- [ ] buildPersonDetailPrompt implemented
- [ ] runDetailUpdate processes queue items correctly
- [ ] Provider-aware parallelism (local=sequential, cloud=max 3 concurrent)
- [ ] Change log entries created on updates
- [ ] learned_by set on new items
- [ ] Validation prevents invalid data
- [ ] Descriptions regenerate on trait changes only
- [ ] Ei's descriptions never regenerate
- [ ] Tests cover each type, new vs update scenarios, parallelism

## Dependencies

- 0108: Entity type definitions
- 0109: Storage migration
- 0110: LLM queue (detail_update items)
- 0111: Fast-scan (queues detail updates)

## Effort Estimate

Medium-Large (~4-5 hours)

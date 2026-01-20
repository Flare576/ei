/**
 * extraction.ts - Two-phase entity data extraction system
 * 
 * Phase 1 (Fast-Scan): Quickly identify what was discussed
 * Phase 2 (Detail Update): Focused extraction for each flagged item
 * 
 * Part of epic 0107: Entity Data Architecture Overhaul
 */

import { HumanEntity, PersonaEntity, Message } from "./types.js";
import { loadHumanEntity, loadPersonaEntity, listPersonas, appendDebugLog } from "./storage.js";
import { callLLMForJSON } from "./llm.js";
import { enqueueItem, DetailUpdatePayload } from "./llm-queue.js";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Item in the known items list (name + type only for fast scanning)
 */
export interface FastScanItem {
  name: string;
  type: "fact" | "trait" | "topic" | "person";
}

/**
 * Result from fast-scan LLM call
 */
export interface FastScanResult {
  /** Known items that were mentioned in the conversation */
  mentioned: Array<{
    name: string;
    type: "fact" | "trait" | "topic" | "person";
    confidence: "high" | "medium" | "low";
  }>;
  /** New items discovered that should be tracked */
  new_items: Array<{
    name: string;
    type: "fact" | "trait" | "topic" | "person";
    confidence: "high" | "medium" | "low";
    reason: string;
  }>;
}

// ============================================================================
// Item List Extraction
// ============================================================================

/**
 * Extracts a flat list of item names and types from an entity.
 * Used to build the "known items" list for fast-scan prompts.
 */
function extractItemList(entity: HumanEntity | PersonaEntity): FastScanItem[] {
  const items: FastScanItem[] = [];
  
  // All entities have traits and topics
  entity.traits.forEach(t => items.push({ name: t.name, type: "trait" }));
  entity.topics.forEach(t => items.push({ name: t.name, type: "topic" }));
  
  // Only humans have facts and people
  if (entity.entity === "human") {
    entity.facts.forEach(f => items.push({ name: f.name, type: "fact" }));
    entity.people.forEach(p => items.push({ name: p.name, type: "person" }));
  }
  
  return items;
}

// ============================================================================
// Prompt Builders
// ============================================================================

/**
 * Builds the system prompt for fast-scan extraction.
 * 
 * @param target - Whether scanning for human or system/persona data
 * @param knownPersonas - List of persona names to avoid person/persona confusion
 */
function buildFastScanSystemPrompt(
  target: "human" | "system",
  knownPersonas: string[]
): string {
  return `You are scanning a conversation to quickly identify what was discussed.

Your ONLY job is to spot relevant items - do NOT try to categorize or analyze them deeply. Just detect and flag.

Your job is to quickly identify:
1. Which known items were mentioned or relevant
2. Any NEW items that should be tracked long-term

## Known Personas (DO NOT add these as People - they are AI entities)
${knownPersonas.map(p => `- ${p}`).join('\n')}

## Guidelines

**For identifying MENTIONED items:**
- Only flag items that were actually discussed, not just tangentially related
- "high" confidence = explicitly discussed
- "medium" confidence = clearly referenced but not the focus
- "low" confidence = might be relevant, uncertain

**For suggesting NEW items:**
- Be CONSERVATIVE - only suggest genuinely important, long-term relevant items
- Ignore: greetings, small talk, one-off mentions, jokes
- Ignore: roleplay-only content (unless it reveals real information)

**Type hints:**
- fact: Biographical data (birthday, location, job, allergies, etc.)
- trait: Personality patterns, communication style, behavioral tendencies
- topic: Interests, hobbies, subjects they care about discussing
- person: Real people in their life (NOT AI personas)

Return JSON only.`;
}

/**
 * Builds the user prompt for fast-scan extraction.
 * 
 * @param target - Whether scanning for human or system/persona data
 * @param items - List of currently known items
 * @param messages - Conversation messages to scan
 */
function buildFastScanUserPrompt(
  target: "human" | "system",
  items: FastScanItem[],
  messages: Message[]
): string {
  const itemList = items.length > 0
    ? items.map(i => `- [${i.type}] ${i.name}`).join('\n')
    : '(none yet)';
  
  const messageText = messages.map(m => 
    `[${m.role}]: ${m.content}`
  ).join('\n\n');

  return `## Known Items
${itemList}

## Conversation
${messageText}

## Task
Identify mentioned items and suggest new ones.

Return JSON:
{
  "mentioned": [
    { "name": "...", "type": "fact|trait|topic|person", "confidence": "high|medium|low" }
  ],
  "new_items": [
    { "name": "...", "type": "fact|trait|topic|person", "confidence": "high|medium|low", "reason": "..." }
  ]
}`;
}

// ============================================================================
// Fast-Scan Execution
// ============================================================================

/**
 * Runs a fast-scan extraction on a conversation chunk.
 * 
 * This is Phase 1 of the two-phase extraction system. It quickly identifies
 * which items were mentioned and flags potential new items for detailed extraction.
 * 
 * @param target - "human" for user data, "system" for persona data
 * @param persona - The persona involved in the conversation
 * @param messages - Messages to scan
 * @param signal - Optional abort signal for cancellation
 * @returns FastScanResult or null if the scan fails
 */
export async function runFastScan(
  target: "human" | "system",
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<FastScanResult | null> {
  try {
    // 1. Load current entity to get item names
    const entity = target === "human" 
      ? await loadHumanEntity()
      : await loadPersonaEntity(persona);
    
    // 2. Build item list (names + types only, no descriptions)
    const items = extractItemList(entity);
    
    // 3. Get known persona names (to filter out persona/person confusion)
    const personas = await listPersonas();
    const personaNames = personas.flatMap(p => [p.name, ...(p.aliases || [])]);
    
    // 4. Call LLM
    const result = await callLLMForJSON<FastScanResult>(
      buildFastScanSystemPrompt(target, personaNames),
      buildFastScanUserPrompt(target, items, messages),
      { signal, temperature: 0.3, operation: "concept" }
    );
    
    // 5. Filter out any new_items that match persona names (belt + suspenders)
    if (result?.new_items) {
      result.new_items = result.new_items.filter(item => 
        !personaNames.some(p => 
          p.toLowerCase() === item.name.toLowerCase()
        )
      );
    }
    
    return result;
  } catch (err) {
    // Don't throw - extraction failures are non-critical
    // Caller can check for null and decide whether to retry
    return null;
  }
}

// ============================================================================
// Post-Scan Routing
// ============================================================================

/**
 * Routes fast-scan results to appropriate queue items.
 * 
 * High/medium confidence items → detail_update queue (Phase 2)
 * Low confidence items → ei_validation queue (human verification)
 * 
 * @param result - Fast-scan result to route
 * @param target - "human" or "system"
 * @param persona - Persona name
 * @param messages - Original messages (needed for detail updates)
 */
export async function routeFastScanResults(
  result: FastScanResult,
  target: "human" | "system",
  persona: string,
  messages: Message[]
): Promise<void> {
  // High/medium confidence → queue detail updates
  const forDetailUpdate = [
    ...result.mentioned.filter(i => i.confidence !== "low"),
    ...result.new_items.filter(i => i.confidence !== "low")
  ];
  
  for (const item of forDetailUpdate) {
    await enqueueItem({
      type: "detail_update",
      priority: "normal",
      payload: {
        target,
        persona,
        data_type: item.type,
        item_name: item.name,
        messages,
        is_new: result.new_items.some(n => n.name === item.name)
      }
    });
  }
  
  // Low confidence → queue for Ei validation
  const forValidation = [
    ...result.mentioned.filter(i => i.confidence === "low"),
    ...result.new_items.filter(i => i.confidence === "low")
  ];
  
  for (const item of forValidation) {
    await enqueueItem({
      type: "ei_validation",
      priority: "low",
      payload: {
        validation_type: "data_confirm",
        item_name: item.name,
        data_type: item.type,
        confidence: item.confidence === "low" ? 0.3 : 0.5,  // Numeric confidence
        context: `Detected "${item.name}" (${item.type}) with low confidence. ${
          result.new_items.some(n => n.name === item.name) 
            ? `Reason: ${result.new_items.find(n => n.name === item.name)?.reason}`
            : 'Mentioned but unclear if relevant.'
        }`
      }
    });
  }
}

// ============================================================================
// Phase 2: Detail Update Prompts
// ============================================================================

import type { Fact, Trait, Topic, Person, DataItemBase, ChangeEntry } from "./types.js";
import { saveHumanEntity, savePersonaEntity } from "./storage.js";

/**
 * Build prompts for updating a specific Fact.
 */
function buildFactDetailPrompt(
  fact: Fact | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single FACT about a person.

Facts are biographical, circumstantial data that rarely changes:
- 📅 Birthday, age, location
- 💼 Occupation, employer
- 👨‍👩‍👧 Family structure (married, kids)
- 🚫 Hard constraints (allergies, disabilities)
- ✅ Stated preferences as facts

## Fields
- name: Short identifier
- description: Context and details
- sentiment: How they FEEL about this fact (-1.0 to 1.0)
- confidence: How certain we are this is accurate (0.0 to 1.0)

## Guidelines
- If this is a NEW fact, extract the core information
- If UPDATING, refine the description with new details
- Set confidence based on how explicitly this was stated:
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

/**
 * Build prompts for updating a specific Trait.
 */
function buildTraitDetailPrompt(
  trait: Trait | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single TRAIT of a person.

Traits are personality patterns and behavioral tendencies:
- 💬 Communication style (direct, verbose, uses humor)
- 🧠 Personality characteristics (introverted, optimistic)
- 🔄 Behavioral patterns (night owl, procrastinator)
- 🎭 Preferences that define how they ARE (not just what they like)

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

/**
 * Build prompts for updating a specific Topic.
 */
function buildTopicDetailPrompt(
  topic: Topic | null,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const system = `You are updating a single TOPIC that a person discusses.

Topics are subjects with engagement dynamics:
- 🎮 Hobbies, interests (gaming, gardening)
- 😰 Current concerns (work stress, health)
- 📺 Media they consume (books, shows)
- 🔧 Ongoing projects or situations

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

/**
 * Build prompts for updating a specific Person.
 */
function buildPersonDetailPrompt(
  person: Person | null,
  messages: Message[],
  isNew: boolean,
  knownPersonas: string[]
): { system: string; user: string } {
  const system = `You are updating information about a PERSON in someone's life.

People are real humans the user knows:
- 👨‍👩‍👧‍👦 Family (daughter, spouse, parent)
- 👥 Friends, coworkers, acquaintances
- 🔧 Service providers they interact with regularly

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

// ============================================================================
// Detail Update Execution
// ============================================================================

/**
 * Find an existing item by name within an entity's data buckets.
 */
function findItemByName(
  entity: HumanEntity | PersonaEntity,
  dataType: "fact" | "trait" | "topic" | "person",
  name: string
): DataItemBase | null {
  const bucketMap = {
    fact: entity.entity === "human" ? entity.facts : [],
    trait: entity.traits,
    topic: entity.topics,
    person: entity.entity === "human" ? entity.people : [],
  };
  
  const bucket = bucketMap[dataType];
  const found = bucket.find(item => item.name.toLowerCase() === name.toLowerCase());
  return found || null;
}

/**
 * Upsert (insert or update) a data item into an entity.
 */
function upsertItem(
  entity: HumanEntity | PersonaEntity,
  dataType: "fact" | "trait" | "topic" | "person",
  item: DataItemBase
): void {
  const bucketMap = {
    fact: entity.entity === "human" ? entity.facts : [],
    trait: entity.traits,
    topic: entity.topics,
    person: entity.entity === "human" ? entity.people : [],
  };
  
  const bucket = bucketMap[dataType];
  const existingIndex = bucket.findIndex(
    existing => existing.name.toLowerCase() === item.name.toLowerCase()
  );
  
  if (existingIndex >= 0) {
    bucket[existingIndex] = item as any;
  } else {
    bucket.push(item as any);
  }
}

/**
 * Build a change log entry for Ei review.
 */
function buildChangeEntry(
  persona: string,
  previousItem: DataItemBase | null,
  newItem: DataItemBase
): ChangeEntry {
  const deltaSize = previousItem 
    ? Math.abs(JSON.stringify(newItem).length - JSON.stringify(previousItem).length)
    : JSON.stringify(newItem).length;
  
  return {
    date: new Date().toISOString(),
    persona,
    delta_size: deltaSize,
    previous_value: previousItem ? JSON.stringify(previousItem) : undefined,
  };
}

/**
 * Validate detail update result based on data type.
 * Returns validated item or null if invalid.
 */
function validateDetailResult(
  result: any,
  dataType: "fact" | "trait" | "topic" | "person"
): DataItemBase | null {
  if (!result || typeof result !== "object") return null;
  if (!result.name || !result.description) return null;
  if (typeof result.sentiment !== "number") return null;
  
  if (dataType === "fact") {
    if (typeof result.confidence !== "number") return null;
  } else if (dataType === "trait") {
    if (result.strength !== undefined && typeof result.strength !== "number") return null;
  } else if (dataType === "topic" || dataType === "person") {
    if (typeof result.level_current !== "number") return null;
    if (typeof result.level_ideal !== "number") return null;
    if (dataType === "person" && !result.relationship) return null;
  }
  
  return result as DataItemBase;
}

/**
 * Run a detail update for a single data item.
 * This is Phase 2 of the two-phase extraction system.
 * 
 * @param payload - Detail update payload from the queue
 * @param signal - Optional abort signal
 */
export async function runDetailUpdate(
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
  const prompts = await buildDetailPromptByType(
    data_type,
    existingItem,
    messages,
    is_new
  );
  
  // 4. Call LLM
  const result = await callLLMForJSON(
    prompts.system,
    prompts.user,
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!result) {
    appendDebugLog(`[DetailUpdate] No result from LLM for ${item_name}`);
    return;
  }
  
  // 5. Validate and merge
  const validated = validateDetailResult(result, data_type);
  if (!validated) {
    appendDebugLog(`[DetailUpdate] Invalid result for ${item_name}: ${JSON.stringify(result)}`);
    return;
  }
  
  // 6. Record change log entry (for Ei)
  const changeEntry = buildChangeEntry(persona, existingItem, validated);
  validated.change_log = [...(existingItem?.change_log || []), changeEntry];
  validated.last_updated = new Date().toISOString();
  validated.learned_by = validated.learned_by || persona;
  
  // 7. Upsert into entity
  upsertItem(entity, data_type, validated);
  
  // 8. Save entity
  if (target === "human") {
    await saveHumanEntity(entity as HumanEntity);
  } else {
    await savePersonaEntity(entity as PersonaEntity, persona);
  }
  
  // 9. Record extraction completion (for frequency tracking)
  const { recordExtraction } = await import("./extraction-frequency.js");
  await recordExtraction(target, persona, data_type);
  
  // 10. Check if we need to regenerate persona descriptions
  if (target === "system" && data_type === "trait") {
    await maybeRegeneratePersonaDescriptions(persona, entity as PersonaEntity);
  }
  
  appendDebugLog(
    `[DetailUpdate] ${is_new ? 'Created' : 'Updated'} ${data_type} "${item_name}" for ${target === "human" ? "human" : persona}`
  );
}

/**
 * Build detail prompts based on data type.
 */
async function buildDetailPromptByType(
  dataType: "fact" | "trait" | "topic" | "person",
  existing: DataItemBase | null,
  messages: Message[],
  isNew: boolean
): Promise<{ system: string; user: string }> {
  switch (dataType) {
    case "fact":
      return buildFactDetailPrompt(existing as Fact | null, messages, isNew);
    case "trait":
      return buildTraitDetailPrompt(existing as Trait | null, messages, isNew);
    case "topic":
      return buildTopicDetailPrompt(existing as Topic | null, messages, isNew);
    case "person": {
      const personas = await listPersonas();
      const personaNames = personas.flatMap(p => [p.name, ...(p.aliases || [])]);
      return buildPersonDetailPrompt(existing as Person | null, messages, isNew, personaNames);
    }
  }
}

/**
 * Regenerate persona descriptions if traits changed.
 * Only regenerates for non-ei personas.
 */
async function maybeRegeneratePersonaDescriptions(
  persona: string,
  entity: PersonaEntity
): Promise<void> {
  if (persona === "ei") return;
  
  await enqueueItem({
    type: "description_regen",
    priority: "low",
    payload: {
      persona
    }
  });
  
  appendDebugLog(`[DetailUpdate] Queued description regeneration for ${persona}`);
}

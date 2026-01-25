/**
 * extraction.ts - Two-phase entity data extraction system
 * 
 * Phase 1 (Fast-Scan): Quickly identify what was discussed
 * Phase 2 (Detail Update): Focused extraction for each flagged item
 * 
 * Part of epic 0107: Entity Data Architecture Overhaul
 */

import { HumanEntity, PersonaEntity, Message } from "./types.js";
import { loadHumanEntity, loadPersonaEntity, listPersonas, appendDebugLog, loadExtractionState } from "./storage.js";
import { callLLMForJSON } from "./llm.js";
import { enqueueItem, DetailUpdatePayload } from "./llm-queue.js";
import { buildStep1FactsPrompt } from "./prompts/extraction/step1/facts.js";
import { buildStep1TraitsPrompt } from "./prompts/extraction/step1/traits.js";
import { buildStep1TopicsPrompt } from "./prompts/extraction/step1/topics.js";
import { buildStep1PeoplePrompt } from "./prompts/extraction/step1/people.js";
import { buildStep2MatchPrompt } from "./prompts/extraction/step2/match.js";
import { buildStep3UpdatePrompt } from "./prompts/extraction/step3/update.js";
import { mapFieldsFromPrompt } from "./prompts/extraction/field-mapping.js";
import { buildPersonaTraitExtractionPrompt } from "./prompts/persona/traits.js";
import { buildPersonaTopicDetectionPrompt } from "./prompts/persona/topics-detection.js";
import { buildPersonaTopicExplorationPrompt } from "./prompts/persona/topics-exploration.js";

// ============================================================================
// Type Definitions
// ============================================================================

export interface Step1FactItem {
  type_of_fact: string;
  value_of_fact: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface Step1TraitItem {
  type_of_trait: string;
  value_of_trait: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface Step1TopicItem {
  type_of_topic: string;
  value_of_topic: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface Step1PersonItem {
  type_of_person: string;
  name_of_person: string;
  confidence: "high" | "medium" | "low";
  reason: string;
}

export interface Step1FactsResult {
  facts: Step1FactItem[];
}

export interface Step1TraitsResult {
  traits: Step1TraitItem[];
}

export interface Step1TopicsResult {
  topics: Step1TopicItem[];
}

export interface Step1PeopleResult {
  people: Step1PersonItem[];
}

export interface Step2MatchResult {
  name: string;
  description: string;
  confidence: "high" | "medium" | "low";
}

export interface Step3UpdateResult {
  name?: string;
  description?: string;
  sentiment?: number;
  strength?: number;
  relationship?: string;
  exposure_current?: number;
  exposure_desired?: number;
  exposure_impact?: "high" | "medium" | "low" | "none";
}

// ============================================================================
// Phase 2: Detail Update Prompts (Legacy - still used by queue)
// ============================================================================

import type { Fact, Trait, Topic, Person, DataItemBase, ChangeEntry } from "./types.js";
import { saveHumanEntity, savePersonaEntity } from "./storage.js";

/**
 * Format messages for display in prompts with clear role labels.
 */
function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[ai_persona: ${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

/**
 * Build prompts for updating a specific Fact.
 */
function buildFactDetailPrompt(
  fact: Fact | null,
  itemName: string,
  persona: string,
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
- Sentiment reflects emotional weight (neutral for most facts, but "divorced" might carry weight)`;

  const currentData = fact 
    ? JSON.stringify(fact, null, 2)
    : `(New fact: "${itemName}" - create from conversation)`;

  const user = `## Current Data
${currentData}

## Conversation
${formatMessagesForPrompt(messages, persona)}

## Task
${isNew ? `Create a new fact called "${itemName}" based on the conversation.` : 'Update this fact if the conversation provides new information.'}

Return JSON:
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "confidence": 0.8
}

**IMPORTANT**: If this fact is not mentioned or demonstrated in the conversation, return: {"skip": true}`;

  return { system, user };
}

/**
 * Build prompts for updating a specific Trait.
 */
function buildTraitDetailPrompt(
  trait: Trait | null,
  itemName: string,
  target: "human" | "system",
  persona: string,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const targetDescription = target === "human"
    ? "You are updating a single TRAIT of the HUMAN USER based on what they've said and done."
    : `You are updating a single TRAIT of the AI PERSONA '${persona}' based on how they've behaved in this conversation, or how the HUMAN USER has asked them to behave.`;

  const evidenceRequirement = target === "human"
    ? `## CRITICAL: Evidence Check

Before creating/updating this trait, identify which message(s) show the HUMAN USER demonstrating this trait through their own words or actions.

**If the trait is:**
- Only mentioned by the AI persona → SKIP (not the human's trait)
- Only described/discussed but not demonstrated → SKIP (no evidence)
- Shown through the human's actual behavior → PROCEED

**Examples of demonstration:**
- Human says "I'm a night owl" → proceed (self-identification)
- Human sends messages at 3am regularly → proceed (behavioral evidence)
- AI says "You seem introverted" but human hasn't shown it → SKIP (no evidence)
- Human tells story about someone else's trait → SKIP (not about them)

If you cannot find a message where the HUMAN demonstrates this trait, return: {"skip": true}`
    : `## CRITICAL: Evidence Check

Before creating/updating this trait, identify which message(s) show the AI PERSONA '${persona}' demonstrating this trait through its own responses.

**If the trait is:**
- Only mentioned by the human about themselves → SKIP (not the persona's trait)
- Only described/discussed but not demonstrated → SKIP (no evidence)
- Shown through the persona's actual response style → PROCEED

**Examples of demonstration:**
- Human describes themselves as "verbose" → SKIP (that's a human trait)
- Persona consistently writes long, detailed responses → PROCEED (behavioral evidence)
- Human asks persona to "be more direct" → PROCEED (requested behavior change)
- Human tells story that mentions a trait → SKIP (not about the persona)

If you cannot find a message where ${persona.toUpperCase()} demonstrates this trait, return: {"skip": true}`;

  const system = `${targetDescription}

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

${evidenceRequirement}`;

  const currentData = trait
    ? JSON.stringify(trait, null, 2)
    : `(New trait: "${itemName}" - create from conversation)`;

  const user = `## Current Data
${currentData}

## Conversation
${formatMessagesForPrompt(messages, persona)}

## Task
${isNew ? `Create a new trait called "${itemName}" - BUT ONLY if you can identify specific messages showing this trait being demonstrated.` : 'Update this trait if the conversation reveals more about it - BUT ONLY if there is actual evidence.'}

Return JSON (you MUST include the evidence field):
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "strength": 0.7,
  "evidence": "Quote the exact message(s) that show this trait being demonstrated. If no evidence exists, return {\"skip\": true} instead."
}`;

  return { system, user };
}

/**
 * Build prompts for updating a specific Topic.
 */
function buildTopicDetailPrompt(
  topic: Topic | null,
  itemName: string,
  target: "human" | "system",
  persona: string,
  messages: Message[],
  isNew: boolean
): { system: string; user: string } {
  const targetDescription = target === "human"
    ? "You are updating a single TOPIC that the HUMAN USER discusses or cares about."
    : `You are updating a single TOPIC that the AI PERSONA '${persona}' discusses or is designed to care about.`;

  const evidenceRequirement = target === "human"
    ? `## CRITICAL: Evidence Check

Before creating/updating this topic, identify messages showing the HUMAN USER engaging with this topic.

**If the topic is:**
- Only mentioned by the AI persona → SKIP (not the human's interest)
- Only discussed in passing without engagement → SKIP (no interest shown)
- Human actively discusses, asks about, or shows emotion about it → PROCEED

**Examples of engagement:**
- Human says "I love gardening" → PROCEED (explicit interest)
- Human shares detailed story about work → PROCEED (active engagement)
- AI mentions "theater" but human doesn't respond → SKIP (no engagement)
- Human tells story where someone else likes X → SKIP (not their topic)

If you cannot find messages showing the HUMAN engaging with this topic, return: {"skip": true}`
    : `## CRITICAL: Evidence Check

Before creating/updating this topic, identify messages showing the AI PERSONA '${persona}' engaging with this topic.

**If the topic is:**
- Only mentioned by the human about themselves → SKIP (not the persona's focus)
- Only discussed because human asked → SKIP (responsive, not interested)
- Persona actively discusses, offers expertise, or shows designed interest → PROCEED

**Examples of engagement:**
- Human discusses their kids' education → SKIP (that's a human topic)
- Persona offers unprompted advice about education → PROCEED (demonstrates expertise)
- Persona asks follow-up questions about the topic → PROCEED (shows interest)
- Human mentions "remote learning" in passing → SKIP (no persona engagement)

If you cannot find messages showing ${persona.toUpperCase()} actively engaging with this topic, return: {"skip": true}`;

  const system = `${targetDescription}

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

${evidenceRequirement}`;

  const currentData = topic
    ? JSON.stringify(topic, null, 2)
    : `(New topic: "${itemName}" - create from conversation)`;

  const user = `## Current Data
${currentData}

## Conversation
${formatMessagesForPrompt(messages, persona)}

## Task
${isNew ? `Create a new topic called "${itemName}" - BUT ONLY if you can identify specific messages showing engagement with this topic.` : 'Update this topic if there is new evidence of engagement.'}

Return JSON (you MUST include the evidence field):
{
  "name": "...",
  "description": "...",
  "sentiment": 0.0,
  "level_current": 0.5,
  "level_ideal": 0.5,
  "evidence": "Quote the exact message(s) that show engagement with this topic. If no evidence exists, return {\"skip\": true} instead."
}`;

  return { system, user };
}

/**
 * Build prompts for updating a specific Person.
 */
function buildPersonDetailPrompt(
  person: Person | null,
  itemName: string,
  persona: string,
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
- level_ideal: Some people are discussed frequently (kids), others rarely`;

  const currentData = person
    ? JSON.stringify(person, null, 2)
    : `(New person: "${itemName}" - create from conversation)`;

  const user = `## Current Data
${currentData}

## Conversation
${formatMessagesForPrompt(messages, persona)}

## Task
${isNew ? `Create a new person called "${itemName}" based on the conversation.` : 'Update this person based on the conversation.'}

Return JSON:
{
  "name": "...",
  "relationship": "...",
  "description": "...",
  "sentiment": 0.0,
  "level_current": 0.5,
  "level_ideal": 0.5
}

**IMPORTANT**: If this person is not mentioned or discussed in the conversation, return: {"skip": true}`;

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
    item_name,
    target,
    persona,
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
  
  // 5. Check for skip signal
  if (result && typeof result === 'object' && 'skip' in result && result.skip === true) {
    appendDebugLog(`[DetailUpdate] Skipped ${data_type} "${item_name}" (entity not relevant)`);
    return;
  }
  
  // 5.5. Check evidence field for traits/topics (debugging aid)
  if (result && typeof result === 'object' && 'evidence' in result) {
    const evidence = result.evidence;
    appendDebugLog(`[DetailUpdate] Evidence for ${data_type} "${item_name}": ${evidence}`);
    
    // Check for weak evidence patterns (LLM trying to dodge the requirement)
    const weakEvidence = [
      'no evidence',
      'not demonstrated',
      'not mentioned',
      'unclear',
      'uncertain',
      'cannot find',
      'no message',
      'not shown'
    ];
    
    const evidenceText = String(evidence).toLowerCase();
    if (weakEvidence.some(pattern => evidenceText.includes(pattern))) {
      appendDebugLog(`[DetailUpdate] Skipped ${data_type} "${item_name}" (weak evidence: "${evidence}")`);
      return;
    }
    
    // Strip evidence field before saving
    delete result.evidence;
  }
  
  // 6. Validate and merge
  const validated = validateDetailResult(result, data_type);
  if (!validated) {
    appendDebugLog(`[DetailUpdate] Invalid result for ${item_name}: ${JSON.stringify(result)}`);
    return;
  }
  
  // 6. Record change log entry (for Ei to review)
  // Skip change log for Ei's own updates - Ei is the arbiter of truth
  if (persona !== "ei") {
    const changeEntry = buildChangeEntry(persona, existingItem, validated);
    validated.change_log = [...(existingItem?.change_log || []), changeEntry];
  }
  validated.last_updated = new Date().toISOString();
  validated.learned_by = validated.learned_by || persona;
  
  // 6.5. Set persona_groups for human data based on active persona's group_primary
  // Only applies to human entity data (persona traits/topics are private to that persona)
  if (target === "human") {
    const personaEntity = await loadPersonaEntity(persona);
    
    if (is_new) {
      validated.persona_groups = personaEntity.group_primary 
        ? [personaEntity.group_primary] 
        : ["*"];
    } else {
      const isGlobal = existingItem?.persona_groups?.includes("*");
      if (isGlobal) {
        validated.persona_groups = ["*"];
      } else {
        const groups = new Set(existingItem?.persona_groups || []);
        if (personaEntity.group_primary) {
          groups.add(personaEntity.group_primary);
        }
        validated.persona_groups = Array.from(groups);
      }
    }
  }
  
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
  
  // 11. Check for cross-persona global updates (ticket 0116)
  if (target === "human") {
    await checkCrossPersonaUpdate(persona, data_type, validated, is_new);
  }
  
  appendDebugLog(
    `[DetailUpdate] ${is_new ? 'Created' : 'Updated'} ${data_type} "${item_name}" for ${target === "human" ? "human" : persona}`
  );
}

/**
 * Check if a non-Ei persona updated a global item.
 * If so, queue for Ei validation in Daily Ceremony.
 * 
 * Part of ticket 0116: Cross-Persona Validation
 */
async function checkCrossPersonaUpdate(
  persona: string,
  dataType: "fact" | "trait" | "topic" | "person",
  item: DataItemBase,
  isNew: boolean
): Promise<void> {
  if (persona === "ei") return;
  
  const isGlobal = !item.persona_groups || 
                   item.persona_groups.length === 0 ||
                   item.persona_groups.includes("*");
  
  if (!isGlobal) return;
  
  const action = isNew ? 'added a new' : 'updated';
  const context = `${persona} ${action} ${dataType}: "${item.name}" - ${item.description}`;
  
  await enqueueItem({
    type: "ei_validation",
    priority: "normal",
    payload: {
      validation_type: "cross_persona",
      item_name: item.name,
      data_type: dataType,
      context,
      source_persona: persona
    }
  });
  
  appendDebugLog(`[CrossPersona] Queued validation for "${item.name}" (updated by ${persona})`);
}

/**
 * Build detail prompts based on data type.
 */
async function buildDetailPromptByType(
  dataType: "fact" | "trait" | "topic" | "person",
  itemName: string,
  target: "human" | "system",
  persona: string,
  existing: DataItemBase | null,
  messages: Message[],
  isNew: boolean
): Promise<{ system: string; user: string }> {
  switch (dataType) {
    case "fact":
      return buildFactDetailPrompt(existing as Fact | null, itemName, persona, messages, isNew);
    case "trait":
      return buildTraitDetailPrompt(existing as Trait | null, itemName, target, persona, messages, isNew);
    case "topic":
      return buildTopicDetailPrompt(existing as Topic | null, itemName, target, persona, messages, isNew);
    case "person": {
      const personas = await listPersonas();
      const personaNames = personas.flatMap(p => [p.name, ...(p.aliases || [])]);
      return buildPersonDetailPrompt(existing as Person | null, itemName, persona, messages, isNew, personaNames);
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

type DataType = "fact" | "trait" | "topic" | "person";

function getItemsOfType(entity: HumanEntity, dataType: DataType): DataItemBase[] {
  switch (dataType) {
    case "fact":
      return entity.facts;
    case "trait":
      return entity.traits;
    case "topic":
      return entity.topics;
    case "person":
      return entity.people;
  }
}

function findByName(items: DataItemBase[], name: string): DataItemBase | null {
  const normalized = name.toLowerCase().trim();
  return items.find(item => item.name.toLowerCase().trim() === normalized) || null;
}

function mapExposureImpactToBoost(impact: string): number {
  switch (impact) {
    case "high": return 0.3;
    case "medium": return 0.2;
    case "low": return 0.1;
    case "none": return 0;
    default: return 0;
  }
}

async function saveDataItem(
  target: "human",
  persona: string,
  dataType: DataType,
  data: Record<string, unknown>,
  isNew: boolean,
  matchedItem: DataItemBase | null = null
): Promise<void> {
  if (target !== "human") {
    throw new Error("Three-step extraction only supports human target currently");
  }

  if (!data.name) {
    appendDebugLog(`[ThreeStep] ERROR: Cannot save ${dataType} without name. Data: ${JSON.stringify(data)}`);
    throw new Error(`Cannot save ${dataType} without name`);
  }

  const entity = await loadHumanEntity();
  const items = getItemsOfType(entity, dataType) as any[];
  
  const now = new Date().toISOString();
  
  if ((dataType === "topic" || dataType === "person") && data.exposure_impact) {
    const impactBoost = mapExposureImpactToBoost(data.exposure_impact as string);
    if (impactBoost > 0) {
      const currentLevel = isNew ? 0.5 : ((matchedItem as any)?.level_current || 0.5);
      data.level_current = Math.min(1.0, currentLevel + impactBoost);
      appendDebugLog(`[ThreeStep] Applied exposure_impact "${data.exposure_impact}": ${currentLevel.toFixed(2)} + ${impactBoost} = ${(data.level_current as number).toFixed(2)}`);
    }
    delete data.exposure_impact;
  }
  
  if (isNew) {
    const newItem: any = {
      name: data.name,
      description: data.description || "",
      sentiment: data.sentiment || 0,
      last_updated: now,
      learned_by: persona,
      persona_groups: ["*"]
    };
    
    if (dataType === "fact") {
      newItem.confidence = data.confidence || 0.5;
    } else if (dataType === "trait") {
      newItem.strength = data.strength;
    } else if (dataType === "topic" || dataType === "person") {
      newItem.level_current = data.level_current || 0.5;
      newItem.level_ideal = data.level_ideal || 0.5;
    }
    
    if (dataType === "person") {
      newItem.relationship = data.relationship || "Unknown";
    }
    
    items.push(newItem);
    appendDebugLog(`[ThreeStep] Created new ${dataType}: ${newItem.name} (total ${items.length} ${dataType}s)`);
  } else {
    if (!matchedItem) {
      appendDebugLog(`[ThreeStep] ERROR: Update mode but no matchedItem provided for ${dataType}`);
      throw new Error(`Update mode requires matchedItem reference`);
    }
    
    const existingItem = findByName(items, matchedItem.name);
    if (!existingItem) {
      appendDebugLog(`[ThreeStep] ERROR: Matched item "${matchedItem.name}" not found in ${items.length} existing ${dataType}s`);
      throw new Error(`Matched item not found: ${matchedItem.name}`);
    }
    
    Object.assign(existingItem, {
      ...data,
      last_updated: now,
      learned_by: persona
    });
    
    appendDebugLog(`[ThreeStep] Updated ${dataType}: ${matchedItem.name} -> ${data.name || matchedItem.name}`);
  }
  
  appendDebugLog(`[ThreeStep] Saving entity with ${items.length} ${dataType}s`);
  await saveHumanEntity(entity);
  appendDebugLog(`[ThreeStep] Entity saved successfully`);
}

export async function runThreeStepExtraction(
  target: "human",
  persona: string,
  messages: Message[],
  dataTypes: DataType[],
  signal?: AbortSignal
): Promise<void> {
  const entityKey = target === "human" ? "human" : `system:${persona}`;
  
  for (const dataType of dataTypes) {
    if (signal?.aborted) return;
    
    const extractionState = await loadExtractionState();
    const dataTypeHistory = extractionState[entityKey]?.[dataType];
    const lastExtractionTimestamp = dataTypeHistory?.last_extraction;
    
    let earlierMessages: Message[] = [];
    let newMessages: Message[] = messages;
    
    if (lastExtractionTimestamp) {
      const lastExtractTime = new Date(lastExtractionTimestamp).getTime();
      earlierMessages = messages.filter(m => new Date(m.timestamp).getTime() <= lastExtractTime);
      newMessages = messages.filter(m => new Date(m.timestamp).getTime() > lastExtractTime);
      appendDebugLog(`[ThreeStep] Split for ${dataType}: ${earlierMessages.length} earlier (context), ${newMessages.length} new (to analyze)`);
    }
    
    if (newMessages.length === 0) {
      appendDebugLog(`[ThreeStep] No new messages to analyze for ${dataType}`);
      continue;
    }
    
    appendDebugLog(`[ThreeStep] Starting ${dataType} extraction`);
    
    const allMessagesForPrompt = [...earlierMessages, ...newMessages];
    const splitIndex = earlierMessages.length;
    
    let step1Result: any = null;
    
    switch (dataType) {
      case "fact": {
        const prompts = buildStep1FactsPrompt(allMessagesForPrompt, persona, splitIndex);
        step1Result = await callLLMForJSON<Step1FactsResult>(
          prompts.system,
          prompts.user,
          { signal, temperature: 0.3, operation: "concept" }
        );
        break;
      }
      case "trait": {
        const prompts = buildStep1TraitsPrompt(allMessagesForPrompt, persona, splitIndex);
        step1Result = await callLLMForJSON<Step1TraitsResult>(
          prompts.system,
          prompts.user,
          { signal, temperature: 0.3, operation: "concept" }
        );
        break;
      }
      case "topic": {
        const prompts = buildStep1TopicsPrompt(allMessagesForPrompt, persona, splitIndex);
        step1Result = await callLLMForJSON<Step1TopicsResult>(
          prompts.system,
          prompts.user,
          { signal, temperature: 0.3, operation: "concept" }
        );
        break;
      }
      case "person": {
        const prompts = await buildStep1PeoplePrompt(allMessagesForPrompt, persona, splitIndex);
        step1Result = await callLLMForJSON<Step1PeopleResult>(
          prompts.system,
          prompts.user,
          { signal, temperature: 0.3, operation: "concept" }
        );
        break;
      }
    }
    
    if (!step1Result) {
      appendDebugLog(`[ThreeStep] Step 1 failed for ${dataType}`);
      continue;
    }
    
    const itemsArray = dataType === "fact" ? step1Result.facts :
                      dataType === "trait" ? step1Result.traits :
                      dataType === "topic" ? step1Result.topics :
                      step1Result.people;
    
    if (!itemsArray || itemsArray.length === 0) {
      appendDebugLog(`[ThreeStep] No ${dataType}s found in Step 1`);
      continue;
    }
    
    appendDebugLog(`[ThreeStep] Found ${itemsArray.length} ${dataType}(s) in Step 1`);
    
    const entity = await loadHumanEntity();
    const existingItems = getItemsOfType(entity, dataType);
    const hasExistingItems = existingItems.length > 0;
    
    if (!hasExistingItems) {
      appendDebugLog(`[ThreeStep] No existing ${dataType}s - skipping Step 2 (matching) for all items`);
    }
    
    for (const item of itemsArray) {
      if (signal?.aborted) return;
      
      if (item.confidence === "low") {
        appendDebugLog(`[ThreeStep] Skipping low-confidence ${dataType}: ${extractItemName(item, dataType)}`);
        continue;
      }
      
      const itemName = extractItemName(item, dataType);
      const itemValue = extractItemValue(item, dataType);
      
      let isNew = !hasExistingItems;
      let matchedItem: DataItemBase | null = null;
      
      if (hasExistingItems) {
        appendDebugLog(`[ThreeStep] Step 2: Matching "${itemName}" (${dataType})`);
        
        const matchPrompts = buildStep2MatchPrompt(
          dataType,
          itemName,
          itemValue,
          existingItems.map(e => ({ name: e.name, description: e.description }))
        );
        
        const step2Result = await callLLMForJSON<Step2MatchResult>(
          matchPrompts.system,
          matchPrompts.user,
          { signal, temperature: 0.3, operation: "concept" }
        );
        
        if (!step2Result) {
          appendDebugLog(`[ThreeStep] Step 2 failed for ${itemName}`);
          continue;
        }
        
        isNew = step2Result.name === "Not Found" || step2Result.description === "Not Found";
        matchedItem = isNew ? null : findByName(existingItems, step2Result.name);
      } else {
        appendDebugLog(`[ThreeStep] Step 2 skipped for "${itemName}" - creating new ${dataType}`);
      }
      
      appendDebugLog(`[ThreeStep] Step 3: ${isNew ? 'Creating' : 'Updating'} "${matchedItem?.name || itemName}"`);
      
      const updatePrompts = buildStep3UpdatePrompt(
        dataType,
        matchedItem,
        allMessagesForPrompt,
        persona,
        isNew ? itemName : undefined,
        isNew ? itemValue : undefined
      );
      
      const step3Result = await callLLMForJSON<Step3UpdateResult>(
        updatePrompts.system,
        updatePrompts.user,
        { signal, temperature: 0.3, operation: "concept" }
      );
      
      if (!step3Result || Object.keys(step3Result).length === 0) {
        appendDebugLog(`[ThreeStep] Step 3 returned empty for ${itemName} - no changes needed`);
        continue;
      }
      
      const mapped = mapFieldsFromPrompt(step3Result as Record<string, unknown>);
      
      if (isNew && !mapped.name) {
        mapped.name = itemName;
        appendDebugLog(`[ThreeStep] Using Step 1 name for new item: ${itemName}`);
      }
      
      await saveDataItem(target, persona, dataType, mapped, isNew, matchedItem);
    }
    
    const { recordExtraction } = await import("./extraction-frequency.js");
    await recordExtraction(target, target === "human" ? null : persona, dataType);
  }
  
  appendDebugLog(`[ThreeStep] Extraction complete for ${dataTypes.join(', ')}`);
}

function extractItemName(item: any, dataType: DataType): string {
  switch (dataType) {
    case "fact":
      return item.type_of_fact;
    case "trait":
      return item.value_of_trait;
    case "topic":
      return item.value_of_topic;
    case "person":
      return item.name_of_person !== "Unknown" ? item.name_of_person : item.type_of_person;
  }
}

function extractItemValue(item: any, dataType: DataType): string {
  switch (dataType) {
    case "fact":
      return item.value_of_fact;
    case "trait":
      return item.value_of_trait;
    case "topic":
      return item.value_of_topic;
    case "person":
      return item.type_of_person;
  }
}

export async function runPersonaTraitExtraction(
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<void> {
  appendDebugLog(`[PersonaTrait] Starting trait extraction for ${persona}`);
  
  const entity = await loadPersonaEntity(persona);
  const existingTraits = entity.traits || [];
  
  const extractionState = await loadExtractionState();
  const entityKey = `system:${persona}`;
  const traitHistory = extractionState[entityKey]?.trait;
  const lastExtractionTimestamp = traitHistory?.last_extraction;
  
  let earlierMessages: Message[] = [];
  let newMessages: Message[] = messages;
  
  if (lastExtractionTimestamp) {
    const lastExtractTime = new Date(lastExtractionTimestamp).getTime();
    earlierMessages = messages.filter(m => new Date(m.timestamp).getTime() <= lastExtractTime);
    newMessages = messages.filter(m => new Date(m.timestamp).getTime() > lastExtractTime);
    appendDebugLog(`[PersonaTrait] Split: ${earlierMessages.length} earlier (context), ${newMessages.length} new (to analyze)`);
  }
  
  if (newMessages.length === 0) {
    appendDebugLog(`[PersonaTrait] No new messages to analyze`);
    return;
  }
  
  const allMessages = [...earlierMessages, ...newMessages];
  const splitIndex = earlierMessages.length;
  const prompts = buildPersonaTraitExtractionPrompt(allMessages, persona, existingTraits, splitIndex);
  const result = await callLLMForJSON<Trait[]>(
    prompts.system,
    prompts.user,
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!result || !Array.isArray(result)) {
    appendDebugLog(`[PersonaTrait] No traits returned or invalid format`);
    return;
  }
  
  const oldTraits = new Map(existingTraits.map(t => [t.name, t]));
  const newTraits = new Map(result.map(t => [t.name, t]));
  
  const added = result.filter(t => !oldTraits.has(t.name));
  const removed = existingTraits.filter(t => !newTraits.has(t.name));
  const modified = result.filter(t => {
    const old = oldTraits.get(t.name);
    if (!old) return false;
    return JSON.stringify(old) !== JSON.stringify(t);
  });
  
  if (added.length > 0) {
    appendDebugLog(`[PersonaTrait] Added: ${added.map(t => `${t.name} (strength: ${t.strength})`).join(', ')}`);
  }
  if (removed.length > 0) {
    appendDebugLog(`[PersonaTrait] Removed: ${removed.map(t => t.name).join(', ')}`);
  }
  if (modified.length > 0) {
    appendDebugLog(`[PersonaTrait] Modified: ${modified.map(t => t.name).join(', ')}`);
  }
  
  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    appendDebugLog(`[PersonaTrait] No changes detected`);
    return;
  }
  
  const now = new Date().toISOString();
  entity.traits = result.map(t => ({
    ...t,
    last_updated: now,
  }));
  
  const { savePersonaEntity } = await import("./storage.js");
  await savePersonaEntity(entity, persona);
  
  await maybeRegeneratePersonaDescriptions(persona, entity);
  
  const { recordExtraction } = await import("./extraction-frequency.js");
  await recordExtraction("system", persona, "trait");
  
  appendDebugLog(`[PersonaTrait] Extraction complete for ${persona}`);
}

export async function runPersonaTopicExtraction(
  persona: string,
  messages: Message[],
  signal?: AbortSignal
): Promise<void> {
  appendDebugLog(`[PersonaTopic] Starting topic extraction for ${persona}`);
  
  const entity = await loadPersonaEntity(persona);
  const existingTopics = entity.topics || [];
  
  const extractionState = await loadExtractionState();
  const entityKey = `system:${persona}`;
  const topicHistory = extractionState[entityKey]?.topic;
  const lastExtractionTimestamp = topicHistory?.last_extraction;
  
  let earlierMessages: Message[] = [];
  let newMessages: Message[] = messages;
  
  if (lastExtractionTimestamp) {
    const lastExtractTime = new Date(lastExtractionTimestamp).getTime();
    earlierMessages = messages.filter(m => new Date(m.timestamp).getTime() <= lastExtractTime);
    newMessages = messages.filter(m => new Date(m.timestamp).getTime() > lastExtractTime);
    appendDebugLog(`[PersonaTopic] Split: ${earlierMessages.length} earlier (context), ${newMessages.length} new (to analyze)`);
  }
  
  if (newMessages.length === 0) {
    appendDebugLog(`[PersonaTopic] No new messages to analyze`);
    return;
  }
  
  const allMessages = [...earlierMessages, ...newMessages];
  const splitIndex = earlierMessages.length;
  
  const detectionPrompts = buildPersonaTopicDetectionPrompt(allMessages, persona, existingTopics, splitIndex);
  const detectedResult = await callLLMForJSON<Array<{
    name: string;
    description: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
  }>>(
    detectionPrompts.system,
    detectionPrompts.user,
    { signal, temperature: 0.3, operation: "concept" }
  );
  
  if (!detectedResult || !Array.isArray(detectedResult)) {
    appendDebugLog(`[PersonaTopic] Detection failed or invalid format`);
    return;
  }
  
  appendDebugLog(`[PersonaTopic] Detection returned ${detectedResult.length} topics`);
  
  const explorationPrompts = buildPersonaTopicExplorationPrompt(
    allMessages,
    persona,
    { short: entity.short_description || '', long: entity.long_description || '' },
    entity.traits || [],
    existingTopics,
    splitIndex
  );
  
  const exploredResult = await callLLMForJSON<Array<{
    name: string;
    description: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
  }>>(
    explorationPrompts.system,
    explorationPrompts.user,
    { signal, temperature: 0.5, operation: "concept" }
  );
  
  if (!exploredResult || !Array.isArray(exploredResult)) {
    appendDebugLog(`[PersonaTopic] Exploration failed or invalid format`);
  } else if (exploredResult.length > 0) {
    appendDebugLog(`[PersonaTopic] Exploration discovered ${exploredResult.length} new topics: ${exploredResult.map(t => t.name).join(', ')}`);
  } else {
    appendDebugLog(`[PersonaTopic] Exploration found no new topics`);
  }
  
  const detectedTopics = detectedResult.map(t => ({
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    level_current: t.exposure_current,
    level_ideal: t.exposure_desired,
    last_updated: new Date().toISOString(),
  }));
  
  const exploredTopics = (exploredResult || []).map(t => ({
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    level_current: t.exposure_current,
    level_ideal: t.exposure_desired,
    last_updated: new Date().toISOString(),
  }));
  
  const mergedTopics = [...detectedTopics];
  const detectedNames = new Set(detectedTopics.map(t => t.name.toLowerCase()));
  
  for (const explored of exploredTopics) {
    if (!detectedNames.has(explored.name.toLowerCase())) {
      mergedTopics.push(explored);
      appendDebugLog(`[PersonaTopic] Adding explored topic: ${explored.name}`);
    } else {
      appendDebugLog(`[PersonaTopic] Skipping duplicate explored topic: ${explored.name}`);
    }
  }
  
  const oldTopics = new Map(existingTopics.map(t => [t.name, t]));
  const newTopics = new Map(mergedTopics.map(t => [t.name, t]));
  
  const added = mergedTopics.filter(t => !oldTopics.has(t.name));
  const removed = existingTopics.filter(t => !newTopics.has(t.name));
  const modified = mergedTopics.filter(t => {
    const old = oldTopics.get(t.name);
    if (!old) return false;
    return JSON.stringify(old) !== JSON.stringify(t);
  });
  
  if (added.length > 0) {
    appendDebugLog(`[PersonaTopic] Added: ${added.map(t => t.name).join(', ')}`);
  }
  if (removed.length > 0) {
    appendDebugLog(`[PersonaTopic] Removed: ${removed.map(t => t.name).join(', ')}`);
  }
  if (modified.length > 0) {
    appendDebugLog(`[PersonaTopic] Modified: ${modified.map(t => t.name).join(', ')}`);
  }
  
  if (added.length === 0 && removed.length === 0 && modified.length === 0) {
    appendDebugLog(`[PersonaTopic] No changes detected`);
    return;
  }
  
  entity.topics = mergedTopics;
  
  const { savePersonaEntity } = await import("./storage.js");
  await savePersonaEntity(entity, persona);
  
  const { recordExtraction } = await import("./extraction-frequency.js");
  await recordExtraction("system", persona, "topic");
  
  appendDebugLog(`[PersonaTopic] Extraction complete for ${persona}`);
}

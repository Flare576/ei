/**
 * extraction.ts - Two-phase entity data extraction system
 * 
 * Phase 1 (Fast-Scan): Quickly identify what was discussed
 * Phase 2 (Detail Update): Focused extraction for each flagged item
 * 
 * Part of epic 0107: Entity Data Architecture Overhaul
 */

import { HumanEntity, PersonaEntity, Message } from "./types.js";
import { loadHumanEntity, loadPersonaEntity, listPersonas } from "./storage.js";
import { callLLMForJSON } from "./llm.js";
import { enqueueItem } from "./llm-queue.js";

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
        validation_type: "fact_confirm",
        item_name: item.name,
        data_type: item.type,
        context: `Detected "${item.name}" (${item.type}) with low confidence. ${
          result.new_items.some(n => n.name === item.name) 
            ? `Reason: ${result.new_items.find(n => n.name === item.name)?.reason}`
            : 'Mentioned but unclear if relevant.'
        }`
      }
    });
  }
}

/**
 * verification.ts - Ei's Daily Ceremony and data verification system
 * 
 * Implements the data verification flow where Ei confirms low-confidence
 * extractions and cross-persona updates with the human user.
 * 
 * Part of epic 0107, ticket 0115: Data Verification Flow
 */

import { 
  HumanEntity, 
  CeremonyConfig, 
  Fact, 
  Trait, 
  Topic, 
  Person, 
  DataItemBase 
} from "./types.js";
import { 
  loadHumanEntity, 
  saveHumanEntity, 
  appendDebugLog 
} from "./storage.js";
import { 
  getPendingValidations, 
  clearValidations, 
  enqueueItem,
  LLMQueueItem, 
  EiValidationPayload 
} from "./llm-queue.js";
import { callLLMForJSON } from "./llm.js";
import { buildVerificationResponsePrompt } from "./prompts/index.js";

const PROTECTED_RELATIONSHIPS = [
  'daughter',
  'son',
  'child',
  'children',
  'kid',
  'kids',
  'baby',
  'infant',
  'toddler',
  'mother',
  'mom',
  'mama',
  'mum',
  'mummy',
  'father',
  'dad',
  'daddy',
  'papa',
  'parent',
  'parents',
  'brother',
  'sister',
  'sibling',
  'siblings',
  'twin',
  'spouse',
  'wife',
  'husband',
  'partner',
  'fiance',
  'fiancé',
  'fiancée',
  'boyfriend',
  'girlfriend',
  'significant other',
  'stepmother',
  'stepmom',
  'stepfather',
  'stepdad',
  'stepparent',
  'stepson',
  'stepdaughter',
  'stepchild',
  'stepbrother',
  'stepsister',
  'stepsibling',
  'adoptive mother',
  'adoptive father',
  'adoptive parent',
  'adopted son',
  'adopted daughter',
  'adopted child',
  'foster mother',
  'foster father',
  'foster parent',
  'foster son',
  'foster daughter',
  'foster child',
  'guardian',
  'mother-in-law',
  'mother in law',
  'father-in-law',
  'father in law',
  'parent-in-law',
  'son-in-law',
  'son in law',
  'daughter-in-law',
  'daughter in law',
  'brother-in-law',
  'brother in law',
  'sister-in-law',
  'sister in law',
  'grandmother',
  'grandma',
  'granny',
  'nana',
  'gran',
  'grandfather',
  'grandpa',
  'granddad',
  'gramps',
  'grandparent',
  'grandparents',
  'grandson',
  'granddaughter',
  'grandchild',
  'grandchildren',
];

export interface VerificationResponse {
  confirmed: string[];
  corrected: Array<{
    name: string;
    correction: string;
  }>;
  rejected: string[];
  roleplay: Array<{
    name: string;
    group: string;
  }>;
  unclear: string[];
}

export async function getCeremonyConfig(): Promise<CeremonyConfig> {
  const entity = await loadHumanEntity();
  return entity.ceremony_config || {
    enabled: true,
    time: "09:00",
    timezone: undefined,
    last_ceremony: undefined
  };
}

export async function updateCeremonyConfig(config: Partial<CeremonyConfig>): Promise<void> {
  const entity = await loadHumanEntity();
  entity.ceremony_config = {
    ...entity.ceremony_config || { enabled: true, time: "09:00" },
    ...config
  };
  await saveHumanEntity(entity);
}

function isNewDay(lastCeremony: string | undefined, now: Date): boolean {
  if (!lastCeremony) return true;
  
  const last = new Date(lastCeremony);
  return (
    last.getFullYear() !== now.getFullYear() ||
    last.getMonth() !== now.getMonth() ||
    last.getDate() !== now.getDate()
  );
}

function isPastCeremonyTime(ceremonyTime: string, now: Date): boolean {
  const [hours, minutes] = ceremonyTime.split(':').map(Number);
  const ceremonyMinutes = hours * 60 + minutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= ceremonyMinutes;
}

export async function shouldRunCeremony(): Promise<boolean> {
  const config = await getCeremonyConfig();
  
  if (!config.enabled) return false;
  
  const now = new Date();
  
  if (!isNewDay(config.last_ceremony, now)) {
    return false;
  }
  
  return isPastCeremonyTime(config.time, now);
}

async function addStalenessChecks(
  validations: LLMQueueItem[],
  entity: HumanEntity
): Promise<void> {
  if (validations.length >= 5) return;
  
  const now = Date.now();
  const SIX_MONTHS = 6 * 30 * 24 * 60 * 60 * 1000;
  
  const stale = [
    ...entity.topics.filter(t => 
      t.level_current < 0.2 && 
      (now - new Date(t.last_updated).getTime()) > SIX_MONTHS
    ).map(t => ({ ...t, item_type: 'topic' as const })),
    ...entity.people.filter(p => {
      const isProtected = PROTECTED_RELATIONSHIPS.some(
        rel => p.relationship.toLowerCase().includes(rel.toLowerCase())
      );
      return (
        !isProtected &&
        p.level_current < 0.2 && 
        (now - new Date(p.last_updated).getTime()) > SIX_MONTHS
      );
    }).map(p => ({ ...p, item_type: 'person' as const }))
  ];
  
  const remaining = 5 - validations.length;
  for (const item of stale.slice(0, remaining)) {
    await enqueueItem({
      type: "ei_validation",
      priority: "low",
      payload: {
        validation_type: "staleness",
        item_name: item.name,
        data_type: item.item_type,
        context: `We haven't talked about "${item.name}" in over 6 months - should I forget about ${item.item_type === 'person' ? 'them' : 'it'}?`
      }
    });
  }
}

export async function buildDailyCeremonyMessage(): Promise<string | null> {
  const entity = await loadHumanEntity();
  let pending = await getPendingValidations();
  
  await addStalenessChecks(pending, entity);
  
  pending = await getPendingValidations();
  
  if (pending.length === 0) {
    return null;
  }
  
  const typeOrder = { fact: 0, person: 1, trait: 2, topic: 3 };
  const sorted = pending
    .sort((a, b) => {
      const payloadA = a.payload as EiValidationPayload;
      const payloadB = b.payload as EiValidationPayload;
      const aOrder = typeOrder[payloadA.data_type] ?? 4;
      const bOrder = typeOrder[payloadB.data_type] ?? 4;
      if (aOrder !== bOrder) return aOrder - bOrder;
      const confA = payloadA.confidence ?? 1.0;
      const confB = payloadB.confidence ?? 1.0;
      return confA - confB;
    })
    .slice(0, 5);
  
  const items = sorted.map((v, i) => {
    const p = v.payload as EiValidationPayload;
    const source = p.source_persona && p.source_persona !== "ei" 
      ? ` (from ${p.source_persona})` 
      : "";
    return `${i + 1}. **${p.item_name}**${source}: ${p.context}`;
  }).join('\n');
  
  return `## Daily Confirmations

I've noted a few things from recent conversations. Mind confirming these?

${items}

Just let me know which are correct, need adjusting, or should be removed entirely. If any were just roleplay or jokes, let me know and I'll keep them separate.`;
}

export async function recordCeremony(): Promise<void> {
  await updateCeremonyConfig({
    last_ceremony: new Date().toISOString()
  });
  appendDebugLog('[Verification] Daily Ceremony completed');
}

export function findDataPointByName(
  entity: HumanEntity, 
  name: string
): (DataItemBase & { item_type: 'fact' | 'trait' | 'topic' | 'person' }) | null {
  for (const fact of entity.facts) {
    if (fact.name === name) {
      return { ...fact, item_type: 'fact' };
    }
  }
  for (const trait of entity.traits) {
    if (trait.name === name) {
      return { ...trait, item_type: 'trait' };
    }
  }
  for (const topic of entity.topics) {
    if (topic.name === name) {
      return { ...topic, item_type: 'topic' };
    }
  }
  for (const person of entity.people) {
    if (person.name === name) {
      return { ...person, item_type: 'person' };
    }
  }
  return null;
}

export function removeDataPointByName(entity: HumanEntity, name: string): void {
  entity.facts = entity.facts.filter(f => f.name !== name);
  entity.traits = entity.traits.filter(t => t.name !== name);
  entity.topics = entity.topics.filter(t => t.name !== name);
  entity.people = entity.people.filter(p => p.name !== name);
}

export async function processVerificationResponse(
  userMessage: string,
  pendingValidations: LLMQueueItem[]
): Promise<VerificationResponse> {
  const validationList = pendingValidations.map(v => {
    const p = v.payload as EiValidationPayload;
    return `- ${p.item_name} (${p.data_type}): ${p.context}`;
  }).join('\n');
  
  const { system, user } = buildVerificationResponsePrompt(validationList, userMessage);
  
  const result = await callLLMForJSON<VerificationResponse>(
    system,
    user,
    { model: undefined, operation: "concept" }
  );
  
  if (!result) {
    throw new Error("Failed to parse verification response from LLM");
  }
  
  return result;
}

export async function applyVerificationResults(
  results: VerificationResponse,
  pendingValidations: LLMQueueItem[]
): Promise<void> {
  const entity = await loadHumanEntity();
  
  for (const name of results.confirmed) {
    const fact = entity.facts.find(f => f.name === name);
    if (fact) {
      fact.confidence = 1.0;
      fact.last_confirmed = new Date().toISOString();
      delete fact.change_log;
    } else {
      const item = entity.traits.find(t => t.name === name) ||
                   entity.topics.find(t => t.name === name) ||
                   entity.people.find(p => p.name === name);
      if (item) {
        delete item.change_log;
      }
    }
  }
  
  for (const { name, correction } of results.corrected) {
    const item = findDataPointByName(entity, name);
    if (item) {
      await enqueueItem({
        type: "detail_update",
        priority: "high",
        payload: {
          target: "human",
          persona: "ei",
          data_type: item.item_type,
          item_name: name,
          messages: [{
            role: "human",
            content: correction,
            timestamp: new Date().toISOString()
          }],
          is_new: false
        }
      });
    }
  }
  
  for (const name of results.rejected) {
    removeDataPointByName(entity, name);
  }
  
  for (const { name, group } of results.roleplay) {
    const item = entity.facts.find(f => f.name === name) ||
                 entity.traits.find(t => t.name === name) ||
                 entity.topics.find(t => t.name === name) ||
                 entity.people.find(p => p.name === name);
    if (item) {
      item.persona_groups = [group];
      delete item.change_log;
    }
  }
  
  await saveHumanEntity(entity);
  
  const processedIds = pendingValidations
    .filter(v => {
      const p = v.payload as EiValidationPayload;
      return !results.unclear.includes(p.item_name);
    })
    .map(v => v.id);
  await clearValidations(processedIds);
  
  appendDebugLog(`[Verification] Processed ${processedIds.length} validations: ${results.confirmed.length} confirmed, ${results.corrected.length} corrected, ${results.rejected.length} rejected, ${results.roleplay.length} moved to groups`);
}

export async function wasLastEiMessageCeremony(): Promise<boolean> {
  const { loadHistory } = await import("./storage.js");
  const history = await loadHistory("ei");
  
  if (history.messages.length === 0) return false;
  
  const lastMessage = history.messages[history.messages.length - 1];
  
  if (lastMessage.role !== "system") return false;
  
  return lastMessage.content.trim().startsWith("## Daily Confirmations");
}

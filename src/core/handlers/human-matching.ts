import {
  ValidationLevel,
  type LLMResponse,
  type Message,
  type Trait,
  type Topic,
  type Fact,
  type Person,
  type Quote,
  type DataItemType,
  type DataItemBase,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { ItemMatchResult, ItemUpdateResult, ExposureImpact } from "../../prompts/human/types.js";
import { queueItemUpdate, type ExtractionContext } from "../orchestrators/index.js";
import { getEmbeddingService, getItemEmbeddingText } from "../embedding-service.js";
import { crossFind } from "../utils/index.js";
import { splitMessagesByTimestamp, getMessageText } from "./utils.js";

export function handleHumanItemMatch(response: LLMResponse, state: StateManager): void {
  const result = response.parsed as ItemMatchResult | undefined;
  if (!result) {
    console.error("[handleHumanItemMatch] No parsed result");
    return;
  }

  const candidateType = response.request.data.candidateType as DataItemType;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  const allMessages = state.messages_get(personaId);
  const { messages_context, messages_analyze } = splitMessagesByTimestamp(allMessages, analyzeFrom);
  const context: ExtractionContext & { itemName: string; itemValue: string; itemCategory?: string } = {
    personaId,
    personaDisplayName,
    messages_context,
    messages_analyze,
    itemName: response.request.data.itemName as string,
    itemValue: response.request.data.itemValue as string,
    itemCategory: response.request.data.itemCategory as string | undefined,
  };

  let resolvedType: DataItemType = candidateType;
  let matched_guid = result.matched_guid;
  if (matched_guid === "new") {
    matched_guid = null;
  } else if (matched_guid) {
    const found = crossFind(matched_guid, state.getHuman());
    if (!found) {
      console.warn(`[handleHumanItemMatch] matched_guid "${matched_guid}" not found in human data — treating as new item`);
      matched_guid = null;
    } else if (found.type === "fact" && found.validated === ValidationLevel.Human) {
      console.log(`[handleHumanItemMatch] Skipping locked fact "${found.name}" (human-validated)`);
      return;
    } else if (!(found.type === "fact" || found.type === "trait" || found.type === "topic" || found.type === "person")) {
      console.warn(`[handleHumanItemMatch] matched_guid "${matched_guid}" resolved to non-human type "${found.type}" - Ignoring`);
      return;
    } else {
      resolvedType = found.type;
      context.itemName = found.name || context.itemName;
      context.itemValue = found.description || context.itemValue;
    }
  }
  result.matched_guid = matched_guid;
  queueItemUpdate(resolvedType, result, context, state);
  const matched = matched_guid ? `matched GUID "${matched_guid}"` : "no match (new item)";
  console.log(`[handleHumanItemMatch] ${resolvedType} "${context.itemName}": ${matched}`);
}

export async function handleHumanItemUpdate(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as ItemUpdateResult | undefined;
  
  if (!result || Object.keys(result).length === 0) {
    console.log("[handleHumanItemUpdate] No changes needed (empty result)");
    return;
  }

  const candidateType = response.request.data.candidateType as DataItemType;
  const isNewItem = response.request.data.isNewItem as boolean;
  const existingItemId = response.request.data.existingItemId as string | undefined;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;

  if (!result.name || !result.description || result.sentiment === undefined) {
    console.error("[handleHumanItemUpdate] Missing required fields in result");
    return;
  }

  const now = new Date().toISOString();
  const resolveItemId = (): string => {
    if (isNewItem || !existingItemId) return crypto.randomUUID();
    const h = state.getHuman();
    const arr = candidateType === "fact" ? h.facts : candidateType === "trait" ? h.traits : candidateType === "topic" ? h.topics : h.people;
    // Guard: if existingItemId isn't in the correct type array, treat as new
    // (prevents cross-type ID reuse when LLM matches against a different type's UUID)
    return arr.find((x: DataItemBase) => x.id === existingItemId) ? existingItemId : crypto.randomUUID();
  };
  const itemId = resolveItemId();

  const persona = state.persona_getById(personaId);
  const personaGroup = persona?.group_primary ?? null;
  const isEi = personaDisplayName.toLowerCase() === "ei";

  const human = state.getHuman();
  const getExistingItem = (): { learned_by?: string; last_changed_by?: string; persona_groups?: string[] } | undefined => {
    if (isNewItem) return undefined;
    switch (candidateType) {
      case "fact": return human.facts.find(f => f.id === existingItemId);
      case "trait": return human.traits.find(t => t.id === existingItemId);
      case "topic": return human.topics.find(t => t.id === existingItemId);
      case "person": return human.people.find(p => p.id === existingItemId);
    }
  };
  const existingItem = getExistingItem();

  const mergeGroups = (existing: string[] | undefined): string[] | undefined => {
    if (!personaGroup) return existing;
    if (isNewItem) return [personaGroup];
    const groups = new Set(existing ?? []);
    groups.add(personaGroup);
    return Array.from(groups);
  };

  let embedding: number[] | undefined;
  try {
    const embeddingService = getEmbeddingService();
    const text = getItemEmbeddingText({ name: result.name, description: result.description });
    embedding = await embeddingService.embed(text);
  } catch (err) {
    console.warn(`[handleHumanItemUpdate] Failed to compute embedding for ${candidateType} "${result.name}":`, err);
  }

  switch (candidateType) {
    case "fact": {
      const fact: Fact = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        validated: ValidationLevel.None,
        validated_date: now,
        last_updated: now,
        learned_by: isNewItem ? personaId : existingItem?.learned_by,
        last_changed_by: personaId,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "fact", fact, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "trait": {
      const trait: Trait = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        strength: (result as any).strength ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaId : existingItem?.learned_by,
        last_changed_by: personaId,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "trait", trait, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "topic": {
      const exposureImpact = (result as any).exposure_impact as ExposureImpact | undefined;
      const itemCategory = response.request.data.itemCategory as string | undefined;
      const existingTopic = human.topics.find(t => t.id === existingItemId);
      const topic: Topic = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        category: (result as any).category ?? itemCategory ?? existingTopic?.category,
        exposure_current: calculateExposureCurrent(exposureImpact),
        exposure_desired: (result as any).exposure_desired ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaId : existingItem?.learned_by,
        last_changed_by: personaId,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "topic", topic, personaDisplayName, isEi, personaGroup);
      break;
    }
    case "person": {
      const exposureImpact = (result as any).exposure_impact as ExposureImpact | undefined;
      const person: Person = {
        id: itemId,
        name: result.name,
        description: result.description,
        sentiment: result.sentiment,
        relationship: (result as any).relationship ?? "Unknown",
        exposure_current: calculateExposureCurrent(exposureImpact),
        exposure_desired: (result as any).exposure_desired ?? 0.5,
        last_updated: now,
        learned_by: isNewItem ? personaId : existingItem?.learned_by,
        last_changed_by: personaId,
        persona_groups: mergeGroups(existingItem?.persona_groups),
        embedding,
      };
      applyOrValidate(state, "person", person, personaDisplayName, isEi, personaGroup);
      break;
    }
  }

  const allMessages = state.messages_get(personaId);
  await validateAndStoreQuotes(result.quotes, allMessages, itemId, personaDisplayName, personaGroup, state);

  console.log(`[handleHumanItemUpdate] ${isNewItem ? "Created" : "Updated"} ${candidateType} "${result.name}"`);
}

async function validateAndStoreQuotes(
  candidates: Array<{ text: string; reason: string }> | undefined,
  messages: Message[],
  dataItemId: string,
  personaName: string,
  personaGroup: string | null,
  state: StateManager
): Promise<void> {
  if (!candidates || candidates.length === 0) return;
  
  for (const candidate of candidates) {
    let found = false;
    for (const message of messages) {
      const msgText = getMessageText(message);
      const start = msgText.indexOf(candidate.text);
      if (start !== -1) {
        const end = start + candidate.text.length;
        
        // Check for ANY overlapping quote in this message (not just exact match)
        const existing = state.human_quote_getForMessage(message.id);
        const overlapping = existing.find(q =>
          q.start !== null && q.end !== null &&
          start < q.end && end > q.start  // ranges overlap
        );
        
        if (overlapping) {
          // Merge: expand to the union of both ranges
          const mergedStart = Math.min(start, overlapping.start!);
          const mergedEnd = Math.max(end, overlapping.end!);
          const mergedText = msgText.slice(mergedStart, mergedEnd);
          
          // Merge data_item_ids and persona_groups (deduplicated)
          const mergedDataItemIds = overlapping.data_item_ids.includes(dataItemId)
            ? overlapping.data_item_ids
            : [...overlapping.data_item_ids, dataItemId];
          const group = personaGroup || "General";
          const mergedGroups = overlapping.persona_groups.includes(group)
            ? overlapping.persona_groups
            : [...overlapping.persona_groups, group];
          
          // Only recompute embedding if the text actually changed
          let embedding = overlapping.embedding;
          if (mergedText !== overlapping.text) {
            try {
              const embeddingService = getEmbeddingService();
              embedding = await embeddingService.embed(mergedText);
            } catch (err) {
              console.warn(`[extraction] Failed to recompute embedding for merged quote: "${mergedText.slice(0, 30)}..."`, err);
            }
          }
          
          state.human_quote_update(overlapping.id, {
            start: mergedStart,
            end: mergedEnd,
            text: mergedText,
            data_item_ids: mergedDataItemIds,
            persona_groups: mergedGroups,
            embedding,
          });
          console.log(`[extraction] Merged overlapping quote: "${mergedText.slice(0, 50)}..." (${mergedStart}-${mergedEnd})`);
          found = true;
          break;
        }
        
        let embedding: number[] | undefined;
        try {
          const embeddingService = getEmbeddingService();
          embedding = await embeddingService.embed(candidate.text);
        } catch (err) {
          console.warn(`[extraction] Failed to compute embedding for quote: "${candidate.text.slice(0, 30)}..."`, err);
        }
        
        const quote: Quote = {
          id: crypto.randomUUID(),
          message_id: message.id,
          data_item_ids: [dataItemId],
          persona_groups: [personaGroup || "General"],
          text: candidate.text,
          speaker: message.role === "human" ? "human" : personaName,
          timestamp: message.timestamp,
          start: start,
          end: end,
          created_at: new Date().toISOString(),
          created_by: "extraction",
          embedding,
        };
        state.human_quote_add(quote);
        console.log(`[extraction] Captured quote: "${candidate.text.slice(0, 50)}..."`);
        found = true;
        break;
      }
    }
    if (!found) {
      console.log(`[extraction] Quote not found in messages, skipping: "${candidate.text?.slice(0, 50)}..."`);
    }
  }
}

function calculateExposureCurrent(impact: ExposureImpact | undefined): number {
  switch (impact) {
    case "high": return 0.9;
    case "medium": return 0.6;
    case "low": return 0.3;
    case "none": return 0.1;
    default: return 0.5;
  }
}

function applyOrValidate(
  state: StateManager,
  dataType: DataItemType,
  item: Fact | Trait | Topic | Person,
  _personaName: string,
  _isEi: boolean,
  _personaGroup: string | null
): void {
  switch (dataType) {
    case "fact": state.human_fact_upsert(item as Fact); break;
    case "trait": state.human_trait_upsert(item as Trait); break;
    case "topic": state.human_topic_upsert(item as Topic); break;
    case "person": state.human_person_upsert(item as Person); break;
  }
}

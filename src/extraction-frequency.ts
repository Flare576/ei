import { HumanEntity, PersonaEntity, Message, EntityExtractionState, ExtractionHistory } from "./types.js";
import {
  loadExtractionState,
  saveExtractionState,
  loadHumanEntity,
  loadPersonaEntity,
  appendDebugLog,
  getRecentMessages,
  loadHistory,
} from "./storage.js";
import { enqueueItem } from "./llm-queue.js";

function createDefaultHistory(): ExtractionHistory {
  return {
    last_extraction: null,
    messages_since_last_extract: 0,
    total_extractions: 0,
  };
}

function createDefaultEntityState(): EntityExtractionState {
  return {
    fact: createDefaultHistory(),
    trait: createDefaultHistory(),
    topic: createDefaultHistory(),
    person: createDefaultHistory(),
  };
}

function shouldExtractByType(
  dataType: "fact" | "trait" | "topic" | "person",
  history: ExtractionHistory
): boolean {
  if (dataType === "topic" || dataType === "person") {
    return true;
  }
  
  const threshold = Math.min(10, history.total_extractions);
  return history.messages_since_last_extract >= threshold;
}

export async function triggerExtraction(
  target: "human" | "system",
  persona: string,
  messages: Message[]
): Promise<void> {
  const state = await loadExtractionState();
  const entityKey = target === "human" ? "human" : `system:${persona}`;
  const entityState = state[entityKey] || createDefaultEntityState();
  
  const typesToExtract: ("fact" | "trait" | "topic" | "person")[] = [];
  
  for (const dataType of ["fact", "trait", "topic", "person"] as const) {
    if (target === "system" && (dataType === "fact" || dataType === "person")) {
      continue;
    }
    
    const history = entityState[dataType];
    if (shouldExtractByType(dataType, history)) {
      typesToExtract.push(dataType);
    }
  }
  
  if (typesToExtract.length > 0) {
    await enqueueItem({
      type: "fast_scan",
      priority: "low",
      payload: {
        target,
        persona,
        messages,
        dataTypes: typesToExtract,
      }
    });
    
    appendDebugLog(
      `[ExtractionFrequency] Queued fast_scan for ${entityKey} (types: ${typesToExtract.join(", ")})`
    );
  }
  
  for (const dataType of ["fact", "trait", "topic", "person"] as const) {
    if (target === "system" && (dataType === "fact" || dataType === "person")) {
      continue;
    }
    entityState[dataType].messages_since_last_extract++;
  }
  
  state[entityKey] = entityState;
  await saveExtractionState(state);
}

export async function recordExtraction(
  entityType: "human" | "system",
  persona: string | null,
  dataType: "fact" | "trait" | "topic" | "person"
): Promise<void> {
  const state = await loadExtractionState();
  const entityKey = entityType === "human" ? "human" : `system:${persona}`;
  const entityState = state[entityKey] || createDefaultEntityState();
  
  entityState[dataType].last_extraction = new Date().toISOString();
  entityState[dataType].messages_since_last_extract = 0;
  entityState[dataType].total_extractions++;
  
  state[entityKey] = entityState;
  await saveExtractionState(state);
  
  appendDebugLog(
    `[ExtractionFrequency] Recorded extraction: ${entityKey}/${dataType} (total: ${entityState[dataType].total_extractions})`
  );
}

export function getItemCount(
  entity: HumanEntity | PersonaEntity,
  dataType: "fact" | "trait" | "topic" | "person"
): number {
  if (entity.entity === "human") {
    switch (dataType) {
      case "fact": return entity.facts.length;
      case "trait": return entity.traits.length;
      case "topic": return entity.topics.length;
      case "person": return entity.people.length;
    }
  } else {
    switch (dataType) {
      case "trait": return entity.traits.length;
      case "topic": return entity.topics.length;
      default: return 0;
    }
  }
}

import { LLMRequestType, LLMPriority, LLMNextStep, type Message, type DataItemType } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildHumanFactScanPrompt,
  buildHumanTraitScanPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
  buildHumanItemMatchPrompt,
  buildHumanItemUpdatePrompt,
  type FactScanCandidate,
  type TraitScanCandidate,
  type TopicScanCandidate,
  type PersonScanCandidate,
  type ItemMatchResult,
} from "../../prompts/human/index.js";

type ScanCandidate = FactScanCandidate | TraitScanCandidate | TopicScanCandidate | PersonScanCandidate;

export interface ExtractionContext {
  personaName: string;
  messages_context: Message[];
  messages_analyze: Message[];
}

export function queueFactScan(context: ExtractionContext, state: StateManager): void {
  const prompt = buildHumanFactScanPrompt({
    persona_name: context.personaName,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanFactScan,
    data: {
      personaName: context.personaName,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queueTraitScan(context: ExtractionContext, state: StateManager): void {
  const prompt = buildHumanTraitScanPrompt({
    persona_name: context.personaName,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanTraitScan,
    data: {
      personaName: context.personaName,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queueTopicScan(context: ExtractionContext, state: StateManager): void {
  const prompt = buildHumanTopicScanPrompt({
    persona_name: context.personaName,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanTopicScan,
    data: {
      personaName: context.personaName,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queuePersonScan(context: ExtractionContext, state: StateManager): void {
  const personas = state.persona_getAll();
  const knownPersonaNames = personas.flatMap(p => p.aliases ?? []);

  const prompt = buildHumanPersonScanPrompt({
    persona_name: context.personaName,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
    known_persona_names: knownPersonaNames,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Normal,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanPersonScan,
    data: {
      personaName: context.personaName,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queueAllScans(context: ExtractionContext, state: StateManager): void {
  queueFactScan(context, state);
  queueTraitScan(context, state);
  queuePersonScan(context, state);
  queueTopicScan(context, state);
}

function truncateDescription(description: string, maxLength: number = 255): string {
  if (description.length <= maxLength) return description;
  return description.slice(0, maxLength) + "...";
}

export function queueItemMatch(
  dataType: DataItemType,
  candidate: ScanCandidate,
  context: ExtractionContext,
  state: StateManager
): void {
  const human = state.getHuman();
  
  let itemName: string;
  let itemValue: string;

  switch (dataType) {
    case "fact":
      itemName = (candidate as FactScanCandidate).type_of_fact;
      itemValue = (candidate as FactScanCandidate).value_of_fact;
      break;
    case "trait":
      itemName = (candidate as TraitScanCandidate).type_of_trait;
      itemValue = (candidate as TraitScanCandidate).value_of_trait;
      break;
    case "topic":
      itemName = (candidate as TopicScanCandidate).value_of_topic;
      itemValue = (candidate as TopicScanCandidate).type_of_topic;
      break;
    case "person":
      itemName = (candidate as PersonScanCandidate).name_of_person;
      itemValue = (candidate as PersonScanCandidate).type_of_person;
      break;
  }

  const allItems: Array<{
    data_type: DataItemType;
    data_id: string;
    data_name: string;
    data_description: string;
  }> = [];

  for (const fact of human.facts) {
    allItems.push({
      data_type: "fact",
      data_id: fact.id,
      data_name: fact.name,
      data_description: dataType === "fact" ? fact.description : truncateDescription(fact.description),
    });
  }

  for (const trait of human.traits) {
    allItems.push({
      data_type: "trait",
      data_id: trait.id,
      data_name: trait.name,
      data_description: dataType === "trait" ? trait.description : truncateDescription(trait.description),
    });
  }

  for (const topic of human.topics) {
    allItems.push({
      data_type: "topic",
      data_id: topic.id,
      data_name: topic.name,
      data_description: dataType === "topic" ? topic.description : truncateDescription(topic.description),
    });
  }

  for (const person of human.people) {
    allItems.push({
      data_type: "person",
      data_id: person.id,
      data_name: person.name,
      data_description: dataType === "person" ? person.description : truncateDescription(person.description),
    });
  }

  const prompt = buildHumanItemMatchPrompt({
    candidate_type: dataType,
    candidate_name: itemName,
    candidate_value: itemValue,
    all_items: allItems,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanItemMatch,
    data: {
      personaName: context.personaName,
      candidateType: dataType,
      itemName,
      itemValue,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queueItemUpdate(
  candidateType: DataItemType,
  matchResult: ItemMatchResult,
  context: ExtractionContext & { itemName: string; itemValue: string; itemCategory?: string },
  state: StateManager
): void {
  const human = state.getHuman();
  const matchedGuid = matchResult.matched_guid;
  const isNewItem = matchedGuid === null;

  let existingItem = null;
  let matchedType: DataItemType | null = null;

  if (!isNewItem) {
    existingItem = human.facts.find(f => f.id === matchedGuid) ?? null;
    if (existingItem) matchedType = "fact";

    if (!existingItem) {
      existingItem = human.traits.find(t => t.id === matchedGuid) ?? null;
      if (existingItem) matchedType = "trait";
    }

    if (!existingItem) {
      existingItem = human.topics.find(t => t.id === matchedGuid) ?? null;
      if (existingItem) matchedType = "topic";
    }

    if (!existingItem) {
      existingItem = human.people.find(p => p.id === matchedGuid) ?? null;
      if (existingItem) matchedType = "person";
    }
  }

  const prompt = buildHumanItemUpdatePrompt({
    data_type: candidateType,
    existing_item: existingItem,
    messages_context: context.messages_context,
    messages_analyze: context.messages_analyze,
    persona_name: context.personaName,
    new_item_name: isNewItem ? context.itemName : undefined,
    new_item_value: isNewItem ? context.itemValue : undefined,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanItemUpdate,
    data: {
      personaName: context.personaName,
      candidateType,
      matchedType,
      isNewItem,
      existingItemId: existingItem?.id,
      itemCategory: context.itemCategory,
      messages_analyze: context.messages_analyze,
    },
  });
}

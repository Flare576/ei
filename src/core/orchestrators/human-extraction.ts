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
    priority: LLMPriority.Low,
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
    priority: LLMPriority.Low,
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
    priority: LLMPriority.Low,
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
  queueTopicScan(context, state);
  queuePersonScan(context, state);
}

export function queueItemMatch(
  dataType: DataItemType,
  candidate: ScanCandidate,
  context: ExtractionContext,
  state: StateManager
): void {
  const human = state.getHuman();
  
  let existingItems: Array<{ name: string; description: string }>;
  let itemName: string;
  let itemValue: string;

  switch (dataType) {
    case "fact":
      existingItems = human.facts.map(f => ({ name: f.name, description: f.description }));
      itemName = (candidate as FactScanCandidate).type_of_fact;
      itemValue = (candidate as FactScanCandidate).value_of_fact;
      break;
    case "trait":
      existingItems = human.traits.map(t => ({ name: t.name, description: t.description }));
      itemName = (candidate as TraitScanCandidate).type_of_trait;
      itemValue = (candidate as TraitScanCandidate).value_of_trait;
      break;
    case "topic":
      existingItems = human.topics.map(t => ({ name: t.name, description: t.description }));
      itemName = (candidate as TopicScanCandidate).type_of_topic;
      itemValue = (candidate as TopicScanCandidate).value_of_topic;
      break;
    case "person":
      existingItems = human.people.map(p => ({ name: p.name, description: p.description }));
      itemName = (candidate as PersonScanCandidate).name_of_person;
      itemValue = (candidate as PersonScanCandidate).type_of_person;
      break;
  }

  const prompt = buildHumanItemMatchPrompt({
    data_type: dataType,
    item_name: itemName,
    item_value: itemValue,
    existing_items: existingItems,
  });

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHumanItemMatch,
    data: {
      personaName: context.personaName,
      dataType,
      itemName,
      itemValue,
      scanConfidence: candidate.confidence,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
    },
  });
}

export function queueItemUpdate(
  dataType: DataItemType,
  matchResult: ItemMatchResult,
  context: ExtractionContext & { itemName: string; itemValue: string; scanConfidence: string },
  state: StateManager
): void {
  const human = state.getHuman();
  const isNewItem = matchResult.name === "Not Found";

  let existingItem = null;
  if (!isNewItem) {
    switch (dataType) {
      case "fact":
        existingItem = human.facts.find(f => f.name === matchResult.name) ?? null;
        break;
      case "trait":
        existingItem = human.traits.find(t => t.name === matchResult.name) ?? null;
        break;
      case "topic":
        existingItem = human.topics.find(t => t.name === matchResult.name) ?? null;
        break;
      case "person":
        existingItem = human.people.find(p => p.name === matchResult.name) ?? null;
        break;
    }
  }

  const prompt = buildHumanItemUpdatePrompt({
    data_type: dataType,
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
      dataType,
      isNewItem,
      existingItemId: existingItem?.id,
      matchedName: matchResult.name,
      scanConfidence: context.scanConfidence,
    },
  });
}

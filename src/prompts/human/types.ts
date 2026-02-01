import type { Message, DataItemBase, DataItemType } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

interface BaseScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}

export interface FactScanPromptData extends BaseScanPromptData {}

export interface TraitScanPromptData extends BaseScanPromptData {}

export interface TopicScanPromptData extends BaseScanPromptData {}

export interface PersonScanPromptData extends BaseScanPromptData {
  known_persona_names: string[];
}

export interface FactScanCandidate {
  type_of_fact: string;
  value_of_fact: string;
  reason: string;
}

export interface TraitScanCandidate {
  type_of_trait: string;
  value_of_trait: string;
  reason: string;
}

export interface TopicScanCandidate {
  type_of_topic: string;
  value_of_topic: string;
  reason: string;
}

export interface PersonScanCandidate {
  type_of_person: string;
  name_of_person: string;
  reason: string;
}

export interface FactScanResult {
  facts: FactScanCandidate[];
}

export interface TraitScanResult {
  traits: TraitScanCandidate[];
}

export interface TopicScanResult {
  topics: TopicScanCandidate[];
}

export interface PersonScanResult {
  people: PersonScanCandidate[];
}

export interface ItemMatchPromptData {
  candidate_type: DataItemType;
  candidate_name: string;
  candidate_value: string;
  all_items: Array<{
    data_type: DataItemType;
    data_id: string;
    data_name: string;
    data_description: string;
  }>;
}

export interface ItemMatchResult {
  matched_guid: string | null;
}

export interface ItemUpdatePromptData {
  data_type: DataItemType;
  existing_item: DataItemBase | null;
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  new_item_name?: string;
  new_item_value?: string;
}

export type ExposureImpact = "high" | "medium" | "low" | "none";

export interface QuoteCandidate {
  text: string;
  reason: string;
}

export interface ItemUpdateResultBase {
  name: string;
  description: string;
  sentiment: number;
  quotes?: QuoteCandidate[];
}

export interface FactUpdateResult extends ItemUpdateResultBase {}

export interface TraitUpdateResult extends ItemUpdateResultBase {
  strength?: number;
}

export interface TopicUpdateResult extends ItemUpdateResultBase {
  exposure_desired?: number;
  exposure_impact?: ExposureImpact;
}

export interface PersonUpdateResult extends ItemUpdateResultBase {
  relationship?: string;
  exposure_desired?: number;
  exposure_impact?: ExposureImpact;
}

export type ItemUpdateResult = 
  | FactUpdateResult 
  | TraitUpdateResult 
  | TopicUpdateResult 
  | PersonUpdateResult 
  | Record<string, never>;

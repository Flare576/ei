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

export interface PersonScanPromptData extends BaseScanPromptData {}

export interface FactFindPromptData {
  persona_name: string;
  missing_fact_names: string[];  // Built-in facts with no description
  messages_context: Message[];   // Earlier conversation (already processed)
  messages_analyze: Message[];   // Recent messages to scan
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
  name: string;
  description: string;
  category: string;
  reason: string;
}

export interface PersonScanCandidate {
  name: string;
  description: string;
  relationship: string;
  reason: string;
}

export interface TopicMatchPromptData {
  candidate_name: string;
  candidate_description: string;
  candidate_category: string;
  existing_topics: Array<{
    id: string;
    name: string;
    description: string;
    category?: string;
  }>;
}

export interface PersonMatchPromptData {
  candidate_name: string;
  candidate_description: string;
  candidate_relationship: string;
  existing_people: Array<{
    id: string;
    name: string;
    description: string;
    relationship?: string;
  }>;
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

export interface FactFindResult {
  facts: Array<{
    name: string;       // Must match a name from missing_fact_names
    value: string;      // The extracted value
    evidence: string;   // Direct quote/reference (NOT stored, limits hallucination)
  }>;
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
  category?: string;
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

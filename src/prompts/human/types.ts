import type { Message } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface ParticipantContext {
  persona_name: string;
  persona_description?: string;  // long_description, omitted if empty
  human_name?: string;           // e.g. "Jeremy (Flare)" — omitted if no facts
  human_age?: number;            // calculated from Birthday fact — omitted if not set
}

interface BaseScanPromptData {
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
}

export interface FactScanPromptData extends BaseScanPromptData {}

export interface TraitScanPromptData extends BaseScanPromptData {}

export interface TopicScanPromptData extends BaseScanPromptData {
  participant_context?: ParticipantContext;
}

export interface PersonScanPromptData extends BaseScanPromptData {
  participant_context?: ParticipantContext;
  known_identifier_types?: string[];
}

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

export interface TopicScanCandidate {
  name: string;
  description: string;
  category: string;
  reason: string;
}

export interface PersonScanCandidate {
  name: string;
  identifiers?: Array<{ type: string; value: string; is_primary?: boolean }>;
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

export interface ItemMatchResult {
  matched_guid: string | null;
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
  | TopicUpdateResult 
  | PersonUpdateResult 
  | Record<string, never>;

export interface EventScanCandidate {
  name: string;
  description: string;
  reason: string;
}

export interface EventScanResult {
  events: EventScanCandidate[];
}

import type { Trait, Message, PersonaTopic } from "../../core/types.js";

export interface PromptOutput {
  system: string;
  user: string;
}

export interface PersonaTraitExtractionPromptData {
  persona_name: string;
  current_traits: Trait[];
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface TraitResult {
  name: string;
  description: string;
  sentiment: number;
  strength: number;
}

// 3-Step Persona Topic Processing (Ticket 0124)

// Step 1: Scan - Quick identification of topics discussed
export interface PersonaTopicScanPromptData {
  persona_name: string;
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface PersonaTopicScanCandidate {
  name: string;
  message_count: number;    // How many messages touched this topic
  sentiment_signal: number; // Quick read: -1 to 1
}

export interface PersonaTopicScanResult {
  topics: PersonaTopicScanCandidate[];
}

// Step 2: Match - Map candidate to existing topics
export interface PersonaTopicMatchPromptData {
  persona_name: string;
  candidate: PersonaTopicScanCandidate;
  existing_topics: PersonaTopic[];
}

export interface PersonaTopicMatchResult {
  action: "match" | "create" | "skip";
  matched_id?: string;  // If action is "match"
  reason: string;       // Why this decision
}

// Step 3: Update - Generate structured PersonaTopic
export interface PersonaTopicUpdatePromptData {
  persona_name: string;
  short_description?: string;
  long_description?: string;
  traits: Trait[];
  existing_topic?: PersonaTopic; // If updating existing
  candidate: PersonaTopicScanCandidate;
  messages_context: Message[];
  messages_analyze: Message[];
}

export interface PersonaTopicUpdateResult {
  name: string;
  perspective: string;      // Their view/opinion - ALWAYS populate
  approach: string;         // How they engage - populate if clear signal
  personal_stake: string;   // Why it matters - populate if clear signal
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
}

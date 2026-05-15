/**
 * Response Prompt Types
 * Based on CONTRACTS.md ResponsePromptData specification
 */

import type { Fact, PersonaTrait, Topic, Person, Quote, PersonaTopic } from "../../core/types.js";
import type { ToolDefinition } from "../../core/types.js";
import type { PersonaEntity } from "../../core/types/entities.js";

export interface TemporalAnchor {
  id: string;
  role: "human" | "system";
  content?: string;
  silence_reason?: string;
  timestamp: string;
  _synthesis?: boolean;
}

/**
 * Data contract for buildResponsePrompt (from CONTRACTS.md)
 */
export interface ResponsePromptData {
  persona: {
    name: string;
    aliases: string[];
    short_description?: string;
    long_description?: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
    /** Pre-filtered: topics where exposure_desired - exposure_current > 0.2 */
    interested_topics: PersonaTopic[];
    /** When true, each message has a timestamp prepended; include a note so the persona doesn't echo them */
    include_message_timestamps?: boolean;
    /** Proposed identity revision pending human review. Persona carries this as ambient self-awareness — no critique, just the proposed changes. */
    pending_update?: PersonaEntity["pending_update"];
    notes?: string[];
  };
  human: {
    name: string;
    facts: Fact[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
    /** Pre-filtered: topics where exposure_current > 0.3 */
    active_topics: Topic[];
    /** Pre-filtered: topics where exposure_desired - exposure_current > 0.2 */
    interested_topics: Topic[];
  };
  visible_personas: Array<{ name: string; short_description?: string }>;
  temporal_anchors: TemporalAnchor[];
  delay_ms: number;
  isTUI: boolean;
  /** Tools assigned to this persona and available in the current runtime. Used to conditionally include tool-use instructions in the system prompt. */
  tools?: ToolDefinition[];
}

/**
 * Structured response from LLM (new JSON schema)
 */
export interface PersonaResponseResult {
  should_respond: boolean;
  content?: string;
  reason?: string;
}

/**
 * Prompt output structure (all prompts return this)
 */
export interface PromptOutput {
  system: string;
  user: string;
}

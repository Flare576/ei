/**
 * Response Prompt Types
 * Based on CONTRACTS.md ResponsePromptData specification
 */

import type { Fact, Trait, Topic, Person, Quote, PersonaTopic } from "../../core/types.js";
import type { ToolDefinition } from "../../core/types.js";

/**
 * Data contract for buildResponsePrompt (from CONTRACTS.md)
 */
export interface ResponsePromptData {
  persona: {
    name: string;
    aliases: string[];
    short_description?: string;
    long_description?: string;
    traits: Trait[];
    topics: PersonaTopic[];
  };
  human: {
    facts: Fact[];
    traits: Trait[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
  };
  visible_personas: Array<{ name: string; short_description?: string }>;
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
  verbal_response?: string;
  action_response?: string;
  reason?: string;
}

/**
 * Prompt output structure (all prompts return this)
 */
export interface PromptOutput {
  system: string;
  user: string;
}

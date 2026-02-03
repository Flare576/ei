/**
 * Response Prompt Types
 * Based on CONTRACTS.md ResponsePromptData specification
 */

import type { Fact, Trait, Topic, Person, Quote } from "../../core/types.js";

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
    topics: Topic[];
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
}

/**
 * Prompt output structure (all prompts return this)
 */
export interface PromptOutput {
  system: string;
  user: string;
}

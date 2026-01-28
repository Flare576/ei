/**
 * Heartbeat Prompt Types
 * Based on CONTRACTS.md specifications
 */

import type { Trait, Topic, Person, Message } from "../../core/types.js";

/**
 * Common prompt output structure
 */
export interface PromptOutput {
  system: string;
  user: string;
}

/**
 * Data contract for buildHeartbeatCheckPrompt
 */
export interface HeartbeatCheckPromptData {
  persona: {
    name: string;
    traits: Trait[];
    topics: Topic[];
  };
  human: {
    topics: Topic[];     // Filtered, sorted by engagement gap
    people: Person[];    // Filtered, sorted by engagement gap
  };
  recent_history: Message[];  // Last N messages for context
  inactive_days: number;      // Days since last activity
}

/**
 * Expected LLM response from heartbeat check
 */
export interface HeartbeatCheckResult {
  should_respond: boolean;
  topic?: string;
  message?: string;
}

/**
 * Data contract for buildEiHeartbeatPrompt
 */
export interface EiHeartbeatPromptData {
  human: {
    topics: Topic[];     // All topics with gaps
    people: Person[];    // All people with gaps
  };
  inactive_personas: Array<{
    name: string;
    short_description?: string;
    days_inactive: number;
  }>;
  pending_validations: number;  // Count of items needing Ei review
  recent_history: Message[];
}

/**
 * Expected LLM response from Ei heartbeat
 */
export interface EiHeartbeatResult {
  should_respond: boolean;
  priorities?: Array<{
    type: "topic" | "persona" | "person";
    name: string;
    reason: string;
  }>;
  message?: string;
}

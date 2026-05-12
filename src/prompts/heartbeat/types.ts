/**
 * Heartbeat Prompt Types
 * Based on CONTRACTS.md specifications
 */

import type { PersonaTrait, Topic, Person, Message, PersonaTopic } from "../../core/types.js";
import type { PersonaEntity } from "../../core/types/entities.js";
import type { TemporalAnchor } from "../response/types.js";

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
    traits: PersonaTrait[];
    topics: PersonaTopic[];
    pending_update?: PersonaEntity["pending_update"];
  };
  human: {
    topics: Topic[];     // Filtered, sorted by engagement gap
    people: Person[];    // Filtered, sorted by engagement gap
  };
  recent_history: Message[];        // Last N messages for context (Always-within-window only)
  temporal_anchors: TemporalAnchor[]; // Always messages that fell outside the context window
  inactive_days: number;            // Days since last activity
}

/**
 * Expected LLM response from heartbeat check
 */
export interface HeartbeatCheckResult {
  should_respond: boolean;
  topic?: string;
  message?: string;
}

// =============================================================================
// EI HEARTBEAT TYPES
// =============================================================================

/**
 * A single item Ei can choose to address.
 * One of: an unverified fact, an under-engaged person, an under-engaged topic,
 * or an inactive persona.
 */
export type EiHeartbeatItem =
  | {
      id: string;
      type: "Fact Check";
      name: string;
      description: string;
      quote?: string;
    }
  | {
      id: string;
      type: "Low-Engagement Person";
      engagement_delta: string;  // e.g. "25%"
      relationship: string;
      name: string;
      description: string;
      quote?: string;
    }
  | {
      id: string;
      type: "Low-Engagement Topic";
      engagement_delta: string;  // e.g. "28%"
      name: string;
      description: string;
      quote?: string;
    }
  | {
      id: string;
      type: "Inactive Persona";
      name: string;
      short_description?: string;
      days_inactive: number;
    }
  | {
      id: string;
      type: "New Person";
      name: string;
      description: string;
      quote?: string;
    }
  | {
      id: string;
      type: "Persona Reflection Alert";
      persona_name: string;
      critique: string;
    }
  | {
      id: string;
      type: "Self Reflection Alert";
      critique: string;
    };

/**
 * Data contract for buildEiHeartbeatPrompt
 */
export interface EiHeartbeatPromptData {
  items: EiHeartbeatItem[];
  recent_history: Message[];
  system_messages: Message[];
  temporal_anchors: TemporalAnchor[];
}

/**
 * Expected LLM response from Ei heartbeat.
 * Ei picks exactly ONE item by id and optionally writes a message.
 */
export interface EiHeartbeatResult {
  should_respond: boolean;
  id?: string;          // ID of the chosen item (required if should_respond is true)
  my_response?: string; // Only used for Person/Topic/Persona items (not Fact Check)
}

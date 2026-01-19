export type ConceptType = "static" | "topic" | "person" | "persona";

export interface Concept {
  name: string;
  description: string;
  /**
   * EXPOSURE: How recently/frequently has this concept come up?
   * Range: 0.0 to 1.0
   * Decays toward 0.0 over time (logarithmic)
   * Increases when the concept is discussed
   */
  level_current: number;
  /**
   * DISCUSSION DESIRE: How much does the entity WANT TO TALK about this?
   * Range: 0.0 to 1.0
   * NOT the same as how much they like/care about it (see sentiment)
   * Changes rarely - only on explicit preference signals
   */
  level_ideal: number;
  /**
   * SENTIMENT: How does the entity feel about this concept?
   * Range: -1.0 (strongly negative) to 1.0 (strongly positive)
   * 0.0 = neutral
   * Updated based on expressed emotions about the concept
   */
  sentiment: number;
  type: ConceptType;
  learned_by?: string;
  last_updated?: string; // ISO timestamp - when this concept was last modified
  /**
   * PERSONA_GROUPS: Which persona groups can see this concept (human concepts only)
   * Empty array = globally visible to all personas
   * Non-empty = only visible to personas in these groups (or with groups_visible: ["*"])
   */
  persona_groups?: string[];
}

export interface ConceptMap {
  entity: "human" | "system";
  aliases?: string[];
  short_description?: string;  // 10-15 word summary of personality
  long_description?: string;   // 2-3 sentence description
  /**
   * MODEL: Which LLM model should this persona use?
   * Format: "provider:model" (e.g., "openai:gpt-4o", "local:google/gemma-3-12b")
   * Optional - absence means use global default (EI_LLM_MODEL env var)
   * Only meaningful for entity: "system" (personas), ignored for humans
   */
  model?: string;
  /**
   * GROUP_PRIMARY: Primary group for this persona (personas only)
   * Concepts created by this persona inherit this group
   * null = no primary group (global persona like ei)
   * Only meaningful for entity: "system"
   */
  group_primary?: string | null;
  /**
   * GROUPS_VISIBLE: Additional groups this persona can see (personas only)
   * Primary group is implicitly visible (don't duplicate here)
   * ["*"] = can see all groups (special case for ei)
   * [] or undefined = only see own group + global
   * Only meaningful for entity: "system"
   */
  groups_visible?: string[];
  last_updated: string | null;
  concepts: Concept[];
  isPaused?: boolean;
  pauseUntil?: string;  // ISO timestamp when pause expires (undefined = indefinite)
  isArchived?: boolean;
  archivedDate?: string;  // ISO timestamp when persona was archived
}

export type MessageState = "sent" | "processing" | "queued" | "failed";

export interface Message {
  role: "human" | "system";
  content: string;
  timestamp: string;
  state?: MessageState;
  read?: boolean;
  concept_processed?: boolean; // undefined/false = not processed for concept updates
}

export interface ConversationHistory {
  messages: Message[];
}

export interface ProcessEventInput {
  delay_ms: number;
  human_concepts: ConceptMap;
  system_concepts: ConceptMap;
  recent_history: Message[] | null;
  human_message: string | null;
}

export interface LLMResponse {
  message: string | null;
}

export interface ConceptMapUpdate {
  concepts: Concept[];
  reasoning?: string;
}

export interface PersonaState {
  name: string;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  isProcessing: boolean;
  messageQueue: string[];
  unreadCount: number;
  abortController: AbortController | null;
  /** Whether this persona is paused (no heartbeats or message processing) */
  isPaused: boolean;
  /** ISO timestamp when pause expires (undefined = indefinite pause) */
  pauseUntil?: string;
  /** Timer for auto-resume when pauseUntil is set */
  pauseTimer: ReturnType<typeof setTimeout> | null;
}

export interface SystemSnapshot {
  timestamp: string;
  humanConcepts: ConceptMap;
  personas: {
    [personaName: string]: {
      system: ConceptMap;
      history: ConversationHistory;
    }
  };
}


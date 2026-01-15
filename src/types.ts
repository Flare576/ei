export type ConceptType = "static" | "topic" | "person" | "persona";

export interface Concept {
  name: string;
  description: string;
  level_current: number;
  level_ideal: number;
  /**
   * ELASTICITY: Rate of natural drift toward level_ideal, per hour.
   * 
   * This controls how quickly a concept "decays" back toward its ideal state
   * when not actively reinforced by interaction. Higher values = faster drift.
   * 
   * Examples:
   * - 0.05 (5%/hr): Very stable, barely changes without interaction
   * - 0.1 (10%/hr): Stable core aspect
   * - 0.2 (20%/hr): Moderate stability, gradually returns to baseline
   * - 0.4 (40%/hr): Flexible, relatively quick to reset
   * - 0.6 (60%/hr): Volatile, changes rapidly with time
   * 
   * Guideline by type:
   * - static: 0.05-0.15 (core values change slowly)
   * - persona: 0.1-0.3 (personality traits are moderately stable)
   * - topic: 0.2-0.5 (interests naturally wax and wane)
   * - person: 0.3-0.6 (relationship intensity fluctuates)
   */
  level_elasticity: number;
  type: ConceptType;
  learned_by?: string;
  last_updated?: string; // ISO timestamp - when this concept was last modified
}

export interface ConceptMap {
  entity: "human" | "system";
  aliases?: string[];
  short_description?: string;  // 10-15 word summary of personality
  long_description?: string;   // 2-3 sentence description
  last_updated: string | null;
  concepts: Concept[];
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
}

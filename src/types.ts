export type ConceptType = "static" | "topic" | "person" | "persona";

export interface Concept {
  name: string;
  description: string;
  level_current: number;
  level_ideal: number;
  level_elasticity: number;
  type: ConceptType;
  learned_by?: string;
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

/**
 * EI V1 LLM Request/Response Types
 * Source of truth: CONTRACTS.md
 */

import type { LLMRequestType, LLMPriority, LLMNextStep } from "./enums.js";

export interface Message {
  id: string;
  role: "human" | "system";
  verbal_response?: string;   // Human text or persona's spoken reply
  action_response?: string;  // Stage direction / action the persona performs
  silence_reason?: string;   // Why the persona chose not to respond (not shown to LLM)
  timestamp: string;
  read: boolean;               // Has human seen this system message?
  context_status: import("./enums.js").ContextStatus;
  
  // Extraction completion flags (omit when false to save space)
  // Single-letter names minimize storage overhead for large message histories
  f?: boolean;                 // Fact extraction completed
  r?: boolean;                 // tRait extraction completed
  p?: boolean;                 // Person extraction completed
  o?: boolean;                 // tOpic extraction completed
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export type LLMRequestState = "pending" | "processing" | "dlq";

export interface LLMRequest {
  id: string;
  created_at: string;
  attempts: number;
  last_attempt?: string;
  retry_after?: string;
  state: LLMRequestState;
  type: LLMRequestType;
  priority: LLMPriority;
  system: string;
  user: string;
  next_step: LLMNextStep;
  model?: string;
  data: Record<string, unknown>;
}

export interface QueueFailResult {
  dropped: boolean;
  retryDelay?: number;
}

export interface LLMResponse {
  request: LLMRequest;
  success: boolean;
  content: string | null;
  parsed?: unknown;
  error?: string;
  finish_reason?: string;
}

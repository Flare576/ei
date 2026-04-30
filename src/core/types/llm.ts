/**
 * EI V1 LLM Request/Response Types
 * Source of truth: CONTRACTS.md
 */

import type { LLMRequestType, LLMPriority, LLMNextStep } from "./enums.js";

export interface Message {
  id: string;
  role: "human" | "system";
  content?: string;           // Raw Markdown response
  silence_reason?: string;   // Why the sender chose not to respond (human or persona)
  timestamp: string;
  read: boolean;               // Has human seen this system message?
  context_status: import("./enums.js").ContextStatus;
  
  // Extraction completion flags (omit when false to save space)
  // Single-letter names minimize storage overhead for large message histories
  f?: boolean;                 // Fact extraction completed
  t?: boolean;                 // Topic extraction completed
  p?: boolean;                 // Person extraction completed
  e?: boolean;                 // Event (epic) extraction completed
  persona_extracted?: Record<string, true>; // Per-persona topic scan tracking. Key = personaId.slice(0, 8)
  // Image generation fields (web-only, ephemeral)
  _synthesis?: boolean;         // True if message was created by multi-message synthesis
  speaker_name?: string;       // Display name of actual speaker; set on room messages for clean hydration

  external?: boolean;          // Set by integration importers (OpenCode, Cursor, Claude Code); invisible to LLM context

  /**
   * Integration source tag. Set ONLY on external: true messages by importers (document, Slack, etc.)
   * to identify which external source this synthetic message came from.
   * Format: "import:document:filename" | "slack:channelId" | etc.
   * Enables quote provenance tracing: quote.message_id → message.source_tag → original source.
   * Never set on conversational messages.
   */
  source_tag?: string;

}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string | null;
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

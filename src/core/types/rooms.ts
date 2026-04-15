/**
 * EI V1 Room Types
 * Source of truth: CONTRACTS.md
 */

import type { RoomMode, ContextStatus } from "./enums.js";

export interface RoomMessage {
  id: string;
  parent_id: string | null;
  role: "human" | "persona";
  persona_id?: string;
  content?: string;
  verbal_response?: string;
  action_response?: string;
  silence_reason?: string;
  timestamp: string;
  read: boolean;
  context_status: ContextStatus;

  f?: boolean;
  t?: boolean;
  p?: boolean;
  e?: boolean;
  persona_extracted?: Record<string, true>; // Per-persona topic scan tracking. Key = personaId.slice(0, 8)
}

export interface RoomEntity {
  id: string;
  display_name: string;
  entity: "room";
  mode: RoomMode;
  persona_ids: string[];
  judge_persona_id?: string;
  active_node_id: string | null;
  is_archived: boolean;
  created_at: string;
  last_updated: string;
  last_activity: string;
  capture_used?: boolean;
  context_window_hours?: number;  // FFA only; falls back to human.settings.default_context_window_hours
  context_boundary?: string;      // FFA only; ISO timestamp; same semantics as persona context_boundary
  messages: RoomMessage[];
}

export interface RoomCreationInput {
  display_name: string;
  mode: RoomMode;
  persona_ids: string[];
  judge_persona_id?: string;
  initial_message: string;
}

export interface RoomSummary {
  id: string;
  display_name: string;
  mode: RoomMode;
  persona_ids: string[];
  active_node_id: string | null;
  is_archived: boolean;
  last_activity: string;
  unread_count: number;
}

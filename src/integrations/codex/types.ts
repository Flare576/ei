/**
 * Codex Integration Types
 *
 * Codex Desktop / CLI stores thread metadata in ~/.codex/state_*.sqlite and
 * per-thread rollout JSONL files under ~/.codex/sessions/YYYY/MM/DD/.
 * Ei imports only visible user/agent event messages and skips tool chatter,
 * prompt scaffolding, token-count events, and system/developer payloads.
 */

// ============================================================================
// Reader Interface
// ============================================================================

export interface CodexMessageWindow {
  message: CodexMessage;
  before: CodexMessage[];
  after: CodexMessage[];
  session: CodexSession;
}

export interface ICodexReader {
  getSessions(): Promise<CodexSession[]>;
  getMessageById(sessionId: string, messageId: string, before?: number, after?: number): Promise<CodexMessageWindow | null>;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Raw Storage Types
// ============================================================================

export interface CodexThreadRow {
  id: string;
  rollout_path?: string | null;
  created_at?: number | null;
  updated_at?: number | null;
  created_at_ms?: number | null;
  updated_at_ms?: number | null;
  cwd?: string | null;
  title?: string | null;
  first_user_message?: string | null;
  source?: string | null;
  thread_source?: string | null;
  agent_nickname?: string | null;
  agent_role?: string | null;
  agent_path?: string | null;
  archived?: number | boolean | null;
}

export interface CodexRolloutRecord {
  timestamp?: string;
  type?: string;
  payload?: Record<string, unknown>;
}

// ============================================================================
// Cleaned Session / Message Types
// ============================================================================

export interface CodexMessage {
  /** Stable synthetic id derived from JSONL line number, e.g. "evt_42" */
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface CodexSession {
  id: string;
  title: string;
  cwd: string;
  source?: string;
  threadSource?: string;
  agentNickname?: string;
  agentRole?: string;
  agentPath?: string;
  rolloutPath: string;
  firstMessageAt: string;
  lastMessageAt: string;
  messages: CodexMessage[];
}

// ============================================================================
// Constants
// ============================================================================

/** The single persona name for all Codex sessions */
export const CODEX_PERSONA_NAME = "Codex";

/** Topic groups assigned to Codex session topics */
export const CODEX_TOPIC_GROUPS = ["General", "Coding", "Codex"];

/**
 * Minimum session age before import.
 * Mirrors Claude Code / Cursor's 20-minute rule so active sessions can settle.
 */
export { MIN_SESSION_AGE_MS } from "../constants.js";

// ============================================================================
// Human Settings Shape
// ============================================================================

/**
 * Stored under human.settings.codex
 *
 * WARNING: ADDING A NEW FIELD HERE?
 * If it is runtime-managed (not user-editable), also preserve it in
 * settingsFromYAML() in tui/src/util/yaml-settings.ts or /settings will wipe it.
 */
export interface CodexSettings {
  integration?: boolean;
  polling_interval_ms?: number;
  extraction_model?: string;
  last_sync?: string;
  extraction_point?: string;
  processed_sessions?: Record<string, string>;
}

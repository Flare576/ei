/**
 * Claude Code Integration Types
 *
 * These types represent the data structures read from Claude Code's storage.
 * Sessions are stored as JSONL files in ~/.claude/projects/<encoded-path>/<uuid>.jsonl
 *
 * The encoded path replaces '/' with '-', so /home/user/myapp → -home-user-myapp.
 */

// ============================================================================
// Reader Interface
// ============================================================================

export interface IClaudeCodeReader {
  getSessions(): Promise<ClaudeCodeSession[]>;
  getMessagesForSession(sessionId: string): Promise<ClaudeCodeMessage[]>;
}

// ============================================================================
// Raw JSONL Record Types
// ============================================================================

/**
 * Common envelope fields present on most records.
 */
interface ClaudeCodeRecordBase {
  type: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
  isSidechain?: boolean;
}

/**
 * user record — a message the human typed.
 */
export interface ClaudeCodeUserRecord extends ClaudeCodeRecordBase {
  type: "user";
  message: {
    role: "user";
    content: string;
  };
  uuid: string;
  sessionId: string;
  cwd: string;
  timestamp: string;
}

/**
 * assistant record — Claude's response.
 * content is an array of blocks; we extract "text" blocks only.
 */
export interface ClaudeCodeAssistantRecord extends ClaudeCodeRecordBase {
  type: "assistant";
  message: {
    model: string;
    role: "assistant";
    content: ClaudeCodeContentBlock[];
  };
  uuid: string;
  sessionId: string;
  cwd: string;
  timestamp: string;
  slug?: string;
}

export type ClaudeCodeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "tool_use"; [key: string]: unknown }
  | { type: string; [key: string]: unknown };

/**
 * summary record — compaction checkpoint with compressed history.
 * We skip these for import (not conversational content).
 */
export interface ClaudeCodeSummaryRecord extends ClaudeCodeRecordBase {
  type: "summary";
  summary: string;
}

// Types we explicitly skip:
// - file-history-snapshot: git working tree state
// - system: slash commands, local_command records
// - progress: hook progress events
// - tool_use / tool_result: internal tool plumbing (only in transcripts/)

export type ClaudeCodeRecord =
  | ClaudeCodeUserRecord
  | ClaudeCodeAssistantRecord
  | ClaudeCodeSummaryRecord
  | ClaudeCodeRecordBase; // catch-all for skipped types

// ============================================================================
// Cleaned Session / Message Types (for Ei consumption)
// ============================================================================

/**
 * A Claude Code session (one JSONL file = one session).
 */
export interface ClaudeCodeSession {
  /** UUID from the filename, e.g. "0da9e1e8-187f-40f9-a66b-c7f1ebf2a72e" */
  id: string;
  /** Working directory when the session was started */
  cwd: string;
  /** Derived title: last segment of cwd (e.g. "ei" from "/Users/foo/Projects/Personal/ei") */
  title: string;
  /** ISO timestamp of the first message */
  firstMessageAt: string;
  /** ISO timestamp of the last message */
  lastMessageAt: string;
}

/**
 * A single user↔assistant exchange, cleaned for Ei.
 */
export interface ClaudeCodeMessage {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  /** Concatenated text blocks only — tool calls, thinking, snapshots are stripped */
  content: string;
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

/** The single persona name for all Claude Code sessions */
export const CLAUDE_CODE_PERSONA_NAME = "Claude Code";

/** Topic groups assigned to Claude Code session topics */
export const CLAUDE_CODE_TOPIC_GROUPS = ["General", "Coding", "Claude Code"];

/**
 * Minimum session age before we import it.
 * Mirrors OpenCode's 20-minute rule — gives the session time to "settle."
 */
export const MIN_SESSION_AGE_MS = 20 * 60 * 1000;

// ============================================================================
// Human Settings Shape (mirrors OpenCodeSettings in core/types.ts)
// ============================================================================

/**
 * Stored under human.settings.claudeCode
 */
export interface ClaudeCodeSettings {
  integration?: boolean;
  polling_interval_ms?: number;  // Default: 1800000 (30 min)
  last_sync?: string;            // ISO timestamp
  processed_sessions?: Record<string, string>; // sessionId → ISO timestamp of last import
}

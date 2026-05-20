/**
 * Pi Integration Types
 *
 * Pi (pi.dev / earendil-works/pi and the oh-my-pi fork) stores sessions as
 * JSONL files under ~/.pi/agent/sessions/ (pi) or ~/.omp/agent/sessions/ (omp).
 *
 * Directory layout:
 *   <sessionsRoot>/
 *     <cwd-encoded>/          # cwd with "/" replaced by "--"
 *       <iso-ts>_<uuid>.jsonl # one file per session
 *
 * Each line in a session file is a JSON entry with a `type` field.
 * We only care about `type: "message"` entries.
 */

// ============================================================================
// Reader Interface
// ============================================================================

export interface PiMessageWindow {
  message: PiMessage;
  before: PiMessage[];
  after: PiMessage[];
  session: PiSession;
}

export interface IPiReader {
  getSessions(): Promise<PiSession[]>;
  getMessageById(
    sessionId: string,
    messageId: string,
    before?: number,
    after?: number
  ): Promise<PiMessageWindow | null>;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Raw JSONL Entry Types
// ============================================================================

/**
 * A `type: "message"` entry in a Pi session JSONL file.
 * Other entry types (model-change, thinking-level, label, compaction,
 * branch-summary, extension) are skipped during import.
 */
export interface PiMessageEntry {
  type: "message";
  id: string;
  parentId?: string;
  timestamp: string;
  message: PiMessagePayload;
  [key: string]: unknown;
}

export interface PiMessagePayload {
  role: "user" | "assistant" | "toolResult" | "custom";
  content?: PiContentBlock[] | string;
  // assistant-only fields
  model?: string;
  provider?: string;
  stopReason?: string;
  usage?: unknown;
  // toolResult-only fields
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  // custom (extension-injected) fields
  customType?: string;
  display?: boolean;
}

export type PiContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; thinkingSignature?: string }
  | { type: "toolCall"; id: string; name: string; arguments: unknown }
  | { type: "image"; source: unknown }
  | { type: string; [key: string]: unknown };

/** Union of all entry types we may encounter (we skip non-message ones). */
export interface PiGenericEntry {
  type: string;
  id?: string;
  parentId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// ============================================================================
// Cleaned Session / Message Types
// ============================================================================

export interface PiSession {
  /** Full UUID from filename, e.g. "019e45e3-e2e5-7174-8165-da221c147ebb" */
  id: string;
  /** Human-readable title derived from the cwd directory name */
  title: string;
  /** Decoded working directory path */
  cwd: string;
  /** ISO timestamp of the earliest message */
  firstMessageAt: string;
  /** ISO timestamp of the most recent message */
  lastMessageAt: string;
  /** All user/assistant messages, sorted oldest-first */
  messages: PiMessage[];
}

export interface PiMessage {
  /** Synthetic stable id: "<sessionUuid>/<entryId>", e.g. "019e45e3.../e5c48339" */
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

// ============================================================================
// Constants
// ============================================================================

/** Single persona name for all Pi/OMP sessions on a machine */
export const PI_PERSONA_NAME = "Pi";

/** Topic groups assigned to Pi session topics */
export const PI_TOPIC_GROUPS = ["General", "Coding", "Pi"];

/**
 * Minimum session age before import, while the tool is running.
 * Mirrors the Claude Code / Codex 20-minute rule so active sessions settle.
 */
export { MIN_SESSION_AGE_MS } from "../constants.js";

// ============================================================================
// Human Settings Shape
// ============================================================================

/**
 * Stored under human.settings.pi
 *
 * WARNING: ADDING A NEW FIELD HERE?
 * If it is runtime-managed (not user-editable), also preserve it in
 * settingsFromYAML() in tui/src/util/yaml-settings.ts or /settings will wipe it.
 */
export interface PiSettings {
  integration?: boolean;
  polling_interval_ms?: number;
  extraction_model?: string;
  last_sync?: string;
  extraction_point?: string;
  processed_sessions?: Record<string, string>;
}

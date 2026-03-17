/**
 * Cursor IDE Integration Types
 *
 * Cursor stores sessions across two SQLite DBs:
 *
 * Workspace DBs:
 *   ~/Library/Application Support/Cursor/User/workspaceStorage/<hash>/state.vscdb
 *   ItemTable key "composer.composerData" → { allComposers: CursorComposerMeta[] }
 *
 * Global DB:
 *   ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 *   cursorDiskKV key "composerData:<id>" → header list
 *   cursorDiskKV key "bubbleId:<id>:<bubbleId>" → bubble blob
 */

// ============================================================================
// Reader Interface
// ============================================================================

export interface ICursorReader {
  getSessions(): Promise<CursorSession[]>;
  isAvailable(): Promise<boolean>;
}

// ============================================================================
// Raw DB Schema Types (internal to reader)
// ============================================================================

/**
 * Raw entry from workspace DB's allComposers array.
 */
export interface CursorComposerMeta {
  composerId: string;
  name?: string;
  createdAt: number;            // epoch ms
  lastUpdatedAt?: number | null; // epoch ms, null for never-used sessions
  unifiedMode?: string;         // "agent" | "chat" | "plan" | "debug"
  isArchived?: boolean;
  isDraft?: boolean;
  filesChangedCount?: number;
  totalLinesAdded?: number;
  totalLinesRemoved?: number;
}

/**
 * Raw bubble from global DB bubbleId:<composerId>:<bubbleId>.
 */
export interface CursorBubbleRaw {
  _v?: number;
  type: 1 | 2;          // 1 = user, 2 = assistant
  bubbleId: string;
  text: string;
  richText?: string;    // Lexical JSON, same content as text — ignored
  createdAt: string;    // ISO timestamp
  modelInfo?: { modelName: string };
  requestId?: string;
}

/**
 * Header entry from composerData:<id>.fullConversationHeadersOnly.
 */
export interface CursorBubbleHeader {
  bubbleId: string;
  type: 1 | 2;
}

// ============================================================================
// Cleaned Session / Message Types (for Ei consumption)
// ============================================================================

/**
 * A single message in a Cursor session, cleaned for Ei.
 */
export interface CursorMessage {
  /** bubbleId from the raw bubble */
  id: string;
  /** 1 = user, 2 = assistant */
  type: 1 | 2;
  /** Plain text content */
  text: string;
  /** ISO timestamp */
  timestamp: string;
}

/**
 * A Cursor composer session, cleaned for Ei.
 */
export interface CursorSession {
  /** composerId — the stable identifier */
  id: string;
  /** User-assigned name, or a generated fallback */
  name: string;
  /** Absolute path to the workspace folder, e.g. /Users/foo/Projects/myapp */
  workspacePath: string;
  /** "agent" | "chat" | "plan" | "debug" */
  unifiedMode: string;
  /** ISO timestamp of creation */
  createdAt: string;
  /** ISO timestamp of last message */
  lastMessageAt: string;
  /** All non-empty messages, sorted oldest-first */
  messages: CursorMessage[];
}

// ============================================================================
// Constants
// ============================================================================

/** The single persona name for all Cursor sessions */
export const CURSOR_PERSONA_NAME = "Cursor";

/** Topic groups assigned to Cursor session topics */
export const CURSOR_TOPIC_GROUPS = ["General", "Coding", "Cursor"];

/**
 * Minimum session age before we import it.
 * Mirrors ClaudeCode's 20-minute rule — gives the session time to "settle."
 */
export const MIN_SESSION_AGE_MS = 20 * 60 * 1000;

// ============================================================================
// Human Settings Shape
// ============================================================================

/**
 * Stored under human.settings.cursor
 *
 * ⚠️  ADDING A NEW FIELD HERE?
 * If it's runtime-managed (not user-editable), you MUST also add it to the
 * cursor reconstruction block in settingsFromYAML() in:
 *   tui/src/util/yaml-serializers.ts
 * Otherwise it will be silently wiped every time the user saves /settings.
 */
export interface CursorSettings {
  integration?: boolean;
  polling_interval_ms?: number;   // Default: 1800000 (30 min)
  last_sync?: string;             // ISO timestamp
  extraction_point?: string;      // ISO timestamp — floor for session filtering
  processed_sessions?: Record<string, string>; // sessionId → ISO timestamp of last import
}

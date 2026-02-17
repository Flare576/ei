/**
 * OpenCode Integration Types
 *
 * These types represent the data structures read from OpenCode's storage.
 * They are based on the actual file format in ~/.local/share/opencode/storage/
 */

// ============================================================================
// Session Types (storage/session/{project_hash}/ses_xxx.json)
// ============================================================================

/**
 * Raw session data as stored by OpenCode
 */
export interface OpenCodeSessionRaw {
  id: string; // ses_xxx
  slug: string;
  version: string;
  projectID: string; // git root commit hash or "global"
  directory: string; // Full path to project
  parentID?: string; // Parent session ID if this is a subagent session
  title: string;
  time: {
    created: number; // Unix timestamp ms
    updated: number; // Unix timestamp ms
    archived?: number; // Only set by web app
  };
  summary?: {
    additions: number;
    deletions: number;
    files: number;
  };
}

/**
 * Cleaned session data for Ei consumption
 */
export interface OpenCodeSession {
  id: string; // ses_xxx
  title: string;
  directory: string;
  projectId: string;
  parentId?: string;
  time: {
    created: number;
    updated: number;
  };
}

// ============================================================================
// Message Types (storage/message/{session_id}/msg_xxx.json)
// ============================================================================

/**
 * Raw message data as stored by OpenCode
 */
export interface OpenCodeMessageRaw {
  id: string; // msg_xxx
  sessionID: string;
  role: "user" | "assistant";
  time: {
    created: number;
    completed?: number;
  };
  agent: string; // "build", "sisyphus", "librarian", etc.
  parentID?: string;
  model?: {
    providerID: string;
    modelID: string;
  };
  modelID?: string;
  providerID?: string;
  mode?: string;
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning: number;
    cache?: {
      read: number;
      write: number;
    };
  };
  finish?: string;
}

/**
 * Cleaned message data for Ei consumption
 */
export interface OpenCodeMessage {
  id: string; // msg_xxx
  sessionId: string;
  role: "user" | "assistant";
  agent: string;
  content: string; // Filtered, concatenated text parts
  timestamp: string; // ISO string from time.created
}

// ============================================================================
// Part Types (storage/part/{msg_id}/prt_xxx.json)
// ============================================================================

/**
 * Raw part data as stored by OpenCode
 * Parts can be of various types, but we only care about text parts
 */
export interface OpenCodePartRaw {
  id: string; // prt_xxx
  sessionID: string;
  messageID: string;
  type: "text" | "tool" | "file" | "step-start" | "step-finish" | string;
  text?: string; // Only present for type="text"
  synthetic?: boolean; // true = tool call summary, skip
  time?: {
    start: number;
    end: number;
  };
}

// ============================================================================
// Agent Types
// ============================================================================

/**
 * Agent info for persona creation
 */
export interface OpenCodeAgent {
  name: string;
  description?: string;
}

/**
 * Utility agents that should not have personas created for them.
 * These are internal agents that do housekeeping tasks.
 */
export const UTILITY_AGENTS = ["compaction", "title", "summary"] as const;

/**
 * Message content prefixes that indicate agent-to-agent communication.
 * Messages starting with these should be filtered out during import.
 */
export const AGENT_TO_AGENT_PREFIXES = [
  "[search-mode]",
  "[analyze-mode]",
  "[CONTEXT]",
  "<analysis>",
  "<results>",
] as const;

/**
 * Agent name aliases for consolidating variants into a single persona.
 * OpenCode's plugin ecosystem results in the same logical agent having
 * different names across versions/configs (e.g., "sisyphus", "Sisyphus",
 * "Sisyphus (Ultraworker)", "Planner-Sisyphus" are all the same agent).
 * 
 * Key = canonical name (used for display_name, Title Case)
 * Value = array of variants that should resolve to this persona
 */
export const AGENT_ALIASES: Record<string, string[]> = {
  Sisyphus: [
    "sisyphus",
    "Sisyphus",
    "Sisyphus (Ultraworker)",
    "Planner-Sisyphus",
  ],
};

/**
 * Built-in agent definitions (fallback when config unavailable)
 */
export const BUILTIN_AGENTS: Record<string, OpenCodeAgent> = {
  build: {
    name: "build",
    description: "The main coding agent that implements features and fixes bugs",
  },
  sisyphus: {
    name: "sisyphus",
    description: "Powerful AI Agent with orchestration capabilities",
  },
  plan: {
    name: "plan",
    description: "Creates implementation plans for complex features",
  },
  general: {
    name: "general",
    description: "General purpose assistant for non-coding tasks",
  },
  explore: {
    name: "explore",
    description: "Explores codebases to understand structure and patterns",
  },
  librarian: {
    name: "librarian",
    description:
      "Searches external references including documentation and open source examples",
  },
  compaction: {
    name: "compaction",
    description: "Compacts conversation history to save context",
  },
  title: {
    name: "title",
    description: "Generates session titles",
  },
  summary: {
    name: "summary",
    description: "Generates session summaries",
  },
  oracle: {
    name: "oracle",
    description: "High-IQ read-only consultant for architecture and debugging",
  },
  atlas: {
    name: "atlas",
    description: "Task execution agent for delegated work",
  },
  metis: {
    name: "metis",
    description: "Pre-planning consultant for scope clarification",
  },
  momus: {
    name: "momus",
    description: "Expert reviewer for evaluating work plans",
  },
};

/**
 * OpenCode Integration Types
 *
 * These types represent the data structures read from OpenCode's storage.
 * They are based on the actual file format in ~/.local/share/opencode/storage/
 * and the SQLite database in ~/.local/share/opencode/opencode.db (1.2+)
 */

// ============================================================================
// Reader Interface
// ============================================================================

/**
 * Common interface for reading OpenCode data.
 * Implemented by both JsonReader (legacy) and SqliteReader (1.2+).
 */
export interface IOpenCodeReader {
  getSessionsUpdatedSince(since: Date): Promise<OpenCodeSession[]>;
  getSessionsInRange(from: Date, to: Date): Promise<OpenCodeSession[]>;
  getMessagesForSession(sessionId: string, since?: Date): Promise<OpenCodeMessage[]>;
  getAgentInfo(agentName: string): Promise<OpenCodeAgent | null>;
  getAllUniqueAgents(sessionId: string): Promise<string[]>;
  getFirstAgent(sessionId: string): Promise<string | null>;
}

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
  // ── OhMyOpenCode primary agents ──────────────────────────────────────────
  //
  // oh-my-openagent uses "Foo - Bar" display names for its agents and stores
  // them verbatim in OpenCode's SQLite message rows. It also prefixes them
  // with invisible U+200B ZERO WIDTH SPACE characters as a sort hack (1 ZWS
  // for Sisyphus, 2 for Hephaestus, etc.) — those are stripped upstream in
  // resolveCanonicalAgent before the alias lookup, so only the clean form is
  // needed here. Parenthetical variants ("Foo (Bar)") are legacy names from
  // earlier oh-my-openagent versions, kept for backward compatibility.
  Sisyphus: [
    "sisyphus",
    "Sisyphus",
    "Sisyphus - Ultraworker",   // oh-my-openagent ≥ 3.x display name (stored in OpenCode DB)
    "Sisyphus (Ultraworker)",   // legacy oh-my-openagent display name
    "Sisyphus Ultraworker",
    "sisyphus ultraworker",
    "Planner-Sisyphus",
    "planner-sisyphus",
  ],
  Build: ["build", "Build"],
  Plan: ["plan", "Plan"],
  Atlas: [
    "atlas",
    "Atlas",
    "Atlas - Plan Executor",    // oh-my-openagent ≥ 3.x display name
    "Atlas (Plan Executor)",    // mixed-case variant observed in DB
    "atlas (plan executor)",
    "Atlas (plan executor)",
  ],
  Prometheus: [
    "prometheus",
    "Prometheus",
    "Prometheus - Plan Builder", // oh-my-openagent ≥ 3.x display name
    "prometheus (plan builder)",
    "Prometheus (plan builder)",
  ],
  Hephaestus: [
    "hephaestus",
    "Hephaestus",
    "Hephaestus - Deep Agent",  // oh-my-openagent ≥ 3.x display name
    "hephaestus (deep agent)",
    "Hephaestus (deep agent)",
  ],
  // Metis, Momus, Sisyphus-Junior intentionally absent — they are subagent-only.
  // The sqlite reader filters to parent_id IS NULL (primary sessions only), so
  // messages from these agents can never reach the importer.

  // ── ai-sdlc agents (RobotsAndPencils/ai-sdlc-claude-code-template) ───────
  // Installed via scripts/install-opencode.sh as "ai-sdlc-{name}" in OpenCode.
  // Bare names included for direct/custom installs.
  Architect: ["ai-sdlc-architect", "architect"],
  "Frontend Engineer": ["ai-sdlc-frontend-engineer", "frontend-engineer"],
  "Backend Engineer": ["ai-sdlc-backend-engineer", "backend-engineer"],
  "Code Reviewer": ["ai-sdlc-code-reviewer", "code-reviewer"],
  "Database Engineer": ["ai-sdlc-database-engineer", "database-engineer"],
  Debugger: ["ai-sdlc-debugger", "debugger"],
  "DevOps Engineer": ["ai-sdlc-devops-engineer", "devops-engineer"],
  "Mobile Engineer": ["ai-sdlc-mobile-engineer", "mobile-engineer"],
  "QA Engineer": ["ai-sdlc-qa-engineer", "qa-engineer"],
  "Security Reviewer": ["ai-sdlc-security-reviewer", "security-reviewer"],
  "Spec Validator": ["ai-sdlc-spec-validator", "spec-validator"],
  "Technical Writer": ["ai-sdlc-technical-writer", "technical-writer"],
  "Test Writer": ["ai-sdlc-test-writer", "test-writer"],
  "AI Engineer": ["ai-sdlc-ai-engineer", "ai-engineer"],
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

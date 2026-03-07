/**
 * EI V1 Integration Types (tools, API surface, sync, storage)
 * Source of truth: CONTRACTS.md
 */

import type { HumanEntity, PersonaEntity } from "./entities.js";
import type { Message, LLMRequest } from "./llm.js";

/**
 * ToolProvider - Owns shared configuration (API keys, base URLs) for a group of tools.
 * Every ToolDefinition must belong to exactly one ToolProvider.
 * Config is merged at query time: { ...provider.config, ...tool.config } (tool overrides win).
 */
export interface ToolProvider {
  id: string;                        // UUID (or "ei" for the built-in Ei provider)
  name: string;                      // Machine name ("ei", "brave", "github")
  display_name: string;              // Human label ("Ei Built-ins", "Brave Search")
  description?: string;              // Short description shown in UI
  builtin: boolean;                  // true = ships with Ei; false = user-registered
  config: Record<string, string>;    // Shared API keys / base URLs (encrypted at rest)
  enabled: boolean;                  // Kill-switch: disabled = all its tools unavailable
  created_at: string;                // ISO timestamp
}

/**
 * ToolDefinition - One callable LLM function. Must belong to a ToolProvider.
 * Personas reference tools by ID via their `tools` array.
 */
export interface ToolDefinition {
  id: string;                          // UUID
  provider_id: string;                 // FK → ToolProvider.id (required)
  name: string;                        // Snake_case machine name ("web_search", "read_memory")
  display_name: string;                // Human label
  description: string;                 // What the LLM reads to decide whether to call this tool
  input_schema: Record<string, unknown>; // JSON Schema for parameters the LLM can pass
  runtime: "any" | "node";             // "any" = Web + TUI; "node" = TUI only (silently excluded in browser)
  builtin: boolean;                    // true = ships with Ei; false = user-registered
  config?: Record<string, string>;     // Tool-level config overrides (merged on top of provider config)
  enabled: boolean;
  created_at: string;                  // ISO timestamp
  max_calls_per_interaction?: number;  // Max times LLM may call this tool per response turn. Default: 3.
}

// =============================================================================
// API TYPES
// =============================================================================

export interface PersonaSummary {
  id: string;
  display_name: string;
  aliases: string[];
  short_description?: string;
  is_paused: boolean;
  is_archived: boolean;
  unread_count: number;
  last_activity?: string;
  context_boundary?: string;
}

export interface MessageQueryOptions {
  after?: string;
  before?: string;
  limit?: number;
  includeOutOfContext?: boolean;
}

export interface QueueStatus {
  state: "idle" | "busy" | "paused";
  pending_count: number;
  dlq_count: number;
  current_operation?: string;
}

export interface EiError {
  code: string;
  message: string;
}

// =============================================================================
// EI_INTERFACE (Processor -> Frontend events)
// =============================================================================

export interface Ei_Interface {
  onPersonaAdded?: () => void;
  onPersonaRemoved?: () => void;
  onPersonaUpdated?: (personaId: string) => void;
  onMessageAdded?: (personaId: string) => void;
  onMessageRecalled?: (personaId: string, content: string) => void;
  onMessageProcessing?: (personaId: string) => void;
  onMessageQueued?: (personaId: string) => void;
  onHumanUpdated?: () => void;
  onQuoteAdded?: () => void;
  onQuoteUpdated?: () => void;
  onQuoteRemoved?: () => void;
  onQueueStateChanged?: (state: "idle" | "busy" | "paused") => void;
  onError?: (error: EiError) => void;
  onStateImported?: () => void;
  onOneShotReturned?: (guid: string, content: string) => void;
  onContextBoundaryChanged?: (personaId: string) => void;
  onSaveAndExitStart?: () => void;
  onSaveAndExitFinish?: () => void;
  onStateConflict?: (data: StateConflictData) => void;
  onToolProviderAdded?: () => void;
  onToolProviderUpdated?: (id: string) => void;
  onToolProviderRemoved?: () => void;
  onToolAdded?: () => void;
  onToolUpdated?: (id: string) => void;
  onToolRemoved?: () => void;
}

// =============================================================================
// SYNC TYPES
// =============================================================================

export type StateConflictResolution = "local" | "server" | "yolo";

export interface StateConflictData {
  localTimestamp: Date;
  remoteTimestamp: Date;
  hasLocalState: boolean;
}

// =============================================================================
// STORAGE TYPES
// =============================================================================

export interface StorageState {
  version: number;
  timestamp: string;
  human: HumanEntity;
  personas: Record<
    string,
    {
      entity: PersonaEntity;
      messages: Message[];
    }
  >;
  queue: LLMRequest[];
  providers: ToolProvider[];    // Tool provider registry (Ei, Brave, etc.)
  tools: ToolDefinition[];      // Platform-level tool registry
}

/**
 * EI V1 Entity Types (HumanEntity, PersonaEntity, settings)
 * Source of truth: CONTRACTS.md
 */

import type { Fact, Trait, Topic, Person, Quote, PersonaTopic } from "./data-items.js";
import type { ProviderType } from "./enums.js";

export interface SyncCredentials {
  username: string;
  passphrase: string;
}

export interface OpenCodeSettings {
  integration?: boolean;
  polling_interval_ms?: number;  // Default: 1800000 (30 min)
  last_sync?: string;  // ISO timestamp
  extraction_point?: string;  // ISO timestamp - cursor for single-session archive scan
  processed_sessions?: Record<string, string>;  // sessionId → ISO timestamp of last import
}

export interface CeremonyConfig {
  time: string;  // "HH:MM" format (e.g., "09:00")
  last_ceremony?: string;  // ISO timestamp
  decay_rate?: number;  // Default: 0.1
  explore_threshold?: number;  // Default: 3
  dedup_threshold?: number;  // Cosine similarity threshold for dedup candidates. Default: 0.85
}

export interface BackupConfig {
  enabled?: boolean;       // Default: false (opt-in)
  max_backups?: number;    // Default: 24
  interval_ms?: number;   // Default: 3600000 (1 hour)
  last_backup?: string;   // ISO timestamp of last backup run
}

/**
 * ProviderAccount - Configuration for external service connections
 * 
 * Used for both LLM providers (OpenRouter, Bedrock, etc.) and storage providers
 * (flare576.com, Dropbox, Google Drive, etc.).
 * 
 * Model specification format: `account-name:model` (e.g., `MyOpenRouter:mistralai/mistral-7b`)
 * Falls back to environment variables if no matching account is found.
 */
export interface ProviderAccount {
  id: string;                      // UUID
  name: string;                    // User-defined display name (e.g., "OpenRouter-Free", "Work Bedrock")
  type: ProviderType;              // "llm" | "storage"
  url: string;                     // Base URL for API (e.g., "https://openrouter.ai/api/v1")
  
  // Auth - use api_key for Bearer token, or username+password for basic/custom auth
  api_key?: string;                // Bearer token auth (most common)
  username?: string;               // Basic auth or custom (for storage providers)
  password?: string;               // Basic auth or custom (for storage providers)
  
  // LLM-specific
  default_model?: string;          // Default model for this account
  token_limit?: number;            // Context window override (tokens). Used for extraction chunking.
  
  // Provider-specific extras (e.g., OpenRouter needs HTTP-Referer, X-Title)
  extra_headers?: Record<string, string>;
  
  // Metadata
  enabled?: boolean;               // Default: true
  created_at: string;              // ISO timestamp
}

export interface HumanSettings {
  default_model?: string;
  oneshot_model?: string;           // Model for AI-assist (wand) requests; falls back to default_model
  rewrite_model?: string;           // Model for rewrite ceremony step; must be capable (Sonnet/Opus class). Unset = rewrite disabled.
  queue_paused?: boolean;
  skip_quote_delete_confirm?: boolean;
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  accounts?: ProviderAccount[];
  sync?: SyncCredentials;
  opencode?: OpenCodeSettings;
  ceremony?: CeremonyConfig;
  backup?: BackupConfig;
  claudeCode?: import("../../integrations/claude-code/types.js").ClaudeCodeSettings;
}

export interface HumanEntity {
  entity: "human";
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
  quotes: Quote[];
  last_updated: string;
  last_activity: string;
  settings?: HumanSettings;
}

export interface PersonaEntity {
  id: string;                    // UUID (or "ei" for built-in Ei persona)
  display_name: string;          // What shows in UI (user's chosen name)
  entity: "system";
  aliases?: string[];            // For fuzzy matching (user types "/persona Bob")
  short_description?: string;
  long_description?: string;
  model?: string;
  group_primary?: string | null;
  groups_visible?: string[];
  traits: Trait[];
  topics: PersonaTopic[];
  is_paused: boolean;
  pause_until?: string;
  is_archived: boolean;
  archived_at?: string;
  is_static: boolean;
  heartbeat_delay_ms?: number;
  context_window_hours?: number;
  context_boundary?: string;  // ISO timestamp - messages before this excluded from LLM context
  last_updated: string;
  last_activity: string;
  last_heartbeat?: string;
  last_extraction?: string;
  tools?: string[];              // IDs of ToolDefinitions this persona can use. Empty/absent = no tool access.
}

export interface PersonaCreationInput {
  name: string;
  aliases?: string[];
  long_description?: string;
  short_description?: string;
  traits?: Partial<Trait>[];
  topics?: Partial<PersonaTopic>[];
  model?: string;
  group_primary?: string;
  groups_visible?: string[];
  tools?: string[];              // IDs of ToolDefinitions to assign at creation time
}

// Message pruning thresholds (shared by ceremony and import)
export const MESSAGE_MIN_COUNT = 200;
export const MESSAGE_MAX_AGE_DAYS = 14;

// DLQ rolloff thresholds
export const DLQ_MAX_COUNT = 50;
export const DLQ_MAX_AGE_DAYS = 14;

// Reserved persona names (command keywords that conflict with /persona subcommands)
export const RESERVED_PERSONA_NAMES = ["new", "clone"] as const;
export type ReservedPersonaName = typeof RESERVED_PERSONA_NAMES[number];

export function isReservedPersonaName(name: string): boolean {
  return RESERVED_PERSONA_NAMES.includes(name.toLowerCase() as ReservedPersonaName);
}

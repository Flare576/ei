/**
 * EI V1 Core Types
 * Source of truth: CONTRACTS.md
 */

// =============================================================================
// ENUMS
// =============================================================================

export enum ContextStatus {
  Default = "default",
  Always = "always",
  Never = "never",
}

export enum ValidationLevel {
  None = "none",     // Fresh data, never acknowledged
  Ei = "ei",         // Ei mentioned it to user (don't mention again)
  Human = "human",   // User explicitly confirmed (locked)
}
export enum LLMRequestType {
  Response = "response",
  JSON = "json",
  Raw = "raw",
}

export enum LLMPriority {
  High = "high",
  Normal = "normal",
  Low = "low",
}

export enum LLMNextStep {
  HandlePersonaResponse = "handlePersonaResponse",
  HandlePersonaGeneration = "handlePersonaGeneration",
  HandlePersonaDescriptions = "handlePersonaDescriptions",
  HandleHumanFactScan = "handleHumanFactScan",
  HandleHumanTraitScan = "handleHumanTraitScan",
  HandleHumanTopicScan = "handleHumanTopicScan",
  HandleHumanPersonScan = "handleHumanPersonScan",
  HandleHumanItemMatch = "handleHumanItemMatch",
  HandleHumanItemUpdate = "handleHumanItemUpdate",
  HandlePersonaTraitExtraction = "handlePersonaTraitExtraction",
  HandlePersonaTopicScan = "handlePersonaTopicScan",
  HandlePersonaTopicMatch = "handlePersonaTopicMatch",
  HandlePersonaTopicUpdate = "handlePersonaTopicUpdate",
  HandleHeartbeatCheck = "handleHeartbeatCheck",
  HandleEiHeartbeat = "handleEiHeartbeat",
  HandleOneShot = "handleOneShot",
  HandlePersonaExpire = "handlePersonaExpire",
  HandlePersonaExplore = "handlePersonaExplore",
  HandleDescriptionCheck = "handleDescriptionCheck",
}

// =============================================================================
// DATA ITEMS
// =============================================================================

export interface DataItemBase {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  last_updated: string;
  learned_by?: string;           // Persona ID that originally learned this item (stable UUID)
  last_changed_by?: string;      // Persona ID that most recently updated this item (stable UUID)
  persona_groups?: string[];
  embedding?: number[];
}

export interface Fact extends DataItemBase {
  validated: ValidationLevel;
  validated_date: string;
}

export interface Trait extends DataItemBase {
  strength?: number;
}

export interface Topic extends DataItemBase {
  category?: string; // Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project
  exposure_current: number;
  exposure_desired: number;
  last_ei_asked?: string | null;  // ISO timestamp of last time Ei proactively asked about this
}

/**
 * PersonaTopic - How a persona engages with a topic
 * 
 * Different from Human Topic because:
 * - Persona-local (not shared across personas via groups)
 * - Richer fields: perspective, approach, personal_stake
 * - Not "learned" - generated during Ceremony
 */
export interface PersonaTopic {
  id: string;
  name: string;
  perspective: string;      // Their view/opinion on this topic
  approach: string;         // How they prefer to engage with this topic
  personal_stake: string;   // Why this topic matters to them personally
  sentiment: number;        // -1.0 to 1.0
  exposure_current: number; // 0.0 to 1.0 (how recently discussed)
  exposure_desired: number; // 0.0 to 1.0 (how much they want to discuss)
  last_updated: string;     // ISO timestamp
}

export interface Person extends DataItemBase {
  relationship: string;
  exposure_current: number;
  exposure_desired: number;
  last_ei_asked?: string | null;  // ISO timestamp of last time Ei proactively asked about this
}

export interface Quote {
  id: string;                    // UUID (use crypto.randomUUID())
  message_id: string | null;     // FK to Message.id (nullable for manual quotes)
  data_item_ids: string[];       // FK[] to DataItemBase.id
  persona_groups: string[];      // Visibility groups
  text: string;                  // The quote content
  speaker: "human" | string;     // Who said it (persona ID or "human")
  timestamp: string;             // ISO timestamp (from original message)
  start: number | null;          // Character offset in message (null = can't highlight)
  end: number | null;            // Character offset in message (null = can't highlight)
  created_at: string;            // ISO timestamp when captured
  created_by: "extraction" | "human";  // How it was created
  embedding?: number[];          // Semantic embedding for similarity search
}

// =============================================================================
// PROVIDER ACCOUNTS
// =============================================================================

export enum ProviderType {
  LLM = "llm",
  Storage = "storage",
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

// =============================================================================
// ENTITIES
// =============================================================================

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

export interface HumanSettings {
  default_model?: string;
  queue_paused?: boolean;
  skip_quote_delete_confirm?: boolean;
  name_display?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  accounts?: ProviderAccount[];
  sync?: SyncCredentials;
  opencode?: OpenCodeSettings;
  ceremony?: CeremonyConfig;
  claudeCode?: import("../integrations/claude-code/types.js").ClaudeCodeSettings;
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
}

export interface PersonaCreationInput {
  name: string;
  aliases?: string[];
  long_description?: string;
  short_description?: string;
  traits?: Partial<Trait>[];
  topics?: Partial<Topic>[];
  model?: string;
  group_primary?: string;
  groups_visible?: string[];
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

// =============================================================================
// MESSAGES
// =============================================================================

export interface Message {
  id: string;
  role: "human" | "system";
  verbal_response?: string;   // Human text or persona's spoken reply
  action_response?: string;  // Stage direction / action the persona performs
  silence_reason?: string;   // Why the persona chose not to respond (not shown to LLM)
  timestamp: string;
  read: boolean;               // Has human seen this system message?
  context_status: ContextStatus;
  
  // Extraction completion flags (omit when false to save space)
  // Single-letter names minimize storage overhead for large message histories
  f?: boolean;                 // Fact extraction completed
  r?: boolean;                 // tRait extraction completed
  p?: boolean;                 // Person extraction completed
  o?: boolean;                 // tOpic extraction completed
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// =============================================================================
// LLM TYPES
// =============================================================================

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
}



// =============================================================================
// DATA ITEM TYPE HELPERS
// =============================================================================

export type DataItemType = "fact" | "trait" | "topic" | "person";

export type DataItem = Fact | Trait | Topic | Person;

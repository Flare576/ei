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
  HandleEiValidation = "handleEiValidation",
  HandleOneShot = "handleOneShot",
  // Ceremony handlers
  HandleCeremonyExposure = "handleCeremonyExposure",
  HandleCeremonyDecayComplete = "handleCeremonyDecayComplete",
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
  learned_by?: string;
  persona_groups?: string[];
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
}

export interface Quote {
  id: string;                    // UUID (use crypto.randomUUID())
  message_id: string | null;     // FK to Message.id (nullable for manual quotes)
  data_item_ids: string[];       // FK[] to DataItemBase.id
  persona_groups: string[];      // Visibility groups
  text: string;                  // The quote content
  speaker: "human" | string;     // Who said it (persona name or "human")
  timestamp: string;             // ISO timestamp (from original message)
  start: number | null;          // Character offset in message (null = can't highlight)
  end: number | null;            // Character offset in message (null = can't highlight)
  created_at: string;            // ISO timestamp when captured
  created_by: "extraction" | "human";  // How it was created
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
  
  // Provider-specific extras (e.g., OpenRouter needs HTTP-Referer, X-Title)
  extra_headers?: Record<string, string>;
  
  // Metadata
  enabled?: boolean;               // Default: true
  created_at: string;              // ISO timestamp
}

// =============================================================================
// ENTITIES
// =============================================================================

export interface HumanSettings {
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
  skip_quote_delete_confirm?: boolean;
  name_display?: string;
  name_color?: string;
  time_mode?: "24h" | "12h" | "local" | "utc";
  accounts?: ProviderAccount[];
}

export interface CeremonyConfig {
  enabled: boolean;
  time: string;  // "HH:MM" format (e.g., "03:00")
  last_ceremony?: string;  // ISO timestamp
  decay_rate?: number;  // Default: 0.1
  explore_threshold?: number;  // Default: 3
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
  last_seeded_fact?: string;
  last_seeded_trait?: string;
  last_seeded_topic?: string;
  last_seeded_person?: string;
  ceremony_config?: CeremonyConfig;
}

export interface PersonaEntity {
  entity: "system";
  aliases?: string[];
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
  last_inactivity_ping?: string;
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

// =============================================================================
// MESSAGES
// =============================================================================

export interface Message {
  id: string;
  role: "human" | "system";
  content: string;
  timestamp: string;
  read: boolean;
  context_status: ContextStatus;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

// =============================================================================
// LLM TYPES
// =============================================================================

export interface LLMRequest {
  id: string;
  created_at: string;
  attempts: number;
  last_attempt?: string;
  type: LLMRequestType;
  priority: LLMPriority;
  system: string;
  user: string;
  next_step: LLMNextStep;
  model?: string;
  data: Record<string, unknown>;
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
  name: string;
  aliases: string[];
  short_description?: string;
  is_paused: boolean;
  is_archived: boolean;
  unread_count: number;
  last_activity?: string;
}

export interface MessageQueryOptions {
  after?: string;
  before?: string;
  limit?: number;
  includeOutOfContext?: boolean;
}

export interface Checkpoint {
  index: number;           // Slot number: 0-9 = auto-save, 10-14 = manual save
  timestamp: string;       // When created
  name?: string;           // Display name (manual saves should have one)
}

export interface QueueStatus {
  state: "idle" | "busy" | "paused";
  pending_count: number;
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
  onPersonaUpdated?: (personaName: string) => void;
  onMessageAdded?: (personaName: string) => void;
  onMessageRecalled?: (personaName: string, content: string) => void;
  onMessageProcessing?: (personaName: string) => void;
  onMessageQueued?: (personaName: string) => void;
  onHumanUpdated?: () => void;
  onQuoteAdded?: () => void;
  onQuoteUpdated?: () => void;
  onQuoteRemoved?: () => void;
  onQueueStateChanged?: (state: "idle" | "busy") => void;
  onError?: (error: EiError) => void;
  onCheckpointStart?: () => void;
  onCheckpointCreated?: (index?: number) => void;
  onCheckpointRestored?: (index: number) => void;
  onCheckpointDeleted?: (index: number) => void;
  onOneShotReturned?: (guid: string, content: string) => void;
  onContextBoundaryChanged?: (personaName: string) => void;
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

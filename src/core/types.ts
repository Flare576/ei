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
  HandlePersonaTopicDetection = "handlePersonaTopicDetection",
  HandlePersonaTopicExploration = "handlePersonaTopicExploration",
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
  confidence: number;
  last_confirmed?: string;
}

export interface Trait extends DataItemBase {
  strength?: number;
}

export interface Topic extends DataItemBase {
  exposure_current: number;
  exposure_desired: number;
}

export interface Person extends DataItemBase {
  relationship: string;
  exposure_current: number;
  exposure_desired: number;
}

// =============================================================================
// ENTITIES
// =============================================================================

export interface HumanSettings {
  auto_save_interval_ms?: number;
  default_model?: string;
  queue_paused?: boolean;
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
  last_updated: string;
  last_activity: string;
  settings?: HumanSettings;
  lastSeeded_fact?: string;
  lastSeeded_trait?: string;
  lastSeeded_topic?: string;
  lastSeeded_person?: string;
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
  topics: Topic[];
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
  messages?: ChatMessage[];
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
  settings: Record<string, unknown>;
}



// =============================================================================
// DATA ITEM TYPE HELPERS
// =============================================================================

export type DataItemType = "fact" | "trait" | "topic" | "person";

export type DataItem = Fact | Trait | Topic | Person;

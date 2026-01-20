// ============================================================================
// NEW ENTITY DATA ARCHITECTURE (0107 Epic)
// ============================================================================

/**
 * Base fields shared by all data items (facts, traits, topics, people)
 */
export interface DataItemBase {
  /** Unique identifier for this data item */
  name: string;
  /** Detailed description or context */
  description: string;
  /**
   * SENTIMENT: How does the entity feel about this?
   * Range: -1.0 (strongly negative) to 1.0 (strongly positive)
   * 0.0 = neutral
   */
  sentiment: number;
  /** ISO timestamp of last modification */
  last_updated: string;
  /** Which persona discovered/created this data (human data only) */
  learned_by?: string;
  /**
   * PERSONA_GROUPS: Which persona groups can see this (human data only)
   * Empty array = globally visible to all personas
   * Non-empty = only visible to personas in these groups (or with groups_visible: ["*"])
   */
  persona_groups?: string[];
  /** Change history for Ei validation */
  change_log?: ChangeEntry[];
}

/**
 * Single entry in a data item's change log
 */
export interface ChangeEntry {
  /** ISO timestamp of the change */
  date: string;
  /** Which persona made this change */
  persona: string;
  /** Rough magnitude of change (e.g., string length difference) */
  delta_size: number;
  /** JSON stringified previous state (for Ei review) */
  previous_value?: string;
}

/**
 * FACT: Immutable biographical/factual information
 * Examples: birthday, location, occupation, constraints
 * Requires periodic confirmation to maintain accuracy
 */
export interface Fact extends DataItemBase {
  /**
   * Confidence level in this fact's accuracy
   * Range: 0.0 to 1.0
   * Affects re-verification frequency
   */
  confidence: number;
  /** ISO timestamp of last user confirmation */
  last_confirmed?: string;
}

/**
 * TRAIT: Core characteristic or behavioral pattern
 * Examples: personality traits, communication style, values
 */
export interface Trait extends DataItemBase {
  /**
   * How strongly this trait manifests
   * Range: 0.0 to 1.0
   * Optional - allows for "occasionally" vs "always" traits
   */
  strength?: number;
}

/**
 * TOPIC: Discussable subject with engagement dynamics
 * Examples: hobbies, interests, work projects, concerns
 */
export interface Topic extends DataItemBase {
  /**
   * EXPOSURE: How recently/frequently has this topic come up?
   * Range: 0.0 to 1.0
   * Decays toward 0.0 over time (logarithmic)
   * Increases when the topic is discussed
   */
  level_current: number;
  /**
   * DISCUSSION DESIRE: How much does the entity WANT TO TALK about this?
   * Range: 0.0 to 1.0
   * NOT the same as sentiment (can love something but not want to discuss it right now)
   * Changes rarely - only on explicit preference signals
   */
  level_ideal: number;
}

/**
 * PERSON: Real human in the user's life (human entity only)
 * Examples: family, friends, coworkers, acquaintances
 */
export interface Person extends DataItemBase {
  /** Relationship type (e.g., "daughter", "boss", "friend") */
  relationship: string;
  /**
   * RELATIONSHIP ENGAGEMENT: How recently/frequently has this person been discussed?
   * Range: 0.0 to 1.0
   * Decays over time
   */
  level_current: number;
  /**
   * DISCUSSION DESIRE: How much does the user want to talk about this person?
   * Range: 0.0 to 1.0
   * Independent of how much they like the person (see sentiment)
   */
  level_ideal: number;
}

/**
 * Configuration for Ei's Daily Ceremony (data verification)
 */
export interface CeremonyConfig {
  /** Whether Daily Ceremony is enabled */
  enabled: boolean;
  /** Time of day to run ceremony (24-hour format: "HH:MM") */
  time: string;
  /** Timezone (defaults to system timezone if not set) */
  timezone?: string;
  /** ISO timestamp of last ceremony run */
  last_ceremony?: string;
}

/**
 * HUMAN ENTITY: Represents the real user
 * One per profile - stores what the system knows about the human
 */
export interface HumanEntity {
  entity: "human";
  /** Biographical/factual information requiring confirmation */
  facts: Fact[];
  /** Core personality characteristics and behavioral patterns */
  traits: Trait[];
  /** Interests and discussable subjects */
  topics: Topic[];
  /** Real people in the user's life */
  people: Person[];
  /** ISO timestamp of last update to any data bucket */
  last_updated: string | null;
  /** Configuration for Ei's Daily Ceremony */
  ceremony_config?: CeremonyConfig;
}

// ============================================================================
// EXTRACTION FREQUENCY TRACKING (0113)
// ============================================================================

/**
 * Extraction history for a single data type
 */
export interface ExtractionHistory {
  /** ISO timestamp of last extraction run */
  last_extraction: string | null;
  /** Number of message pairs since last extraction */
  messages_since_last_extract: number;
  /** Total number of extractions ever run (also serves as "fullness" indicator) */
  total_extractions: number;
}

/**
 * Extraction tracking state for a single entity
 */
export interface EntityExtractionState {
  fact: ExtractionHistory;
  trait: ExtractionHistory;
  topic: ExtractionHistory;
  person: ExtractionHistory;
}

/**
 * Global extraction state file
 * Keys: "human" or "system:{personaName}"
 */
export interface ExtractionState {
  [entityKey: string]: EntityExtractionState;
}

// ============================================================================
// ENTITY DEFINITIONS
// ============================================================================

/**
 * PERSONA ENTITY: Represents an AI conversational agent
 * Multiple per profile - each with their own personality and context
 */
export interface PersonaEntity {
  entity: "system";
  
  // Identity
  /** Alternative names for this persona */
  aliases?: string[];
  /** Brief 10-15 word personality summary */
  short_description?: string;
  /** Detailed 2-3 sentence description */
  long_description?: string;
  /**
   * MODEL: Which LLM model should this persona use?
   * Format: "provider:model" (e.g., "openai:gpt-4o", "local:google/gemma-3-12b")
   * Optional - absence means use global default (EI_LLM_MODEL env var)
   */
  model?: string;
  
  // Visibility
  /**
   * GROUP_PRIMARY: Primary group for this persona
   * Human data created by this persona inherits this group
   * null = no primary group (global persona like ei)
   */
  group_primary?: string | null;
  /**
   * GROUPS_VISIBLE: Additional groups this persona can see
   * Primary group is implicitly visible (don't duplicate here)
   * ["*"] = can see all groups (special case for ei)
   * [] or undefined = only see own group + global
   */
  groups_visible?: string[];
  
  // Data (simpler than human - no facts or people)
  /** Core personality characteristics */
  traits: Trait[];
  /** What this persona cares about or focuses on */
  topics: Topic[];
  
  // State
  /** Whether this persona is paused (no heartbeats or processing) */
  isPaused?: boolean;
  /** ISO timestamp when pause expires (undefined = indefinite) */
  pauseUntil?: string;
  /** Whether this persona is archived (soft delete) */
  isArchived?: boolean;
  /** ISO timestamp when persona was archived */
  archivedDate?: string;
  
  /** ISO timestamp of last update to any data */
  last_updated: string | null;
}

/**
 * ENTITY: Union type for storage operations
 */
export type Entity = HumanEntity | PersonaEntity;

/**
 * Type guard: Check if entity is a human
 */
export function isHumanEntity(entity: Entity): entity is HumanEntity {
  return entity.entity === "human";
}

/**
 * Type guard: Check if entity is a persona
 */
export function isPersonaEntity(entity: Entity): entity is PersonaEntity {
  return entity.entity === "system";
}

export type MessageState = "sent" | "processing" | "queued" | "failed";

export interface Message {
  role: "human" | "system";
  content: string;
  timestamp: string;
  state?: MessageState;
  read?: boolean;
}

export interface ConversationHistory {
  messages: Message[];
}

export interface ProcessEventInput {
  delay_ms: number;
  human_entity: HumanEntity;
  persona_entity: PersonaEntity;
  recent_history: Message[] | null;
  human_message: string | null;
}

export interface LLMResponse {
  message: string | null;
}

export interface PersonaState {
  name: string;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  isProcessing: boolean;
  messageQueue: string[];
  unreadCount: number;
  abortController: AbortController | null;
  /** Whether this persona is paused (no heartbeats or message processing) */
  isPaused: boolean;
  /** ISO timestamp when pause expires (undefined = indefinite pause) */
  pauseUntil?: string;
  /** Timer for auto-resume when pauseUntil is set */
  pauseTimer: ReturnType<typeof setTimeout> | null;
}

export interface SystemSnapshot {
  timestamp: string;
  humanEntity: HumanEntity;
  personas: {
    [personaName: string]: {
      entity: PersonaEntity;
      history: ConversationHistory;
    }
  };
}


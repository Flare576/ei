/**
 * EI V1 Data Item Types
 * Source of truth: CONTRACTS.md
 */


export interface DataItemBase {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  last_updated: string;
  learned_on?: string;           // ISO timestamp when item first entered the system. Immutable after creation. Pairs with learned_by.
  last_mentioned?: string;        // Set by extraction only, never ceremony. Used for --recent sorting.
  learned_by?: string;           // Persona ID that originally learned this item (UUID, or "ei"/"emmet" for reserved personas)
  last_changed_by?: string;      // Persona ID that most recently updated this item (UUID, or "ei"/"emmet" for reserved personas)
  interested_personas?: string[]; // Persona IDs that have extracted/touched this item (accumulated)
  sources?: string[];            // Namespaced source identifiers — where items were learned from. Format: "provider:id" (e.g., "opencode:ses_abc123", "cursor:composerId", "codex:threadId"). Grow-only union.
  persona_groups?: string[];
  embedding?: number[];
  rewrite_length_floor?: number; // Set after every rewrite scan: ceil(description.length * 1.1). Item is skipped by ceremony until description grows past this floor. Preserved across extraction upserts — only cleared when description exceeds it.
}

export interface Fact extends DataItemBase {
  validated_date: string;
}

export interface PersonaTrait extends DataItemBase {
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

export interface PersonIdentifier {
  type: string;         // User-extensible. "Nickname", "GitHub", "Ei Persona", etc. NOT an enum. Matching is case-insensitive.
  value: string;        // The identifier value. For "Ei Persona": the Persona's id — a UUID for user-created personas, or the literal "ei"/"emmet" for the two reserved ones.
  is_primary?: boolean; // True = this is the display name. Synced to DataItemBase.name on write.
}

export interface Person extends DataItemBase {
  identifiers?: PersonIdentifier[];
  // DataItemBase.name stays. Must always equal:
  //   identifiers.find(i => i.is_primary)?.value ?? identifiers[0]?.value ?? name
  // State manager syncs name on every write.
  validated_date?: string;  // ISO timestamp. Empty string or absent = candidate for Ei heartbeat intro. Same contract as Fact.validated_date.
  relationship: string;
  exposure_current: number;
  exposure_desired: number;
  last_ei_asked?: string | null;  // ISO timestamp of last time Ei proactively asked about this
}

export interface Quote {
  id: string;                    // UUID — stable identity for CRUD operations (use crypto.randomUUID())
  message_id: string | null;     // FK to Message.id (nullable for manual quotes)
  data_item_ids: string[];       // FK[] to DataItemBase.id
  persona_groups: string[];      // Visibility groups
  text: string;                  // The quote content
  speaker: "human" | string;     // Actual speaker: "human" or the persona's display_name
  channel?: string;              // Display name of the Channel (persona or room) where captured.
                                 // Undefined on pre-migration quotes.
  timestamp: string;             // ISO timestamp (from original message)
  start: number | null;          // Character offset in message (null = can't highlight)
  end: number | null;            // Character offset in message (null = can't highlight)
  created_at: string;            // ISO timestamp when captured
  created_by: "extraction" | "human";  // How it was created
  embedding?: number[];          // Semantic embedding for similarity search
}

export type DataItemType = "fact" | "trait" | "topic" | "person";

export type DataItem = Fact | PersonaTrait | Topic | Person;

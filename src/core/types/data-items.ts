/**
 * EI V1 Data Item Types
 * Source of truth: CONTRACTS.md
 */

import type { ValidationLevel } from "./enums.js";

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

export type DataItemType = "fact" | "trait" | "topic" | "person";

export type DataItem = Fact | Trait | Topic | Person;

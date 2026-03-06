import type { Trait, PersonaTopic, DataItemBase } from "../../core/types.js";

export interface PersonaExpirePromptData {
  persona_name: string;
  topics: PersonaTopic[];
}

export interface PersonaExpireResult {
  topic_ids_to_remove: string[];
}

export interface PersonaExplorePromptData {
  persona_name: string;
  traits: Trait[];
  remaining_topics: PersonaTopic[];
  recent_conversation_themes: string[];
}

export interface PersonaExploreResult {
  new_topics: Array<{
    name: string;
    perspective: string;
    approach: string;
    personal_stake: string;
    sentiment: number;
    exposure_current: number;
    exposure_desired: number;
  }>;
}

export interface DescriptionCheckPromptData {
  persona_name: string;
  current_short_description?: string;
  current_long_description?: string;
  traits: Trait[];
  topics: PersonaTopic[];
}

export interface DescriptionCheckResult {
  should_update: boolean;
  reason?: string;
}

// =============================================================================
// REWRITE (Item Reorganization)
// =============================================================================

export type RewriteItemType = "fact" | "trait" | "topic" | "person";

/** Phase 1 input: the bloated item to scan for extra subjects. */
export interface RewriteScanPromptData {
  item: DataItemBase;
  itemType: RewriteItemType;
}

/** Phase 1 output: array of subject strings (parsed from LLM JSON response). */
export type RewriteScanResult = string[];

/** A single subject and the read_memory matches found for it. */
export interface RewriteSubjectMatch {
  searchTerm: string;
  matches: DataItemBase[];  // Top 3 from searchHumanData, may be empty
}

/** Phase 2 input: the bloated item + all subject matches. */
export interface RewritePromptData {
  item: DataItemBase;
  itemType: RewriteItemType;
  subjects: RewriteSubjectMatch[];
}

/** Phase 2 output: existing items to upsert + new items to create. */
export interface RewriteResult {
  existing: Array<{
    id: string;
    type: RewriteItemType;
    name: string;
    description: string;
    sentiment?: number;
    strength?: number;        // traits
    exposure_current?: number; // topics, people
    exposure_desired?: number; // topics, people
    relationship?: string;     // people
    category?: string;          // topics
  }>;
  new: Array<{
    type: RewriteItemType;
    name: string;
    description: string;
    sentiment?: number;
    strength?: number;
    exposure_current?: number;
    exposure_desired?: number;
    relationship?: string;
    category?: string;
  }>;
}

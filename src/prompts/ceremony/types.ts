import type { DataItemBase } from "../../core/types.js";

// =============================================================================
// REWRITE (Item Reorganization)
// =============================================================================

export type RewriteItemType = "trait" | "topic" | "person";

/** Phase 1 input: the bloated item to scan for extra subjects. */
export interface RewriteScanPromptData {
  item: DataItemBase;
  itemType: RewriteItemType;
}

/** Phase 1 output: array of subject strings (parsed from LLM JSON response). */
export type RewriteScanResult = string[];

/** A single subject and the find_memory matches found for it. */
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

// =============================================================================
// DEDUP (Duplicate Entity Merge)
// =============================================================================

/** Input: cluster of potentially duplicate entities to curate. */
export interface DedupPromptData {
  cluster: DataItemBase[];  // 2+ items with 0.90+ cosine similarity
  itemType: RewriteItemType;
  similarityRange: { min: number; max: number };  // e.g., { min: 0.90, max: 0.98 }
}

/** Input: exactly 2 records — one established, one just created — for binary merge decision. */
export interface ValidatePromptData {
  established: DataItemBase;
  newcomer: DataItemBase;
  itemType: RewriteItemType;
  similarity: number;
}

/** Output: merge decisions (update/remove/add). */
export interface DedupResult {
  update: Array<{
    id: string;
    type: RewriteItemType;
    name: string;
    description: string;
    sentiment?: number;
    strength?: number;
    confidence?: number;
    exposure_current?: number;
    exposure_desired?: number;
    relationship?: string;
    category?: string;
    last_updated?: string;
  }>;
  remove: Array<{
    to_be_removed: string;  // UUID of duplicate
    replaced_by: string;    // UUID of canonical record
  }>;
  add: Array<{
    type: RewriteItemType;
    name: string;
    description: string;
    sentiment?: number;
    strength?: number;
    confidence?: number;
    exposure_current?: number;
    exposure_desired?: number;
    relationship?: string;
    category?: string;
  }>;
}

import type { DedupPromptData } from "./types.js";

// =============================================================================
// USER-TRIGGERED DEDUP — Direct merge, no candidate-finding, no hedging
// =============================================================================

/**
 * Prompt for user-confirmed deduplication.
 *
 * Unlike buildDedupPrompt (ceremony), this skips all decision-making — the user
 * has already confirmed these entities are duplicates. Opus just merges.
 * No hedging, no "our system BELIEVES these MAY be duplicates" language.
 */
export function buildUserDedupPrompt(data: DedupPromptData): { system: string; user: string } {
  const typeLabel = data.itemType.charAt(0).toUpperCase() + data.itemType.slice(1);

  const system = `You are merging duplicate ${typeLabel} records in a user's personal knowledge base. The user has manually confirmed that all records in this cluster refer to the same entity.

**YOUR PRIME DIRECTIVE: LOSE NO DATA.**

Your job is synthesis, not decision-making. Do not question whether these are duplicates — they are. Simply collapse them into one comprehensive, non-repetitive record.

### Merge Rules:
- Pick the most descriptive, commonly-used name as the canonical name
- Union all unique details from every description — if it was in any record, it belongs in the merged record
- Descriptions should be concise (under 300 chars) but complete — no detail left behind
- Numeric fields: strength/confidence → take HIGHER; sentiment → AVERAGE; exposure → take HIGHER
- relationship/category → pick most specific/accurate

### Output Format:
{
  "update": [
    /* The single merged canonical record with ALL fields preserved */
    /* MUST include "id" (use the oldest/most-referenced record's ID), "type", "name", "description" */
  ],
  "remove": [
    {"to_be_removed": "uuid-of-duplicate", "replaced_by": "uuid-of-canonical-record"},
    /* One entry per record being absorbed */
  ],
  "add": []
}

Return raw JSON only. No markdown, no commentary.

${buildRecordFormatHint(data.itemType)}`;

  const user = JSON.stringify({
    cluster: data.cluster.map(stripEmbedding),
    cluster_type: data.itemType,
    user_confirmed: true,
  }, null, 2);

  return { system, user };
}

// =============================================================================
// Helpers
// =============================================================================

function stripEmbedding<T extends { embedding?: unknown }>(item: T): Omit<T, "embedding"> {
  const { embedding: _, ...rest } = item;
  return rest as Omit<T, "embedding">;
}

function buildRecordFormatHint(itemType: string): string {
  switch (itemType) {
    case "person":
      return `Person fields: id, type, name, description, sentiment (-1 to 1), relationship, exposure_current (0-1), exposure_desired (0-1), learned_by (optional), last_changed_by (optional)`;
    case "topic":
      return `Topic fields: id, type, name, description, sentiment (-1 to 1), category, exposure_current (0-1), exposure_desired (0-1), learned_by (optional), last_changed_by (optional)`;
    default:
      return "";
  }
}

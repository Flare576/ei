import type { RewriteScanPromptData, RewritePromptData } from "./types.js";

// =============================================================================
// PHASE 1: SCAN — Identify distinct subjects in a bloated item
// =============================================================================

export function buildRewriteScanPrompt(data: RewriteScanPromptData): { system: string; user: string } {
  const typeLabel = data.itemType.charAt(0).toUpperCase() + data.itemType.slice(1);

  const system = `You are auditing a personal knowledge base. A single ${typeLabel} record has grown too large because unrelated information was repeatedly appended to it over time. The record's Name suggests its intended subject, but its Description now covers many additional, unrelated subjects.

Your job: identify the **additional** subjects buried in this record that do NOT belong under the record's Name.

Rules:
- Do NOT include the record's primary subject (what its Name describes) — only the extra, unrelated subjects.
- Each subject should be a succinct phrase (2-8 words) that could serve as a search query.
- Be specific. "Technical preferences" is too vague. "TypeScript coding conventions" is better.
- If the record is actually cohesive and on-topic despite its length, return an empty array.

Return a raw JSON array of strings. No markdown fencing, no commentary, no explanation. Just the array.

Example — a Topic named "Software Engineering" whose description also discusses vim keybindings, git conventions, and AI tooling:
["vim keybindings and editor configuration", "git and GitHub workflow conventions", "AI coding assistant preferences"]`;

  const payload = JSON.stringify(stripEmbedding(data.item), null, 2);

  const schemaReminder = `**Return JSON:**
\n\`\`\`json
[
  "topic about vim keybindings",
  "git workflow conventions",
  "AI coding assistant preferences"
]
\`\`\`

Respond with raw JSON array only.`;

  const user = `${payload}

---

${schemaReminder}`;

  return { system, user };
}

// =============================================================================
// PHASE 2: REWRITE — Reorganize data across existing and new items
// =============================================================================

export function buildRewritePrompt(data: RewritePromptData): { system: string; user: string } {
  const typeLabel = data.itemType.charAt(0).toUpperCase() + data.itemType.slice(1);

  const system = `You are reorganizing a personal knowledge base. A ${typeLabel} record has become a catch-all for several unrelated subjects. An earlier analysis identified the extra subjects, and we searched our knowledge base for potentially matching existing records.

The search results under each subject are our **best guesses** — they may not be accurate matches. Only merge data into an existing record if the subject matter genuinely overlaps. Similar names with different meanings should produce a NEW record instead.

Your job:
1. **Update existing records**: For subjects that match an existing record, incorporate the relevant data from the original entry into that record's description. Preserve the existing record's "id", "name", and "type".
2. **Create new records**: For subjects with no appropriate match among the search results, create a new record.
3. **Slim the original**: Remove all data from the original record that now lives elsewhere. The original should contain ONLY information directly relevant to its Name.

Return raw JSON with exactly two keys. No markdown fencing, no commentary. Just the JSON object:
{
  "existing": [ /* updated records, including the slimmed-down original */ ],
  "new": [ /* brand-new records for subjects with no match */ ]
}

Record format for "existing" entries (MUST include "id" and "type"):
${buildExistingExamples()}

Record format for "new" entries (NO "id" field — the system assigns one):
${buildNewExamples()}

Rules:
- The original record (id: "${data.item.id}") MUST appear in "existing", slimmed down.
- Descriptions should be concise: ${data.itemType === 'topic' ? 'ideally under 300 characters, never over 500' : 'ideally under 600 characters, never over 1000'}.
- Preserve sentiment, strength, confidence, and other numeric values from the source record where applicable.
- "type" must be one of: "topic", "person".
- Topics MUST include "category" — one of: Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project, Event. For Event topics, the description should be a narrative account of a specific moment, not a general summary.
- People MUST include "relationship" — a short label like "coworker", "friend", "mentor", etc.
- Do NOT invent information. Only redistribute what exists in the original record.`;

  const subjects = data.subjects.map(s => ({
    search_term: s.searchTerm,
    matches: s.matches.map(m => stripEmbedding(m)),
  }));

  const userPayload = {
    original: stripEmbedding(data.item),
    original_type: data.itemType,
    subjects,
  };

  const schemaReminder = `**Return JSON:**
\n\`\`\`json
{
  "existing": [
    {
      "id": "existing-uuid",
      "type": "${data.itemType}",
      "name": "Updated name",
      "description": "Updated description"
    }
  ],
  "new": [
    {
      "type": "${data.itemType}",
      "name": "New name",
      "description": "New description"
    }
  ]
}
\`\`\`

Return raw JSON only.`;

  const user = `${JSON.stringify(userPayload, null, 2)}

---

${schemaReminder}`;

  return { system, user };
}

// =============================================================================
// Helpers
// =============================================================================

/** Strip embedding arrays from items before putting them in prompts — they're huge and useless to the LLM. */
function stripEmbedding<T extends { embedding?: unknown }>(item: T): Omit<T, "embedding"> {
  const { embedding: _, ...rest } = item;
  return rest as Omit<T, "embedding">;
}

function buildExistingExamples(): string {
  return `Topic:
{
  "id": "existing-uuid",
  "type": "topic",
  "name": "Topic Name",
  "description": "Updated topic description",
  "category": "Interest"
}

Person:
{
  "id": "existing-uuid",
  "type": "person",
  "name": "Person Name",
  "description": "Updated person description",
  "relationship": "coworker"
}`;
}

function buildNewExamples(): string {
  return `Topic:
{
  "type": "topic",
  "name": "New Topic Name",
  "description": "Concise topic description",
  "sentiment": 0.0,
  "category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event"
}

Person:
{
  "type": "person",
  "name": "New Person Name",
  "description": "Concise person description",
  "sentiment": 0.0,
  "relationship": "friend"
}`;
}

import type { RewriteScanPromptData, RewritePromptData } from "./types.js";

// =============================================================================
// PHASE 1: SCAN — Identify subjects that don't belong in a Topic record
// =============================================================================

function stripEmbedding<T extends { embedding?: unknown }>(item: T): Omit<T, "embedding"> {
  const { embedding: _, ...rest } = item;
  return rest as Omit<T, "embedding">;
}

export function buildTopicRewriteScanPrompt(data: RewriteScanPromptData): { system: string; user: string } {
  const isTechnical = (data.item as { category?: string }).category === "Technical";

  const technicalGuidance = isTechnical
    ? `
## Technical Topic Guidance

This is a Technical topic — a knowledge base for a specific technology, platform, or tool. Technical topics are ALLOWED to be dense and detailed.

Only flag subjects that are about a **different** technology or workflow than the one named in this record. For example:
- A Uniform topic containing Turborepo setup details → flag "Turborepo monorepo setup"
- A Uniform topic containing Vercel preview gotchas → do NOT flag (that's core Uniform knowledge)
- An AWS Bedrock topic containing Twilio integration details → flag "Twilio integration"
`
    : "";

  const system = `You are auditing a Topic record in a personal knowledge base. A single Topic record has grown too large because unrelated information was repeatedly added over time. The record's Name suggests its intended subject, but its Description now covers additional, unrelated subjects.

Your job: identify the **extra subjects** buried in this record that do NOT belong under the record's Name.

Rules:
- Do NOT include the record's primary subject (what its Name describes) — only the extra, unrelated subjects
- Each subject should be a succinct phrase (2-8 words) that could serve as a search query
- Be specific: "TypeScript coding conventions" beats "technical preferences"
- If the record is cohesive and on-topic despite its length, return an empty array
${technicalGuidance}
Return a raw JSON array of strings. No markdown fencing, no commentary.

Example — a Topic named "Software Engineering" whose description also discusses vim keybindings, git conventions, and AI tooling:
["vim keybindings and editor configuration", "git and GitHub workflow conventions", "AI coding assistant preferences"]`;

  const payload = JSON.stringify(stripEmbedding(data.item), null, 2);

  const schemaReminder = `**Return JSON:**
\`\`\`json
[
  "vim keybindings and editor configuration",
  "git and GitHub workflow conventions",
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
// PHASE 2: SPLIT — Slim the Topic, redistribute subjects to new/existing records
// =============================================================================

function buildTopicExistingExample(): string {
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

function buildTopicNewExample(isTechnical: boolean): string {
  const categoryHint = isTechnical
    ? `"category": "Technical"  // Split topics from a Technical record inherit Technical category unless clearly different`
    : `"category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event|Technical"`;

  return `Topic:
{
  "type": "topic",
  "name": "New Topic Name",
  "description": "Concise topic description",
  "sentiment": 0.0,
  ${categoryHint}
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

export function buildTopicRewriteSplitPrompt(data: RewritePromptData): { system: string; user: string } {
  const isTechnical = (data.item as { category?: string }).category === "Technical";

  const descriptionGuidance = isTechnical
    ? `ideally under 600 characters, never over 900 — Technical topics are knowledge bases that preserve specific gotchas, decisions, and open questions`
    : `ideally under 300 characters, never over 500`;

  const technicalCategoryNote = isTechnical
    ? `\n- Topics split from a Technical record should inherit category "Technical" unless the subject is clearly a different type (e.g., a personal interest extracted from a technical topic)`
    : "";

  const noSubjectsGate = data.subjects.length === 0
    ? `\n**IMPORTANT: No extra subjects were identified for this record. The correct response is to return the original record unchanged in "existing" with an empty "new" array. Do NOT create new records. Do NOT modify the description.**\n`
    : "";

  const system = `You are reorganizing a personal knowledge base. A Topic record has become a catch-all for several unrelated subjects. An earlier analysis identified the extra subjects, and we searched the knowledge base for potentially matching existing records.
${noSubjectsGate}

The search results under each subject are our **best guesses** — they may not be accurate matches. Only merge data into an existing record if the subject matter genuinely overlaps. Similar names with different meanings should produce a NEW record instead.

Your job:
1. **Update existing records**: For subjects that match an existing record, incorporate the relevant data from the original entry into that record's description. Preserve the existing record's "id", "name", and "type".
2. **Create new records**: For subjects with no appropriate match among the search results, create a new record.
3. **Slim the original**: Remove all data from the original record that now lives elsewhere. The original should contain ONLY information directly relevant to its Name.

Return raw JSON with exactly two keys. No markdown fencing, no commentary:
{
  "existing": [ /* updated records, including the slimmed-down original */ ],
  "new": [ /* brand-new records for subjects with no match */ ]
}

Record format for "existing" entries (MUST include "id" and "type"):
${buildTopicExistingExample()}

Record format for "new" entries (NO "id" field — the system assigns one):
${buildTopicNewExample(isTechnical)}

Rules:
- The original record (id: "${data.item.id}") MUST appear in "existing", slimmed down
- Descriptions should be concise: ${descriptionGuidance}
- Preserve sentiment and other numeric values from the source record where applicable
- "type" must be one of: "topic", "person"
- Topics MUST include "category" — one of: Interest, Goal, Dream, Conflict, Concern, Fear, Hope, Plan, Project, Event, Technical. For Event topics, the description should be a narrative account of a specific moment, not a general summary. For Technical topics, split by distinct technical concept (e.g., "Uniform Composition Model" vs "Uniform Preview Setup") — preserve specificity over brevity
- People MUST include "relationship" — a short label like "coworker", "friend", "mentor", etc.
- Do NOT invent information. Only redistribute what exists in the original record${technicalCategoryNote}`;

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
\`\`\`json
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

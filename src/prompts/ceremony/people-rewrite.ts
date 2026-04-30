import type { RewriteScanPromptData, RewritePromptData } from "./types.js";

// =============================================================================
// What belongs in a Person record (shared reference for both prompts)
// =============================================================================
//
// A Person record is a RELATIONSHIP PROFILE — who this person is, how they
// relate to the human user, and anything a persona would use to meaningfully
// reference them in conversation 6+ months from now.
//
// A Person record is NOT:
//   - A project status log
//   - A record of ticket numbers, PR numbers, or sprint assignments
//   - A biography of their personal habits and hobbies
//   - A shared-interest tracker (those are Topics)
//
// The test: "Would this still be true and useful if you ran into this person
// at a coffee shop, unrelated to any current project?"

const PERSON_CONTRACT = `A Person record is a **relationship profile** — who this person IS, how they relate to the human user, their character and communication style, and anything that makes them recognizable across time and context.

It is NOT:
- A project status log (ticket numbers, PR references, sprint assignments)
- A record of shared interests that could stand alone as a Topic
- Personal biography unrelated to the relationship (commute, hobbies, hometown)
- Technical knowledge attributed to them rather than about them

**The test**: Would this detail still be true and useful if you ran into this person at a coffee shop, unrelated to any current project, in six months?`;

// =============================================================================
// PHASE 1: SCAN — Identify subjects that don't belong in a Person record
// =============================================================================

export function buildPersonRewriteScanPrompt(data: RewriteScanPromptData): { system: string; user: string } {
  const system = `You are auditing a Person record in a personal knowledge base.

${PERSON_CONTRACT}

Your job: identify **subjects buried in this description that fail the test above**.

For each subject that doesn't belong, return a short phrase (3-8 words) that describes it — specific enough to search for matching records. These phrases will be used to find existing Topics this content might belong in.

Rules:
- Do NOT include the relationship profile itself — who they are, their role, how you know them, their character
- Be specific: "React performance patterns" beats "technical stuff"
- If the record is clean — everything in it passes the test — return an empty array

Return a raw JSON array of strings. No markdown fencing, no commentary.

Example — a Person named "Nicholas" whose description includes sprint ticket numbers:
["CMIDP sprint ticket assignments", "ASU Data Lake access provisioning details"]`;

  const payload = JSON.stringify({
    name: (data.item as { name?: string }).name,
    description: data.item.description,
    relationship: (data.item as { relationship?: string }).relationship,
  }, null, 2);

  const user = `${payload}

---

Return a raw JSON array of subject phrases found in this Person record that don't belong there. Return [] if the record is clean.`;

  return { system, user };
}

// =============================================================================
// PHASE 2: SPLIT — Slim the Person, redistribute subjects to Topics
// =============================================================================

function buildPersonExistingExample(): string {
  return `{
  "id": "existing-uuid",
  "type": "person",
  "name": "Nicholas",
  "description": "Backend engineer on the CMIDP team. Thoughtful code reviewer who flags architectural concerns — specifically around concurrency and queue isolation. Direct point of contact for Data Lake access provisioning.",
  "relationship": "coworker"
}`;
}

function buildPersonNewTopicExample(): string {
  return `{
  "type": "topic",
  "name": "CMIDP Sprint 86 work",
  "description": "Nicholas owns 4 tickets in Sprint 86 including course list ordering bugs (CMIDP-2604, CMIDP-2441, CMIDP-2686) and course sequencing (CMIDP-2624).",
  "sentiment": 0.5,
  "category": "Project"
}`;
}

export function buildPersonRewriteSplitPrompt(data: RewritePromptData): { system: string; user: string } {
  const system = `You are reorganizing a Person record in a personal knowledge base.

${PERSON_CONTRACT}

An earlier scan identified subjects in this Person record that don't belong there. For each subject, we searched the knowledge base for existing Topics that might already cover it.

Your job:
1. **Slim the Person** — remove the identified subjects AND any other content that fails the relationship profile test (personal trivia, lifestyle details, biographical facts unrelated to the relationship). Keep only: who they are, their role, their character, how the human user knows and works with them.
2. **Redistribute each identified subject** — if a matching Topic exists in the search results, move the content there. If not, create a new Topic.
3. **Discard what isn't worth a Topic** — personal trivia (hobbies, commute, hometown) that has no standalone value doesn't need to become a Topic. Just remove it from the Person.
4. **Lose NO relationship data** — everything about how this person relates to the human user must survive.

Record format for the Person (MUST keep "id", type stays "person"):
${buildPersonExistingExample()}

Record format for a new Topic created from extracted content:
${buildPersonNewTopicExample()}

Rules:
- The original Person record (id: "${data.item.id}") MUST appear in "existing", slimmed down
- Person description after slimming: 2-4 sentences, relationship profile only. **If it still contains city, commute, hobbies, or lifestyle details after slimming — remove them.** Those are not relationship data.
- Topics created from person content: use the most appropriate category (Technical, Project, Interest, etc.)
- People MUST include "relationship"
- Topics MUST include "category"
- Do NOT invent information — only redistribute what exists in the original record
- Do NOT remove the person's relationship, role, character, or how the human user knows them — only the non-person content

**What to KEEP in the Person description**: role, expertise, *why* the human user works with them (their operational function in the relationship), how they communicate, character traits, how the human user knows them.
**What to REMOVE from the Person description**: current project status, ticket/PR numbers, shared interests (→ Topic), city/commute/hobbies (→ discard).

The distinction:
- "Data Lake bucket owner responsible for access provisioning" → KEEP (operational role in the relationship)
- "Currently owns 4 tickets in Sprint 86" → REMOVE (current sprint status, not who they are)
- "Left detailed comments on PR #1644 identifying architectural concerns around concurrency" → KEEP the insight, DROP the PR reference: "Flags architectural concerns around concurrency and queue isolation" belongs in the description; "PR #1644" does not.

Return raw JSON with exactly two keys:
{
  "existing": [ /* slimmed Person + any existing Topics being updated */ ],
  "new": [ /* new Topics for subjects with no existing match */ ]
}

No markdown fencing, no commentary.`;

  const subjects = data.subjects.map(s => ({
    search_term: s.searchTerm,
    matches: s.matches.map(m => ({
      id: (m as { id?: string }).id,
      name: (m as { name?: string }).name,
      description: m.description,
      category: (m as { category?: string }).category,
    })),
  }));

  const payload = JSON.stringify({
    original_person: {
      id: data.item.id,
      name: (data.item as { name?: string }).name,
      description: data.item.description,
      relationship: (data.item as { relationship?: string }).relationship,
      sentiment: data.item.sentiment,
    },
    subjects_to_extract: subjects,
  }, null, 2);

  const schemaReminder = `**Return JSON:**
\`\`\`json
{
  "existing": [
    {
      "id": "uuid-of-person",
      "type": "person",
      "name": "Person Name",
      "description": "Slimmed relationship profile only",
      "relationship": "coworker"
    }
  ],
  "new": [
    {
      "type": "topic",
      "name": "Subject Name",
      "description": "Content extracted from person record",
      "sentiment": 0.5,
      "category": "Project|Technical|Interest|etc."
    }
  ]
}
\`\`\`

Return raw JSON only.`;

  const user = `${payload}

---

${schemaReminder}`;

  return { system, user };
}

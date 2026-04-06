import type { Person } from "../../core/types/data-items.js";
import type { PromptOutput } from "../persona/types.js";

export interface PersonMigrationPromptData {
  person: Pick<Person, "name" | "description" | "relationship">;
}

export function buildPersonMigrationPrompt(data: PersonMigrationPromptData): PromptOutput {
  const { person } = data;
  const system = `You are extracting identifiers for a Person record in a personal knowledge system.

A Person record has a \`name\` and \`description\` that describe who they are. Your job is to extract ALL identifiers for this person — every name, handle, alias, or platform ID that refers to them.

CRITICAL RULES:
1. The \`name\` field value MUST appear in identifiers — never lose it.
2. Mark exactly one identifier as \`is_primary: true\` — the most natural display name.
3. Check read_memory for additional context before finalizing.
4. Return ONLY a JSON object with an \`identifiers\` array. No other text.
5. "none" is never valid — every person has at least one identifier (their name).

IDENTIFIER TYPES (use these where they fit; any string is valid):
- full_name: Legal or full birth name
- nickname: Informal name, diminutive, pet name  
- email: Email address
- github: GitHub username
- discord: Discord username
- ei_persona: Ei persona UUID (only if explicitly in the data)
- Any other type string is valid.

RESPONSE FORMAT:
\`\`\`json
{
  "identifiers": [
    { "type": "nickname", "value": "Flare", "is_primary": true },
    { "type": "full_name", "value": "Jeremy Scherer" },
    { "type": "github", "value": "Flare576" }
  ]
}
\`\`\``;

  const user = `Extract identifiers for this Person record.

Name: ${person.name}
Relationship: ${person.relationship ?? "unknown"}
Description: ${person.description ?? "(none)"}

First, call read_memory to search for any additional context about "${person.name}". Then return the complete identifiers array.

Return JSON only.`;

  return { system, user };
}

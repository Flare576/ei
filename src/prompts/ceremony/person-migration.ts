import type { Person } from "../../core/types/data-items.js";
import type { PromptOutput } from "../persona/types.js";

export interface PersonMigrationPromptData {
  person: Pick<Person, "name" | "description" | "relationship">;
}

export function buildPersonMigrationPrompt(data: PersonMigrationPromptData): PromptOutput {
  const { person } = data;

  const system = `You are extracting identifiers for a Person record in a personal knowledge system.

A Person record has a \`name\` and \`description\` that describe who they are. Your job is to extract ALL identifiers for this person — every name, handle, alias, or platform ID that refers to them.

## CRITICAL RULES

1. The \`name\` field value MUST appear in identifiers — never lose it.
2. If \`name\` contains a space (e.g. "Jeremy Scherer"), create BOTH a \`Full Name\` identifier AND a \`First Name\` identifier for the given name.
3. Mark exactly one identifier as \`is_primary: true\` — the most natural display name.
4. Check \`read_memory\` for additional context before finalizing.
5. Return ONLY a JSON object with an \`identifiers\` array. No other text.
6. "none" is never valid — every person has at least one identifier (their name).

## DESCRIPTION PRE-PROCESSING

If the description begins with a JSON block (e.g. \`{"identifiers": [...]}\` or \`[{...}]\`), those are pre-seeded identifiers from a prior migration step:
- Parse them out and include them in your output
- Normalize their \`type\` values to Title Case (e.g. \`nickname\` → \`Nickname\`, \`full_name\` → \`Full Name\`)
- Treat the remainder of the description (after the JSON block) as the actual description text for \`read_memory\` context

## IDENTIFIER TYPES

Use Title Case for all types. Built-in types:

| Type | Meaning |
|------|---------|
| Full Name | Legal or full birth name |
| First Name | Given/first name only |
| Nickname | Informal name, diminutive, pet name |
| Email | Email address |
| GitHub | GitHub username |
| Discord | Discord username |
| Roblox | Roblox username |
| Reddit | Reddit username |
| Twitter | Twitter/X handle |
| FF14 | Final Fantasy XIV character name |
| Relationship | How the user addresses this person: Dad, Pop, Sis, etc. |
| Ei Persona | Ei persona UUID (only if explicitly in the data) |

Any string is valid as a type — users define their own (e.g. \`Slack-ASU\`, \`Slack-RnP\`, \`sehimu_thinara\`). Use the exact casing the user would recognize.

## RESPONSE FORMAT

\`\`\`json
{
  "identifiers": [
    { "type": "Nickname", "value": "Flare", "is_primary": true },
    { "type": "Full Name", "value": "Jeremy Scherer" },
    { "type": "First Name", "value": "Jeremy" },
    { "type": "GitHub", "value": "Flare576" },
    { "type": "Slack-RnP", "value": "jeremy.scherer" }
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

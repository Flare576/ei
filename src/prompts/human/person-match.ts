import type { PromptOutput } from "./types.js";

export interface PersonMatchPromptData {
  candidate_name: string;
  candidate_description: string;
  candidate_relationship: string;
  existing_people: Array<{
    id: string;
    name: string;
    description: string;
    relationship?: string;
  }>;
}

export function buildPersonMatchPrompt(data: PersonMatchPromptData): PromptOutput {
  if (!data.candidate_name) {
    throw new Error("buildPersonMatchPrompt: candidate_name is required");
  }

  const system = `# Task

You are checking if a PERSON already exists in our database.

## Matching Rules

1. **Exact match**: Same person by name or clear identity → return their ID
2. **Similar match**: Same person referred to differently ("Mom" vs "Carol", "my boss" vs "Trumble") → return their ID
3. **No match**: Genuinely new person → return "new"

Be conservative. If you're unsure, return "new" — a duplicate is worse than a gap.

# Existing People

\`\`\`json
${JSON.stringify(data.existing_people, null, 2)}
\`\`\`

# Response Format

Return ONLY the ID of the matching entry, or "new".

\`\`\`json
{
  "matched_guid": "uuid-of-matching-entry" | "new"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Candidate Person

Name: ${data.candidate_name}
Description: ${data.candidate_description}
Relationship: ${data.candidate_relationship}

Find the best match in existing people, or return "new" if this is a genuinely new person.

\`\`\`json
{
  "matched_guid": "..." | "new"
}
\`\`\``;

  return { system, user };
}

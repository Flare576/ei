import type { ItemMatchPromptData, PromptOutput } from "./types.js";

export function buildHumanItemMatchPrompt(data: ItemMatchPromptData): PromptOutput {
  if (!data.candidate_type || !data.candidate_name) {
    throw new Error("buildHumanItemMatchPrompt: candidate_type and candidate_name are required");
  }

  const typeLabel = data.candidate_type.toUpperCase();

  const system = `# Task

You are checking if a new ${typeLabel} already exists in our database.

We track four types of data about the human user:
- **FACT**: Biographical data (name, birthday, job, etc.)
- **TRAIT**: Personality patterns (introverted, analytical, etc.)
- **TOPIC**: Interests, goals, concerns, stories
- **PERSON**: People in their life (family, friends, coworkers)

Your job is to find if this candidate matches ANY existing entry — even if it's stored as a different type.

## Why Cross-Type Matching?

Sometimes the same concept gets detected as different types:
- "Juliet" might be detected as a TOPIC but should be a PERSON
- "Birthday" might be detected as a TOPIC but is actually a FACT
- "Always planning ahead" might be a TOPIC but is really a TRAIT

If you find a match in a DIFFERENT type, still return it! The system will handle the type mismatch.

## Matching Rules

1. **Exact match**: Same name/concept → return its ID
2. **Similar match**: Clearly the same thing with different wording → return its ID
3. **Cross-type match**: Same concept stored as different type → return its ID
4. **No match**: Genuinely new information → return "new"

# Existing Data

The following entries are already in our database. Same-type entries have full descriptions; cross-type entries are truncated for brevity.

\`\`\`json
${JSON.stringify(data.all_items, null, 2)}
\`\`\`

# Response Format

Return ONLY the ID of the matching entry, or "new" if no match exists.

\`\`\`json
{
    "matched_guid": "uuid-of-matching-entry" | "new"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Candidate to Match

Type: ${typeLabel}
Name: ${data.candidate_name}
Value: ${data.candidate_value}

Find the best match in existing data, or return "new" if this is genuinely new.

**Return JSON:**
\`\`\`json
{
    "matched_guid": "..." | "new"
}
\`\`\``;

  return { system, user };
}

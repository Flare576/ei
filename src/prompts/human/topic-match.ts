import type { PromptOutput } from "./types.js";

export interface TopicMatchPromptData {
  candidate_name: string;
  candidate_description: string;
  candidate_category: string;
  existing_topics: Array<{
    id: string;
    name: string;
    description: string;
    category?: string;
  }>;
}

export function buildTopicMatchPrompt(data: TopicMatchPromptData): PromptOutput {
  if (!data.candidate_name) {
    throw new Error("buildTopicMatchPrompt: candidate_name is required");
  }

  const system = `# Task

You are checking if a TOPIC already exists in our database.

## Matching Rules

1. **Exact match**: Same name or concept → return its ID
2. **Similar match**: Clearly the same topic with different wording → return its ID
3. **No match**: Genuinely new information → return "new"

Be conservative. If you're unsure, return "new" — a duplicate is worse than a gap.

# Existing Topics

\`\`\`json
${JSON.stringify(data.existing_topics, null, 2)}
\`\`\`

# Response Format

Return ONLY the ID of the matching entry, or "new".

\`\`\`json
{
  "matched_guid": "uuid-of-matching-entry" | "new"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Candidate Topic

Name: ${data.candidate_name}
Description: ${data.candidate_description}
Category: ${data.candidate_category}

Find the best match in existing topics, or return "new" if this is genuinely new.

\`\`\`json
{
  "matched_guid": "..." | "new"
}
\`\`\``;

  return { system, user };
}

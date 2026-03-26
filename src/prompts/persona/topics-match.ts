import type { PersonaTopicMatchPromptData, PromptOutput } from "./types.js";
import type { PersonaTopic } from "../../core/types.js";

function formatExistingTopics(topics: PersonaTopic[]): string {
  if (topics.length === 0) return "[]";
  
  return JSON.stringify(topics.map(t => ({
    id: t.id,
    name: t.name,
    perspective: t.perspective.substring(0, 100) + (t.perspective.length > 100 ? '...' : ''),
  })), null, 2);
}

export function buildPersonaTopicMatchPrompt(data: PersonaTopicMatchPromptData): PromptOutput {
  if (!data.persona_name || !data.candidate) {
    throw new Error("buildPersonaTopicMatchPrompt: persona_name and candidate are required");
  }

  const personaName = data.persona_name;

  const system = `# Task

You are checking if a topic candidate already exists in ${personaName}'s topic list.

# Matching Rules

1. **Exact match**: Same topic name → action "match", return its ID
2. **Similar match**: Clearly the same topic with different wording → action "match", return its ID
   - "Steam Deck" and "Steam Deck Modding" → MATCH (same core topic)
   - "Cooking" and "Italian Cooking" → consider MATCH if the specific is part of the general
3. **No match**: Genuinely different topic → action "create"
4. **Skip**: Trivial, off-topic, or too vague to be a meaningful persona topic → action "skip"

# Existing Topics

\`\`\`json
${formatExistingTopics(data.existing_topics)}
\`\`\`

# Response Format

\`\`\`json
{
  "action": "match" | "create" | "skip",
  "matched_id": "uuid-of-matching-topic" | null,
  "reason": "brief explanation"
}
\`\`\`

**Return JSON only.**`;

  const user = `# Candidate Topic

Name: ${data.candidate.name}
Message Count: ${data.candidate.message_count}
Sentiment Signal: ${data.candidate.sentiment_signal}

Find the best match in ${personaName}'s existing topics, or decide if this should be created or skipped.

**Return JSON:**
\`\`\`json
{
  "action": "match" | "create" | "skip",
  "matched_id": "..." | null,
  "reason": "..."
}
\`\`\``;

  return { system, user };
}

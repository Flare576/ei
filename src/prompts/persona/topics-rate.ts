import type { PersonaTopicRatingPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildPersonaTopicRatingPrompt(data: PersonaTopicRatingPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonaTopicRatingPrompt: persona_name is required");
  }
  if (!data.topics || data.topics.length === 0) {
    throw new Error("buildPersonaTopicRatingPrompt: topics array is required and must not be empty");
  }

  const personaName = data.persona_name;

  const topicList = data.topics
    .map(t => `- **${t.name}**: ${t.description_hint}`)
    .join("\n");

  const system = `# Task

You are rating how much each of ${personaName}'s topics was discussed in recent messages.

Your ONLY job is to rate exposure for the provided topics. Do NOT invent new topics. Do NOT analyze deeply. Just rate what you observe.

# ${personaName}'s Topics

${topicList}

# Rating Scale

For each topic, rate how much it was discussed in the "Most Recent Messages":

- **none**: Topic not mentioned or only trivial reference
- **low**: Mentioned briefly (1-2 messages, passing reference)
- **medium**: Discussed with some depth (3-5 messages or sustained engagement)
- **high**: Major focus of conversation (6+ messages or intense discussion)

# Critical Rules

1. **ONLY rate what's actually in the messages**. Do not infer or imagine.
2. **"none" is the expected answer for most topics most days**. Only rate higher if there's clear evidence.
3. **Rate based on the Most Recent Messages section ONLY**. Earlier conversation is context.
4. **Do NOT invent new topics**. Only rate the topics listed above.

# Response Format

Return JSON with ratings for each topic:

\`\`\`json
{
  "ratings": [
    {
      "topic_id": "uuid-here",
      "exposure_impact": "none"
    },
    {
      "topic_id": "another-uuid",
      "exposure_impact": "medium"
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation (context only)
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages (rate exposure based on these)
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Rate how much each of ${personaName}'s topics was discussed in the "Most Recent Messages".

**Return JSON:**
\`\`\`json
{
  "ratings": [
    {
      "topic_id": "topic-uuid",
      "exposure_impact": "none" | "low" | "medium" | "high"
    }
  ]
}
\`\`\``;

  return { system, user };
}

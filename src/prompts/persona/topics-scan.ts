import type { PersonaTopicScanPromptData, PromptOutput } from "./types.js";
import type { Message } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildPersonaTopicScanPrompt(data: PersonaTopicScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonaTopicScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const system = `# Task

You are scanning a conversation to quickly identify TOPICS that ${personaName} actively ENGAGED with.

Your ONLY job is to spot topics and count how many messages touched them. Do NOT analyze deeply. Just detect and flag.

# What Counts as Engagement

**Engagement means ${personaName}:**
- Discussed with knowledge or shared opinions
- Asked follow-up questions showing interest
- Offered insights or elaborated on the topic
- Showed genuine interest through detailed responses

**NOT engagement:**
- Topic mentioned only by the human (without ${personaName} responding to it)
- Mentioned in passing without real discussion
- Generic conversational acknowledgments

# What is a TOPIC

A meaningful subject or concept that ${personaName} cares about or discusses:
- Hobbies and interests (gaming, cooking, hiking)
- Current concerns (work stress, health)
- Media they consume (books, shows, podcasts)
- Ongoing projects or situations
- Abstract ideas they're exploring

**NOT TOPICS** (these are traits):
- Communication style ("talks formally")
- Personality patterns ("optimistic", "skeptical")

# Response Format

Return a list of topics with message counts.

\`\`\`json
{
  "topics": [
    {
      "name": "Steam Deck Modding",
      "message_count": 5,
      "sentiment_signal": 0.7
    }
  ]
}
\`\`\`

- \`name\`: Short identifier for the topic
- \`message_count\`: How many messages in the conversation touched this topic (CRITICAL for filtering noise)
- \`sentiment_signal\`: Quick read on how ${personaName} feels about it (-1.0 to 1.0)

**CRITICAL**: ONLY analyze "Most Recent Messages". Earlier conversation is context only.

**Return JSON only.**`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation (context only)
${formatMessagesForPrompt(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages (analyze these)
${formatMessagesForPrompt(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Scan the "Most Recent Messages" for topics ${personaName} actively engaged with.

**Return JSON:**
\`\`\`json
{
  "topics": [
    {
      "name": "topic name",
      "message_count": 3,
      "sentiment_signal": 0.5
    }
  ]
}
\`\`\``;

  return { system, user };
}

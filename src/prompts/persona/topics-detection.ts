import type { PersonaTopicDetectionPromptData, PromptOutput } from "./types.js";
import type { Message, Topic } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatTopicsForPrompt(topics: Topic[]): string {
  if (topics.length === 0) return "(No topics yet)";
  
  return JSON.stringify(topics.map(t => ({
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    exposure_current: t.exposure_current,
    exposure_desired: t.exposure_desired,
  })), null, 2);
}

export function buildPersonaTopicDetectionPrompt(data: PersonaTopicDetectionPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonaTopicDetectionPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const definitionsFragment = `# Definitions

**TOPIC** - Ideas, concepts, subjects that ${personaName} discusses or cares about:
- Hobbies and interests (gaming, cooking, hiking)
- Current concerns (work stress, health)
- Media they consume (books, shows, podcasts)
- Ongoing projects or situations
- Abstract ideas they're exploring

**NOT TOPICS** (these are traits):
- Communication style ("talks formally")
- Personality patterns ("optimistic", "skeptical")`;

  const taskFragment = `# Task

Detect which TOPICS ${personaName} actively ENGAGED with in the conversation.

**Engagement means:**
- Discussed with knowledge or expertise
- Asked follow-up questions
- Offered opinions or insights
- Showed genuine interest through responses

**NOT engagement:**
- Topic only mentioned by human (without ${personaName} engaging)
- Mentioned in passing without real discussion
- Generic conversational fillers`;

  const fieldsFragment = `# Fields

- \`name\`: Short identifier for the topic
- \`description\`: What this topic means to ${personaName}, when to bring it up
- \`sentiment\`: How ${personaName} feels about it (-1.0 to 1.0)
- \`exposure_current\`: How recently/much discussed (0.0 to 1.0)
  - ONLY INCREASE this value (decay happens separately)
  - Increase if ${personaName} actively engaged in recent messages
- \`exposure_desired\`: How much ${personaName} wants to discuss (0.0 to 1.0)
  - RARELY change - only on explicit preference signals`;

  const adjustmentsFragment = `## Adjustments

**exposure_current**: ALWAYS ONLY INCREASE
- ${personaName} actively discussed → increase by 0.2-0.3
- Topic mentioned briefly → increase by 0.1
- Not mentioned → no change (decay handles reduction)

**exposure_desired**: ONLY change if
- Human explicitly says "${personaName} should talk more/less about X"
- Otherwise preserve existing value

**name/description**: Only update if human clarifies meaning`;

  const currentTopicsFragment = `# Current TOPICS

\`\`\`json
${formatTopicsForPrompt(data.current_topics)}
\`\`\``;

  const criticalFragment = `# Critical Instructions

1. ONLY analyze "Most Recent Messages" - earlier messages are context only
2. This is DETECTION only - what was discussed, not what should be added
3. Return the COMPLETE topic list (existing + any new detections)

**Return JSON:**
\`\`\`json
[
  {
    "name": "Steam Deck Modding",
    "description": "User mentioned tips, I engaged with knowledge",
    "sentiment": 0.7,
    "exposure_current": 0.8,
    "exposure_desired": 0.6
  }
]
\`\`\``;

  const system = `${definitionsFragment}

${taskFragment}

${fieldsFragment}

${adjustmentsFragment}

${currentTopicsFragment}

${criticalFragment}`;

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

Analyze the "Most Recent Messages" for topics ${personaName} actively engaged with.

Return the complete topic list as JSON.`;

  return { system, user };
}

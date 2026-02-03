import type { PersonaTopicUpdatePromptData, PromptOutput } from "./types.js";
import type { Message, PersonaTopic, Trait } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatTraitsForPrompt(traits: Trait[]): string {
  if (traits.length === 0) return "(No traits defined)";
  return traits.map(t => `- ${t.name}: ${t.description}`).join('\n');
}

function formatExistingTopic(topic: PersonaTopic | undefined): string {
  if (!topic) return "**NEW TOPIC** - Creating from scratch";
  
  return `**EXISTING TOPIC** - Updating:
\`\`\`json
${JSON.stringify({
  name: topic.name,
  perspective: topic.perspective,
  approach: topic.approach,
  personal_stake: topic.personal_stake,
  sentiment: topic.sentiment,
  exposure_current: topic.exposure_current,
  exposure_desired: topic.exposure_desired,
}, null, 2)}
\`\`\``;
}

export function buildPersonaTopicUpdatePrompt(data: PersonaTopicUpdatePromptData): PromptOutput {
  if (!data.persona_name || !data.candidate) {
    throw new Error("buildPersonaTopicUpdatePrompt: persona_name and candidate are required");
  }

  const personaName = data.persona_name;
  const isNewTopic = !data.existing_topic;

  const system = `# Task

You are generating or updating a PersonaTopic for ${personaName}.

${isNewTopic ? `This is a NEW topic - create all fields from scratch based on the conversation.` : `This is an EXISTING topic - update fields based on new conversation evidence.`}

# Persona Context

**Name**: ${personaName}
${data.short_description ? `**Description**: ${data.short_description}` : ''}
${data.long_description ? `**Background**: ${data.long_description}` : ''}

**Personality Traits**:
${formatTraitsForPrompt(data.traits)}

# Current Topic State

${formatExistingTopic(data.existing_topic)}

# Field Definitions

## name
Short identifier for the topic. Only change for clarification.

## perspective
${personaName}'s view or opinion on this topic. What do they think about it?

**ALWAYS populate this field.** Use conversation content + persona traits to infer their view.

Example: "The Shire represents everything worth fighting for - simple pleasures, good food, and the bonds of community."

## approach
How ${personaName} prefers to engage with this topic. Their style of discussion.

**Only populate if there's a clear pattern** in how they discuss this topic. Leave empty string if unclear.

Example: "Frodo speaks of the Shire with wistful longing, often comparing other places to it unfavorably."

## personal_stake
Why this topic matters to ${personaName} personally. Their connection to it.

**Only populate if there's evidence** of personal connection. Leave empty string if unclear.

Example: "As a hobbit who left home, the Shire is both memory and motivation."

## sentiment
How ${personaName} feels about this topic. Scale: -1.0 (hate) to 1.0 (love).

## exposure_current
How recently/frequently this topic has been discussed. Scale: 0.0 to 1.0.

**For existing topics**: ONLY INCREASE this value based on conversation activity.
- Active discussion → increase by 0.2-0.3
- Brief mention → increase by 0.1
- Maximum: 1.0

**For new topics**: Start at 0.3-0.5 depending on discussion depth.

## exposure_desired
How much ${personaName} wants to discuss this topic. Scale: 0.0 to 1.0.

**RARELY change** for existing topics. Only adjust if there's explicit preference signal.

**For new topics**: Infer from how enthusiastically ${personaName} engaged.

# Critical Instructions

1. ONLY analyze "Most Recent Messages" - earlier messages are context only
2. Do NOT invent details not supported by the conversation
3. Do NOT apply flowery or poetic language - be factual
4. If a field cannot be determined, use empty string (for text) or preserve existing value (for numbers)

**Return JSON:**
\`\`\`json
{
  "name": "Topic Name",
  "perspective": "Their view on this topic",
  "approach": "",
  "personal_stake": "",
  "sentiment": 0.5,
  "exposure_current": 0.5,
  "exposure_desired": 0.5
}
\`\`\``;

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

# Topic Candidate

Name: ${data.candidate.name}
Message Count: ${data.candidate.message_count}
Sentiment Signal: ${data.candidate.sentiment_signal}

${isNewTopic ? 'Create' : 'Update'} the PersonaTopic based on how ${personaName} engaged with this topic.

**Return JSON:**
\`\`\`json
{
  "name": "...",
  "perspective": "...",
  "approach": "...",
  "personal_stake": "...",
  "sentiment": 0.5,
  "exposure_current": 0.5,
  "exposure_desired": 0.5
}
\`\`\``;

  return { system, user };
}

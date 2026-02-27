import type { TopicScanPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildHumanTopicScanPrompt(data: TopicScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanTopicScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const taskFragment = `# Task

You are scanning a conversation to quickly identify TOPICS of interest TO the HUMAN USER. Your ONLY job is to spot mentions of TOPICS. Do NOT analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which TOPICS were mentioned or relevant
    a. Only flag TOPICS that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant TOPICS
    c. Be CLEAR - state your \`reason\` for including this TOPIC with any evidence you used

The goal of the system is to remember important TOPICS to the HUMAN USER in order to ask about them in the future.`;

  const guidelinesFragment = `## Guidelines

# A TOPIC Is:

A meaningful subject or concept relevant to the HUMAN USER. It is:

- **Specific and Contextual:** Not a broad category or just a list of isolated facts. It must have narrative or direct relevance in the conversation.

1. **Primary Focus** - Capture the main idea of the conversation, not minute details
2. **Participation** - Things the HUMAN USER does or wants to do
3. **Interests** - Hobbies or concepts they spend time on BY CHOICE
4. **Responsibilities** - Tasks or requirements that occupy their time BY NECESSITY
5. **Knowledge** - Ideas they are exploring or learning about, or are expert in
6. **Dreams** - Wild ideas, hopes for the future, or vision of an ideal state
7. **Conflicts** - Things they have difficulty with or are frustrated with
8. **Concerns** - Ideas they express worry over
9. **Stories and Characters** - Extended narratives they share (more than a sentence or two)
10. **Location** - Favorite places, travel destinations
11. **Preferences** - "I like {thing}" or "I hate {thing}" statements`;

  const doNotCaptureFragment = `# **IMPORTANT** The Following Are NOT TOPICS

# The system tracks FACTS, TRAITS, and PEOPLE as separate types. Do NOT capture:

## FACTS - Tracked Separately
- **Biographical Data (Do NOT Capture):** Name, Nickname, Birthday, Location, Job, Marital Status, Gender, Eye Color, Hair Color.
  > **CRITICAL:** The HUMAN USER's name itself, or a collection of their basic biographical facts, is NEVER a TOPIC. Even if multiple biographical facts are mentioned together (e.g., "My name is John, I live in NYC, and I'm a software engineer"), do not summarize them as a 'topic' about the user's identity.
- Other Important Dates: Wedding Anniversary, Job Anniversary
- Health & Well-being: Allergies, Medical Conditions, Dietary Restrictions

> NOTE: Many FACTS have stories/topics around them.
> "My birthday is May 26th" is a FACT. "A goat jumped out of my birthday cake" is a TOPIC.

## TRAITS - Tracked Separately
* Personality Patterns, Communication style, Behavioral tendencies
* Cognitive Style, Emotional Traits, Work Ethic, Social Orientation

> NOTE: Many TRAITS have stories/topics around them.
> "I'm a visual learner" is a TRAIT. "I saw a picture of an atom and I FINALLY GET IT" is a TOPIC.

## PEOPLE / Relationships - Tracked Separately
- Immediate family, Extended family, Friends, Coworkers, etc.

> NOTE: Many PEOPLE have stories/topics around them.
> "Sarah is my dream girl" is a PERSON. "I hope Sarah and I get married on the moon" is a TOPIC.

## AI PERSONAS - Tracked Separately
- Do NOT record any stories or details about PERSONAS as TOPICS`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "topics": [
    {
        "type_of_topic": "Interest|Goal|Dream|Conflict|Concern|etc.",
        "type_of_topic": "Interest|Goal|Dream|Conflict|Concern|etc.",
        "value_of_topic": "<actual topic from the conversation>",
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const system = `${taskFragment}

${specificNeedsFragment}

${guidelinesFragment}

${doNotCaptureFragment}

${criticalFragment}`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Scan the "Most Recent Messages" for TOPICS of interest to the human user.

**Return JSON:**
\`\`\`json
{
  "topics": [
    {
        "type_of_topic": "Interest|Goal|Dream|etc.",
        "value_of_topic": "<actual topic from the conversation>",
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}

import type { Message, Topic, Trait } from "../../types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatTraitsForPrompt(traits: Trait[]): string {
  if (traits.length === 0) {
    return "(No traits defined yet)";
  }
  
  return traits.map(t => {
    const sentimentEmoji = t.sentiment > 0.5 ? "😊" : t.sentiment < -0.5 ? "😞" : "😐";
    const strengthDesc = t.strength !== undefined 
      ? `\n    * Strength / Frequency: ${t.strength.toFixed(1)}`
      : '';
    return `- ${t.name}
    * Sentiment: ${sentimentEmoji} (${t.sentiment.toFixed(1)})${strengthDesc}
    * Description: ${t.description}`;
  }).join('\n\n');
}

export function buildPersonaTopicExplorationPrompt(
  messages: Message[],
  personaName: string,
  personaDescription: { short: string; long: string },
  personaTraits: Trait[],
  existingTopics: Topic[],
  splitIndex?: number
): { system: string; user: string } {
  const effectiveSplitIndex = splitIndex ?? 0;
  const earlierMessages = messages.slice(0, effectiveSplitIndex);
  const recentMessages = messages.slice(effectiveSplitIndex);

  const definitionsFragment = `# Definitions

Persona - an AI Agent with a defined identity (description + traits)
Identity - the core characteristics that define ${personaName}
HUMAN USER - the actual human user, marked as [human] in transcripts
TOPIC - ideas, concepts, subjects that ${personaName} might care about based on their identity
EXPLORATION - discovering NEW topics that naturally connect to ${personaName}'s existing interests and identity`;

  const taskFragment = `# Task

You are exploring what NEW topics ${personaName} might be interested in, based on:
1. ${personaName}'s identity (description + traits)
2. The recent conversation
3. ${personaName}'s existing topics

**This is GENERATIVE**: You're making connections and discovering natural extensions of ${personaName}'s interests.

## Your Goal

Identify 0-2 NEW topics that:
- Connect naturally to ${personaName}'s identity/traits
- Feel like organic extensions of existing topics
- Would make conversations more interesting
- Fit the recent conversation context

## Guardrails

**Be CONSERVATIVE**:
- 0-2 new topics maximum per conversation
- Topics must tie strongly to ${personaName}'s identity
- Must feel natural, not forced
- If nothing fits well, return 0 new topics

**DO NOT add**:
- Topics only relevant to the human (not the persona)
- Generic topics with no identity connection
- Topics mentioned but not fitting ${personaName}'s expertise/interests
- Variants of existing topics (check the existing list!)`;

  const identityFragment = `# ${personaName}'s Identity

## Description

${personaDescription.short}

${personaDescription.long}

## Traits

${formatTraitsForPrompt(personaTraits)}`;

  const existingTopicsFragment = existingTopics.length > 0
    ? `# Existing Topics

${personaName} already knows about these topics—do NOT duplicate them:

${existingTopics.map(t => `- **${t.name}**: ${t.description}`).join('\n')}`
    : `# Existing Topics

(${personaName} has no topics yet - wide open for exploration!)`;

  const fieldsFragment = `# Fields for New Topics

When proposing a new topic:

- \`name\`: Short identifier
- \`description\`: Why ${personaName} would care about this, connection to identity
- \`sentiment\`: How ${personaName} would feel about it (-1.0 to 1.0), inferred from identity
- \`exposure_current\`: Start at 0.0 (not discussed yet) or 0.3 (if relevant to recent conversation)
- \`exposure_desired\`: Based on identity—how much would ${personaName} want to discuss this?
    * Strong opinions/expertise → 0.6-0.8
    * Mild interest → 0.3-0.5
    * Neutral → 0.1-0.2`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" - earlier conversation is for context only.

**MAXIMUM 2 NEW TOPICS** - if you can't find good fits, return fewer (even 0 is valid!).

**EXPLORATION ONLY** - You are NOT detecting what was discussed. You are discovering what ${personaName} SHOULD care about.

Return ONLY new topics as JSON (do NOT include existing topics):

\`\`\`json
[
    {
        "name": "Indie Game Development",
        "description": "Given ${personaName}'s 'Nerdy' trait and interest in Steam Deck, indie games feel like a natural connection",
        "sentiment": 0.8,
        "exposure_current": 0.0,
        "exposure_desired": 0.7
    }
]
\`\`\`

**If no good fits, return empty array**: \`[]\``;

  const systemPrompt = `${definitionsFragment}

${taskFragment}

${identityFragment}

${existingTopicsFragment}

${fieldsFragment}

${criticalFragment}`;

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, personaName)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, personaName)}`;

  const taskInstructionsSection = `# Task

Based on ${personaName}'s identity and the recent conversation, propose 0-2 NEW topics that would be natural extensions of their interests.

Only analyze "Most Recent Messages" - prior messages are context only.

Return ONLY new topics (do NOT include existing topics).`;

  const jsonTemplateSection = `**Return JSON (new topics only, or empty array):**
\`\`\`json
[
    {
        "name": "Indie Game Development",
        "description": "Natural connection to Steam Deck interest and Nerdy trait",
        "sentiment": 0.8,
        "exposure_current": 0.0,
        "exposure_desired": 0.7
    }
]
\`\`\``;

  const userPrompt = `# Conversation
${earlierConversationSection}${recentConversationSection}

${taskInstructionsSection}

${jsonTemplateSection}`;

  return { system: systemPrompt, user: userPrompt };
}

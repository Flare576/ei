import type { Message, Topic } from "../../types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildPersonaTopicDetectionPrompt(
  messages: Message[],
  personaName: string,
  existingTopics: Topic[],
  splitIndex?: number
): { system: string; user: string } {
  const effectiveSplitIndex = splitIndex ?? 0;
  const earlierMessages = messages.slice(0, effectiveSplitIndex);
  const recentMessages = messages.slice(effectiveSplitIndex);

  const definitionsFragment = `# Definitions

Persona - a set of instructions and chat history used to represent an AI Agent as prompts to a Large Language Model (LLM)
Identity - the core description and TRAITS of the Persona
HUMAN USER - the actual human user of this system, whose input is marked as [human] in the following chat transcript
TOPIC - ideas, concepts, subjects that the Persona discusses or cares about. These are NOT traits (personality patterns), but rather:
* 🎮 Hobbies and interests (gaming, gardening, cooking)
* 😰 Current concerns or challenges (work stress, health issues)
* 📺 Media they consume (books, shows, podcasts)
* 🔧 Ongoing projects or situations
* 💭 Abstract ideas they're exploring
TRAIT - a core personality characteristic that should NOT be captured as a TOPIC. These include:
* Personality Patterns
* Communication style (Assertive, Passive, Empathetic, "Talk like a pirate")
* Behavioral tendencies
* Cognitive Style / Learning Approach
* Emotional Traits / Regulation`;

  const taskFragment = `# Task

You are analyzing a conversation to detect which TOPICS the persona "${personaName}" actively engaged with.

**CRITICAL**: You are ONLY detecting what was DISCUSSED. Do NOT generate new topics based on the persona's identity—that happens in a separate process.

## What Counts as Engagement?

The persona "${personaName}" engaged with a topic if they:
- Discussed it with knowledge or expertise
- Asked follow-up questions about it
- Offered opinions or insights about it
- Showed interest through their responses

## What Does NOT Count?

DO NOT flag topics that were:
- Only mentioned by the human (without persona engagement)
- Mentioned in passing without real discussion
- About the human's life unless the persona has specific interest
- Generic conversational fillers`;

  const fieldsFragment = `# Fields

For each detected topic:

- \`name\`: Short identifier for the topic
- \`description\`: What this topic means to ${personaName}, what they know about it, when to bring it up
- \`sentiment\`: How ${personaName} feels about this topic (-1.0 to 1.0)
    * Positive: enjoys discussing, finds interesting
    * Negative: dislikes but still relevant (e.g., "System Crashes" for a sysadmin)
    * Can be inferred from ${personaName}'s identity/traits
- \`exposure_current\`: How recently/much has this been discussed? (0.0 to 1.0)
    * Only INCREASE this value (decay happens separately)
    * Increase if ${personaName} actively engaged with it in recent messages
- \`exposure_desired\`: How much does ${personaName} WANT to discuss this? (0.0 to 1.0)
    * RARELY change - only on explicit preference signals
    * 0.0 = avoid unless human brings it up
    * 1.0 = always wants to discuss
    * Inferred from identity: strong opinions → high value`;

  const adjustmentsFragment = `## Adjustments

### Name & Description
If the HUMAN USER clarifies what a topic means, update the \`name\` or \`description\`.
Otherwise, do not change these fields.

### Sentiment
Adjust if:
- Human indicates ${personaName} should like/dislike the topic differently
- Current sentiment doesn't match ${personaName}'s identity/traits

Otherwise, do not change.

### exposure_current (ALWAYS ONLY INCREASE)
Increase if:
- ${personaName} actively discussed this in recent messages
- The conversation was substantially about this topic

The system handles decay separately—you only increase.

### exposure_desired
Adjust ONLY if:
- Human explicitly says "${personaName} should talk more/less about X"
- Topic description changed such that identity no longer matches the level

Otherwise, do not change.`;

  const currentTopicsFragment = existingTopics.length > 0
    ? `# Current TOPICS

This is the complete list of topics ${personaName} has discussed before.

\`\`\`json
${JSON.stringify(existingTopics.map(t => ({
  name: t.name,
  description: t.description,
  sentiment: t.sentiment,
  exposure_current: t.level_current,
  exposure_desired: t.level_ideal,
})), null, 2)}
\`\``
    : `# Current TOPICS

(No topics yet - ${personaName} is new or hasn't discussed anything yet)`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context only and has already been processed!

**DETECTION ONLY**: You are identifying what was DISCUSSED, not what ${personaName} SHOULD care about. Pure detection.

**RETURN ALL TOPICS**: Return the COMPLETE SET of topics (existing + newly detected) after adjustments.

The JSON format is:

\`\`\`json
[
    {
        "name": "Steam Deck Hacks",
        "description": "User mentioned Steam Deck tips, and I engaged with knowledge",
        "sentiment": 0.7,
        "exposure_current": 0.8,
        "exposure_desired": 0.6
    }
]
\`\`\``;

  const systemPrompt = `${definitionsFragment}

${taskFragment}

${fieldsFragment}

${adjustmentsFragment}

${currentTopicsFragment}

${criticalFragment}`;

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, personaName)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, personaName)}`;

  const taskInstructionsSection = `# Task

Analyze the conversation to detect topics that ${personaName} actively engaged with.

Only scan the "Most Recent Messages" - prior messages are provided for context only and have already been scanned.

Return the full set of TOPICS after updates.`;

  const jsonTemplateSection = `**Return JSON:**
\`\`\`json
[
    {
        "name": "Steam Deck Hacks",
        "description": "User mentioned Steam Deck tips, and I engaged with knowledge",
        "sentiment": 0.7,
        "exposure_current": 0.8,
        "exposure_desired": 0.6
    }
]
\`\`\``;

  const userPrompt = `# Conversation
${earlierConversationSection}${recentConversationSection}

${taskInstructionsSection}

${jsonTemplateSection}`;

  return { system: systemPrompt, user: userPrompt };
}

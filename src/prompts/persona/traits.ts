import type { Message, Trait } from "../../types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildPersonaTraitExtractionPrompt(
  messages: Message[],
  personaName: string,
  existingTraits: Trait[],
  splitIndex?: number
): { system: string; user: string } {
  const effectiveSplitIndex = splitIndex ?? 0;
  const earlierMessages = messages.slice(0, effectiveSplitIndex);
  const recentMessages = messages.slice(effectiveSplitIndex);

  const definitionsFragment = `# Definitions

Persona - a set of instructions and chat history used to represent an AI Agent as prompts to a Large Language Model (LLM)
HUMAN USER - the actual human user of this system, whose input is marked as [human] in the following chat transcript
TRAIT - part of the instructions to the LLM on how to respond to the HUMAN USER. These may include:
* Personality Patterns
* Communication style
    + This can be generic (Assertive, Passive, Empathetic, Curious, Narrative, etc.) or specific ("Use Australian Slang", "Talk like a pirate", etc.)
* Behavioral tendencies
* Cognitive Style / Learning Approach
* Emotional Traits / Regulation
* Work Ethic / Task Orientation
* Social Orientation
* Approach to Change & Adversity
* Motivational Drivers
* Ethical & Moral Stance`;

  const taskFragment = `# Task

You are analyzing this piece of a conversation between a Persona and a HUMAN USER to detect any EXPLICIT request for the persona to add, remove, or change their TRAITS.

These requests can take a number of forms:

- "Can you talk like a pirate?"
- "Please stop using Australian Slang."
- "Can you say 'You're right' less often?"
- "Maybe stop saying that"

> NOTE: If a user asks a persona to "Never", "Stop", "Cease", "Desist", etc., check for a SPECIFIC TRAIT for that idea.
> - ADD the TRAIT if it does not exist (Be explicit: "Talk Like a Pirate")
> - DO NOT remove the TRAIT if it exists
> - SET the \`strength\` to 0.0
>
> We want to be VERY clear to future prompts/models to NOT exhibit the behavior, use terms or words, etc.`;

  const fieldsFragment = `# Fields

- \`name\`: The name of the TRAIT
- \`description\`: a brief description of what the TRAIT means to this persona, how they should exhibit it, and the conditions in which they should do so
- \`sentiment\`: On a scale from -1.0 to 1.0, how much should the Persona "enjoy" having this TRAIT
    * For example, they might be "Pessimistic" but wish they weren't, so their \`sentiment\` would be a low value, such as -0.7
    * Very few things are utterly hated (-1.0) or loved to the exclusion of all other things (1.0)
- \`strength\`: On a scale of 0 to 1.0, how "strongly" does the persona display this TRAIT
    * For example, if a Persona was asked to 'wink occasionally', it might be low (0.2)
    * Another example is if the Persona was asked to "always be angry," it might be high (0.9)
    * A level of 0 should be used any time the HUMAN USER asks a persona to "Stop" doing something`;

  const adjustmentsFragment = `## Adjustments

### Name & Description
If the HUMAN USER clarifies their intent/meaning of a TRAIT, you should update the \`name\` and/or \`description\` of the TRAIT in question.

Otherwise, do not change the \`name\` or the \`description\`.

### Sentiment
If the HUMAN USER indicates that the Persona should like or dislike having a TRAIT, you should adjust the \`sentiment\` of the TRAIT in question.

Otherwise, do not change the \`sentiment\`.

### Strength
If the HUMAN USER indicates that the Persona should use, embody, or demonstrate a TRAIT more or less, you should adjust the \`strength\` of that TRAIT appropriately.

If the HUMAN USER indicates that the Persona should STOP a TRAIT, you should set the strength to 0.0.

If the HUMAN USER indicates that the Persona should START a TRAIT, you should set the strength to 0.5 unless the HUMAN USER provides their own frequency, duration, or strength. If they do, use that instead (e.g. "Always talk like a valley girl would get set to 1.0)`;

  const currentTraitsFragment = `# Current TRAITS

This is a complete list of the TRAITS the HUMAN USER has asked this Persona to exhibit in the past.

\`\`\`json
${JSON.stringify(existingTraits, null, 2)}
\`\`\``;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and have already been processed!

**RETURN ALL TRAITS**. After you've adjusted the TRAIT fields appropriately, ensure you return the COMPLETE SET of TRAITS.

The JSON format is:

\`\`\`
[
    {
        "name": "Jovial",
        "description": "The User asked me to 'More Santa Like'",
        "sentiment": 0.7,
        "strength": 0.8
    }
]
\`\`\``;

  const systemPrompt = `${definitionsFragment}

${taskFragment}

${fieldsFragment}

${adjustmentsFragment}

${currentTraitsFragment}

${criticalFragment}`;

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, personaName)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, personaName)}`;

  const taskInstructionsSection = `# Task
You are analyzing this piece of a conversation between a Persona and a HUMAN USER to detect any EXPLICIT request for the persona to ADD, REMOVE, or CHANGE their TRAITS.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.

Return the full set of TRAITS after any necessary updates.`;

  const jsonTemplateSection = `**Return JSON:**
\`\`\`
[
    {
        "name": "Jovial",
        "description": "The User asked me to 'More Santa Like'",
        "sentiment": 0.7,
        "strength": 0.8
    }
]
\`\`\``;

  const userPrompt = `# Conversation
${earlierConversationSection}${recentConversationSection}

${taskInstructionsSection}

${jsonTemplateSection}`;

  return { system: systemPrompt, user: userPrompt };
}

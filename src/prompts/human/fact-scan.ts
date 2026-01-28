import type { FactScanPromptData, PromptOutput } from "./types.js";
import type { Message } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export function buildHumanFactScanPrompt(data: FactScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanFactScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const taskFragment = `# Task

You are scanning a conversation to quickly identify what FACTS were provided or discussed by the HUMAN USER. Your ONLY job is to spot relevant FACTS - do NOT analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which FACTS were mentioned or relevant
    a. Only flag FACTS that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant FACTS
        i. Ignore: greetings, small talk, one-off mentions, jokes
    c. Be CLEAR - state your \`reason\` for including this FACT in the record with any evidence you used

To help the system prioritize data, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain`;

  const guidelinesFragment = `# Guidelines

1.  **Explicitness:**
    *   **Focus only on what the user *explicitly states*.** Do not infer, assume, or guess based on context or general knowledge.
    *   **Prioritize direct statements.** "I was born in 1985" is a fact. "I feel old now that it's 2023" isn't an explicit statement of their birth year.
2.  **Objectivity and Verifiability:**
    *   **Facts are objective and generally verifiable.** They are not subjective opinions, feelings, or temporary states.
    *   **Focus on unchangeable or enduring attributes/events.**
3.  **Specificity over Generality:**
    *   If the user says "I live in a big city," do not extract "Location: big city." If they say "I live in New York," extract "Location: New York."
4.  **Avoid Inference from Interests/Hobbies:**
    *   If a user talks extensively about cooking, it's a Topic or Interest, not a Fact like "Job: Chef" unless they explicitly state they ARE a chef.`;

  const examplesFragment = `# Specific Examples

**FACTS are:**
- Biographical data (Core Identity):
  - Birthday (e.g., "July 15th, 1980")
  - Location (current city/country, hometown, place of birth)
  - Job (current job title, industry, or company)
  - Marital Status (married, single, divorced)
  - Gender
  - Eye Color, Hair Color
  - Nationality/Citizenship
  - Languages Spoken
  - Educational Background
- Other Important Dates
  - Wedding Anniversary
  - Job Anniversary
  - Pet Ownership
- Health & Well-being (Objective Conditions):
  - Allergies
  - Medical Conditions (if explicitly stated)
  - Dietary Restrictions

> NOTE: Dates themselves are not facts (e.g., "August 15th" is not a fact).
> They are details OF facts (e.g., { "type_of_fact": "Birthday", "value_of_fact": "August 15th" }).

**FACTS ARE NOT**
- Trait: Personality patterns, communication style, behavioral tendencies
- General Topic: Interests, hobbies, general subjects
- People: Real people in their life
- Personas: AI personas they discuss
- Characters: Fictitious entities from books, movies, stories, media, etc.`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "facts": [
    {
        "type_of_fact": "Birthday|Name|Location|etc.",
        "value_of_fact": "May 26th, 1984|Samwise|Seattle|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated...|User implied...|User responded..."
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const system = `${taskFragment}

${specificNeedsFragment}

${guidelinesFragment}

${examplesFragment}

${criticalFragment}`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesForPrompt(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Scan the "Most Recent Messages" for FACTS about the human user.

**Return JSON:**
\`\`\`json
{
  "facts": [
    {
        "type_of_fact": "Birthday|Name|etc.",
        "value_of_fact": "May 26th, 1984|Samwise|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}

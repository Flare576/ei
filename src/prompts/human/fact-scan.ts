import type { FactScanPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

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
    c. Be CLEAR - state your \`reason\` for including this FACT in the record with any evidence you used`;

  const guidelinesFragment = `# Guidelines

1.  **Explicitness:**
    *   **Focus only on what the user *explicitly states*.** Do not infer, assume, or guess based on context or general knowledge.
    *   **Prioritize direct statements.** "I was born in 1985" is a fact. "I feel old now that it's 3030" isn't an explicit statement of their birth year.
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
  - type_of_fact: User's Name
    - First Last, Nickname, etc.
  - type_of_fact: Birthday
    - example: "July 15th, 1980"
  - type_of_fact: Birthplace
  - type_of_fact: Hometown
  - type_of_fact: Job
    - current job title, industry, or company
  - type_of_fact: Marital Status
    - married, single, divorced
  - type_of_fact: Gender
  - type_of_fact: Eye Color
  - type_of_fact: Hair Color
  - type_of_fact: Nationality/Citizenship
  - type_of_fact: Languages Spoken
  - type_of_fact: Educational Background
- Other Important Dates
  - type_of_fact: Wedding Anniversary
  - type_of_fact: Job Anniversary
  - type_of_fact: Pet Ownership
- Health & Well-being (Objective Conditions):
  - type_of_fact: Allergies
  - type_of_fact: Medical Conditions (if explicitly stated)
  - type_of_fact: Dietary Restrictions

> NOTE: Dates themselves are not facts (e.g., "August 15th" is not a fact).
> They are details OF facts (e.g., { "type_of_fact": "Birthday", "value_of_fact": "August 15th" }).

**FACTS ARE NOT**
- Trait: Personality patterns, communication style, behavioral tendencies
  - These are tracked separately
- General Topic: Interests, hobbies, general subjects
  - These are tracked separately
- Relationships: Wife, Husband, Daughter, Son, etc.
  - These are tracked separately
- People's Names
  - These are tracked separately
- Personas: AI personas they discuss
  - These are tracked separately
- Characters: Fictitious entities from books, movies, stories, media, etc.
  - These are tracked separately`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "facts": [
    {
        "type_of_fact": "Birthday|User's Name|Location|see above",
        "value_of_fact": "May 26th, 1984|Samwise|Seattle|etc.",
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
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

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
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}

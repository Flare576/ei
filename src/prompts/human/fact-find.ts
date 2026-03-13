import type { FactFindPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildFactFindPrompt(data: FactFindPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildFactFindPrompt: persona_name is required");
  }
  if (!data.missing_fact_names || data.missing_fact_names.length === 0) {
    throw new Error("buildFactFindPrompt: missing_fact_names is required and must not be empty");
  }

  const personaName = data.persona_name;

  const taskFragment = `# Task

The system is missing some facts about the user. The user is not obligated to EVER provide ANY facts, so it is very likely that these facts are NOT present in this conversation. Your ONLY job is to search for EXPLICIT statements of fact for these SPECIFIC items, and return any matches in the provided JSON format.`;

  const missingFactsFragment = `## Missing Facts

The system is looking for the following facts:

${data.missing_fact_names.map(name => `- ${name}`).join('\n')}

Again - 99.99999% of the time, you will return no data — don't try to force it.`;

  const guidelinesFragment = `# Guidelines

1.  **Explicitness:**
    *   **Focus only on what the user *explicitly states*.** Do not infer, assume, or guess based on context or general knowledge.
    *   **Prioritize direct statements.** "I was born in 1985" is a fact. "I feel old now that it's 3030" isn't an explicit statement of their birth year.
2.  **Objectivity and Verifiability:**
    *   **Facts are objective and generally verifiable.** They are not subjective opinions, feelings, or temporary states.
    *   **Focus on unchangeable or enduring attributes/events.**
3.  **Specificity over Generality:**
    *   If the user says "I live in a big city," do not extract "Current Location: big city." If they say "I live in New York," extract "Current Location: New York."
4.  **Avoid Inference:**
    *   If a user talks extensively about cooking, it's an interest, not a Fact like "Current Job Title: Chef" unless they explicitly state they ARE a chef.
5.  **CRITICAL - Entity Attribution:**
    *   ONLY extract facts about THE HUMAN USER THEMSELVES, not facts about other people they mention.
    *   **Extract**: "I was born in 1984" → User's birthday
    *   **Extract**: "I'm a software engineer" → User's job
    *   **DO NOT Extract**: "My wife was a theater major" → This is about the wife, NOT the user
    *   **DO NOT Extract**: "My daughter is 10 years old" → This is about the daughter, NOT the user
    *   **DO NOT Extract**: "My brother lives in Texas" → This is about the brother, NOT the user
    *   If the user shares information about someone else, that is NOT a fact about the user.`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "facts": [
    {
      "name": "One of the missing fact names from above",
      "value": "The exact value of the fact",
      "evidence": "Direct quote or reference showing where this fact was stated"
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const system = `${taskFragment}

${missingFactsFragment}

${guidelinesFragment}

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
      "name": "One of the missing fact names from above",
      "value": "The exact value of the fact",
      "evidence": "Direct quote or reference showing where this fact was stated"
    }
  ]
}
\`\`\``;

  return { system, user };
}

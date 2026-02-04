import type { PersonScanPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildHumanPersonScanPrompt(data: PersonScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanPersonScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;
  const knownPersonasList = data.known_persona_names.length > 0
    ? data.known_persona_names.map(name => `        + ${name}`).join('\n')
    : '        + (none)';

  const taskFragment = `# Task

You are scanning a conversation to quickly identify PEOPLE of interest TO the HUMAN USER. Your ONLY job is to spot mentions of PEOPLE. Do NOT analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which PEOPLE were mentioned or relevant
    a. Only flag PEOPLE that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant PEOPLE
        i. Ignore: greetings, small talk, one-off mentions, jokes
    c. Be CLEAR - state your \`reason\` for including this PERSON with any evidence you used`;

  const guidelinesFragment = `## Guidelines

1. **Unknown Types and Names of PEOPLE**
    a. In some conversations, it may be impossible to identify which "Brother" or which "Bob" the user is referring to.
        - Use "Unknown" for the missing field and explain in the \`reason\`
        - This will trigger a later validation step to get more information!
    b. If you're adding a NEW PERSON, be as specific as you can, for example:
        - { "type_of_person": "Unknown", "name_of_person": "Alice at Grocery Store", "reason": "Mentioned but relationship unclear" }
        - { "type_of_person": "Sister that sews", "name_of_person": "Name Unknown", "reason": "Has a sister who sews, name not given" }

**A PERSON Is**
* Immediate Family: Father, Husband, Son, Brother, Mother, Wife, Daughter, Sister (and step/in-law variants)
* Extended Family: Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew
* Close Acquaintance
* Friend
* Lover / Love Interest
* Fiance / Spouse
* Coworker

**A PERSON Is NOT**
- Biographical data: Birthday, Location, Job, Marital Status, Gender, Eye Color, Hair Color
- Other unchangeable Data: Wedding Day, Allergies
- Trait: Personality patterns, communication style, behavioral tendencies
- General Topic: Interests, Hobbies, General subjects
- Personas: AI personas they discuss
    * Known Personas:
${knownPersonasList}
- Characters: Fictitious entities from books, movies, stories, media, etc.`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" is provided for your context and has already been processed!

The JSON format is:

\`\`\`json
{
  "people": [
    {
        "type_of_person": "Father|Friend|Love Interest|Unknown|etc.",
        "name_of_person": "Bob|Alice|Charles|Name Unknown|etc.",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const system = `${taskFragment}

${specificNeedsFragment}

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

Scan the "Most Recent Messages" for PEOPLE mentioned by the human user.

**Return JSON:**
\`\`\`json
{
  "people": [
    {
        "type_of_person": "Father|Friend|Love Interest|Unknown|etc.",
        "name_of_person": "Bob|Alice|Charles|Name Unknown|etc.",
        "reason": "User stated..."
    }
  ]
}
\`\`\``;

  return { system, user };
}

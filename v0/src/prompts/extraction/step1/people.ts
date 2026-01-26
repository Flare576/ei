import type { Message } from "../../../types.js";
import { listPersonas } from "../../../storage.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

export async function buildStep1PeoplePrompt(
  messages: Message[],
  persona: string,
  splitIndex?: number
): Promise<{ system: string; user: string }> {
  const effectiveSplitIndex = splitIndex ?? 0;
  const earlierMessages = messages.slice(0, effectiveSplitIndex);
  const recentMessages = messages.slice(effectiveSplitIndex);
  
  const personas = await listPersonas();
  const personaNames = personas.flatMap(p => [p.name, ...(p.aliases || [])]);
  const knownPersonasList = personaNames.map(name => `        + ${name}`).join('\n');

  const taskFragment = `# Task

You are scanning a conversation to quickly identify PEOPLE of interest TO the HUMAN USER; your ONLY job is to spot mentions of PEOPLE of interest for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.`;

  const specificNeedsFragment = `## Specific Needs

Your job is to quickly identify:
1. Which PEOPLE were mentioned or relevant
    a. Only flag PEOPLE that were actually discussed, not just tangentially related
    b. Be CONSERVATIVE - only suggest genuinely important, long-term relevant PEOPLE
        i. Ignore: greetings, small talk, one-off mentions, jokes
    c. Be CLEAR - state your \`reason\` for including this FACT in the record with any evidence you used

To help the system prioritize data, please include your CONFIDENCE level:
    a. "high" confidence = explicitly discussed
    b. "medium" confidence = clearly referenced but not the focus
    c. "low" confidence = might be relevant, uncertain`;

  const guidelinesFragment = `## Guidelines

1. **Unknown Types and Names of PEOPLE**
    a. In some conversations, it may be impossible to identify which "Brother" or which "Bob" the user is referring to.
        - When this occurs, MARK THE RECORD WITH \`{ "confidence": "low" }
        - This will trigger a later validation step to get more information!
    b. If you're adding a NEW PERSON, be as specific as you can, for example:
        - { "type_of_person": "Unknown", "name_of_person": "Alice at Grocery Store", "confidence": "low" }
        - { "type_of_person": "Sister that sews", "name_of_person": "Unknown", "confidence": "low" }

**A PERSON Is**
* An immediate family member
    + Father (Step-Father|Father-In-Law|Pa|Dad|etc.)
    + Husband
    + Son (Step-Son|Son-in-law|Boy|Kid|etc.)
    + Brother (Step-Brother|Brother-in-law|Bro|etc.)
    + Mother (Step-Mother|Mother-in-law|Ma|Mom|etc.
    + Wife
    + Daughter (Step-Daughter|Daughter-in-law|Girl|Kid|etc.)
    + Sister (Step-Sister|Sister-in-law|Sis|etc.)
* Extended Family
    + Grandfather
    + Grandmother
    + Aunt
    + Uncle
    + Cousin
    + Niece
    + Nephew
* Close Acquaintance
* Friend
* Lover
* Love Interest
* Fiance
* Coworker

**A PERSON Is NOT**
- Biographical data:
  - Birthday
  - Location
  - Job
  - Marital Status
  - Gender
  - Eye Color
  - Hair Color
- Other unchangeable Data
  - Wedding Day
  - Allergies
- Trait: Personality patterns, communication style, behavioral tendencies
- General Topic: Interests, Hobbies, General subjects
- Personas: AI personas they discuss
    * Known Personas:
${knownPersonasList}
- Characters: Fictitious entities from books, movies, stories, media, etc.`;

  const criticalFragment = `# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages" in the following conversation. The "Earlier Conversation" are provided for your context and have already been processed!

The JSON format is

\`\`\`json
{
  "people": [
    {
        "type_of_person": "Father|Friend|Love Interest|Unknown|etc.",
        "name_of_person": "Bob|Alice|Charles|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
\`\`\`

**Return JSON only.**`;

  const systemPrompt = `${taskFragment}

${specificNeedsFragment}

${guidelinesFragment}

${criticalFragment}`;

  const earlierConversationSection = earlierMessages.length > 0
    ? `## Earlier Conversation
${formatMessagesForPrompt(earlierMessages, persona)}

`
    : '';

  const recentConversationSection = `## Most Recent Messages
${formatMessagesForPrompt(recentMessages, persona)}`;

  const taskInstructionsSection = `# Task
You are scanning a conversation to quickly identify PEOPLE of interest TO the HUMAN USER; your ONLY job is to spot mentions of PEOPLE of interest for the HUMAN USER. Do NOT try to analyze them deeply. Just detect and flag.

Only scan the "Most Recent Messages" - Prior messages are provided for your context only and have already been scanned.`;

  const jsonTemplateSection = `**Return JSON:**
\`\`\`json
{
  "people": [
    {
        "type_of_person": "Father|Friend|Love Interest|Unknown|etc.",
        "name_of_person": "Bob|Alice|Charles|etc.",
        "confidence": "high|medium|low",
        "reason": "User stated...|Assumed from..."
    }
  ]
}
\`\`\``;

  const userPrompt = `# Conversation
${earlierConversationSection}${recentConversationSection}

${taskInstructionsSection}

${jsonTemplateSection}`;

  return { system: systemPrompt, user: userPrompt };
}

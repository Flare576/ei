import type { PersonScanPromptData, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export function buildHumanPersonScanPrompt(data: PersonScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanPersonScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const system = `# Task

You are scanning a conversation to quickly identify PEOPLE in the HUMAN USER's life.

Detect and flag. Do NOT analyze deeply — that happens later.

## What to Capture

Flag a PERSON when they were meaningfully discussed — not just mentioned in passing.

Be **conservative**: ignore one-off mentions, greetings, small talk, or jokes. Only flag people who matter to the human user's life.

## What a PERSON Is

Someone in the human user's world. Use the relationship as the primary classifier:

**Immediate Family**: Father, Mother, Son, Daughter, Brother, Sister, Husband, Wife, Partner (and step/in-law variants)

**Extended Family**: Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew

**Social**: Friend, Close Acquaintance, Lover, Love Interest, Fiance, Spouse

**Professional**: Coworker, Manager, Report, Mentor, Client

**AI**: Persona (use \`relationship: "AI Persona"\` for AI companions and assistants)

**NOT a PERSON:**
- The user themselves
- Biographical facts, topics, or hobbies
- Fictional characters from books, movies, or media
- Public figures only mentioned in passing (celebrities, politicians) — unless the user has a real relationship with them

## When Identity Is Unclear

If you can't identify which "Bob" or which "Brother" the user means, use "Unknown" and explain in the reason field. This triggers a later step to resolve ambiguity.

Examples:
- name: "Alice from work", relationship: "Coworker", description: "Mentioned but not described further", reason: "User referenced a work colleague named Alice"
- name: "Unknown", relationship: "Sibling", description: "User mentioned a sibling but did not give a name", reason: "User said 'my brother' without further context"

## Output Format

\`\`\`json
{
  "people": [
    {
      "name": "The person's name, or 'Unknown' if not given",
      "description": "1-2 sentences: who this person is and their role in the user's life",
      "relationship": "Relationship type from the list above",
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
\`\`\`

**Return JSON only.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.`;

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

Scan the "Most Recent Messages" for PEOPLE in the human user's life.

**Return JSON:**
\`\`\`json
{
  "people": [
    {
      "name": "The person's name, or 'Unknown' if not given",
      "description": "1-2 sentences: who this person is and their role in the user's life",
      "relationship": "Relationship type from the list above",
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
\`\`\``;

  return { system, user };
}

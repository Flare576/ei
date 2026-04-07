import type { PersonScanPromptData, ParticipantContext, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

function participantContextSection(ctx: ParticipantContext | undefined): string {
  if (!ctx) return "";
  const lines: string[] = ["# Participant Context", "The following may help you understand who is in this conversation.", ""];
  lines.push(`## Persona: ${ctx.persona_name}`);
  if (ctx.persona_description) lines.push(ctx.persona_description);
  lines.push("");
  lines.push("## Human User");
  if (ctx.human_name) lines.push(`Name: ${ctx.human_name}`);
  if (ctx.human_age !== undefined) lines.push(`Age: ${ctx.human_age}`);
  lines.push("");
  return lines.join("\n");
}

export function buildHumanPersonScanPrompt(data: PersonScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanPersonScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;
  const humanName = data.participant_context?.human_name;

  const builtInTypes = ['Full Name', 'First Name', 'Nickname', 'Email', 'GitHub', 'Discord',
    'Roblox', 'Reddit', 'Twitter', 'FF14', 'Relationship', 'Ei Persona'];
  const userTypes = data.known_identifier_types ?? [];
  const allTypes = [...new Set([...builtInTypes, ...userTypes])].join(', ');

  const selfGuard = humanName
    ? `The HUMAN USER (${humanName}) wrote these messages. When the conversation is meaningfully about them as a person, you MAY include a self-record with \`relationship: "Self"\`. Do NOT apply their names or handles as identifiers for OTHER people in their life.`
    : `The HUMAN USER wrote these messages. They are not automatically a person to flag — only include a self-record with \`relationship: "Self"\` when the conversation is meaningfully about them. Do NOT apply their names or handles as identifiers for other people in their life.`;

  const system = `# Task

You are scanning a conversation to quickly identify PEOPLE in the HUMAN USER's life.

Detect and flag. Do NOT analyze deeply — that happens later.

${participantContextSection(data.participant_context)}## What to Capture

Flag a PERSON when they were meaningfully discussed — not just mentioned in passing.

Be **conservative**: ignore one-off mentions, greetings, small talk, or jokes. Only flag people who matter to the human user's life.

## What a PERSON Is

Someone in the human user's world. Use the relationship as the primary classifier:

**Immediate Family**: Father, Mother, Son, Daughter, Brother, Sister, Husband, Wife, Partner (and step/in-law variants)

**Extended Family**: Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew

**Social**: Friend, Close Acquaintance, Lover, Love Interest, Fiance, Spouse

**Professional**: Coworker, Manager, Report, Mentor, Client

**Self**: The human user themselves (use \`relationship: "Self"\`)

**AI**: Persona (use \`relationship: "AI Persona"\` for AI companions and assistants)

**NOT a PERSON:**
- ${selfGuard}
- Biographical facts, topics, or hobbies
- Fictional characters from books, movies, or media
- Public figures only mentioned in passing (celebrities, politicians) — unless the user has a real relationship with them

## When Identity Is Unclear

If you can't identify which "Bob" or which "Brother" the user means, use "Unknown" and explain in the reason field. This triggers a later step to resolve ambiguity.

Examples:
- name: "Alice from work", relationship: "Coworker", description: "Mentioned but not described further", reason: "User referenced a work colleague named Alice"
- name: "Unknown", relationship: "Sibling", description: "User mentioned a sibling but did not give a name", reason: "User said 'my brother' without further context"

## Identifiers (optional)

If the conversation **explicitly** mentions a platform handle, username, email address, or alternative name for this person, capture it in \`identifiers\`.

Known types: ${allTypes}

If you are unsure of the type, use \`Nickname\` as a fallback. Do NOT invent types. Do NOT duplicate the \`name\` field as an identifier.

Only include \`identifiers\` when explicitly mentioned in the conversation — omit it entirely if nothing qualifies.

## Output Format

\`\`\`json
{
  "people": [
    {
      "name": "The person's name, or 'Unknown' if not given",
      "identifiers": [
        { "type": "GitHub", "value": "mldelaro" }
      ],
      "description": "1-2 sentences: who this person is and their role in the user's life",
      "relationship": "Relationship type from the list above",
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
\`\`\`

\`identifiers\` is OPTIONAL — only include when the conversation explicitly mentions platform handles, usernames, emails, or alternative names.

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
      "identifiers": [{ "type": "GitHub", "value": "handle" }],
      "description": "1-2 sentences: who this person is and their role in the user's life",
      "relationship": "Relationship type from the list above",
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
\`\`\`

\`identifiers\` is optional — include only when explicitly mentioned.`;

  return { system, user };
}

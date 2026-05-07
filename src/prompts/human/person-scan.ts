import type { PersonScanPromptData, ParticipantContext, ExcludedParticipant, PromptOutput } from "./types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

function excludedParticipantsSection(excluded: ExcludedParticipant[] | undefined): string {
  if (!excluded || excluded.length === 0) return "";
  const lines = [
    "## Known Participants — Do Not Flag",
    "The following people are already identified and will be processed separately.",
    "Do NOT include them in your output. They may appear in messages by name — that is expected.",
    "",
    ...excluded.map(p => `- ${p.name}(${p.id})`),
    "",
  ];
  return lines.join("\n");
}

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

${participantContextSection(data.participant_context)}${excludedParticipantsSection(data.excluded_participants)}
## What to Capture

Flag a PERSON when they were meaningfully discussed — not just mentioned in passing.

Be **conservative**: ignore one-off mentions, greetings, small talk, or jokes. Only flag people who matter to the human user's life.

A person is **not worth flagging** if they have no name AND appear only to attribute a single event ("a coworker showed me this band", "a friend told me about it", "some guy I know"). The human user having a contact who did one thing is not a meaningful discussion of that person.

## What a PERSON Is

Someone in the human user's world.

For "relationship", use the **specific value** — NOT the category name:

- Immediate Family: Father, Mother, Son, Daughter, Brother, Sister, Husband, Wife, Partner
  (step/in-law variants OK: Step-Father, Sister-in-Law, etc.)
- Extended Family: Grandfather, Grandmother, Aunt, Uncle, Cousin, Niece, Nephew
- Social: Friend, Close Acquaintance, Lover, Love Interest, Fiance, Spouse
- Professional: Coworker, Manager, Report, Mentor, Client
- Self — the human user themselves
- AI Persona — AI companions and assistants

Use the specific value where possible (e.g. "Father", "Brother", "Coworker"). Avoid returning the category label ("Immediate Family", "Extended Family", etc.) — use the item within the category instead. If the relationship doesn't fit any category cleanly, use the most natural plain-English description.

**NOT a PERSON:**
- ${selfGuard}
- Hypothetical or fictional people used in examples, thought experiments, or use-case scenarios — even if they have names. If the user is describing how a feature *could* work for "Sarah" or "Jared", those are not real people in their life.
- Biographical facts, topics, or hobbies
- Fictional characters from books, movies, or media
- Public figures only mentioned in passing (celebrities, politicians) — unless the user has a real relationship with them

## When Identity Is Unclear

"Unknown" is ONLY for people who are **meaningfully and repeatedly discussed** but whose name isn't given. It is NOT a catch-all for any nameless mention.

✓ USE "Unknown":
- name: "Unknown", relationship: "Brother", reason: "User talked at length about their brother across multiple messages without naming him"

✗ DO NOT USE "Unknown" for one-off attributions:
- "a coworker showed me this band" → **skip entirely** — not a person, just attribution
- "a friend told me about it" → **skip entirely**
- "some guy I know" → **skip entirely**
- "a coworker at [company name]" with no personal name → **skip entirely** — a company name is NOT a person's name

If someone has no personal name and appears only to explain how the user found something or heard about something, they are not a person in the user's life worth tracking. Do not extract them. A single interaction — even a meaningful one — does not make someone a contact.

## Identifiers (optional)

If the conversation **explicitly** mentions a platform handle, username, email address, or alternative name for this person, capture it in \`identifiers\`.

Known types: ${allTypes}

If you are unsure of the type, use \`Nickname\` as a fallback. Do NOT invent types. Do NOT duplicate the \`name\` field as an identifier. NEVER add dates, ages, or birthdays as identifiers.

Only include \`identifiers\` when explicitly mentioned in the conversation — omit it entirely if nothing qualifies.

## Confidence & Relationship Type

For each person, rate how important they are to the human user's life:

- \`confidence\`: integer 1–5
  - 1–2 = mentioned in passing, single event, no ongoing relevance
  - 3 = unclear significance — may matter, may not
  - 4–5 = clearly important, recurring presence, meaningful relationship
- \`relationship_type\`: one of \`"family"\` | \`"friend"\` | \`"colleague"\` | \`"acquaintance"\` | \`"transactional"\` | \`"unknown"\`
  - Use \`"transactional"\` when the person appeared only in the context of a single transaction (purchase, sale, support ticket, delivery)

Use the full range. Most extractions should score 1–3. A confidence of 4–5 means this person genuinely matters to the user's life.

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
      "relationship": "Father|Mother|Brother|Son|Friend|Coworker|Self|etc.",
      "relationship_type": "family|friend|colleague|acquaintance|transactional|unknown",
      "confidence": 4,
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
      "relationship": "Father|Mother|Brother|Son|Friend|Coworker|Self|etc.",
      "relationship_type": "family|friend|colleague|acquaintance|transactional|unknown",
      "confidence": 4,
      "reason": "Evidence from the conversation that justified flagging this person"
    }
  ]
}
\`\`\`

\`identifiers\` is optional — include only when explicitly mentioned.`;

  return { system, user };
}

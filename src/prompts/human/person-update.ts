import type { PromptOutput, ParticipantContext } from "./types.js";
import type { Person, Message } from "../../core/types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

export interface PersonUpdatePromptData {
  existing_item: Person | null;
  new_person_name?: string;
  new_person_description?: string;
  new_person_relationship?: string;
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  participant_context?: ParticipantContext;
  known_identifier_types?: string[];
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

function formatExistingPerson(person: Person): string {
  return JSON.stringify({
    identifiers: person.identifiers ?? [],
    description: person.description,
    sentiment: person.sentiment,
    relationship: person.relationship,
    exposure_current: person.exposure_current,
    exposure_desired: person.exposure_desired,
  }, null, 2);
}

export function buildPersonUpdatePrompt(data: PersonUpdatePromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildPersonUpdatePrompt: persona_name is required");
  }

  const personaName = data.persona_name;
  const isNewItem = data.existing_item === null;
  const humanName = data.participant_context?.human_name;

  const builtInTypes = ['Full Name', 'First Name', 'Nickname', 'Email', 'GitHub', 'Discord',
    'Roblox', 'Reddit', 'Twitter', 'FF14', 'Relationship', 'Ei Persona'];
  const userTypes = data.known_identifier_types ?? [];
  const allTypes = [...new Set([...builtInTypes, ...userTypes])].join(', ');

  const personRelationship = data.existing_item?.relationship ?? data.new_person_relationship ?? 'Unknown';
  const personName = data.existing_item?.name ?? data.new_person_name ?? 'Unknown';

  // ── WHO YOU ARE ANALYZING ──────────────────────────────────────────────────
  // This section anchors the model on the target person before anything else.
  // Local models lose context from long prompts — this must be first.

  const personFocusSection = isNewItem
    ? `# WHO YOU ARE ANALYZING

NEW PERSON — not yet in system
Relationship: ${personRelationship}
Name: ${personName === 'Unknown' ? 'Not yet known' : personName}${data.new_person_description ? `\nWhat we know: ${data.new_person_description}` : ''}

Your ONLY job is to find information about the HUMAN USER's **${personRelationship}** in the conversation and create their record. Ignore all other people mentioned — they each have their own separate records.`
    : `# WHO YOU ARE ANALYZING

EXISTING PERSON RECORD — update only if the Most Recent Messages contain new information
Name: ${personName}
Relationship: ${personRelationship}

Current record:
\`\`\`json
${formatExistingPerson(data.existing_item!)}
\`\`\`

Your ONLY job is to update THIS SPECIFIC PERSON's record based on the Most Recent Messages. Ignore all other people mentioned — they each have their own separate records.`;

  // ── TASK ──────────────────────────────────────────────────────────────────

  const taskSection = isNewItem
    ? `# Task

You are creating a new PERSON record based on what you find about the HUMAN USER's **${personRelationship}** in the conversation.

The record you create will be referenced by personas in future conversations — keep it accurate, brief, and useful.`
    : `# Task

You are scanning a conversation to update a PERSON record in the HUMAN USER's life.

Apply changes to the record above **ONLY IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

Detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the record above`;

  // ── DESCRIPTION SECTION ───────────────────────────────────────────────────
  // New: shorter, no "don't accumulate" guidance (nothing to accumulate yet)
  // Existing: full synthesis guidance

  const descriptionSection = isNewItem
    ? `A concise summary of who this person is and how they relate to the HUMAN USER. Keep it brief and factual — only what you can confirm from the conversation.

- Capture who this person IS — their role in the user's life
- Be useful to a persona who's never heard this person's name before
- 1-3 sentences maximum
- If you know their birth date or birth year, include it as a date (e.g. "born 1986-10-28") — never as a current age (ages change, dates don't)

**ABSOLUTELY VITAL**: Do **NOT** embellish. Record only what the user actually said or demonstrated.`
    : `A concise summary of who this person is and how they relate to the HUMAN USER. Personas use this to recognize this person and engage meaningfully when they come up.

## CRITICAL: Synthesize, don't accumulate

Every update must **rewrite** the description as a current-state summary. Never append to it.

**Good**: "Borfinda, partner of 12 years. Former marine biologist, now stay-at-home parent. Tends to ground the user when they spiral; dry sense of humor. Two kids together."

**Bad**: "Borfinda was mentioned when the user talked about moving. In a later conversation she came up again during the work stress discussion. Most recently the user said she was supportive."

The description should:
- Capture who this person IS — their role, characteristics, relationship texture
- Include what the HUMAN USER has revealed about them over time
- Read as a brief, confident summary — not a log of when they were mentioned
- Not exceed 3-4 sentences

The description should NOT:
- Append "Most recently:", "Latest mention:", or any temporal marker
- Accumulate a session-by-session history of every time this person came up
- Speculate about the person based on thin evidence
- Record someone's age — record their birth date or birth year instead (e.g. "born 1981" not "age 44")

**ABSOLUTELY VITAL**: Do **NOT** embellish — personas use their own voice. Record what the user actually said or demonstrated, not your interpretation of its emotional significance.`;

  // ── IDENTIFIERS ───────────────────────────────────────────────────────────

  const identityGuard = humanName
    ? `CRITICAL: The HUMAN USER is ${humanName}. They wrote these messages. Do NOT assign their names, nicknames, or handles as identifiers for this person's record — UNLESS this IS the user's own Self record (relationship: "Self").`
    : `CRITICAL: The HUMAN USER wrote these messages. Do NOT assign their own names or handles as identifiers for this person's record — UNLESS this IS the user's own Self record (relationship: "Self"). Do NOT return \`relationship: "Self"\` unless you are certain this record is about the human user themselves.`;

  const isUnknownNewPerson = isNewItem && personName === 'Unknown';
  const unknownIdentifierGuard = isUnknownNewPerson
    ? `\nThis person's name is not yet known. ONLY add \`identifiers\` if their name, handle, or email is explicitly stated in the conversation about THEM specifically — not inferred, not guessed.`
    : '';

  const identifierSection = `${identityGuard}${unknownIdentifierGuard}

If you spot a platform handle, username, email, nickname, or full name explicitly mentioned in the conversation that isn't already in the person's identifiers, include it in \`identifiers_to_add\` (updates) or \`identifiers\` (new records). Always mark exactly one identifier as \`"is_primary": true\` — prefer the most formal or complete name.

For persons with a known relationship (Father, Mother, Sibling, etc.), also look for informal terms the HUMAN USER uses to address or refer to THAT SPECIFIC PERSON (\`Dad\`, \`Pop\`, \`Mom\`, \`Sis\`, etc.) and add them as \`{ "type": "Relationship", "value": "..." }\` identifiers.

NEVER add dates, ages, birthdays, or anniversaries as identifiers. These are not identifying labels — if known, include them in the description instead.

Known identifier types: ${allTypes}. If unsure of type, use \`Nickname\`.`;

  // ── OUTPUT FORMAT ─────────────────────────────────────────────────────────

  const jsonTemplate = isNewItem
    ? `{
    "identifiers": [
      { "type": "Full Name", "value": "Borfinda Lastname", "is_primary": true },
      { "type": "Nickname", "value": "Borfi" }
    ],
    "description": "...",
    "sentiment": 0.0,
    "relationship": "Mother|Friend|Coworker|AI Companion|etc.",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      { "text": "exact phrase from message", "reason": "why this matters" }
    ]
  }`
    : `{
    "identifiers_to_add": [{ "type": "GitHub", "value": "handle" }],
    "description": "...",
    "sentiment": 0.0,
    "relationship": "Mother|Friend|Coworker|AI Companion|etc.",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      { "text": "exact phrase from message", "reason": "why this matters" }
    ]
  }`;

  // ── SYSTEM PROMPT ASSEMBLY ─────────────────────────────────────────────────
  // Order: WHO (anchor) → task → participant context → field definitions →
  //        output format. Person details are in WHO, not repeated at the bottom.

  const system = `${personFocusSection}

${taskSection}

${participantContextSection(data.participant_context)}# Field Definitions

## Identifiers
${identifierSection}

## Description (\`description\`)
${descriptionSection}

## Sentiment (\`sentiment\`)

How the HUMAN USER feels about this PERSON overall.

Scale of -1.0 to 1.0:
- -1.0: No PERSON is more despised
- -0.5: Disliked or complicated relationship, but not without value
- 0: Neutral or unknown
- 0.5: Liked and valued
- 1.0: The most important person in their life

Do not make micro-adjustments. Close enough is OK.

## Relationship (\`relationship\`)

How the HUMAN USER is currently related to this PERSON.

Once known, this field changes infrequently — a "Father" may later be clarified to "Step-Father", but is unlikely to become "Uncle".

Keep it concise and specific. Avoid vague labels.

Examples: "Unknown" → "Coworker", "Mother" → "Step-Mother", "Fiance" → "Spouse", "AI Persona" → "AI Companion"

## Desired Exposure (\`exposure_desired\`)

How much the HUMAN USER wants to talk about this PERSON.

Scale of 0.0 to 1.0:
- 0.0: Never wants to hear about this PERSON again
- 0.5: Average amount of engagement
- 1.0: This PERSON is the sole focus of their existence

Do not make micro-adjustments. Close enough is OK.

## Exposure Impact (\`exposure_impact\`)

Not in the current data — but include it in your response.

How much this conversation should count toward exposure tracking:
- "high": Long, detailed conversation exclusively about this PERSON
- "medium": Long OR detailed conversation about this PERSON
- "low": The conversation touched on this PERSON briefly
- "none": Only alluded to or hinted at

## Quotes

Identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this PERSON.

**Prioritize:**
- Humor, wit, colorful language, creative profanity
- Emotional outbursts (positive or negative) — the raw stuff
- Phrases that reveal how the HUMAN USER feels about this PERSON
- Things you'd quote back to them later to make them laugh or think

**NEVER extract these:**
- Technical identifiers: ARNs, URLs, file paths, UUIDs, config keys
- AI agent self-talk or apologies
- Generic statements that could apply to anyone

**CRITICAL**: Return the EXACT text as it appears in the message.

# Output

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

\`\`\`json
${jsonTemplate}
\`\`\`

When returning a record, **ALWAYS** include \`description\` and \`sentiment\`. Do NOT return \`relationship: "Self"\` unless this record IS the human user themselves.

If you find **NO EVIDENCE** of the HUMAN USER's **${personRelationship}** in the "Most Recent Messages", respond with: \`{}\`

If **NO CHANGES** are required, respond with: \`{}\`

An empty object is the MOST COMMON expected response.
`;

  // ── USER PROMPT ───────────────────────────────────────────────────────────

  const earlierSection =
    data.messages_context.length > 0
      ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
      : "";

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const personReminder = personName !== 'Unknown'
    ? `Remember: You are analyzing the record for **${personName}** (${personRelationship}). Focus only on information about this specific person.`
    : `Remember: You are analyzing the record for the HUMAN USER's **${personRelationship}**. Focus only on information about this specific person.`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

${personReminder}

Analyze the Most Recent Messages and ${isNewItem ? 'create the PERSON record' : 'update the PERSON record'} if warranted.

**Return JSON:**
\`\`\`json
${jsonTemplate}
\`\`\`

If no ${isNewItem ? 'information found' : 'changes are needed'}, respond with: \`{}\``;

  return { system, user };
}

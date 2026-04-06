import type { PromptOutput } from "./types.js";
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

  const identifierSection = `If you spot a platform handle, username, email, nickname, or full name explicitly mentioned in the conversation that isn't already in the person's identifiers, include it in \`identifiers_to_add\` (updates) or \`identifiers\` (new records).

Known identifier types: \`full_name\`, \`nickname\`, \`email\`, \`github\`, \`discord\`, \`roblox\`, \`reddit\`, \`twitter\`, \`ff14\`, \`ei_persona\`. If unsure of type, use \`nickname\`.`;

  const descriptionSection = `A concise summary of who this person is and how they relate to the HUMAN USER. Personas use this to recognize this person and engage meaningfully when they come up.

## CRITICAL: Synthesize, don't accumulate

Every update must **rewrite** the description as a current-state summary. Never append to it.

**Good description**: "Borfinda, partner of 12 years. Former marine biologist, now stay-at-home parent. Tends to ground the user when they spiral; dry sense of humor. Two kids together."

**Bad description**: "Borfinda was mentioned when the user talked about moving. In a later conversation she came up again during the work stress discussion. Most recently the user said she was supportive."

The description should:
- Capture who this person IS — their role, characteristics, relationship texture
- Include what the HUMAN USER has revealed about them over time
- Be useful to a persona who's never heard this person's name before
- Read as a brief, confident summary — not a log of when they were mentioned

The description should NOT:
- Append "Most recently:", "Latest mention:", or any temporal marker
- Accumulate a session-by-session history of every time this person came up
- Speculate about the person based on thin evidence
- Exceed 3-4 sentences under any circumstances

**ABSOLUTELY VITAL**: Do **NOT** embellish — personas use their own voice. Record what the user actually said or demonstrated, not your interpretation of its emotional significance.`;

  const relationshipSection = `## Relationship (\`relationship\`)

How the HUMAN USER is currently related to this PERSON.

Once known, this field changes infrequently — a "Father" may later be clarified to "Step-Father", but is unlikely to become "Uncle".

Keep it concise and specific. Avoid vague labels.

Examples: "Unknown" → "Coworker", "Mother" → "Step-Mother", "Fiance" → "Spouse", "AI Persona" → "AI Companion"`;

  const exposureSection = `## Desired Exposure (\`exposure_desired\`)

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
- "none": Only alluded to or hinted at`;

  const currentDetailsSection = data.existing_item
    ? `\`\`\`json
${formatExistingPerson(data.existing_item)}
\`\`\`

You are UPDATING an existing PERSON.`
    : `**NEW PERSON — NOT YET IN SYSTEM**

You are CREATING a new PERSON from what was discovered:
\`\`\`json
{
  "name": "${data.new_person_name ?? "Unknown"}",
  "description": "${data.new_person_description ?? "Details unknown"}",
  "relationship": "${data.new_person_relationship ?? "Unknown"}"
}
\`\`\`

Return all fields based on what you find in the conversation.`;

  const jsonTemplate = isNewItem
    ? `{
    "identifiers": [
      { "type": "nickname", "value": "Matt", "is_primary": true }
    ],
    "description": "...",
    "sentiment": 0.0,
    "relationship": "Mother|Friend|Coworker|AI Companion|etc.",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      {
        "text": "exact phrase from message",
        "reason": "why this matters"
      }
    ]
  }`
    : `{
    "identifiers_to_add": [{ "type": "github", "value": "handle" }],
    "description": "...",
    "sentiment": 0.0,
    "relationship": "Mother|Friend|Coworker|AI Companion|etc.",
    "exposure_desired": 0.5,
    "exposure_impact": "high|medium|low|none",
    "quotes": [
      {
        "text": "exact phrase from message",
        "reason": "why this matters"
      }
    ]
  }`;

  const system = `# Task

You are scanning a conversation to deeply understand a PERSON in the HUMAN USER's life.

Your job is to take that analysis and apply it to the record we already have **IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

This means detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the description or identifiers of the PERSON

This PERSON will be recorded in the HUMAN USER's profile for agents and personas to later reference.

# Field Definitions

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

${relationshipSection}

${exposureSection}

## Quotes

In addition to updating the PERSON, identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this PERSON.

### What Makes a Quote Worth Preserving

**Prioritize:**
- Humor, wit, colorful language, creative profanity
- Emotional outbursts (positive or negative) — the raw stuff
- Phrases that reveal how the HUMAN USER feels about this PERSON
- Things you'd quote back to them later to make them laugh or think
- Unique expressions or turns of phrase about or from this PERSON
- Quotable moments from EITHER speaker — humans AND AI personas both say memorable things

**NEVER extract these — they are NOT quotes:**
- Technical identifiers: ARNs, URLs, file paths, UUIDs, config keys
- AI agent self-talk: "I notice I'm in Plan Mode", "I'll start by...", status updates
- AI apologies or acknowledgments: "You're absolutely right", "I apologize for that"
- Generic statements that could apply to anyone
- Credentials, secrets, connection strings, or anything that looks like an access token

**The litmus test**: Would you bring this up at a bar with a friend? Would it make someone laugh, think, or feel something?
- "She's the only person who can make me feel simultaneously stupid and brilliant" → YES.
- "Borfinda was mentioned in the context of the Minnesota discussion" → NO. That's a note, not a quote.

**When in doubt, leave it out.** An empty quotes array is always acceptable.

**CRITICAL**: Return the EXACT text as it appears in the message. **WE CAN ONLY USE IT IF WE FIND IT IN THE TEXT.**

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

\`\`\`json
${jsonTemplate}
\`\`\`

When returning a record, **ALWAYS** include \`description\` and \`sentiment\`.

If you find **NO EVIDENCE** of this PERSON in the "Most Recent Messages", respond with: \`{}\`

If **NO CHANGES** are required, respond with: \`{}\`

An empty object is the MOST COMMON expected response.

# Current Details of PERSON

${currentDetailsSection}
`;

  const earlierSection =
    data.messages_context.length > 0
      ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
      : "";

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation
${earlierSection}${recentSection}

---

Analyze the Most Recent Messages and update the PERSON if warranted.

**Return JSON:**
\`\`\`json
${jsonTemplate}
\`\`\`

If no changes are needed, respond with: \`{}\``;

  return { system, user };
}

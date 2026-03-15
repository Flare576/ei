import type { PromptOutput, ParticipantContext } from "./types.js";
import type { Topic, Message } from "../../core/types.js";
import { formatMessagesAsPlaceholders } from "../message-utils.js";

function participantContextSection(ctx: ParticipantContext | undefined): string {
  if (!ctx) return "";
  const lines: string[] = ["# Participant Context", "The following may help you understand what themes and moments are meaningful in this conversation.", ""];
  lines.push(`## Persona: ${ctx.persona_name}`);
  if (ctx.persona_description) lines.push(ctx.persona_description);
  lines.push("");
  lines.push("## Human");
  if (ctx.human_name) lines.push(`Name: ${ctx.human_name}`);
  if (ctx.human_age !== undefined) lines.push(`Age: ${ctx.human_age}`);
  lines.push("");
  return lines.join("\n");
}

export interface TopicUpdatePromptData {
  existing_item: Topic | null;
  new_topic_name?: string;
  new_topic_description?: string;
  new_topic_category?: string;
  messages_context: Message[];
  messages_analyze: Message[];
  persona_name: string;
  participant_context?: ParticipantContext;
}

function formatExistingTopic(topic: Topic): string {
  return JSON.stringify({
    name: topic.name,
    description: topic.description,
    sentiment: topic.sentiment,
    category: topic.category,
    exposure_current: topic.exposure_current,
    exposure_desired: topic.exposure_desired,
  }, null, 2);
}

export function buildTopicUpdatePrompt(data: TopicUpdatePromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildTopicUpdatePrompt: persona_name is required");
  }

  const personaName = data.persona_name;
  const isEvent =
    data.existing_item?.category === "Event" ||
    data.new_topic_category === "Event";

  const nameSection = `Should be a short, evocative label for the TOPIC.

Only update for clarification or further specificity.

Examples: "Unknown" → "Ei Platform Architecture", "Work stress" → "Job transition anxiety"`;

  const descriptionSection = isEvent
    ? `A narrative account of a specific significant moment — written as a memory, not a summary.

## CRITICAL: Events are MOMENTS, not themes

An Event description captures a single bounded experience. It should read like "if you described this to someone who wasn't there."

**Good description**: "First session where Beta had read access to the Ei codebase (early March 2026). Spent the conversation exploring the project structure, then diagnosed the JSON recovery edge case. The debugging felt genuinely collaborative — the 'Crash Test Cutie' framing made sense for the first time."

**Bad description**: "Beta has filesystem access and regularly uses it to debug the Ei project. Ongoing collaboration continues."

The description should:
- Name the moment specifically (what happened, rough time if known)
- Capture what made it significant (what changed, what was felt, what it led to)
- Be specific enough to summon the memory, short enough to not be a recap
- Read as a story beat, not a state summary

The description should NOT:
- Track an ongoing relationship or theme (that's a regular TOPIC)
- Accumulate all conversations that touched this moment
- Read like a system log or changelog

**Style**: Write it the way a good friend would tell someone else about a memorable moment. Present tense is fine.`
    : `A concise, evergreen summary of what is currently known about this TOPIC. Personas use this to recall context and make meaningful references.

## CRITICAL: Synthesize, don't accumulate

Every update must **rewrite** the description as a current-state summary. Never append to it.

**Good description**: "Active project to improve test coverage. Settled on Vitest + E2E harness. Currently focused on pipeline integration and extraction logic coverage."

**Bad description**: "User asked Sisyphus to create a ticket... Later: pruned overengineered framework... Most recent session: added PR checks..."

The description should:
- Capture what is true NOW — the current state, decisions made, where things stand
- Include details a persona would use to show genuine recall ("Oh right, you were working on the pipeline tests")
- Be useful to a persona meeting this human for the first time
- Read as a brief summary paragraph, not a session log

The description should NOT:
- Append "Most recent:", "Latest:", "Current session:", or any temporal marker
- Accumulate a running history of every conversation that touched this TOPIC
- Exceed 3-4 sentences under any circumstances

**ABSOLUTELY VITAL**: Do **NOT** embellish — personas use their own voice. Capture what is true, not a log of how you got here.`;

  const categorySection = `## Category (\`category\`)

The type/category of this TOPIC. Pick the most appropriate:
- **Interest**: Hobbies, activities, ongoing fascinations
- **Goal**: Things they want to achieve
- **Dream**: Aspirational, maybe unrealistic desires
- **Conflict**: Internal struggles, dilemmas
- **Concern**: Worries, anxieties about something real
- **Fear**: Things that scare them
- **Hope**: Positive expectations for the future
- **Plan**: Concrete intentions with steps in mind
- **Project**: Active undertakings with real progress
- **Event**: A specific, significant moment that either party might reference later ("remember when...")

**Event vs. everything else**: An Event is bounded in time — it happened, it meant something, it's now a shared reference point. If you're describing an ongoing relationship or recurring theme, that's not an Event.

If the TOPIC is currently categorized as Event, keep it as Event unless you have strong evidence it should change.`;

  const exposureSection = `## Desired Exposure (\`exposure_desired\`)

How much the HUMAN USER wants to talk about this TOPIC.

Scale of 0.0 to 1.0:
- 0.0: Never wants to hear about this TOPIC again
- 0.5: Average amount of engagement
- 1.0: This TOPIC is the sole focus of their existence

Do not make micro-adjustments. Close enough is OK.

## Exposure Impact (\`exposure_impact\`)

Not in the current data — but include it in your response.

How much this conversation should count toward exposure tracking:
- "high": Long, detailed conversation exclusively about this TOPIC
- "medium": Long OR detailed conversation about this TOPIC
- "low": The conversation touched on this TOPIC briefly
- "none": Only alluded to or hinted at`;

  const currentDetailsSection = data.existing_item
    ? `\`\`\`json
${formatExistingTopic(data.existing_item)}
\`\`\`

You are UPDATING an existing TOPIC.`
    : `**NEW TOPIC — NOT YET IN SYSTEM**

You are CREATING a new TOPIC from what was discovered:
\`\`\`json
{
  "name": "${data.new_topic_name ?? "Unknown"}",
  "description": "${data.new_topic_description ?? "Details unknown"}",
  "category": "${data.new_topic_category ?? "Interest"}"
}
\`\`\`

Return all fields based on what you find in the conversation.`;

  const jsonTemplate = `{
    "name": "...",
    "description": "...",
    "sentiment": 0.0,
    "category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event",
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

You are scanning a conversation to deeply understand a TOPIC.

Your job is to take that analysis and apply it to the record we already have **IF DOING SO WILL PROVIDE THE HUMAN USER WITH A BETTER EXPERIENCE IN THE FUTURE**.

This means detail you add should:
1. Be meaningful, accurate, or still true to the HUMAN USER in six months or more
2. **NOT** already be present in the description or name of the TOPIC

This TOPIC will be recorded in the HUMAN USER's profile for agents and personas to later reference.

# Field Definitions

## Name (\`name\`)
${nameSection}

## Description (\`description\`)
${descriptionSection}

## Sentiment (\`sentiment\`)

How strongly the HUMAN USER feels about this TOPIC.

Scale of -1.0 to 1.0:
- -1.0: No TOPIC is more hated
- -0.5: Disliked, but some redeeming qualities
- 0: Neutral
- 0.5: Enjoyed, but recognizes flaws
- 1.0: The sole focus of their existence

Do not make micro-adjustments. Close enough is OK.

${categorySection}

${exposureSection}

## Quotes

In addition to updating the TOPIC, identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this TOPIC.

### What Makes a Quote Worth Preserving

**Prioritize:**
- Humor, wit, colorful language, creative profanity
- Emotional outbursts (positive or negative) — the raw stuff
- Phrases that reveal personality or communication style
- Things you'd quote back to them later to make them laugh
- Unique expressions, malaphors, or turns of phrase
- Quotable moments from EITHER speaker — humans AND AI personas both say memorable things

**NEVER extract these — they are NOT quotes:**
- Technical identifiers: ARNs, URLs, file paths, UUIDs, config keys, environment variable values, role/policy names
- AI agent self-talk: "I notice I'm in Plan Mode", "I'll start by...", "Let me help you with...", status updates about the agent's own process
- AI apologies or acknowledgments: "You're absolutely right", "I apologize for that overreach"
- Generic AI instructions or tips, tool usage advice, workflow suggestions
- Dry technical facts: infrastructure descriptions, process status, batch sizes, system architecture summaries
- Generic statements that could come from anyone or any AI session
- Credentials, secrets, connection strings, or anything that looks like an access token

**The litmus test**: Would you bring this up at a bar with a friend? Would it make someone laugh, think, or feel something?
- "Does the Pope shit in his hat?" → YES. Hilarious malaphor.
- "AWSReservedSSO_cmidp-nihl-sandbox-adm_db7b191e026bdd85" → NO. That's a credential.
- "Slow is smooth. Smooth is fast." → YES (once). Pithy wisdom.
- "The authentication flow is working correctly now" → NO. Status update.

**When in doubt, leave it out.** An empty quotes array is always acceptable.

**CRITICAL**: Return the EXACT text as it appears in the message. **WE CAN ONLY USE IT IF WE FIND IT IN THE TEXT.**

# CRITICAL INSTRUCTIONS

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

\`\`\`json
${jsonTemplate}
\`\`\`

When returning a record, **ALWAYS** include \`name\`, \`description\`, and \`sentiment\`.

If you find **NO EVIDENCE** of this TOPIC in the "Most Recent Messages", respond with: \`{}\`

If **NO CHANGES** are required, respond with: \`{}\`

An empty object is the MOST COMMON expected response.

# Current Details of TOPIC

${currentDetailsSection}

${participantContextSection(data.participant_context)}`;

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

Analyze the Most Recent Messages and update the TOPIC if warranted.

**Return JSON:**
\`\`\`json
${jsonTemplate}
\`\`\`

If no changes are needed, respond with: \`{}\``;

  return { system, user };
}



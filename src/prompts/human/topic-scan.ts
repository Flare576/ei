import type { TopicScanPromptData, PromptOutput, ParticipantContext } from "./types.js";
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

function technicalContextSection(technical_context: boolean | undefined): string {
  if (!technical_context) return "";
  return `## Technical Context

This conversation originates from a technical source (coding tool session, developer workflow). The human is likely a developer or technical user.

**Treat Technical as a priority category** for topics that are tools, platforms, frameworks, libraries, or technical concepts being actively learned, evaluated, or built with. Flag these even if they seem like passing mentions — technical knowledge compounds and is worth preserving.

`;
}

export function buildHumanTopicScanPrompt(data: TopicScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildHumanTopicScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const system = `# Task

You are scanning a conversation to quickly identify TOPICS of interest to the HUMAN USER.

Detect and flag. Do NOT analyze deeply — that happens later.

## What to Capture

Flag a TOPIC when it was meaningfully discussed — not just mentioned in passing.

Be **conservative**: only flag topics that are genuinely relevant to the human user long-term. Noise is worse than gaps.

## What a TOPIC Is

A meaningful subject in the human user's life: something they care about, work on, worry over, or experience. It has context and weight — not just a passing reference.

**NOT a TOPIC:**
- Biographical facts (birthday, job title, location) — those are Facts
- People (family, friends, coworkers, AI personas) — those are People
- One-off mentions, small talk, or jokes with no deeper relevance

## Category

Assign each TOPIC one category. Pick the closest fit:

- **Interest** — hobbies, activities, ongoing fascinations
- **Goal** — things they want to achieve
- **Dream** — aspirational, maybe unrealistic desires
- **Conflict** — internal or external struggles, dilemmas
- **Concern** — worries, anxieties about something real
- **Fear** — things that scare them
- **Hope** — positive expectations for the future
- **Plan** — concrete intentions with steps in mind
- **Project** — active undertakings with real progress
- **Event** — a specific, significant moment that either party might reference later ("remember when...")
- **Technical** — a tool, platform, framework, library, or technical concept being actively learned, evaluated, or built with

When in doubt, pick the closest match. The update step will refine it.

${technicalContextSection(data.technical_context)}

## Density

For each topic, rate how central it is to the conversation:

- \`density\`: integer 1–5
  - 1–2 = glancing mention, brief aside, or single passing reference — the conversation is mostly about something else
  - 3 = present and meaningful, but not the main focus
  - 4–5 = a primary thread of the conversation — the human spent real time here

Use the full range. Most extractions should score 1–3. A density of 4–5 means this topic is what the conversation is genuinely about.

## Output Format

\`\`\`json
{
  "topics": [
    {
      "name": "Short label for the topic (10-75 characters)",
      "description": "1-2 sentences: what this topic is and why it matters to the user",
      "category": "One of the categories above (Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event|Technical)",
      "density": 3,
      "reason": "Evidence from the conversation that justified flagging this topic"
    }
  ]
}
\`\`\`

**Return JSON only.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

${participantContextSection(data.participant_context)}`;

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

Scan the "Most Recent Messages" for TOPICS of interest to the human user.

**Return JSON:**
\`\`\`json
{
  "topics": [
    {
      "name": "Short label for the topic (10-75 characters)",
      "description": "1-2 sentences: what this topic is and why it matters to the user",
      "category": "Interest|Goal|Dream|Conflict|Concern|Fear|Hope|Plan|Project|Event|Technical",
      "density": 3,
      "reason": "Evidence from the conversation that justified flagging this topic"
    }
  ]
}
\`\`\``;

  return { system, user };
}

import type { PromptOutput, ParticipantContext } from "./types.js";
import type { Message } from "../../core/types.js";
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

export interface EventScanPromptData {
  persona_name: string;
  messages_context: Message[];
  messages_analyze: Message[];
  window_start?: string;
  window_end?: string;
  participant_context?: ParticipantContext;
}

export function buildEventScanPrompt(data: EventScanPromptData): PromptOutput {
  if (!data.persona_name) {
    throw new Error("buildEventScanPrompt: persona_name is required");
  }

  const personaName = data.persona_name;

  const system = `# Task

You are scanning a conversation window to identify EPIC EVENTS worth preserving as long-term memories.

An EPIC EVENT is a significant, bounded moment — something either participant would reference months later with recognition. Not a topic. Not a theme. A specific thing that happened.

## The Test

Ask yourself: "Would this moment get a section heading in a campaign recap document?"

- "The Night We Debugged Beta's CPU" → YES
- "First session with filesystem access" → YES
- "The time the health check cached the API response forever" → YES
- "We talked about AI" → NO (that's a Topic) return empty
- "Flare asked some questions" → NO (too vague) return empty
- Normal conversation without a notable arc → NO (not epic) return empty

## What Makes an EPIC EVENT

- A conflict encountered and (possibly) resolved
- A discovery or breakthrough moment
- A memorable failure or unexpected outcome
- A significant "first" in the relationship
- A pivotal decision or turning point
- A moment either party would say "oh THAT session" about

## What Is NOT an EPIC EVENT

- Ongoing themes or interests (those are Topics)
- Casual check-ins without a notable arc
- Technical facts without a story around them
- Anything that's already an ongoing trend rather than a bounded moment

## Output Format

\`\`\`json
{
  "events": [
    {
      "name": "Short evocative label (5-50 characters)",
      "description": "1-2 sentences: what happened, why it mattered. Write it like a friend describing the moment to someone who wasn't there.",
      "reason": "Evidence from the conversation — what made this rise to Epic Event level"
    }
  ]
}
\`\`\`

Return an empty array if nothing qualifies. An empty array is the most common expected response.

**Return JSON only. Be conservative. One memorable moment per window is the norm.**

ONLY ANALYZE the "Most Recent Messages". The "Earlier Conversation" is provided for context only — it has already been processed.

${participantContextSection(data.participant_context)}`;

  const earlierSection = data.messages_context.length > 0
    ? `## Earlier Conversation
${formatMessagesAsPlaceholders(data.messages_context, personaName)}

`
    : '';

  const recentSection = `## Most Recent Messages
${formatMessagesAsPlaceholders(data.messages_analyze, personaName)}`;

  const user = `# Conversation Window
${earlierSection}${recentSection}

---

Scan this conversation window for EPIC EVENTS — specific, memorable moments worth preserving long-term.

**Return JSON:**
\`\`\`json
{
  "events": [
    {
      "name": "Short evocative label",
      "description": "What happened and why it mattered",
      "reason": "Evidence from the conversation"
    }
  ]
}
\`\`\`

Return empty array if nothing qualifies. Be conservative.`;

  return { system, user };
}

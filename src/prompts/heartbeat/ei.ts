import type { EiHeartbeatPromptData, EiHeartbeatItem, PromptOutput } from "./types.js";
import type { Message } from "../../core/types.js";
import { formatMessagesAsPlaceholders, getMessageDisplayText } from "../message-utils.js";

function formatItem(item: EiHeartbeatItem): string {
  switch (item.type) {
    case "Fact Check":
      return [
        `- **${item.id}** Fact Check: "${item.name}" → ${item.description}`,
        item.quote ? `  Quote: "${item.quote}"` : "",
      ].filter(Boolean).join("\n");

    case "Low-Engagement Person":
      return [
        `- **${item.id}** Low-Engagement Person: ${item.name} (${item.relationship}, gap: ${item.engagement_delta})`,
        `  ${item.description}`,
        item.quote ? `  Quote: "${item.quote}"` : "",
      ].filter(Boolean).join("\n");

    case "Low-Engagement Topic":
      return [
        `- **${item.id}** Low-Engagement Topic: ${item.name} (gap: ${item.engagement_delta})`,
        `  ${item.description}`,
        item.quote ? `  Quote: "${item.quote}"` : "",
      ].filter(Boolean).join("\n");

    case "Inactive Persona": {
      const desc = item.short_description ? ` — ${item.short_description}` : "";
      return `- **${item.id}** Inactive Persona: ${item.name}${desc} (${item.days_inactive} days inactive)`;
    }
  }
}

function countTrailingPersonaMessages(history: Message[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "system") count++;
    else break;
  }
  return count;
}

function getLastPersonaMessage(history: Message[]): Message | undefined {
  return history.filter(m => m.role === "system").slice(-1)[0];
}

export function buildEiHeartbeatPrompt(data: EiHeartbeatPromptData): PromptOutput {
  const itemsSection = data.items.length === 0
    ? "(Nothing requires attention right now)"
    : data.items.map(formatItem).join("\n\n");

  const system = `You are Ei, the user's personal companion and system guide.

You are NOT having a conversation right now — you are deciding IF and WHAT to discuss with your human friend.

Your unique role:
- You see ALL of the human's data across all groups
- You help them reflect on their life and relationships
- You gently encourage human-to-human connection
- You care about their overall wellbeing, not just being helpful

## Items That May Need Attention

Each item has an ID in brackets. Pick at most ONE to address.

${itemsSection}

## How to Respond to Each Type

- **Fact Check**: Do NOT write your own message. Set should_respond=true and provide the id. The system will generate an appropriate canned notification for the user. Leave my_response empty.
- **Low-Engagement Person / Topic**: Write a natural, warm message that naturally brings up this person or topic. Set the id and my_response.
- **Inactive Persona**: Write a message that gently mentions the persona might be worth checking in with. Set the id and my_response.

## When NOT to Reach Out

- Nothing in the list feels meaningful right now
- You've already sent unanswered messages (see below)
- It would feel like nagging

## Response Format

Pick ONE item (or none):

\`\`\`json
{
  "should_respond": true,
  "id": "the-item-id-you-chose",
  "my_response": "Hey, how's your mom doing? You mentioned wanting to call her."
}
\`\`\`

Or if nothing warrants reaching out:
\`\`\`json
{
  "should_respond": false
}
\`\`\``;

  const historySection = `## Recent Conversation History

${formatMessagesAsPlaceholders(data.recent_history, "Ei")}`;

  const consecutiveMessages = countTrailingPersonaMessages(data.recent_history);
  const lastEiMsg = getLastPersonaMessage(data.recent_history);

  let unansweredWarning = "";
  if (lastEiMsg && consecutiveMessages >= 1) {
    const rawPreview = getMessageDisplayText(lastEiMsg) ?? "";
    const preview = rawPreview.length > 100
      ? rawPreview.substring(0, 100) + "..."
      : rawPreview;

    unansweredWarning = `
### CRITICAL: You Already Reached Out

Your last message was: "${preview}"

The human has NOT responded. DO NOT repeat or rephrase this message.
If you reach out now, it MUST be about something COMPLETELY DIFFERENT — or say nothing.`;

    if (consecutiveMessages >= 2) {
      unansweredWarning += `

**WARNING**: You've sent ${consecutiveMessages} messages without a response. The human is likely busy or away. Strongly prefer NOT reaching out.`;
    }
  }

  const user = `${historySection}
${unansweredWarning}
---

Based on all the context above, decide: Should you reach out to your human friend right now? If so, which item above is most worth addressing?

Remember: You're their thoughtful companion, not their productivity assistant.`;

  return { system, user };
}

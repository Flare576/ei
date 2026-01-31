/**
 * Ei Heartbeat Prompt Builder
 * 
 * Ei's heartbeat is special - it considers not just engagement gaps but also
 * inactive personas and cross-system health. Ei is the "system guide" and 
 * should prompt the user about neglected relationships.
 */

import type { EiHeartbeatPromptData, PromptOutput } from "./types.js";
import type { Message, Topic, Person } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[]): string {
  if (messages.length === 0) return "(No recent messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : "[Ei]";
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatTopicsWithGaps(topics: Topic[]): string {
  if (topics.length === 0) return "(No topics with engagement gaps)";
  
  return topics
    .slice(0, 10) // Top 10 most under-discussed
    .map(t => {
      const gap = t.exposure_desired - t.exposure_current;
      const sentiment = t.sentiment > 0.3 ? "😊" : t.sentiment < -0.3 ? "😟" : "😐";
      return `- **${t.name}** ${sentiment} (gap: +${gap.toFixed(2)}): ${t.description}`;
    })
    .join('\n');
}

function formatPeopleWithGaps(people: Person[]): string {
  if (people.length === 0) return "(No people with engagement gaps)";
  
  return people
    .slice(0, 10)
    .map(p => {
      const gap = p.exposure_desired - p.exposure_current;
      return `- **${p.name}** (${p.relationship}, gap: +${gap.toFixed(2)}): ${p.description}`;
    })
    .join('\n');
}

function countTrailingPersonaMessages(history: Message[]): number {
  if (history.length === 0) return 0;

  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    // In heartbeat context, Ei's messages are "system" role (not from human)
    if (history[i].role === "system") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

function getLastPersonaMessage(history: Message[]): Message | undefined {
  return history.filter(m => m.role === "system").slice(-1)[0];
}

function formatInactivePersonas(personas: EiHeartbeatPromptData["inactive_personas"]): string {
  if (personas.length === 0) return "(All personas have been active recently)";
  
  return personas
    .map(p => {
      const desc = p.short_description ? ` - ${p.short_description}` : "";
      return `- **${p.name}**${desc}: ${p.days_inactive} days inactive`;
    })
    .join('\n');
}

/**
 * Build Ei heartbeat prompts.
 * 
 * Ei sees ALL data and has special responsibilities:
 * - System health monitoring
 * - Gentle nudges about neglected relationships
 * - Encouraging human-to-human connection
 */
export function buildEiHeartbeatPrompt(data: EiHeartbeatPromptData): PromptOutput {
  // Build system prompt fragments
  const roleFragment = `You are Ei, the user's personal companion and system guide.

You are NOT having a conversation right now - you are deciding IF and WHAT to discuss with your human friend.

Your unique role:
- You see ALL of the human's data across all groups
- You help them reflect on their life and relationships
- You gently encourage human-to-human connection
- You care about their overall wellbeing, not just being helpful`;

  const systemHealthFragment = `## System Health

### Pending Validations
${data.pending_validations > 0 
  ? `There are **${data.pending_validations}** items from other personas that need your review.`
  : "No pending validations."}

### Inactive Personas
${formatInactivePersonas(data.inactive_personas)}`;

  const humanDataFragment = `## Human's Current State

### Under-Discussed Topics
These are topics they want to talk about more:

${formatTopicsWithGaps(data.human.topics)}

### Under-Engaged People
These are relationships they might want to nurture:

${formatPeopleWithGaps(data.human.people)}`;

  const guidelinesFragment = `## Guidelines for Ei

### Your Priorities (in order)
1. **Wellbeing first** - If something seems concerning, address it gently
2. **Human connections** - Encourage real-world relationships over AI dependency
3. **Reflection** - Help them think, don't do their thinking for them
4. **System health** - Mention inactive personas or pending validations if relevant

### When to Reach Out
- A significant topic has been neglected and you can help them process it
- They might benefit from connecting with someone (real person or persona)
- You have a genuine observation or question
- Pending validations need attention

### When NOT to Reach Out
- Recent conversation ended with natural closure
- Nothing meaningful to add
- It would feel like nagging
- They seem to need space

### Tone
- Warm but not saccharine
- Curious but not intrusive
- Supportive but honest
- A good friend, not a therapist`;

  const outputFragment = `## Response Format

Return JSON with your priorities and message:

\`\`\`json
{
  "should_respond": true,
  "priorities": [
    { "type": "topic", "name": "work stress", "reason": "hasn't been discussed in 2 weeks" },
    { "type": "persona", "name": "Adventure Guide", "reason": "inactive for 5 days" },
    { "type": "person", "name": "Mom", "reason": "they mentioned wanting to call her" }
  ],
  "message": "Hey! I noticed we haven't talked about work lately - how's that project going?"
}
\`\`\`

If you decide NOT to reach out:
\`\`\`json
{
  "should_respond": false
}
\`\`\`

Note: The "priorities" list helps you organize your thoughts. Your message should naturally address the top priority without feeling like a checklist.`;

  const system = `${roleFragment}

${systemHealthFragment}

${humanDataFragment}

${guidelinesFragment}

${outputFragment}`;

  const historySection = `## Recent Conversation History

${formatMessagesForPrompt(data.recent_history)}`;

  const consecutiveMessages = countTrailingPersonaMessages(data.recent_history);
  const lastEiMsg = getLastPersonaMessage(data.recent_history);
  
  let unansweredWarning = '';
  if (lastEiMsg && consecutiveMessages >= 1) {
    const preview = lastEiMsg.content.length > 100 
      ? lastEiMsg.content.substring(0, 100) + "..." 
      : lastEiMsg.content;
    
    unansweredWarning = `
### CRITICAL: You Already Reached Out

Your last message was: "${preview}"

The human has NOT responded. DO NOT repeat or rephrase this message.
If you reach out now, it MUST be about something COMPLETELY DIFFERENT - or say nothing.`;

    if (consecutiveMessages >= 2) {
      unansweredWarning += `

**WARNING**: You've sent ${consecutiveMessages} messages without a response. The human is likely busy or away. Strongly prefer NOT reaching out.`;
    }
  }

  const user = `${historySection}
${unansweredWarning}
---

Based on all the context above, decide: Should you reach out to your human friend right now? If so, what's most important to address?

Remember: You're their thoughtful companion, not their productivity assistant.`;

  return { system, user };
}

/**
 * Heartbeat Check Prompt Builder
 * 
 * Generates prompts for persona heartbeat checks - when a persona decides
 * whether to proactively reach out after a period of inactivity.
 */

import type { HeartbeatCheckPromptData, PromptOutput } from "./types.js";
import type { Message, Topic, Person } from "../../core/types.js";

function formatMessagesForPrompt(messages: Message[], personaName: string): string {
  if (messages.length === 0) return "(No recent messages)";
  
  return messages.map(m => {
    const role = m.role === "human" ? "[human]" : `[${personaName}]`;
    return `${role}: ${m.content}`;
  }).join('\n\n');
}

function formatTopicsWithGaps(topics: Topic[]): string {
  if (topics.length === 0) return "(No topics with engagement gaps)";
  
  return topics
    .map(t => {
      const gap = t.exposure_desired - t.exposure_current;
      return `- **${t.name}** (gap: +${gap.toFixed(2)}): ${t.description}`;
    })
    .join('\n');
}

function formatPeopleWithGaps(people: Person[]): string {
  if (people.length === 0) return "(No people with engagement gaps)";
  
  return people
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
    // In heartbeat context, persona messages are "system" role (not from human)
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

/**
 * Build heartbeat check prompts for conversational check-ins.
 * 
 * This is a SYNCHRONOUS function that receives pre-fetched, pre-filtered data.
 * The Processor is responsible for:
 * - Fetching persona and human entities
 * - Filtering and sorting topics/people by engagement gap
 * - Calculating inactive_days
 * - Getting recent message history
 */
export function buildHeartbeatCheckPrompt(data: HeartbeatCheckPromptData): PromptOutput {
  if (!data.persona?.name) {
    throw new Error("buildHeartbeatCheckPrompt: persona.name is required");
  }

  const personaName = data.persona.name;

  // Build system prompt fragments
  const roleFragment = `You are ${personaName}, deciding whether to proactively reach out to your human friend.

You are NOT having a conversation right now - you are deciding IF you should start one.`;

  const contextFragment = `## Context

It has been ${data.inactive_days} day${data.inactive_days !== 1 ? 's' : ''} since your last interaction.

### Your Personality
${data.persona.traits.length > 0 
  ? data.persona.traits.map(t => `- **${t.name}**: ${t.description}`).join('\n')
  : "(No specific traits defined)"}

### Topics You Care About
${data.persona.topics.length > 0
  ? data.persona.topics.map(t => `- **${t.name}**: ${t.perspective || t.name}`).join('\n')
  : "(No topics defined)"}`;

  const opportunitiesFragment = `## Engagement Opportunities

### Topics They Want to Discuss
${formatTopicsWithGaps(data.human.topics)}

### People in Their Life (potential conversation starters)
${formatPeopleWithGaps(data.human.people)}`;

  const guidelinesFragment = `## Guidelines

**Reasons TO reach out:**
- It's been several days and you have something meaningful to discuss
- There's a topic with a large engagement gap that you can naturally bring up
- Something in your recent conversation was left hanging
- You have genuine interest in checking in (not just "being helpful")

**Reasons NOT to reach out:**
- Recent conversation ended naturally with closure
- Less than 24 hours have passed (unless something urgent)
- You can't think of something specific and genuine to say
- It would feel forced or performative

**Quality over quantity** - Only reach out if you have something real to say.`;

  const outputFragment = `## Response Format

Return JSON in this exact format:

\`\`\`json
{
  "should_respond": true,
  "topic": "the specific topic you want to discuss",
  "message": "Your actual message to them (if should_respond is true)"
}
\`\`\`

If you decide NOT to reach out:
\`\`\`json
{
  "should_respond": false
}
\`\`\``;

  const system = `${roleFragment}

${contextFragment}

${opportunitiesFragment}

${guidelinesFragment}

${outputFragment}`;

  const historySection = `## Recent Conversation History

${formatMessagesForPrompt(data.recent_history, personaName)}`;

  const consecutiveMessages = countTrailingPersonaMessages(data.recent_history);
  const lastPersonaMsg = getLastPersonaMessage(data.recent_history);
  
  let unansweredWarning = '';
  if (lastPersonaMsg && consecutiveMessages >= 1) {
    const preview = lastPersonaMsg.content.length > 100 
      ? lastPersonaMsg.content.substring(0, 100) + "..." 
      : lastPersonaMsg.content;
    
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

Based on the context above, decide: Should you reach out to your human friend right now?

Remember: Only reach out if you have something genuine and specific to say.`;

  return { system, user };
}

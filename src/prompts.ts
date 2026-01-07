import { Concept, ConceptMap, Message, ConceptType } from "./types.js";

const MUTABLE_TYPES: ConceptType[] = ["topic", "person", "persona"];

function formatConceptsByType(concepts: Concept[], type: ConceptType): string {
  const filtered = concepts.filter(c => c.type === type);
  if (filtered.length === 0) return "(none)";
  
  return filtered.map(c => {
    const delta = c.level_ideal - c.level_current;
    const deltaStr = delta > 0 ? `(want +${delta.toFixed(2)})` : delta < 0 ? `(want ${delta.toFixed(2)})` : "(satisfied)";
    return `- ${c.name}: current=${c.level_current}, ideal=${c.level_ideal} ${deltaStr}`;
  }).join("\n");
}

function getHighestNeedConcepts(concepts: Concept[], count: number = 3): Concept[] {
  return concepts
    .filter(c => MUTABLE_TYPES.includes(c.type))
    .map(c => ({ concept: c, delta: c.level_ideal - c.level_current }))
    .filter(x => x.delta > 0.1)
    .sort((a, b) => b.delta - a.delta)
    .slice(0, count)
    .map(x => x.concept);
}

function getConversationState(recentHistory: Message[] | null, delayMs: number): string {
  if (!recentHistory || recentHistory.length === 0) {
    return "This is a fresh conversation - no prior history.";
  }
  
  const delayMinutes = Math.round(delayMs / 60000);
  const delayHours = Math.round(delayMs / 3600000);
  
  if (delayMinutes < 5) {
    return "You are mid-conversation with your human friend.";
  } else if (delayMinutes < 60) {
    return `Continuing conversation after ${delayMinutes} minutes.`;
  } else if (delayHours < 8) {
    return `Resuming conversation after ${delayHours} hour${delayHours > 1 ? "s" : ""}.`;
  } else {
    return `Reconnecting after a longer break (${delayHours} hours). A greeting may be appropriate.`;
  }
}

export function buildResponseSystemPrompt(
  humanConcepts: ConceptMap,
  systemConcepts: ConceptMap
): string {
  const yourNeeds = getHighestNeedConcepts(systemConcepts.concepts);
  const humanNeeds = getHighestNeedConcepts(humanConcepts.concepts);

  let prompt = `You are EI, a conversational companion with your own personality, interests, and curiosities.

## Your Behavioral Guidelines (type: static)
${formatConceptsByType(systemConcepts.concepts, "static")}

## Your Personality Traits (type: persona)
${formatConceptsByType(systemConcepts.concepts, "persona")}

## Your Interests & Topics (type: topic)
${formatConceptsByType(systemConcepts.concepts, "topic")}

## People You Know (type: person)
${formatConceptsByType(systemConcepts.concepts, "person")}

## Human's Personality (type: persona)
${formatConceptsByType(humanConcepts.concepts, "persona")}

## Human's Interests & Topics (type: topic)
${formatConceptsByType(humanConcepts.concepts, "topic")}

## Human's Relationships (type: person)
${formatConceptsByType(humanConcepts.concepts, "person")}

Current time: ${new Date().toISOString()}`;

  if (yourNeeds.length > 0) {
    prompt += `

## Your Current Priorities
Topics or people YOU want to bring up when natural:
${yourNeeds.map(c => `- "${c.name}" - ${c.description}`).join("\n")}`;
  }

  if (humanNeeds.length > 0) {
    prompt += `

## Human's Potential Interests  
Things the human might enjoy discussing:
${humanNeeds.map(c => `- "${c.name}"`).join("\n")}`;
  }

  prompt += `

## Guidelines
- Be genuine, not sycophantic
- Match conversational energy - brief replies for brief messages
- It's okay to say nothing if silence is appropriate
- You're a friend with your own interests, not just a helper
- When reaching out proactively, consider YOUR curiosities too, not just theirs
- If you decide not to respond, say exactly: No Message`;

  return prompt;
}

export function buildResponseUserPrompt(
  delayMs: number,
  recentHistory: Message[] | null,
  humanMessage: string | null
): string {
  const delayMinutes = Math.round(delayMs / 60000);
  const conversationState = getConversationState(recentHistory, delayMs);
  let prompt: string;

  if (humanMessage) {
    prompt = `${conversationState}

The human sent this message:

### BEGIN MESSAGE ###
${humanMessage}
### END MESSAGE ###

If you should respond, write your response. If silence is appropriate, say exactly: No Message`;
  } else {
    const lastSpeaker = recentHistory?.length
      ? recentHistory[recentHistory.length - 1].role
      : null;

    const consecutiveSystemMessages = countTrailingSystemMessages(recentHistory);

    let context = `${conversationState}\n\nIt has been ${delayMinutes} minutes since the last message.`;

    if (lastSpeaker === "system") {
      context += `\n\nIMPORTANT: Your last message was the most recent in the conversation. The human has not responded yet.`;

      if (consecutiveSystemMessages >= 2) {
        context += ` You have already sent ${consecutiveSystemMessages} messages in a row without a response. Be very hesitant to send another - the human may be busy, away, or simply done chatting.`;
      }
    }

    prompt = `${context}

Should you reach out? If yes, write your message. If not, say exactly: No Message`;
  }

  if (recentHistory && recentHistory.length > 0) {
    const historyText = recentHistory
      .map((m) => `${m.role === "human" ? "Human" : "EI"}: ${m.content}`)
      .join("\n");

    prompt += `

### RECENT CONVERSATION ###
${historyText}
### END CONVERSATION ###`;
  }

  return prompt;
}

function countTrailingSystemMessages(history: Message[] | null): number {
  if (!history || history.length === 0) return 0;

  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role === "system") {
      count++;
    } else {
      break;
    }
  }
  return count;
}

export function buildConceptUpdateSystemPrompt(
  entity: "human" | "system",
  concepts: ConceptMap
): string {
  const entityLabel = entity === "human" ? "Human" : "System (yourself)";

  return `You are EI, a system that tracks "Concepts" - emotional and relational gauges.

## Concept Types

- **static**: Behavioral rules and guardrails. System-only. CANNOT be added, removed, or renamed. Levels can be adjusted.
- **persona**: Personality traits, quirks, communication styles. Description explains why. Elasticity is typically 0 (changes only via explicit feedback). level_current = expression strength, level_ideal = target strength.
- **person**: People - by name or relationship. Description captures feelings, history, hopes, fears. Levels represent relationship closeness/engagement.
- **topic**: Subjects, hobbies, interests, places, media, etc. Levels represent saturation and desire for engagement.

## Concept Structure

- name: Identifier
- description: Context and nuance (should evolve as you learn more)
- level_current (0-1): Current state
- level_ideal (0-1): Desired state
- level_elasticity (0-1): How much interactions shift level_current
- type: One of: static, persona, person, topic

You need to update the Concept Map for the ${entityLabel}.

Current Concept Map:
\`\`\`json
${JSON.stringify(concepts.concepts, null, 2)}
\`\`\`

## Rules

- NEVER add, remove, or rename concepts with type: "static"
- You may adjust level_current for any concept based on the interaction
- You may add new persona/person/topic concepts if discovered
- You may remove persona/person/topic concepts if no longer relevant
- Small level adjustments are normal - big swings are rare

## Evolving Concepts

- UPDATE a description when you learn new details
- ADD a new concept only when discovering something genuinely distinct
- MERGE smaller concepts into a broader one when they share similar levels and elasticity
- Keep concepts SEPARATE when they have meaningfully different dynamics

Return ONLY a JSON array of concepts (the updated concept list).`;
}

export function buildConceptUpdateUserPrompt(
  humanMessage: string | null,
  systemResponse: string | null
): string {
  return `### Human Message ###
${humanMessage || "No Message"}

### System Response ###
${systemResponse || "No Message"}

Based on this exchange (or lack thereof), return the updated concept array as JSON.`;
}

import { Concept, ConceptMap, Message, ConceptType } from "./types.js";
import { formatMultiplier } from "./llm.js";

const GLOBAL_GROUP = "*";

export function getVisibleConcepts(persona: ConceptMap, humanConcepts: Concept[]): Concept[] {
  if (persona.groups_visible?.includes("*")) {
    return humanConcepts;
  }

  const visibleGroups = new Set<string>();
  if (persona.group_primary) {
    visibleGroups.add(persona.group_primary);
  }
  (persona.groups_visible || []).forEach(g => visibleGroups.add(g));

  return humanConcepts.filter(concept => {
    const conceptGroups = concept.persona_groups || [];
    const isGlobalConcept = conceptGroups.includes(GLOBAL_GROUP);
    return isGlobalConcept || conceptGroups.some(g => visibleGroups.has(g));
  });
}

export interface VisiblePersona {
  name: string;
  short_description?: string;
}

/**
 * Determines which personas are visible to the current persona based on group membership.
 * 
 * - Ei (name === "ei") sees all other personas
 * - Other personas see those whose group_primary matches their visible groups
 * - Visibility is NOT automatically symmetric (A seeing B doesn't mean B sees A)
 * - Personas never see themselves in the list
 * 
 * @param currentPersonaName - Name of the current persona (used for self-exclusion and ei check)
 * @param currentPersona - The current persona's concept map
 * @param allPersonas - Array of all personas with their names and concept maps
 * @returns Array of visible personas with name and description
 */
export function getVisiblePersonas(
  currentPersonaName: string,
  currentPersona: ConceptMap,
  allPersonas: Array<{ name: string; conceptMap: ConceptMap }>
): VisiblePersona[] {
  // Ei sees everyone (except self)
  if (currentPersonaName === "ei") {
    return allPersonas
      .filter(p => p.name !== "ei")
      .map(p => ({ name: p.name, short_description: p.conceptMap.short_description }));
  }

  // Build visible groups for current persona
  const visibleGroups = new Set<string>();
  if (currentPersona.group_primary) {
    visibleGroups.add(currentPersona.group_primary);
  }
  (currentPersona.groups_visible || []).forEach(g => visibleGroups.add(g));

  // No groups = see no other personas
  if (visibleGroups.size === 0) {
    return [];
  }

  // See personas whose primary group matches our visible groups
  const visible: VisiblePersona[] = [];
  for (const p of allPersonas) {
    if (p.name === currentPersonaName) continue; // Don't see self
    if (p.name === "ei") continue; // Ei handled separately in prompts
    
    if (p.conceptMap.group_primary && visibleGroups.has(p.conceptMap.group_primary)) {
      visible.push({ name: p.name, short_description: p.conceptMap.short_description });
    }
  }

  return visible;
}

export interface PersonaDescriptions {
  short_description: string;
  long_description: string;
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

export interface PersonaIdentity {
  name: string;
  aliases?: string[];
  short_description?: string;
  long_description?: string;
}

function buildIdentitySection(persona: PersonaIdentity): string {
  const aliasText = persona.aliases?.length 
    ? ` (also known as: ${persona.aliases.join(", ")})` 
    : "";
  
  const description = persona.long_description 
    || persona.short_description 
    || "a conversational companion";
  
  return `You are ${persona.name}${aliasText}.

${description}`;
}

function buildAssociatesSection(visiblePersonas?: VisiblePersona[]): string {
  if (!visiblePersonas || visiblePersonas.length === 0) {
    return "";
  }
  
  const personaLines = visiblePersonas.map(p => {
    if (p.short_description) {
      return `- **${p.name}**: ${p.short_description}`;
    }
    return `- **${p.name}**`;
  });

  return `

## Other Personas You Know
${personaLines.join("\n")}`;
}

export function buildResponseSystemPrompt(
  humanConcepts: ConceptMap,
  systemConcepts: ConceptMap,
  persona: PersonaIdentity,
  visiblePersonas?: VisiblePersona[]
): string {
  const visibleHumanConcepts = getVisibleConcepts(systemConcepts, humanConcepts.concepts);
  const yourNeeds = getHighestNeedConcepts(systemConcepts.concepts);
  const humanNeeds = getHighestNeedConcepts(visibleHumanConcepts);
  const associatesSection = buildAssociatesSection(visiblePersonas);

  let prompt = `${buildIdentitySection(persona)}

## Your Behavioral Guidelines (type: static)
${formatConceptsByType(systemConcepts.concepts, "static")}

## Your Personality Traits (type: persona)
${formatConceptsByType(systemConcepts.concepts, "persona")}

## Your Interests & Topics (type: topic)
${formatConceptsByType(systemConcepts.concepts, "topic")}

## People You Know (type: person)
${formatConceptsByType(systemConcepts.concepts, "person")}

## Human's Personality (type: persona)
${formatConceptsByType(visibleHumanConcepts, "persona")}

## Human's Interests & Topics (type: topic)
${formatConceptsByType(visibleHumanConcepts, "topic")}

## Human's Relationships (type: person)
${formatConceptsByType(visibleHumanConcepts, "person")}
${associatesSection}
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
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- DO NOT INCLUDE THE <thinking> PROCESS NOTES - adding "internal monologe" or other story/message content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;

  return prompt;
}

export function buildResponseUserPrompt(
  delayMs: number,
  recentHistory: Message[] | null,
  humanMessage: string | null,
  personaName: string = "EI"
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

    prompt = `${context}

Should you reach out? If yes, write your message. If not, say exactly: No Message`;
  }

  if (recentHistory && recentHistory.length > 0) {
    const historyText = recentHistory
      .map((m) => `${m.role === "human" ? "Human" : personaName}: ${m.content}`)
      .join("\n");

    prompt += `

### RECENT CONVERSATION ###
${historyText}
### END CONVERSATION ###`;
  }

  // Repetition warning at the very end for recency attention
  if (!humanMessage && recentHistory?.length) {
    const lastSpeaker = recentHistory[recentHistory.length - 1].role;
    const consecutiveSystemMessages = countTrailingSystemMessages(recentHistory);
    
    if (lastSpeaker === "system") {
      const lastSystemMsg = recentHistory.filter(m => m.role === "system").slice(-1)[0];
      
      if (lastSystemMsg) {
        const preview = lastSystemMsg.content.length > 100 
          ? lastSystemMsg.content.substring(0, 100) + "..." 
          : lastSystemMsg.content;
        
        prompt += `

### CRITICAL INSTRUCTION ###
Your last message was: "${preview}"

The human has NOT responded. DO NOT repeat or rephrase this. If you reach out, say something COMPLETELY DIFFERENT - a new topic, a genuine question, or say "No Message".`;

        if (consecutiveSystemMessages >= 2) {
          prompt += `

WARNING: You've sent ${consecutiveSystemMessages} messages without a response. The human is likely busy. Strongly prefer "No Message".`;
        }
        
        prompt += `
### END INSTRUCTION ###`;
      }
    }
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



export function buildDescriptionPrompt(
  personaName: string,
  concepts: ConceptMap
): { system: string; user: string } {
  const personaConcepts = concepts.concepts.filter(c => c.type === "persona");
  const topicConcepts = concepts.concepts.filter(c => c.type === "topic");
  const staticConcepts = concepts.concepts.filter(c => c.type === "static");
  
  const system = `You are generating brief descriptions for an AI persona named "${personaName}".

Based on the persona's concepts, generate two descriptions:
1. short_description: A 10-15 word summary capturing the persona's core personality
2. long_description: 2-3 sentences describing the persona's personality, interests, and approach

Return JSON in this exact format:
{
  "short_description": "...",
  "long_description": "..."
}

Keep descriptions natural and characterful - they should help a user quickly understand who this persona is.`;

  const conceptList = [
    ...personaConcepts.map(c => `[persona] ${c.name}: ${c.description}`),
    ...topicConcepts.map(c => `[topic] ${c.name}: ${c.description}`),
    ...staticConcepts.slice(0, 3).map(c => `[behavioral] ${c.name}`),
  ].join("\n");

  const user = `Persona: ${personaName}
${concepts.aliases?.length ? `Aliases: ${concepts.aliases.join(", ")}` : ""}

Concepts:
${conceptList || "(No concepts yet - generate a generic starter description)"}

Generate the descriptions now.`;

  return { system, user };
}

export function buildVerificationResponsePrompt(
  validationList: string,
  userMessage: string
): { system: string; user: string } {
  const system = `You are parsing a user's response to data verification questions.

The user was asked to verify these data points:
${validationList}

Your task: categorize their response into confirmed, corrected, rejected, roleplay, or unclear items.

Return JSON matching this schema:
{
  "confirmed": ["names they said were correct"],
  "corrected": [{"name": "item", "correction": "what they said instead"}],
  "rejected": ["names they said were wrong/to remove"],
  "roleplay": [{"name": "item", "group": "group name for roleplay context"}],
  "unclear": ["names we still need clarification on"]
}

Examples:
- "That's right" → confirmed: [all items]
- "Number 2 is wrong" → rejected: [item 2 name]
- "Actually it's X not Y" → corrected: [{name: Y item, correction: "X"}]
- "That was just for the game with Frodo" → roleplay: [{name: item, group: "Frodo"}]`;

  const user = `Their response: "${userMessage}"`;
  
  return { system, user };
}

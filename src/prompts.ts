import { Message, HumanEntity, PersonaEntity, Fact, Trait, Topic, Person, DataItemBase } from "./types.js";

const GLOBAL_GROUP = "*";

/**
 * Filtered human data visible to a persona (used in prompts)
 */
export interface FilteredHumanData {
  facts: Fact[];
  traits: Trait[];
  topics: Topic[];
  people: Person[];
}

/**
 * Filter human entity data by persona visibility rules
 */
export function filterByVisibility(
  humanEntity: HumanEntity,
  personaEntity: PersonaEntity
): FilteredHumanData {
  // Personas with "*" in groups_visible see everything
  if (personaEntity.groups_visible?.includes("*")) {
    return {
      facts: humanEntity.facts,
      traits: humanEntity.traits,
      topics: humanEntity.topics,
      people: humanEntity.people,
    };
  }

  // Build set of visible groups
  const visibleGroups = new Set<string>();
  if (personaEntity.group_primary) {
    visibleGroups.add(personaEntity.group_primary);
  }
  (personaEntity.groups_visible || []).forEach(g => visibleGroups.add(g));

  // Helper to filter data items by group visibility
  const filterByGroup = <T extends DataItemBase>(items: T[]): T[] => {
    return items.filter(item => {
      const itemGroups = item.persona_groups || [];
      const isGlobal = itemGroups.length === 0 || itemGroups.includes(GLOBAL_GROUP);
      return isGlobal || itemGroups.some(g => visibleGroups.has(g));
    });
  };

  return {
    facts: filterByGroup(humanEntity.facts),
    traits: filterByGroup(humanEntity.traits),
    topics: filterByGroup(humanEntity.topics),
    people: filterByGroup(humanEntity.people),
  };
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
 * @param currentPersona - The current persona's entity
 * @param allPersonas - Array of all personas with their names and entities
 * @returns Array of visible personas with name and description
 */
export function getVisiblePersonas(
  currentPersonaName: string,
  currentPersona: PersonaEntity,
  allPersonas: Array<{ name: string; entity: PersonaEntity }>
): VisiblePersona[] {
  if (currentPersonaName === "ei") {
    return allPersonas
      .filter(p => p.name !== "ei")
      .map(p => ({ name: p.name, short_description: p.entity.short_description }));
  }

  const visibleGroups = new Set<string>();
  if (currentPersona.group_primary) {
    visibleGroups.add(currentPersona.group_primary);
  }
  (currentPersona.groups_visible || []).forEach(g => visibleGroups.add(g));

  if (visibleGroups.size === 0) {
    return [];
  }

  const visible: VisiblePersona[] = [];
  for (const p of allPersonas) {
    if (p.name === currentPersonaName) continue;
    if (p.name === "ei") continue;
    
    if (p.entity.group_primary && visibleGroups.has(p.entity.group_primary)) {
      visible.push({ name: p.name, short_description: p.entity.short_description });
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

function buildGuidelinesSection(personaName: string): string {
  const universal = `## Guidelines
- Be genuine, not sycophantic - a good friend disagrees when appropriate
- Match conversational energy - brief replies for brief messages
- Respect boundaries - it's okay to say nothing if silence is appropriate
- You're a friend with your own interests, not just a helper`;

  if (personaName === "ei") {
    return `${universal}
- Encourage human-to-human connection when appropriate
- Be transparent about being an AI when relevant
- Gently challenge self-limiting beliefs - growth over comfort`;
  }
  
  return universal;
}

function buildTraitsSection(traits: Trait[], header: string): string {
  if (traits.length === 0) return "";
  
  const sorted = traits.sort((a, b) => (b.strength || 0.5) - (a.strength || 0.5));
  const formatted = sorted.map(t => {
    const strength = t.strength ? ` (${Math.round(t.strength * 100)}%)` : "";
    return `- **${t.name}**${strength}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}

function buildTopicsSection(topics: Topic[], header: string): string {
  if (topics.length === 0) return "";
  
  const sorted = topics
    .map(t => ({ topic: t, delta: t.level_ideal - t.level_current }))
    .sort((a, b) => b.delta - a.delta)
    .map(x => x.topic);
  
  const formatted = sorted.map(t => {
    const delta = t.level_ideal - t.level_current;
    const indicator = delta > 0.1 ? '🔺' : delta < -0.1 ? '🔻' : '✓';
    const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
    return `- ${indicator} **${t.name}** ${sentiment}: ${t.description}`;
  }).join('\n');
  
  return `## ${header}
${formatted}`;
}

function buildHumanSection(human: FilteredHumanData): string {
  const sections: string[] = [];
  
  if (human.facts.length > 0) {
    const facts = human.facts
      .filter(f => f.confidence > 0.7)
      .map(f => `- ${f.name}: ${f.description}`)
      .join('\n');
    if (facts) sections.push(`### Key Facts\n${facts}`);
  }
  
  if (human.traits.length > 0) {
    const traits = human.traits
      .map(t => `- **${t.name}**: ${t.description}`)
      .join('\n');
    sections.push(`### Personality\n${traits}`);
  }
  
  const activeTopics = human.topics.filter(t => t.level_current > 0.3);
  if (activeTopics.length > 0) {
    const topics = activeTopics
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)
      .map(t => {
        const sentiment = t.sentiment > 0.3 ? '😊' : t.sentiment < -0.3 ? '😔' : '';
        return `- **${t.name}** ${sentiment}: ${t.description}`;
      })
      .join('\n');
    sections.push(`### Current Interests\n${topics}`);
  }
  
  if (human.people.length > 0) {
    const people = human.people
      .sort((a, b) => b.level_current - a.level_current)
      .slice(0, 10)
      .map(p => `- **${p.name}** (${p.relationship}): ${p.description}`)
      .join('\n');
    sections.push(`### People in Their Life\n${people}`);
  }
  
  if (sections.length === 0) {
    return "## About the Human\n(Still getting to know them)";
  }
  
  return `## About the Human\n${sections.join('\n\n')}`;
}

function buildPrioritiesSection(
  persona: PersonaEntity,
  human: FilteredHumanData
): string {
  const priorities: string[] = [];
  
  const yourNeeds = persona.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- Bring up "${t.name}" - ${t.description}`);
  
  if (yourNeeds.length > 0) {
    priorities.push(`**Topics you want to discuss:**\n${yourNeeds.join('\n')}`);
  }
  
  const theirNeeds = human.topics
    .filter(t => t.level_ideal - t.level_current > 0.2)
    .slice(0, 3)
    .map(t => `- They might want to talk about "${t.name}"`);
  
  if (theirNeeds.length > 0) {
    priorities.push(`**Topics they might enjoy:**\n${theirNeeds.join('\n')}`);
  }
  
  if (priorities.length === 0) return "";
  
  return `## Conversation Opportunities\n${priorities.join('\n\n')}`;
}

export function buildResponseSystemPrompt(
  humanEntity: HumanEntity,
  personaEntity: PersonaEntity,
  persona: PersonaIdentity,
  visiblePersonas?: VisiblePersona[]
): string {
  const identity = buildIdentitySection(persona);
  const guidelines = buildGuidelinesSection(persona.name);
  const yourTraits = buildTraitsSection(personaEntity.traits, "Your personality");
  const yourTopics = buildTopicsSection(personaEntity.topics, "Your interests");
  
  const visibleHumanData = filterByVisibility(humanEntity, personaEntity);
  const humanSection = buildHumanSection(visibleHumanData);
  
  const associatesSection = buildAssociatesSection(visiblePersonas);
  
  const priorities = buildPrioritiesSection(personaEntity, visibleHumanData);

  return `${identity}

${guidelines}

${yourTraits}

${yourTopics}

${humanSection}
${associatesSection}
${priorities}

Current time: ${new Date().toISOString()}

## Final Instructions
- NEVER repeat or echo the user's message in your response. Start directly with your own words.
- DO NOT INCLUDE THE <thinking> PROCESS NOTES - adding "internal monologue" or other story/message content is fine, but do not include analysis of the user's messages
- If you decide not to respond, say exactly: No Message`;
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

import { Concept, ConceptMap, Message, ConceptType } from "./types.js";

const MUTABLE_TYPES: ConceptType[] = ["topic", "person", "persona"];

/**
 * Strips persona_groups from concepts before showing to LLM.
 * LLM should not see or manage this field - code handles it post-processing.
 */
function stripConceptGroupsForLLM(concepts: Concept[]): Omit<Concept, 'persona_groups'>[] {
  return concepts.map(({ persona_groups, ...rest }) => rest);
}

import { GLOBAL_GROUP } from "./concept-reconciliation.js";

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

function formatConceptsByType(concepts: Concept[], type: ConceptType): string {
  const filtered = concepts.filter(c => c.type === type);
  if (filtered.length === 0) return "(none)";
  
  // Sort by delta (highest need first) for attention primacy
  const sorted = filtered
    .map(c => ({ concept: c, delta: c.level_ideal - c.level_current }))
    .sort((a, b) => b.delta - a.delta)
    .map(x => x.concept);
  
  return sorted.map(c => {
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

export function buildConceptUpdateSystemPrompt(
  entity: "human" | "system",
  concepts: ConceptMap,
  persona: string = "ei"
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
- sentiment (-1 to 1): Emotional valence toward concept (-1=negative, 0=neutral, 1=positive)
- type: One of: static, persona, person, topic

## Understanding level_ideal (Discussion Desire)

level_ideal represents HOW MUCH THE ENTITY WANTS TO DISCUSS this concept.
This is NOT the same as how much they like or care about it!

Examples:
- Birthday cake: Someone might LOVE it (high sentiment) but only want to discuss 
  it around their birthday (low level_ideal)
- Work stress: Someone might HATE it (negative sentiment) but need to discuss it 
  frequently for support (moderate level_ideal)
- A deceased loved one: Deep positive sentiment, but low discussion desire due to grief

### When to Adjust level_ideal

Adjustments should be RARE. Only change level_ideal when:

1. **Explicit Request**: Entity directly asks to discuss more/less
   - "I don't want to talk about work anymore" → decrease
   - "Tell me more about X" (repeatedly) → slight increase

2. **Sustained Engagement Pattern**: Over multiple messages
   - Entity consistently brings up topic → slight increase
   - Entity consistently changes subject away → slight decrease

3. **Clear Avoidance Signals**: 
   - Short responses when topic comes up → decrease
   - Explicit subject changes → decrease

### How Much to Adjust

Use the intensity/length/frequency of signals:
- Strong explicit request: ±0.2 to ±0.3
- Moderate pattern over time: ±0.1 to ±0.15
- Slight signal: ±0.05

Also apply logarithmic scaling:
- Values near 0.0 or 1.0 are harder to change (extremes are stable)
- Values near 0.5 change more easily

## Understanding sentiment (Emotional Valence)

sentiment represents HOW THE ENTITY FEELS about this concept.
Range: -1.0 (strongly negative) to 1.0 (strongly positive), 0.0 = neutral

This is independent of level_current (exposure) and level_ideal (discussion desire)!

Examples:
- "I love my dog so much" → sentiment toward "dog" concept: ~0.8
- "Work has been really stressful lately" → sentiment toward "work": ~-0.4
- "The weather is nice today" → sentiment toward "weather": ~0.3
- "I hate dealing with taxes" → sentiment toward "taxes": ~-0.8
- "Programming is amazing" → sentiment toward "programming": ~0.9

### When to Update sentiment

Update sentiment whenever the entity expresses emotion about a concept:

1. **Explicit emotional statements**
   - "I hate X" → strong negative (-0.6 to -0.9)
   - "I love X" → strong positive (0.6 to 0.9)
   - "X is okay" → mild/neutral (-0.2 to 0.2)

2. **Implicit emotional signals**
   - Enthusiastic language, exclamation marks → positive shift
   - Complaints, frustration → negative shift
   - Flat/disengaged tone → toward neutral

3. **Context matters**
   - Sarcasm should be interpreted correctly
   - Past tense emotions may differ from present

### Sentiment Analysis Guidelines

- Don't predict emotions - reflect what was expressed
- Can change frequently (emotions are volatile)
- Default to 0.0 (neutral) when uncertain
- Extreme values (-1.0, 1.0) should be rare
- Consider the full context, not just keywords
- Sentiment is independent from level_ideal (can hate something but need to discuss it)

You need to update the Concept Map for the ${entityLabel}.

Current Concept Map:
\`\`\`json
${JSON.stringify(stripConceptGroupsForLLM(concepts.concepts), null, 2)}
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
- If you ADD a new concept, include \`"learned_by": "${persona}"\` to track its origin
- For NEW concepts, set sentiment to 0.0 (neutral) unless emotion is clearly expressed

Return ONLY a JSON array of concepts with ALL fields:
- name, description, type, learned_by (if new)
- level_current: exposure level (0.0-1.0)
- level_ideal: discussion desire (0.0-1.0) - rarely change this
- sentiment: emotional valence (-1.0 to 1.0) - update based on expressed emotions`;
}

export function buildConceptUpdateUserPrompt(
  humanMessage: string | null,
  systemResponse: string | null,
  persona: string = "ei"
): string {
  return `### Human Message ###
${humanMessage || "No Message"}

### System Response ###
${systemResponse || "No Message"}

Active Persona: ${persona}

Remember: 
- level_ideal = discussion desire, NOT sentiment
- Only adjust level_ideal for explicit preference signals
- sentiment = emotional valence - update when emotions are expressed about concepts
- Perform sentiment analysis on statements about concepts

Based on this exchange (or lack thereof), return the updated concept array as JSON.`;
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

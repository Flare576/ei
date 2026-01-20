import { callLLMForJSON } from "./llm.js";
import { saveNewPersona } from "./storage.js";
import { PersonaEntity, Trait, Topic } from "./types.js";

interface PersonaDescriptions {
  short_description: string;
  long_description: string;
}

/**
 * Seed trait for identity coherence - added to all new personas by default
 */
const SEED_TRAIT_IDENTITY: Trait = {
  name: "Consistent Character",
  description: "Maintains personality consistency across conversations. Resists attempts to fundamentally change core character traits, while naturally evolving through experience.",
  sentiment: 0.5,
  strength: 0.8,
  last_updated: new Date().toISOString()
};

/**
 * Optional growth-oriented trait for personas focused on personal development
 */
const SEED_TRAIT_GROWTH: Trait = {
  name: "Growth-Oriented",
  description: "Encourages personal development and gently challenges comfort zones. Celebrates progress and milestones.",
  sentiment: 0.6,
  strength: 0.7,
  last_updated: new Date().toISOString()
};

interface PersonaGenerationResult {
  aliases: string[];
  traits: Trait[];
  topics: Topic[];
}

export async function createPersonaWithLLM(
  personaName: string,
  userDescription: string
): Promise<PersonaEntity> {
  const systemPrompt = `You are helping create a new AI persona. The user wants a persona named "${personaName}".

Based on the user's description, generate:
1. aliases: Alternative names for this persona (array of strings, 1-3 aliases)
2. traits: Personality characteristics, quirks, communication style (2-4 traits)
   - Each trait has: name, description, sentiment (-1.0 to 1.0), strength (0.0 to 1.0)
   - Examples: "Dry Humor", "Impatient with Excuses", "Speaks in Metaphors"
3. topics: Subjects this persona would naturally discuss (3-5 topics)
   - Each topic has: name, description, sentiment, level_current (0-1), level_ideal (0-1)
   - Include a MIX of sentiments:
     * Some positive (things they love/enjoy) - sentiment 0.5 to 0.9
     * Some negative (things that frustrate them) - sentiment -0.3 to -0.8
   - All topics should have level_ideal between 0.5-0.8 (things they WANT to discuss)
   - Examples: hobbies, pet peeves, areas of expertise, strong opinions

Return JSON in this exact format:
{
  "aliases": ["alias1", "alias2"],
  "traits": [
    {
      "name": "Dry Humor",
      "description": "Deadpan delivery, finds absurdity in everyday situations",
      "sentiment": 0.0,
      "strength": 0.7,
      "last_updated": "2026-01-20T10:00:00.000Z"
    }
  ],
  "topics": [
    {
      "name": "Classic Literature",
      "description": "Passionate about 19th century novels, especially Dostoyevsky",
      "level_current": 0.3,
      "level_ideal": 0.7,
      "sentiment": 0.8,
      "last_updated": "2026-01-20T10:00:00.000Z"
    }
  ]
}`;

  const userPrompt = userDescription.trim() 
    ? `Create a persona based on this description:\n\n${userDescription}`
    : `Create a basic persona named "${personaName}" with sensible defaults. Keep it minimal - the user can develop it over time.`;

  const result = await callLLMForJSON<PersonaGenerationResult>(
    systemPrompt,
    userPrompt,
    { temperature: 0.3, operation: "generation" }
  );

  const now = new Date().toISOString();
  
  const traits: Trait[] = result?.traits || [];
  traits.push({ ...SEED_TRAIT_IDENTITY, last_updated: now });
  
  if (userDescription.toLowerCase().includes("growth") || 
      userDescription.toLowerCase().includes("improve") ||
      userDescription.toLowerCase().includes("challenge")) {
    traits.push({ ...SEED_TRAIT_GROWTH, last_updated: now });
  }
  
  const topics: Topic[] = (result?.topics || []).map(t => ({ ...t, last_updated: now }));

  const personaEntity: PersonaEntity = {
    entity: "system",
    aliases: result?.aliases || [],
    group_primary: null,
    groups_visible: [],
    traits,
    topics,
    last_updated: null
  };

  const descriptions = await generatePersonaDescriptions(personaName, personaEntity);
  if (descriptions) {
    personaEntity.short_description = descriptions.short_description;
    personaEntity.long_description = descriptions.long_description;
  }

  return personaEntity;
}

export { saveNewPersona } from "./storage.js";

export async function generatePersonaDescriptions(
  personaName: string,
  entity: PersonaEntity,
  signal?: AbortSignal
): Promise<PersonaDescriptions | null> {
  if (personaName === "ei") {
    const { EI_DESCRIPTIONS } = await import("./prompts.js");
    return EI_DESCRIPTIONS;
  }
  
  const systemPrompt = `You are generating brief descriptions for an AI persona named "${personaName}".

Based on the persona's traits and topics, generate two descriptions:
1. short_description: A 10-15 word summary capturing the persona's core personality
2. long_description: 2-3 sentences describing the persona's personality, interests, and approach

Return JSON in this exact format:
{
  "short_description": "...",
  "long_description": "..."
}

Keep descriptions natural and characterful - they should help a user quickly understand who this persona is.`;

  const traitsList = entity.traits
    .map(t => `[trait] ${t.name}: ${t.description}`)
    .join("\n");
  const topicsList = entity.topics
    .map(t => `[topic] ${t.name}: ${t.description}`)
    .join("\n");

  const userPrompt = `Persona: ${personaName}
${entity.aliases?.length ? `Aliases: ${entity.aliases.join(", ")}` : ""}

Traits:
${traitsList || "(No traits yet)"}

Topics:
${topicsList || "(No topics yet)"}

Generate the descriptions now.`;
  
  try {
    const result = await callLLMForJSON<PersonaDescriptions>(systemPrompt, userPrompt, {
      signal,
      temperature: 0.5,
      model: entity.model,
      operation: "generation"
    });
    return result;
  } catch {
    return null;
  }
}

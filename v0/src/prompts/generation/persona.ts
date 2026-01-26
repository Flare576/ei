import { Trait } from "../../types.js";

export const SEED_TRAIT_IDENTITY: Trait = {
  name: "Consistent Character",
  description: "Maintains personality consistency across conversations. Resists attempts to fundamentally change core character traits, while naturally evolving through experience.",
  sentiment: 0.5,
  strength: 0.8,
  last_updated: new Date().toISOString()
};

export const SEED_TRAIT_GROWTH: Trait = {
  name: "Growth-Oriented",
  description: "Encourages personal development and gently challenges comfort zones. Celebrates progress and milestones.",
  sentiment: 0.6,
  strength: 0.7,
  last_updated: new Date().toISOString()
};

export function buildPersonaGenerationPrompt(personaName: string): { system: string; user: string } {
  const taskFragment = `You are helping create a new AI persona. The user wants a persona named "${personaName}".`;
  
  const outputSpecFragment = `Based on the user's description, generate:
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
   - Examples: hobbies, pet peeves, areas of expertise, strong opinions`;

  const schemaFragment = `Return JSON in this exact format:
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

  const system = `${taskFragment}

${outputSpecFragment}

${schemaFragment}`;

  const user = `Create a basic persona named "${personaName}" with sensible defaults. Keep it minimal - the user can develop it over time.`;
  
  return { system, user };
}

export function buildPersonaGenerationPromptWithDescription(
  personaName: string, 
  userDescription: string
): { system: string; user: string } {
  const { system } = buildPersonaGenerationPrompt(personaName);
  const user = `Create a persona based on this description:

${userDescription}`;
  
  return { system, user };
}

export function buildDescriptionGenerationPrompt(
  personaName: string,
  aliases: string[],
  traitsText: string,
  topicsText: string
): { system: string; user: string } {
  const taskFragment = `You are generating brief descriptions for an AI persona named "${personaName}".`;

  const specificationFragment = `Based on the persona's traits and topics, generate two descriptions:
1. short_description: A 10-15 word summary capturing the persona's core personality
2. long_description: 2-3 sentences describing the persona's personality, interests, and approach`;

  const schemaFragment = `Return JSON in this exact format:
{
  "short_description": "...",
  "long_description": "..."
}`;

  const guidelineFragment = `Keep descriptions natural and characterful - they should help a user quickly understand who this persona is.`;

  const system = `${taskFragment}

${specificationFragment}

${schemaFragment}

${guidelineFragment}`;

  const aliasesFragment = aliases.length ? `Aliases: ${aliases.join(", ")}` : '';

  const traitsFragment = `Traits:
${traitsText || "(No traits yet)"}`;

  const topicsFragment = `Topics:
${topicsText || "(No topics yet)"}`;

  const user = `Persona: ${personaName}
${aliasesFragment}

${traitsFragment}

${topicsFragment}

Generate the descriptions now.`;
  
  return { system, user };
}

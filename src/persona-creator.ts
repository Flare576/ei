import { callLLMForJSON } from "./llm.js";
import { saveNewPersona } from "./storage.js";
import { PersonaEntity, Trait, Topic } from "./types.js";
import { 
  SEED_TRAIT_IDENTITY, 
  SEED_TRAIT_GROWTH,
  buildPersonaGenerationPrompt,
  buildPersonaGenerationPromptWithDescription,
  buildDescriptionGenerationPrompt
} from "./prompts/generation/persona.js";
import { EI_DESCRIPTIONS } from "./prompts/response/ei.js";

interface PersonaDescriptions {
  short_description: string;
  long_description: string;
}

interface PersonaGenerationResult {
  aliases: string[];
  traits: Trait[];
  topics: Topic[];
}

export async function createPersonaWithLLM(
  personaName: string,
  userDescription: string
): Promise<PersonaEntity> {
  const { system: systemPrompt, user: userPrompt } = userDescription.trim()
    ? buildPersonaGenerationPromptWithDescription(personaName, userDescription)
    : buildPersonaGenerationPrompt(personaName);

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
    return EI_DESCRIPTIONS;
  }
  
  const traitsList = entity.traits
    .map(t => `[trait] ${t.name}: ${t.description}`)
    .join("\n");
  const topicsList = entity.topics
    .map(t => `[topic] ${t.name}: ${t.description}`)
    .join("\n");

  const { system: systemPrompt, user: userPrompt } = buildDescriptionGenerationPrompt(
    personaName,
    entity.aliases || [],
    traitsList,
    topicsList
  );
  
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

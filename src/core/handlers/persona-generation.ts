import {
  type LLMResponse,
  type Trait,
  type PersonaTopic,
} from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaGenerationResult, PersonaDescriptionsResult } from "../../prompts/generation/types.js";
import type { TraitResult } from "../../prompts/persona/types.js";
import { orchestratePersonaGeneration, type PartialPersona } from "../orchestrators/index.js";

export function handlePersonaGeneration(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaGeneration] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaGenerationResult | undefined;
  const existingPartial = (response.request.data.partial as PartialPersona) ?? { id: personaId, name: personaDisplayName };

  const now = new Date().toISOString();

  // Merge LLM traits into user-provided traits by name.
  // User-provided fields win; LLM fills in what the user left blank.
  const userTraitsByName = new Map(
    (existingPartial.traits ?? []).filter(t => t.name?.trim()).map(t => [t.name!.toLowerCase().trim(), t])
  );

  const mergedLlmTraits: Trait[] = (result?.traits || []).map(t => {
    const userTrait = userTraitsByName.get(t.name?.toLowerCase().trim() ?? '');
    return {
      id: (userTrait as Trait | undefined)?.id ?? crypto.randomUUID(),
      name: t.name,
      description: userTrait?.description?.trim() || t.description,
      sentiment: userTrait?.sentiment ?? t.sentiment ?? 0,
      strength: userTrait?.strength ?? t.strength,
      last_updated: now,
    };
  });

  // Keep user-provided traits the LLM didn't return
  const llmTraitNames = new Set(mergedLlmTraits.map(t => t.name?.toLowerCase().trim()));
  const preservedUserTraits: Trait[] = (existingPartial.traits ?? [])
    .filter(t => t.name?.trim() && !llmTraitNames.has(t.name.toLowerCase().trim()))
    .map(t => ({
      id: (t as Trait).id ?? crypto.randomUUID(),
      name: t.name!,
      description: t.description || '',
      sentiment: t.sentiment ?? 0,
      strength: t.strength,
      last_updated: now,
    }));

  const mergedTraits: Trait[] = mergedLlmTraits.length > 0
    ? [...mergedLlmTraits, ...preservedUserTraits]
    : (existingPartial.traits as Trait[] | undefined) ?? [];

  // Merge LLM topics into user-provided topics by name.
  // User-provided fields win; LLM fills in what the user left blank.
  const userTopicsByName = new Map(
    (existingPartial.topics ?? []).filter(t => t.name?.trim()).map(t => [t.name!.toLowerCase().trim(), t])
  );

  const llmTopics: PersonaTopic[] = (result?.topics || []).map(t => {
    const userTopic = userTopicsByName.get(t.name?.toLowerCase().trim() ?? '');
    return {
      id: (userTopic as PersonaTopic | undefined)?.id ?? crypto.randomUUID(),
      name: t.name,
      perspective: userTopic?.perspective?.trim() || t.perspective || '',
      approach: userTopic?.approach?.trim() || t.approach || '',
      personal_stake: userTopic?.personal_stake?.trim() || t.personal_stake || '',
      sentiment: userTopic?.sentiment ?? t.sentiment ?? 0,
      exposure_current: userTopic?.exposure_current ?? t.exposure_current ?? 0.5,
      exposure_desired: userTopic?.exposure_desired ?? t.exposure_desired ?? 0.5,
      last_updated: now,
    };
  });

  // Keep user-provided topics the LLM didn't return (not in its output list)
  const llmTopicNames = new Set(llmTopics.map(t => t.name?.toLowerCase().trim()));
  const preservedUserTopics: PersonaTopic[] = (existingPartial.topics ?? [])
    .filter(t => t.name?.trim() && !llmTopicNames.has(t.name.toLowerCase().trim()))
    .map(t => ({
      id: (t as PersonaTopic).id ?? crypto.randomUUID(),
      name: t.name!,
      perspective: t.perspective || '',
      approach: t.approach || '',
      personal_stake: t.personal_stake || '',
      sentiment: t.sentiment ?? 0,
      exposure_current: t.exposure_current ?? 0.5,
      exposure_desired: t.exposure_desired ?? 0.5,
      last_updated: now,
    }));

  const topics: PersonaTopic[] = llmTopics.length > 0
    ? [...llmTopics, ...preservedUserTopics]
    : (existingPartial.topics as PersonaTopic[] | undefined) ?? [];

  const updatedPartial: PartialPersona = {
    ...existingPartial,
    short_description: result?.short_description ?? existingPartial.short_description,
    long_description: existingPartial.long_description ?? result?.long_description,
    traits: mergedTraits.length > 0 ? mergedTraits : existingPartial.traits,
    topics,
  };

  orchestratePersonaGeneration(updatedPartial, state);
  console.log(`[handlePersonaGeneration] Orchestrated: ${personaDisplayName}`);
}

export function handlePersonaDescriptions(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaDescriptions] No personaId in request data");
    return;
  }

  const result = response.parsed as PersonaDescriptionsResult | undefined;
  if (!result) {
    console.error("[handlePersonaDescriptions] No parsed result");
    return;
  }

  if (result.no_change) {
    console.log(`[handlePersonaDescriptions] No change needed for ${personaDisplayName}`);
    return;
  }

  state.persona_update(personaId, {
    short_description: result.short_description,
    long_description: result.long_description,
    last_updated: new Date().toISOString(),
  });
  console.log(`[handlePersonaDescriptions] Updated descriptions for ${personaDisplayName}`);
}

export function handlePersonaTraitExtraction(response: LLMResponse, state: StateManager): void {
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  if (!personaId) {
    console.error("[handlePersonaTraitExtraction] No personaId in request data");
    return;
  }

  const result = response.parsed as TraitResult[] | undefined;
  if (!result || !Array.isArray(result)) {
    console.error("[handlePersonaTraitExtraction] Invalid parsed result");
    return;
  }

  const now = new Date().toISOString();
  const traits: Trait[] = result.map(t => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength,
    last_updated: now,
  }));

  state.persona_update(personaId, { traits, last_updated: now });
  console.log(`[handlePersonaTraitExtraction] Updated ${traits.length} traits for ${personaDisplayName}`);
}

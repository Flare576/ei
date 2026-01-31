import { LLMRequestType, LLMPriority, LLMNextStep, type Trait, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { buildPersonaGenerationPrompt } from "../../prompts/index.js";

const MAX_ORCHESTRATOR_LOOPS = 4;

export interface PartialPersona {
  name: string;
  aliases?: string[];
  description?: string;
  short_description?: string;
  long_description?: string;
  traits?: Partial<Trait>[];
  topics?: Partial<Topic>[];
  model?: string;
  group_primary?: string;
  groups_visible?: string[];
  loop_counter?: number;
  step?: "description" | "traits" | "topics";
}

export function orchestratePersonaGeneration(
  partial: PartialPersona,
  stateManager: StateManager,
  onComplete?: () => void
): void {
  const loopCounter = (partial.loop_counter ?? 0) + 1;

  if (loopCounter > MAX_ORCHESTRATOR_LOOPS) {
    console.error(`[orchestratePersonaGeneration] Max loops (${MAX_ORCHESTRATOR_LOOPS}) exceeded for ${partial.name}`);
    return;
  }

  const needsShortDescription = !partial.short_description;
  const traitCount = partial.traits?.filter(t => t.name?.trim()).length ?? 0;
  const topicCount = partial.topics?.filter(t => t.name?.trim()).length ?? 0;
  const needsMoreTraits = traitCount < 3;
  const needsMoreTopics = topicCount < 3;

  if (needsShortDescription || needsMoreTraits || needsMoreTopics) {
    const prompt = buildPersonaGenerationPrompt({
      name: partial.name,
      long_description: partial.long_description,
      short_description: partial.short_description,
      existing_traits: partial.traits,
      existing_topics: partial.topics,
    });

    stateManager.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.High,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandlePersonaGeneration,
      data: {
        personaName: partial.name,
        partial: { ...partial, loop_counter: loopCounter },
      },
    });
    return;
  }

  const now = new Date().toISOString();
  stateManager.persona_update(partial.name, {
    short_description: partial.short_description,
    long_description: partial.long_description,
    traits: partial.traits as Trait[],
    topics: partial.topics as Topic[],
    last_updated: now,
  });

  console.log(`[orchestratePersonaGeneration] Completed: ${partial.name}`);
  onComplete?.();
}

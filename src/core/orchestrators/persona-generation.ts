import { LLMRequestType, LLMPriority, LLMNextStep, type Trait, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { buildPersonaGenerationPrompt } from "../../prompts/index.js";

const MAX_ORCHESTRATOR_LOOPS = 4;

export interface PartialPersona {
  name: string;
  description?: string;
  short_description?: string;
  long_description?: string;
  traits?: Trait[];
  topics?: Topic[];
  model?: string;
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

  const needsDescription = !partial.short_description && !partial.long_description;
  const needsTraits = !partial.traits || partial.traits.length === 0;
  const needsTopics = !partial.topics || partial.topics.length === 0;

  if (needsDescription || needsTraits || needsTopics) {
    const prompt = buildPersonaGenerationPrompt({
      name: partial.name,
      description: partial.description ?? partial.short_description ?? "",
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
    traits: partial.traits,
    topics: partial.topics,
    last_updated: now,
  });

  console.log(`[orchestratePersonaGeneration] Completed: ${partial.name}`);
  onComplete?.();
}

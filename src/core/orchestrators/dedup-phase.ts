import { StateManager } from "../state-manager.js";
import { LLMRequestType, LLMPriority, LLMNextStep, type DataItemBase } from "../types.js";
import { buildUserDedupPrompt } from "../../prompts/ceremony/user-dedup.js";

type DedupableItem = DataItemBase & { relationship?: string };

// =============================================================================
// USER-TRIGGERED DEDUP
// =============================================================================

export function queueUserDedupRequest(
  state: StateManager,
  itemType: "topic" | "person",
  entityIds: string[]
): void {
  const human = state.getHuman();

  const collection = (itemType === "topic" ? human.topics : human.people) as DedupableItem[];
  const entities = entityIds
    .map(id => collection.find(item => item.id === id))
    .filter((item): item is DedupableItem => item !== undefined);

  if (entities.length < 2) {
    console.warn("[UserDedup] Need at least 2 entities to merge");
    return;
  }

  const prompt = buildUserDedupPrompt({
    cluster: entities,
    itemType,
    similarityRange: { min: 1.0, max: 1.0 },
  });

  const model = human.settings?.rewrite_model ?? undefined;

  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.High,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleDedupCurate,
    ...(model ? { model } : {}),
    data: {
      entity_type: itemType,
      entity_ids: entityIds,
    },
  });

  console.log(`[UserDedup] Queued merge of ${entities.length} ${itemType} entities`);
}

import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  type LLMRequest,
  type QueueStatus,
} from "./types.js";
import { StateManager } from "./state-manager.js";
import { QueueProcessor } from "./queue-processor.js";

export async function abortCurrentOperation(sm: StateManager, qp: QueueProcessor): Promise<void> {
  sm.queue_pause();
  qp.abort();
}

export async function resumeQueue(sm: StateManager): Promise<void> {
  sm.queue_resume();
}

export async function getQueueStatus(sm: StateManager): Promise<QueueStatus> {
  return {
    state: sm.queue_isPaused()
      ? "paused"
      : sm.queue_hasProcessingItem()
      ? "busy"
      : "idle",
    pending_count: sm.queue_length(),
    dlq_count: sm.queue_dlqLength(),
  };
}

export function pauseQueue(sm: StateManager, qp: QueueProcessor): void {
  sm.queue_pause();
  qp.abort();
}

export function getQueueActiveItems(sm: StateManager): LLMRequest[] {
  return sm.queue_getAllActiveItems();
}

export function getDLQItems(sm: StateManager): LLMRequest[] {
  return sm.queue_getDLQItems();
}

export function updateQueueItem(
  sm: StateManager,
  id: string,
  updates: Partial<LLMRequest>
): boolean {
  return sm.queue_updateItem(id, updates);
}

export async function clearQueue(sm: StateManager, qp: QueueProcessor): Promise<number> {
  qp.abort();
  return sm.queue_clear();
}

export async function submitOneShot(
  sm: StateManager,
  getOneshotModel: () => string | undefined,
  guid: string,
  systemPrompt: string,
  userPrompt: string
): Promise<void> {
  sm.queue_enqueue({
    type: LLMRequestType.Raw,
    priority: LLMPriority.High,
    system: systemPrompt,
    user: userPrompt,
    next_step: LLMNextStep.HandleOneShot,
    model: getOneshotModel(),
    data: { guid },
  });
}

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
  const activeItems = sm.queue_getAllActiveItems();
  const segmentationItems = activeItems.filter(
    r => r.next_step === LLMNextStep.HandleDocumentSegmentation
  );

  const batchMap = new Map<string, { filename: string; count: number }>();
  for (const item of segmentationItems) {
    const { batchId, filename } = item.data as { batchId: string; filename: string };
    if (!batchId || !filename) continue;
    const existing = batchMap.get(batchId);
    if (existing) {
      existing.count++;
    } else {
      batchMap.set(batchId, { filename, count: 1 });
    }
  }

  const pending_documents = batchMap.size > 0
    ? Array.from(batchMap.entries()).map(([batchId, { filename, count }]) => ({ batchId, filename, count }))
    : undefined;

  const extractingSet = new Set<string>();
  for (const item of activeItems) {
    const sources = item.data.sources as string[] | undefined;
    if (!Array.isArray(sources)) continue;
    for (const s of sources) {
      if (typeof s === "string" && s.startsWith("import:document:")) {
        extractingSet.add(s.slice("import:document:".length));
      }
    }
  }
  const extracting_documents = extractingSet.size > 0 ? Array.from(extractingSet) : undefined;

  const generatingSet: string[] = [];
  for (const item of activeItems) {
    if (item.next_step === LLMNextStep.HandleKnowledgeSynthesis) {
      const slug = (item.data as { slug?: string }).slug;
      if (slug) generatingSet.push(slug);
    }
  }
  const generating_documents = generatingSet.length > 0 ? generatingSet : undefined;

  return {
    state: sm.queue_isPaused()
      ? "paused"
      : sm.queue_hasProcessingItem()
      ? "busy"
      : "idle",
    pending_count: sm.queue_length(),
    dlq_count: sm.queue_dlqLength(),
    embedding_warning: sm.embedding_getWarning() || undefined,
    pending_documents,
    extracting_documents,
    generating_documents,
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

export function deleteQueueItems(sm: StateManager, ids: string[]): number {
  return sm.queue_deleteItems(ids);
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

export async function submitOneShotJSON(
  sm: StateManager,
  getOneshotModel: () => string | undefined,
  guid: string,
  systemPrompt: string,
  userPrompt: string
): Promise<void> {
  sm.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.High,
    system: systemPrompt,
    user: userPrompt,
    next_step: LLMNextStep.HandleOneShotJSON,
    model: getOneshotModel(),
    data: { guid },
  });
}

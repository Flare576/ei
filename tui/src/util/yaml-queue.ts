import YAML from "yaml";
import type { LLMRequest, LLMRequestState, LLMPriority, ProviderAccount } from "../../../src/core/types.js";
import { modelGuidToDisplay, displayToModelGuid } from "./yaml-shared.js";

interface EditableQueueItem {
  id: string;
  state: LLMRequestState;
  created_at: string;
  attempts: number;
  last_attempt?: string;
  retry_after?: string;
  type?: string;
  priority?: LLMPriority;
  next_step?: string;
  model?: string;
  data?: Record<string, unknown>;
  _delete?: boolean;
}

export function queueItemsToYAML(items: LLMRequest[], accounts: ProviderAccount[]): string {
  const data: EditableQueueItem[] = items.map(item => ({
    id: item.id,
    _delete: false,
    state: item.state,
    created_at: item.created_at,
    attempts: item.attempts,
    last_attempt: item.last_attempt,
    retry_after: item.retry_after,
    type: item.type,
    priority: item.priority,
    next_step: item.next_step,
    model: item.model ? modelGuidToDisplay(item.model, accounts) : undefined,
    data: item.data,
  }));
  return YAML.stringify(data, { lineWidth: 0 });
}

export interface QueueItemUpdate {
  id: string;
  state: LLMRequestState;
  attempts: number;
  model?: string;
  priority?: LLMPriority;
  data?: Record<string, unknown>;
}

export interface QueueItemsYAMLResult {
  updates: QueueItemUpdate[];
  deletedIds: string[];
}

export function queueItemsFromYAML(yamlContent: string, accounts: ProviderAccount[]): QueueItemsYAMLResult {
  const data = YAML.parse(yamlContent) as EditableQueueItem[];
  if (!Array.isArray(data)) throw new Error("Expected a YAML array of queue items");

  const deletedIds: string[] = [];
  const updates: QueueItemUpdate[] = [];

  for (const item of data) {
    if (!item.id) throw new Error(`Queue item missing 'id' field`);
    if (item._delete) {
      deletedIds.push(item.id);
      continue;
    }
    if (!item.state) throw new Error(`Queue item ${item.id} missing 'state' field`);
    const validStates: LLMRequestState[] = ["pending", "processing", "dlq"];
    if (!validStates.includes(item.state)) {
      throw new Error(`Queue item ${item.id} has invalid state '${item.state}'. Valid: ${validStates.join(", ")}`);
    }
    updates.push({
      id: item.id,
      state: item.state,
      attempts: typeof item.attempts === "number" ? item.attempts : 0,
      model: item.model ? displayToModelGuid(item.model, accounts) ?? item.model : undefined,
      priority: item.priority,
      data: item.data,
    });
  }

  return { updates, deletedIds };
}

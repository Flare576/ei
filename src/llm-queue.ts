/**
 * LLMQueue - Persistent queue for asynchronous LLM operations.
 *
 * This module manages a priority-based queue of LLM tasks (extractions, validations, etc.)
 * that persists to disk and survives application restarts.
 *
 * @module llm-queue
 */

import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import { Message } from "./types.js";
import { getDataPath, appendDebugLog } from "./storage.js";

type QueueOperation<T> = () => Promise<T>;

const queueOperations: QueueOperation<any>[] = [];
let isProcessingQueue = false;

async function withQueueLock<T>(operation: QueueOperation<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    queueOperations.push(async () => {
      try {
        const result = await operation();
        resolve(result);
      } catch (err) {
        reject(err);
      }
    });
    
    processQueueOperations();
  });
}

async function processQueueOperations(): Promise<void> {
  if (isProcessingQueue || queueOperations.length === 0) {
    return;
  }
  
  isProcessingQueue = true;
  
  while (queueOperations.length > 0) {
    const operation = queueOperations.shift();
    if (operation) {
      await operation();
    }
  }
  
  isProcessingQueue = false;
}

// ============================================================================
// Type Definitions
// ============================================================================

export type QueueItemType =
  | "fast_scan"           // Phase 1 extraction
  | "ei_validation"       // Pending Ei verification
  | "description_regen"   // Persona description update
  | "response";           // Conversation response (safety net, shouldn't queue)

export interface FastScanPayload {
  target: "human" | "system";
  persona: string;
  messages: Message[];
  dataTypes: ("fact" | "trait" | "topic" | "person")[];
}

export interface DetailUpdatePayload {
  target: "human" | "system";
  persona: string;
  data_type: "fact" | "trait" | "topic" | "person";
  item_name: string;
  messages: Message[];
  is_new: boolean;
}

export interface EiValidationPayload {
  validation_type: "data_confirm" | "cross_persona" | "conflict" | "staleness";
  item_name: string;
  data_type: "fact" | "trait" | "topic" | "person";
  context: string;
  confidence?: number;       // For data_confirm type
  source_persona?: string;   // For cross_persona type
}

export interface DescriptionRegenPayload {
  persona: string;
}

export type QueuePayload =
  | FastScanPayload
  | DetailUpdatePayload
  | EiValidationPayload
  | DescriptionRegenPayload;

export interface LLMQueueItem {
  id: string;
  type: QueueItemType;
  priority: "high" | "normal" | "low";
  created_at: string;
  attempts: number;
  last_attempt?: string;
  payload: QueuePayload;
}

export interface LLMQueue {
  version: number;
  items: LLMQueueItem[];
  last_processed?: string;
}

// ============================================================================
// Queue File Operations
// ============================================================================

const QUEUE_VERSION = 1;
const QUEUE_FILENAME = "llm_queue.jsonc";

function getQueuePath(): string {
  return path.join(getDataPath(), QUEUE_FILENAME);
}

function generateItemId(): string {
  return `llm_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

function isDebugMode(): boolean {
  return process.argv.includes("--debug") || process.argv.includes("-d");
}

/**
 * Loads the queue from disk. Returns empty queue if file doesn't exist.
 */
async function loadQueue(): Promise<LLMQueue> {
  const queuePath = getQueuePath();
  
  if (!existsSync(queuePath)) {
    return {
      version: QUEUE_VERSION,
      items: [],
    };
  }
  
  try {
    const content = await readFile(queuePath, "utf-8");
    const queue = JSON.parse(content) as LLMQueue;
    
    // Future: Handle version migrations here if needed
    if (queue.version !== QUEUE_VERSION) {
      appendDebugLog(`[LLMQueue] Queue version mismatch (file: ${queue.version}, current: ${QUEUE_VERSION})`);
    }
    
    return queue;
  } catch (err) {
    appendDebugLog(`[LLMQueue] Failed to load queue: ${err}`);
    return {
      version: QUEUE_VERSION,
      items: [],
    };
  }
}

/**
 * Saves the queue to disk.
 */
async function saveQueue(queue: LLMQueue): Promise<void> {
  const queuePath = getQueuePath();
  
  try {
    const content = JSON.stringify(queue, null, 2);
    await writeFile(queuePath, content, "utf-8");
  } catch (err) {
    appendDebugLog(`[LLMQueue] Failed to save queue: ${err}`);
    throw err;
  }
}

// ============================================================================
// Queue Operations
// ============================================================================

/**
 * Adds an item to the queue.
 * 
 * @param item - Item to enqueue (id, created_at, and attempts will be auto-generated)
 * @returns The generated item ID
 */
export async function enqueueItem(
  item: Omit<LLMQueueItem, "id" | "created_at" | "attempts">
): Promise<string> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    
    const fullItem: LLMQueueItem = {
      ...item,
      id: generateItemId(),
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    
    queue.items.push(fullItem);
    await saveQueue(queue);
    
    appendDebugLog(
      `[LLMQueue] Enqueued ${fullItem.type} (priority: ${fullItem.priority}, id: ${fullItem.id}, queue length: ${queue.items.length})`
    );
    
    return fullItem.id;
  });
}

/**
 * Gets the next item to process, respecting priority order.
 * Priority: high → normal → low, then FIFO within priority.
 * 
 * Skips ei_validation items - they're batched in Daily Ceremony, not processed by queue processor.
 * 
 * @returns Next item to process, or null if queue is empty
 */
export async function dequeueItem(): Promise<LLMQueueItem | null> {
  const queue = await loadQueue();
  
  if (queue.items.length === 0) {
    return null;
  }
  
  // Sort by priority (high first), then by created_at (oldest first)
  queue.items.sort((a, b) => {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    if (a.priority !== b.priority) {
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    }
    return a.created_at.localeCompare(b.created_at);
  });
  
  // Skip ei_validation items - they're batched in Daily Ceremony
  const item = queue.items.find(i => i.type !== "ei_validation");
  
  if (!item) {
    return null;
  }
  
  appendDebugLog(
    `[LLMQueue] Dequeued ${item.type} (priority: ${item.priority}, id: ${item.id}, attempts: ${item.attempts})`
  );
  
  return item;
}

/**
 * Marks an item as completed and removes it from the queue.
 * 
 * @param id - Item ID to complete
 */
export async function completeItem(id: string): Promise<void> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    const before = queue.items.length;
    
    queue.items = queue.items.filter((item) => item.id !== id);
    
    if (queue.items.length < before) {
      queue.last_processed = new Date().toISOString();
      await saveQueue(queue);
      appendDebugLog(`[LLMQueue] Completed item ${id}`);
    } else {
      appendDebugLog(`[LLMQueue] Tried to complete non-existent item ${id}`);
    }
  });
}

/**
 * Marks an item as failed. Increments attempt counter.
 * After 3 attempts, moves item to dead letter (logs and drops).
 * 
 * @param id - Item ID that failed
 * @param error - Optional error message for logging
 */
export async function failItem(id: string, error?: string): Promise<void> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    const item = queue.items.find((i) => i.id === id);
    
    if (!item) {
      appendDebugLog(`[LLMQueue] Tried to fail non-existent item ${id}`);
      return;
    }
    
    item.attempts++;
    item.last_attempt = new Date().toISOString();
    
    if (item.attempts >= 3) {
      if (isDebugMode()) {
        const dlqEntry = {
          ...item,
          final_error: error,
          dropped_at: new Date().toISOString(),
        };
        appendDebugLog(`[DLQ] Dropping after 3 attempts: ${JSON.stringify(dlqEntry)}`);
      }
      
      queue.items = queue.items.filter((i) => i.id !== id);
      appendDebugLog(`[LLMQueue] Item ${id} moved to dead letter queue (3 failures)`);
    } else {
      appendDebugLog(
        `[LLMQueue] Item ${id} failed (attempt ${item.attempts}/3)${error ? `: ${error}` : ""}`
      );
    }
    
    await saveQueue(queue);
  });
}

/**
 * Gets the current queue length.
 */
export async function getPendingValidations(): Promise<LLMQueueItem[]> {
  const queue = await loadQueue();
  return queue.items.filter((item) => item.type === "ei_validation");
}

/**
 * Clears completed validations after Ei processes them.
 * 
 * @param ids - Array of item IDs to clear
 */
export async function clearValidations(ids: string[]): Promise<void> {
  return withQueueLock(async () => {
    const queue = await loadQueue();
    const before = queue.items.length;
    
    queue.items = queue.items.filter((item) => !ids.includes(item.id));
    
    if (queue.items.length < before) {
      await saveQueue(queue);
      appendDebugLog(`[LLMQueue] Cleared ${before - queue.items.length} validation(s)`);
    }
  });
}

/**
 * Gets the current queue length.
 */
export async function getQueueLength(): Promise<number> {
  const queue = await loadQueue();
  return queue.items.length;
}

/**
 * Gets all queue items (for inspection/debugging).
 */
export async function getAllItems(): Promise<LLMQueueItem[]> {
  const queue = await loadQueue();
  return queue.items;
}

/**
 * Clears the entire queue (for testing or emergency recovery).
 */
export async function clearQueue(): Promise<void> {
  const queue: LLMQueue = {
    version: QUEUE_VERSION,
    items: [],
  };
  await saveQueue(queue);
  appendDebugLog("[LLMQueue] Queue cleared");
}

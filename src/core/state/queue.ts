import type { LLMRequest, QueueFailResult } from "../types.js";
import { DLQ_MAX_COUNT, DLQ_MAX_AGE_DAYS } from "../types.js";

const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30_000;

function extractHTTPStatus(error: string): number | null {
  const match = error.match(/\((\d{3})\)/);
  return match ? parseInt(match[1], 10) : null;
}

function isPermanentError(error: string): boolean {
  const status = extractHTTPStatus(error);
  if (status !== null) {
    // 4xx are permanent EXCEPT 429 (rate limit) and 408 (request timeout)
    return status >= 400 && status < 500 && status !== 429 && status !== 408;
  }
  // Pattern-based fallback for non-HTTP errors
  return /bad request|invalid api key|unauthorized|forbidden/i.test(error);
}

function calculateBackoff(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * Math.pow(2, attempts - 1), MAX_BACKOFF_MS);
}

export class QueueState {
  private queue: LLMRequest[] = [];
  private paused = false;

  load(queue: LLMRequest[]): void {
    // Reset any items stuck in 'processing' from a previous session
    this.queue = queue.map(r =>
      r.state === "processing" ? { ...r, state: "pending" } : r
    );
  }

  export(): LLMRequest[] {
    return this.queue;
  }

  enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts" | "state">): string {
    const id = crypto.randomUUID();
    const fullRequest: LLMRequest = {
      ...request,
      id,
      created_at: new Date().toISOString(),
      attempts: 0,
      state: "pending",
    };
    this.queue.push(fullRequest);
    return id;
  }

  claimHighest(): LLMRequest | null {
    if (this.paused || this.queue.length === 0) return null;
    const available = this.queue.filter(r => r.state === "pending");
    if (available.length === 0) return null;
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sorted = [...available].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    const item = sorted[0] ?? null;
    if (item) {
      item.state = "processing";
    }
    return item;
  }

  // Returns the retry_after of the highest-priority pending item, or null if ready now.
  // Used by the processor loop to decide whether to sleep instead of claiming.
  nextItemRetryAfter(): string | null {
    if (this.paused || this.queue.length === 0) return null;
    const available = this.queue.filter(r => r.state === "pending");
    if (available.length === 0) return null;
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sorted = [...available].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    return sorted[0]?.retry_after ?? null;
  }

  complete(id: string): void {
    const idx = this.queue.findIndex((r) => r.id === id);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
    }
  }

  fail(id: string, error?: string, permanent?: boolean): QueueFailResult {
    const idx = this.queue.findIndex((r) => r.id === id);
    if (idx < 0) return { dropped: false };
    const request = this.queue[idx];
    request.attempts++;
    request.last_attempt = new Date().toISOString();
    if (error) {
      request.data._lastError = error;
    }

    // No error string and not flagged permanent = just increment, no classification
    // Still reset to pending in case it was claimed (processing state)
    if (!error && !permanent) {
      request.state = "pending";
      return { dropped: false };
    }

    const shouldDrop = permanent || (error ? isPermanentError(error) : false);

    if (shouldDrop) {
      request.state = "dlq";
      return { dropped: true };
    }

    // Transient error — reset to pending with backoff timer
    request.state = "pending";
    const delay = calculateBackoff(request.attempts);
    request.retry_after = new Date(Date.now() + delay).toISOString();
    return { dropped: false, retryDelay: delay };
  }



  clearPersonaResponses(personaId: string, nextStep: string): string[] {
    const removedIds: string[] = [];
    this.queue = this.queue.filter((r) => {
      if (r.state !== "dlq" && r.next_step === nextStep && r.data.personaId === personaId) {
        removedIds.push(r.id);
        return false;
      }
      return true;
    });
    return removedIds;
  }

  length(): number {
    return this.queue.filter(r => r.state === "pending" || r.state === "processing").length;
  }

  dlqLength(): number {
    return this.queue.filter(r => r.state === "dlq").length;
  }

  hasProcessingItem(): boolean {
    return this.queue.some(r => r.state === "processing");
  }

  getDLQItems(): LLMRequest[] {
    return this.queue.filter(r => r.state === "dlq");
  }

  getAllActiveItems(): LLMRequest[] {
    return this.queue.filter(r => r.state !== "dlq");
  }

  updateItem(id: string, updates: Partial<LLMRequest>): boolean {
    const idx = this.queue.findIndex(r => r.id === id);
    if (idx < 0) return false;
    this.queue[idx] = { ...this.queue[idx], ...updates };
    return true;
  }

  trimDLQ(): number {
    const dlqItems = this.queue.filter(r => r.state === "dlq");
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - DLQ_MAX_AGE_DAYS);
    const cutoffISO = cutoff.toISOString();

    // Remove by age first
    const afterAgeTrim = dlqItems.filter(r => r.created_at >= cutoffISO);

    // Then enforce count limit (oldest first)
    const sorted = afterAgeTrim.sort((a, b) => a.created_at.localeCompare(b.created_at));
    const kept = sorted.slice(-DLQ_MAX_COUNT);
    const keptIds = new Set(kept.map(r => r.id));

    const before = this.queue.length;
    this.queue = this.queue.filter(r => r.state !== "dlq" || keptIds.has(r.id));
    return before - this.queue.length;
  }

  pause(): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  isPaused(): boolean {
    return this.paused;
  }

  hasPendingCeremonies(): boolean {
    return this.queue.some(r => r.state !== "dlq" && r.data.ceremony_progress === true);
  }

  clear(): number {
    const count = this.queue.filter(r => r.state !== "dlq").length;
    this.queue = this.queue.filter(r => r.state === "dlq");
    return count;
  }
}

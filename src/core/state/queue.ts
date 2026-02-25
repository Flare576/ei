import type { LLMRequest, QueueFailResult } from "../types.js";

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
    this.queue = queue;
  }

  export(): LLMRequest[] {
    return this.queue;
  }

  enqueue(request: Omit<LLMRequest, "id" | "created_at" | "attempts">): string {
    const id = crypto.randomUUID();
    const fullRequest: LLMRequest = {
      ...request,
      id,
      created_at: new Date().toISOString(),
      attempts: 0,
    };
    this.queue.push(fullRequest);
    return id;
  }

  peekHighest(): LLMRequest | null {
    if (this.paused || this.queue.length === 0) return null;
    const now = new Date().toISOString();
    const available = this.queue.filter(r => !r.retry_after || r.retry_after <= now);
    if (available.length === 0) return null;
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sorted = [...available].sort(
      (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]
    );
    return sorted[0] ?? null;
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
    if (!error && !permanent) {
      return { dropped: false };
    }

    const shouldDrop = permanent || (error ? isPermanentError(error) : false);

    if (shouldDrop) {
      this.queue.splice(idx, 1);
      return { dropped: true };
    }

    // Transient error — apply exponential backoff, never drop
    const delay = calculateBackoff(request.attempts);
    request.retry_after = new Date(Date.now() + delay).toISOString();
    return { dropped: false, retryDelay: delay };
  }



  clearPersonaResponses(personaId: string, nextStep: string): string[] {
    const removedIds: string[] = [];
    this.queue = this.queue.filter((r) => {
      if (r.next_step === nextStep && r.data.personaId === personaId) {
        removedIds.push(r.id);
        return false;
      }
      return true;
    });
    return removedIds;
  }

  length(): number {
    return this.queue.length;
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
    return this.queue.some(r => r.data.ceremony_progress === true);
  }

  clear(): number {
    const count = this.queue.length;
    this.queue = [];
    return count;
  }
}

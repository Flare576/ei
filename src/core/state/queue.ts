import type { LLMRequest, LLMNextStep } from "../types.js";

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

    const priorityOrder = { high: 0, normal: 1, low: 2 };
    const sorted = [...this.queue].sort(
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

  fail(id: string, error?: string): void {
    const request = this.queue.find((r) => r.id === id);
    if (request) {
      request.attempts++;
      request.last_attempt = new Date().toISOString();
      if (error) {
        request.data._lastError = error;
      }
    }
  }

  getValidations(): LLMRequest[] {
    return this.queue.filter(
      (r) => r.next_step === ("handleEiValidation" as LLMNextStep)
    );
  }

  clearValidations(ids: string[]): void {
    const idSet = new Set(ids);
    this.queue = this.queue.filter((r) => !idSet.has(r.id));
  }

  clearPersonaResponses(personaName: string, nextStep: string): string[] {
    const removedIds: string[] = [];
    this.queue = this.queue.filter((r) => {
      if (r.next_step === nextStep && r.data.personaName === personaName) {
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
}

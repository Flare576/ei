import { describe, it, expect, beforeEach } from "vitest";
import { QueueState } from "../../../../src/core/state/index.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../../src/core/types.js";
import type { LLMRequest } from "../../../../src/core/types.js";

describe("QueueState", () => {
  let state: QueueState;

  const makeRequest = (
    priority: "high" | "normal" | "low" = "normal",
    nextStep: LLMNextStep = LLMNextStep.HandlePersonaResponse
  ): Omit<LLMRequest, "id" | "created_at" | "attempts" | "state"> => ({
    type: LLMRequestType.Response,
    priority: priority as LLMPriority,
    system: "System prompt",
    user: "User prompt",
    next_step: nextStep,
    data: {},
  });

  beforeEach(() => {
    state = new QueueState();
  });

  describe("enqueue", () => {
    it("adds request to queue and returns id", () => {
      const id = state.enqueue(makeRequest());
      
      expect(id).toBeDefined();
      expect(typeof id).toBe("string");
      expect(state.length()).toBe(1);
    });

    it("generates unique ids for each request", () => {
      const id1 = state.enqueue(makeRequest());
      const id2 = state.enqueue(makeRequest());
      
      expect(id1).not.toBe(id2);
    });

    it("sets created_at and attempts on enqueue", () => {
      state.enqueue(makeRequest());
      
      const request = state.claimHighest();
      expect(request?.created_at).toBeDefined();
      expect(request?.attempts).toBe(0);
    });
  });

  describe("claimHighest", () => {
    it("returns null when queue is empty", () => {
      expect(state.claimHighest()).toBeNull();
    });

    it("returns high priority before normal", () => {
      state.enqueue(makeRequest("normal"));
      state.enqueue(makeRequest("high"));
      state.enqueue(makeRequest("low"));

      const request = state.claimHighest();
      expect(request?.priority).toBe("high");
    });

    it("returns normal priority before low", () => {
      state.enqueue(makeRequest("low"));
      state.enqueue(makeRequest("normal"));

      const request = state.claimHighest();
      expect(request?.priority).toBe("normal");
    });

    it("returns null when paused", () => {
      state.enqueue(makeRequest());
      state.pause();

      expect(state.claimHighest()).toBeNull();
    });

    it("returns request after resume", () => {
      state.enqueue(makeRequest());
      state.pause();
      state.resume();

      expect(state.claimHighest()).not.toBeNull();
    });

    it("marks claimed item as processing", () => {
      state.enqueue(makeRequest());
      const claimed = state.claimHighest();
      expect(claimed?.state).toBe("processing");
      // Item still in queue (pending count includes processing)
      expect(state.length()).toBe(1);
      // But not claimable again (already processing)
      expect(state.claimHighest()).toBeNull();
    });
  });

  describe("complete", () => {
    it("removes request from queue", () => {
      const id = state.enqueue(makeRequest());
      expect(state.length()).toBe(1);
      
      state.complete(id);
      
      expect(state.length()).toBe(0);
    });

    it("does nothing for non-existent id", () => {
      state.enqueue(makeRequest());
      state.complete("nonexistent");
      
      expect(state.length()).toBe(1);
    });
  });

  describe("fail", () => {
    it("increments attempt count", () => {
      const id = state.enqueue(makeRequest());
      const before = state.export()[0]?.attempts;
      state.fail(id);
      const after = state.export()[0]?.attempts;
      expect(after).toBe((before ?? 0) + 1);
    });
    it("sets last_attempt timestamp", () => {
      const id = state.enqueue(makeRequest());

      state.fail(id);
      expect(state.export()[0]?.last_attempt).toBeDefined();
    });
    it("stores error in data._lastError", () => {
      const id = state.enqueue(makeRequest());

      state.fail(id, "Test error message");

      // Item is in backoff after error, so use export() instead of peekHighest()
      const exported = state.export();
      expect(exported[0]?.data._lastError).toBe("Test error message");
    });

    it("moves permanently-failed items to DLQ instead of dropping", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, "LLM API error (400): bad request");

      expect(result.dropped).toBe(true);
      expect(state.length()).toBe(0);
      expect(state.dlqLength()).toBe(1);
      expect(state.getDLQItems()[0].state).toBe("dlq");
    });

    it("moves 401 auth errors to DLQ", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, "LLM API error (401): unauthorized");

      expect(result.dropped).toBe(true);
      expect(state.length()).toBe(0);
      expect(state.dlqLength()).toBe(1);
    });

    it("does NOT drop 429 rate limit errors", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, 'LLM API error (429): rate limited');

      expect(result.dropped).toBe(false);
      expect(result.retryDelay).toBeGreaterThan(0);
      expect(state.length()).toBe(1);
    });

    it("does NOT drop 529 overloaded errors", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, 'LLM API error (529): overloaded');

      expect(result.dropped).toBe(false);
      expect(result.retryDelay).toBeGreaterThan(0);
      expect(state.length()).toBe(1);
    });

    it("does NOT drop 503 service unavailable errors", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, 'LLM API error (503): service unavailable');

      expect(result.dropped).toBe(false);
      expect(state.length()).toBe(1);
    });

    it("moves to DLQ when permanent flag is true regardless of error type", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, "LLM API error (529): overloaded", true);

      expect(result.dropped).toBe(true);
      expect(state.length()).toBe(0);
      expect(state.dlqLength()).toBe(1);
    });

    it("applies exponential backoff on transient errors", () => {
      const id = state.enqueue(makeRequest());

      const result1 = state.fail(id, 'LLM API error (529): overloaded');
      // attempt 1 = 2s base
      expect(result1.retryDelay).toBe(2000);

      const result2 = state.fail(id, 'LLM API error (529): overloaded');
      // attempt 2 = 4s
      expect(result2.retryDelay).toBe(4000);

      const result3 = state.fail(id, 'LLM API error (529): overloaded');
      // attempt 3 = 8s
      expect(result3.retryDelay).toBe(8000);
    });

    it("caps backoff at 30 seconds", () => {
      const id = state.enqueue(makeRequest());

      // Fail many times to exceed cap
      for (let i = 0; i < 10; i++) {
        state.fail(id, 'LLM API error (529): overloaded');
      }

      const result = state.fail(id, 'LLM API error (529): overloaded');
      expect(result.retryDelay).toBe(30000);
    });

    it("sets retry_after on transient errors (for processor backoff)", () => {
      const id = state.enqueue(makeRequest());

      state.fail(id, 'LLM API error (529): overloaded');

      const exported = state.export();
      expect(exported[0]?.retry_after).toBeDefined();
      expect(new Date(exported[0].retry_after!).getTime()).toBeGreaterThan(Date.now() - 1000);
    });

    it("never moves transient errors to DLQ regardless of attempt count", () => {
      const id = state.enqueue(makeRequest());

      for (let i = 0; i < 20; i++) {
        const result = state.fail(id, "LLM API error (529): overloaded");
        expect(result.dropped).toBe(false);
      }

      expect(state.length()).toBe(1);
      expect(state.dlqLength()).toBe(0);
      expect(state.export()[0].attempts).toBe(20);
    });

    it("moves pattern-based permanent errors to DLQ", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, "invalid api key provided");

      expect(result.dropped).toBe(true);
      expect(state.length()).toBe(0);
      expect(state.dlqLength()).toBe(1);
    });

    it("treats unknown errors as transient (safe default)", () => {
      const id = state.enqueue(makeRequest());

      const result = state.fail(id, 'Something weird happened');

      expect(result.dropped).toBe(false);
      expect(result.retryDelay).toBeGreaterThan(0);
      expect(state.length()).toBe(1);
    });
  });

  describe("claimHighest after failure", () => {
    it("claimHighest does NOT gate on retry_after (processor checks nextItemRetryAfter instead)", () => {
      const id1 = state.enqueue(makeRequest("normal"));
      state.enqueue(makeRequest("low"));

      state.fail(id1, "LLM API error (529): overloaded");

      // claimHighest ignores retry_after — returns highest priority pending item regardless
      const next = state.claimHighest();
      expect(next?.id).toBe(id1);
      expect(next?.priority).toBe("normal");
    });

    it("nextItemRetryAfter returns future timestamp when top item is in backoff", () => {
      const id = state.enqueue(makeRequest());

      state.fail(id, "LLM API error (529): overloaded");

      const retryAfter = state.nextItemRetryAfter();
      expect(retryAfter).toBeDefined();
      expect(new Date(retryAfter!).getTime()).toBeGreaterThan(Date.now());
    });

    it("nextItemRetryAfter returns null when top item has no backoff", () => {
      state.enqueue(makeRequest());

      expect(state.nextItemRetryAfter()).toBeNull();
    });
  });


  describe("pause/resume", () => {
    it("isPaused returns correct state", () => {
      expect(state.isPaused()).toBe(false);
      
      state.pause();
      expect(state.isPaused()).toBe(true);
      
      state.resume();
      expect(state.isPaused()).toBe(false);
    });
  });

  describe("load/export", () => {
    it("exports queue as array", () => {
      state.enqueue(makeRequest());
      state.enqueue(makeRequest());
      
      const exported = state.export();
      
      expect(Array.isArray(exported)).toBe(true);
      expect(exported).toHaveLength(2);
    });

    it("loads queue from array", () => {
      const requests: LLMRequest[] = [
        {
          id: "test-1",
          created_at: new Date().toISOString(),
          attempts: 0,
          state: "pending",
          type: LLMRequestType.Response,
          priority: LLMPriority.Normal,
          system: "Test",
          user: "Test",
          next_step: LLMNextStep.HandlePersonaResponse,
          data: {},
        },
      ];

      state.load(requests);

      expect(state.length()).toBe(1);
      expect(state.claimHighest()?.id).toBe("test-1");
    });
  });

  describe("length", () => {
    it("returns correct count", () => {
      expect(state.length()).toBe(0);
      
      state.enqueue(makeRequest());
      expect(state.length()).toBe(1);
      
      state.enqueue(makeRequest());
      expect(state.length()).toBe(2);
      
      const claimed = state.claimHighest()!;
      state.complete(claimed.id);
      expect(state.length()).toBe(1);
    });
  });

  describe("clearPersonaResponses", () => {
    const makeRequestForPersona = (
      personaId: string,
      nextStep: LLMNextStep = LLMNextStep.HandlePersonaResponse
    ): Omit<LLMRequest, "id" | "created_at" | "attempts" | "state"> => ({
      type: LLMRequestType.Response,
      priority: LLMPriority.Normal,
      system: "System prompt",
      user: "User prompt",
      next_step: nextStep,
      data: { personaId },
    });

    it("removes requests matching personaName and nextStep", () => {
      state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaResponse));
      state.enqueue(makeRequestForPersona("Beta", LLMNextStep.HandlePersonaResponse));
      state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaResponse));

      const removed = state.clearPersonaResponses("Alpha", LLMNextStep.HandlePersonaResponse);

      expect(removed).toHaveLength(2);
      expect(state.length()).toBe(1);
    });

    it("returns empty array when no matches", () => {
      state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaResponse));

      const removed = state.clearPersonaResponses("Beta", LLMNextStep.HandlePersonaResponse);

      expect(removed).toHaveLength(0);
      expect(state.length()).toBe(1);
    });

    it("only removes requests with matching nextStep", () => {
      state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaResponse));
      state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaTraitExtraction));

      const removed = state.clearPersonaResponses("Alpha", LLMNextStep.HandlePersonaResponse);

      expect(removed).toHaveLength(1);
      expect(state.length()).toBe(1);
    });

    it("returns the ids of removed requests", () => {
      const id1 = state.enqueue(makeRequestForPersona("Alpha", LLMNextStep.HandlePersonaResponse));
      state.enqueue(makeRequestForPersona("Beta", LLMNextStep.HandlePersonaResponse));

      const removed = state.clearPersonaResponses("Alpha", LLMNextStep.HandlePersonaResponse);

      expect(removed).toContain(id1);
    });
  });

  describe("DLQ management", () => {
    it("dlqLength returns count of dlq items only", () => {
      state.enqueue(makeRequest());
      const id2 = state.enqueue(makeRequest());
      state.fail(id2, "LLM API error (400): bad request");

      expect(state.length()).toBe(1);
      expect(state.dlqLength()).toBe(1);
    });

    it("getDLQItems returns only dlq items", () => {
      state.enqueue(makeRequest());
      const id2 = state.enqueue(makeRequest());
      state.fail(id2, "LLM API error (400): bad request");

      const dlq = state.getDLQItems();
      expect(dlq).toHaveLength(1);
      expect(dlq[0].state).toBe("dlq");
    });

    it("getAllActiveItems excludes dlq items", () => {
      state.enqueue(makeRequest());
      const id2 = state.enqueue(makeRequest());
      state.fail(id2, "LLM API error (400): bad request");

      const active = state.getAllActiveItems();
      expect(active).toHaveLength(1);
      expect(active[0].state).not.toBe("dlq");
    });

    it("updateItem can recover a DLQ item to pending", () => {
      const id = state.enqueue(makeRequest());
      state.fail(id, "LLM API error (400): bad request");
      expect(state.dlqLength()).toBe(1);

      state.updateItem(id, { state: "pending", attempts: 0 });

      expect(state.dlqLength()).toBe(0);
      expect(state.length()).toBe(1);
      const claimed = state.claimHighest();
      expect(claimed?.id).toBe(id);
      expect(claimed?.attempts).toBe(0);
    });

    it("trimDLQ removes items older than DLQ_MAX_AGE_DAYS", () => {
      const id = state.enqueue(makeRequest());
      state.fail(id, "LLM API error (400): bad request");
      const exported = state.export();
      exported[0].created_at = new Date(Date.now() - 20 * 86_400_000).toISOString();
      state.load(exported);

      const trimmed = state.trimDLQ();
      expect(trimmed).toBe(1);
      expect(state.dlqLength()).toBe(0);
    });

    it("trimDLQ keeps items within age threshold", () => {
      const id = state.enqueue(makeRequest());
      state.fail(id, "LLM API error (400): bad request");

      const trimmed = state.trimDLQ();
      expect(trimmed).toBe(0);
      expect(state.dlqLength()).toBe(1);
    });
  });
});


import { describe, it, expect, beforeEach } from "vitest";
import { QueueState } from "../../../../src/core/state/index.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../../src/core/types.js";
import type { LLMRequest } from "../../../../src/core/types.js";

describe("QueueState", () => {
  let state: QueueState;

  const makeRequest = (
    priority: "high" | "normal" | "low" = "normal",
    nextStep: LLMNextStep = LLMNextStep.HandlePersonaResponse
  ): Omit<LLMRequest, "id" | "created_at" | "attempts"> => ({
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
      
      const request = state.peekHighest();
      expect(request?.created_at).toBeDefined();
      expect(request?.attempts).toBe(0);
    });
  });

  describe("peekHighest", () => {
    it("returns null when queue is empty", () => {
      expect(state.peekHighest()).toBeNull();
    });

    it("returns high priority before normal", () => {
      state.enqueue(makeRequest("normal"));
      state.enqueue(makeRequest("high"));
      state.enqueue(makeRequest("low"));
      
      const request = state.peekHighest();
      expect(request?.priority).toBe("high");
    });

    it("returns normal priority before low", () => {
      state.enqueue(makeRequest("low"));
      state.enqueue(makeRequest("normal"));
      
      const request = state.peekHighest();
      expect(request?.priority).toBe("normal");
    });

    it("returns null when paused", () => {
      state.enqueue(makeRequest());
      state.pause();
      
      expect(state.peekHighest()).toBeNull();
    });

    it("returns request after resume", () => {
      state.enqueue(makeRequest());
      state.pause();
      state.resume();
      
      expect(state.peekHighest()).not.toBeNull();
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
      const before = state.peekHighest()?.attempts;
      
      state.fail(id);
      
      const after = state.peekHighest()?.attempts;
      expect(after).toBe((before ?? 0) + 1);
    });

    it("sets last_attempt timestamp", () => {
      const id = state.enqueue(makeRequest());
      
      state.fail(id);
      
      expect(state.peekHighest()?.last_attempt).toBeDefined();
    });

    it("stores error in data._lastError", () => {
      const id = state.enqueue(makeRequest());
      
      state.fail(id, "Test error message");
      
      expect(state.peekHighest()?.data._lastError).toBe("Test error message");
    });
  });

  describe("validations", () => {
    it("getValidations returns only ei_validation requests", () => {
      state.enqueue(makeRequest("normal", LLMNextStep.HandlePersonaResponse));
      state.enqueue(makeRequest("normal", LLMNextStep.HandleEiValidation));
      state.enqueue(makeRequest("normal", LLMNextStep.HandleHeartbeatCheck));
      
      const validations = state.getValidations();
      
      expect(validations).toHaveLength(1);
      expect(validations[0].next_step).toBe(LLMNextStep.HandleEiValidation);
    });

    it("clearValidations removes specified requests", () => {
      const id1 = state.enqueue(makeRequest("normal", LLMNextStep.HandleEiValidation));
      const id2 = state.enqueue(makeRequest("normal", LLMNextStep.HandleEiValidation));
      state.enqueue(makeRequest("normal", LLMNextStep.HandlePersonaResponse));
      
      state.clearValidations([id1]);
      
      expect(state.length()).toBe(2);
      const validations = state.getValidations();
      expect(validations).toHaveLength(1);
      expect(validations[0].id).toBe(id2);
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
      expect(state.peekHighest()?.id).toBe("test-1");
    });
  });

  describe("length", () => {
    it("returns correct count", () => {
      expect(state.length()).toBe(0);
      
      state.enqueue(makeRequest());
      expect(state.length()).toBe(1);
      
      state.enqueue(makeRequest());
      expect(state.length()).toBe(2);
      
      state.complete(state.peekHighest()!.id);
      expect(state.length()).toBe(1);
    });
  });
});

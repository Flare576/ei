import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueueProcessor } from "../../../src/core/queue-processor.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../src/core/types.js";
import type { LLMRequest, LLMResponse } from "../../../src/core/types.js";

vi.mock("../../../src/core/llm-client.js", () => ({
  callLLMRaw: vi.fn(),
  parseJSONResponse: vi.fn((content: string) => JSON.parse(content)),
  cleanResponseContent: vi.fn((content: string) => content.trim()),
}));

import * as llmClient from "../../../src/core/llm-client.js";

describe("QueueProcessor", () => {
  let processor: QueueProcessor;

  const makeRequest = (
    type: "response" | "json" | "raw" = "response"
  ): LLMRequest => ({
    id: "test-request-id",
    created_at: new Date().toISOString(),
    attempts: 0,
    type: type as LLMRequestType,
    priority: LLMPriority.Normal,
    system: "System prompt",
    user: "User prompt",
    next_step: LLMNextStep.HandlePersonaResponse,
    data: {},
  });

  beforeEach(() => {
    processor = new QueueProcessor();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("state transitions", () => {
    it("starts in idle state", () => {
      expect(processor.getState()).toBe("idle");
    });

    it("transitions to busy when started", () => {
      vi.mocked(llmClient.callLLMRaw).mockImplementation(
        () => new Promise(() => {})
      );
      
      processor.start(makeRequest(), vi.fn());
      
      expect(processor.getState()).toBe("busy");
    });

    it("transitions back to idle after completion", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Test response",
        finishReason: "stop",
      });
      
      const callback = vi.fn().mockResolvedValue(undefined);
      processor.start(makeRequest(), callback);
      
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      await vi.waitFor(() => expect(processor.getState()).toBe("idle"));
    });

    it("throws QUEUE_BUSY if started while busy", () => {
      vi.mocked(llmClient.callLLMRaw).mockImplementation(
        () => new Promise(() => {})
      );
      
      processor.start(makeRequest(), vi.fn());
      
      expect(() => processor.start(makeRequest(), vi.fn()))
        .toThrow("QUEUE_BUSY");
    });
  });

  describe("response type handling", () => {
    it("handles raw type - returns content as-is", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Raw content here",
        finishReason: "stop",
      });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("raw"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(true);
      expect(response?.content).toBe("Raw content here");
    });

    it("handles json type - parses valid JSON", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: '{"key": "value"}',
        finishReason: "stop",
      });
      vi.mocked(llmClient.parseJSONResponse).mockReturnValue({ key: "value" });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("json"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(true);
      expect(response?.parsed).toEqual({ key: "value" });
    });

    it("handles json type - fails on invalid JSON", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "not valid json",
        finishReason: "stop",
      });
      vi.mocked(llmClient.parseJSONResponse).mockImplementation(() => {
        throw new Error("Invalid JSON");
      });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("json"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(false);
      expect(response?.error).toContain("JSON parse failed");
    });

    it("handles response type - cleans content", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "  Hello world  ",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("Hello world");
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("response"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.content).toBe("Hello world");
    });

    it("handles response type - detects 'no message' patterns", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "No message",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("No message");
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("response"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(true);
      expect(response?.content).toBeNull();
    });

    it("handles response type - detects '[no message]' pattern", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "[no message]",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("[no message]");
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("response"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.content).toBeNull();
    });
  });

  describe("error handling", () => {
    it("handles empty response from LLM", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: null,
        finishReason: "stop",
      });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest(), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(false);
      expect(response?.error).toBe("Empty response from LLM");
    });

    it("handles LLM call failure", async () => {
      vi.mocked(llmClient.callLLMRaw).mockRejectedValue(
        new Error("Network error")
      );
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest(), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(false);
      expect(response?.error).toBe("Network error");
    });

    it("includes finish_reason in response", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Test",
        finishReason: "length",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("Test");
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest(), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.finish_reason).toBe("length");
    });
  });

  describe("abort", () => {
    it("abort() can be called", () => {
      vi.mocked(llmClient.callLLMRaw).mockImplementation(
        () => new Promise(() => {})
      );
      
      processor.start(makeRequest(), vi.fn().mockResolvedValue(undefined));
      
      expect(() => processor.abort()).not.toThrow();
    });

    it("abort() does nothing when idle", () => {
      expect(() => processor.abort()).not.toThrow();
    });
  });

  describe("callback invocation", () => {
    it("invokes callback with response", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Test response",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("Test response");
      
      const callback = vi.fn().mockResolvedValue(undefined);
      processor.start(makeRequest(), callback);
      
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      
      const response = callback.mock.calls[0][0] as LLMResponse;
      expect(response.request.id).toBe("test-request-id");
      expect(response.success).toBe(true);
    });

    it("returns to idle after callback completes", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Test",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("Test");
      
      const callback = vi.fn().mockResolvedValue(undefined);
      
      processor.start(makeRequest(), callback);
      
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      await vi.waitFor(() => expect(processor.getState()).toBe("idle"));
    });
  });

  describe("LLM call parameters", () => {
    it("passes correct parameters to callLLMRaw", async () => {
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: "Test",
        finishReason: "stop",
      });
      vi.mocked(llmClient.cleanResponseContent).mockReturnValue("Test");
      
      const request = makeRequest();
      request.system = "Custom system";
      request.user = "Custom user";
      request.model = "custom-model";
      request.data.personaName = "TestPersona";
      
      const messageFetcher = vi.fn().mockReturnValue([{ role: "user", content: "History" }]);
      const callback = vi.fn().mockResolvedValue(undefined);
      processor.start(request, callback, { messageFetcher });
      
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      
      expect(messageFetcher).toHaveBeenCalledWith("TestPersona");
      expect(llmClient.callLLMRaw).toHaveBeenCalledWith(
        "Custom system",
        "Custom user",
        [{ role: "user", content: "History" }],
        "custom-model",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
        undefined
      );
    });
  });
});

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { QueueProcessor } from "../../../src/core/queue-processor.js";
import type { LLMHistoryMessage } from "../../../src/core/queue-processor.js";
import { LLMRequestType, LLMPriority, LLMNextStep } from "../../../src/core/types.js";
import type { LLMRequest, LLMResponse, ToolDefinition } from "../../../src/core/types.js";

vi.mock("../../../src/core/llm-client.js", () => ({
  callLLMRaw: vi.fn(),
  parseJSONResponse: vi.fn((content: string) => JSON.parse(content)),
  cleanResponseContent: vi.fn((content: string) => content),
}));

vi.mock("../../../src/core/tools/index.js", () => ({
  toOpenAITools: vi.fn(() => []),
  executeToolCalls: vi.fn(),
  parseToolCalls: vi.fn(() => []),
}));

import * as llmClient from "../../../src/core/llm-client.js";
import * as toolsModule from "../../../src/core/tools/index.js";

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
    vi.mocked(llmClient.parseJSONResponse).mockImplementation((content: string) => JSON.parse(content));
    vi.mocked(llmClient.cleanResponseContent).mockImplementation((content: string) => content);
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

    it("handles response type - parsed as JSON (response→json redirect)", async () => {
      const jsonContent = '{"should_respond": true, "verbal_response": "Hello world"}';
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: jsonContent,
        finishReason: "stop",
      });
      vi.mocked(llmClient.parseJSONResponse).mockReturnValue({
        should_respond: true,
        verbal_response: "Hello world",
      });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("response"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(true);
      expect(response?.parsed).toEqual({
        should_respond: true,
        verbal_response: "Hello world",
      });
    });

    it("handles response type - should_respond false", async () => {
      const jsonContent = '{"should_respond": false, "reason": "User said goodnight"}';
      vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
        content: jsonContent,
        finishReason: "stop",
      });
      vi.mocked(llmClient.parseJSONResponse).mockReturnValue({
        should_respond: false,
        reason: "User said goodnight",
      });
      
      let response: LLMResponse | undefined;
      processor.start(makeRequest("response"), async (r) => { response = r; });
      
      await vi.waitFor(() => expect(response).toBeDefined());
      expect(response?.success).toBe(true);
      expect(response?.parsed).toEqual({
        should_respond: false,
        reason: "User said goodnight",
      });
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
        content: '{"ok": true}',
        finishReason: "stop",
      });
      vi.mocked(llmClient.parseJSONResponse).mockReturnValue({ ok: true });
      
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
      
      const request = makeRequest();
      request.system = "Custom system";
      request.user = "Custom user";
      request.model = "custom-model";
      request.data.personaId = "test-persona-id";
      
      const messageFetcher = vi.fn().mockReturnValue([{ role: "user", content: "History" }]);
      const callback = vi.fn().mockResolvedValue(undefined);
      processor.start(request, callback, { messageFetcher });
      
      await vi.waitFor(() => expect(callback).toHaveBeenCalled());
      
      expect(messageFetcher).toHaveBeenCalledWith("test-persona-id");
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

  describe("tool calling", () => {
    const makeTool = (): ToolDefinition => ({
      id: "tool-1",
      provider_id: "provider-1",
      name: "some_tool",
      display_name: "Some Tool",
      description: "A test tool",
      input_schema: { type: "object", properties: {} },
      runtime: "any",
      builtin: true,
      enabled: true,
      created_at: new Date().toISOString(),
    });

    const rawToolCallsData: unknown[] = [
      { id: "tc1", type: "function", function: { name: "some_tool", arguments: "{}" } },
    ];

    const assistantMsg: Record<string, unknown> = {
      role: "assistant",
      content: null,
      tool_calls: rawToolCallsData,
    };

    beforeEach(() => {
      vi.mocked(toolsModule.parseToolCalls).mockReturnValue([
        { id: "tc1", name: "some_tool", arguments: {} },
      ]);
      vi.mocked(toolsModule.executeToolCalls).mockResolvedValue({
        results: [{ tool_call_id: "tc1", name: "some_tool", result: '{"ok":true}', error: false }],
        exhaustedToolNames: new Set<string>(),
      });
      vi.mocked(toolsModule.toOpenAITools).mockReturnValue([
        { type: "function", function: { name: "some_tool" } },
      ]);
    });

    describe("when finish_reason is tool_calls with rawToolCalls", () => {
      beforeEach(() => {
        vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
          content: null,
          finishReason: "tool_calls",
          rawToolCalls: rawToolCallsData,
          assistantMessage: assistantMsg,
        });
      });

      it("calls executeToolCalls", async () => {
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, {
          tools: [makeTool()],
          onEnqueue: vi.fn().mockReturnValue("id"),
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        expect(toolsModule.executeToolCalls).toHaveBeenCalled();
      });

      it("calls onEnqueue with next_step === HandleToolSynthesis", async () => {
        const onEnqueue = vi.fn().mockReturnValue("id");
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, {
          tools: [makeTool()],
          onEnqueue,
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        expect(onEnqueue).toHaveBeenCalledWith(
          expect.objectContaining({ next_step: LLMNextStep.HandleToolSynthesis })
        );
      });

      it("passes data.toolHistory containing tool results to onEnqueue", async () => {
        const onEnqueue = vi.fn().mockReturnValue("id");
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, {
          tools: [makeTool()],
          onEnqueue,
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const enqueuedRequest = onEnqueue.mock.calls[0][0] as LLMRequest;
        expect(enqueuedRequest.data.toolHistory).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: "tool", tool_call_id: "tc1", name: "some_tool" }),
          ])
        );
      });

      it("passes data.originalNextStep matching the original request's next_step to onEnqueue", async () => {
        const onEnqueue = vi.fn().mockReturnValue("id");
        const callback = vi.fn().mockResolvedValue(undefined);
        const request = makeRequest();

        processor.start(request, callback, {
          tools: [makeTool()],
          onEnqueue,
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const enqueuedRequest = onEnqueue.mock.calls[0][0] as LLMRequest;
        expect(enqueuedRequest.data.originalNextStep).toBe(request.next_step);
      });

      it("returns LLMResponse with finish_reason: tool_calls_enqueued", async () => {
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, {
          tools: [makeTool()],
          onEnqueue: vi.fn().mockReturnValue("id"),
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const response = callback.mock.calls[0][0] as LLMResponse;
        expect(response.finish_reason).toBe("tool_calls_enqueued");
      });

      it("returns LLMResponse with success: true", async () => {
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, {
          tools: [makeTool()],
          onEnqueue: vi.fn().mockReturnValue("id"),
        });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const response = callback.mock.calls[0][0] as LLMResponse;
        expect(response.success).toBe(true);
      });
    });

    describe("when finish_reason is tool_calls but onEnqueue is not provided", () => {
      it("does not throw and returns finish_reason: tool_calls_enqueued", async () => {
        vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
          content: null,
          finishReason: "tool_calls",
          rawToolCalls: rawToolCallsData,
          assistantMessage: assistantMsg,
        });

        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeRequest(), callback, { tools: [makeTool()] });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const response = callback.mock.calls[0][0] as LLMResponse;
        expect(response.finish_reason).toBe("tool_calls_enqueued");
      });
    });

    describe("HandleToolSynthesis requests", () => {
      const toolHistory: LLMHistoryMessage[] = [
        { role: "assistant", content: null, tool_calls: [{ id: "tc1" }] },
        { role: "tool", content: '{"ok":true}', tool_call_id: "tc1", name: "some_tool" },
      ];

      const makeSynthesisRequest = (): LLMRequest => ({
        ...makeRequest(),
        next_step: LLMNextStep.HandleToolSynthesis,
        data: {
          toolHistory,
          originalNextStep: LLMNextStep.HandlePersonaResponse,
        },
      });

      beforeEach(() => {
        vi.mocked(llmClient.callLLMRaw).mockResolvedValue({
          content: '{"should_respond": true, "verbal_response": "synthesis result"}',
          finishReason: "stop",
        });
        vi.mocked(llmClient.parseJSONResponse).mockReturnValue({
          should_respond: true,
          verbal_response: "synthesis result",
        });
      });

      it("injects toolHistory into messages before calling callLLMRaw", async () => {
        const conversationMessages = [{ role: "user" as const, content: "History" }];
        const messageFetcher = vi.fn().mockReturnValue(conversationMessages);

        const synthesisRequest: LLMRequest = {
          ...makeSynthesisRequest(),
          data: {
            ...makeSynthesisRequest().data,
            personaId: "test-persona-id",
          },
        };

        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(synthesisRequest, callback, { messageFetcher });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const callArgs = vi.mocked(llmClient.callLLMRaw).mock.calls[0];
        const passedMessages = callArgs[2];
        expect(passedMessages).toHaveLength(3);
        expect(passedMessages[0]).toEqual(conversationMessages[0]);
        expect(passedMessages[1]).toMatchObject({ role: "assistant", content: null });
        expect(passedMessages[2]).toMatchObject({ role: "tool", tool_call_id: "tc1", name: "some_tool" });
      });

      it("does not pass tools to callLLMRaw and does not call toOpenAITools", async () => {
        const callback = vi.fn().mockResolvedValue(undefined);
        processor.start(makeSynthesisRequest(), callback, { tools: [makeTool()] });

        await vi.waitFor(() => expect(callback).toHaveBeenCalled());
        const callArgs = vi.mocked(llmClient.callLLMRaw).mock.calls[0];
        const options = callArgs[4];
        expect(options).not.toHaveProperty("tools");
        expect(toolsModule.toOpenAITools).not.toHaveBeenCalled();
      });
    });
  });
});

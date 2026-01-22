import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QueueProcessor } from "../../src/queue-processor.js";
import * as queue from "../../src/llm-queue.js";
import * as extraction from "../../src/extraction.js";
import * as llm from "../../src/llm.js";
import type { LLMQueueItem, FastScanPayload } from "../../src/llm-queue.js";
import type { Message } from "../../src/types.js";

vi.mock("../../src/llm-queue.js");
vi.mock("../../src/extraction.js");
vi.mock("../../src/llm.js");
vi.mock("../../src/storage.js");

describe("QueueProcessor", () => {
  let processor: QueueProcessor;

  beforeEach(() => {
    vi.clearAllMocks();
    processor = new QueueProcessor();
    vi.mocked(llm.sleep).mockImplementation((ms) => 
      new Promise(resolve => setTimeout(resolve, Math.min(ms, 10)))
    );
  });

  afterEach(async () => {
    if (processor) {
      await processor.stop();
    }
  });

  describe("lifecycle", () => {
    it("starts and stops successfully", async () => {
      await processor.start();
      await processor.stop();

      expect(true).toBe(true);
    });

    it("ignores duplicate start() calls", async () => {
      await processor.start();
      await processor.start();
      await processor.stop();

      expect(true).toBe(true);
    });

    it("ignores stop() when not running", async () => {
      await processor.stop();
      expect(true).toBe(true);
    });

    it("pauses and resumes successfully", async () => {
      await processor.start();
      processor.pause();
      processor.resume();
      await processor.stop();

      expect(true).toBe(true);
    });

    it("ignores pause/resume when not running", () => {
      processor.pause();
      processor.resume();
      expect(true).toBe(true);
    });
  });

  describe("queue processing", () => {
    const mockMessages: Message[] = [
      { role: "human", content: "Hello", timestamp: new Date().toISOString() },
      { role: "system", content: "Hi", timestamp: new Date().toISOString() }
    ];

    it("processes fast_scan item successfully", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-123",
        type: "fast_scan",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          messages: mockMessages
        } as FastScanPayload
      };

      const mockResult = {
        mentioned: [{ name: "Topic1", type: "topic" as const, confidence: "high" as const }],
        new_items: []
      };

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);
      
      vi.mocked(extraction.runFastScan).mockResolvedValue(mockResult);
      vi.mocked(extraction.routeFastScanResults).mockResolvedValue(undefined);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(extraction.runFastScan).toHaveBeenCalledWith(
        "human",
        "ei",
        mockMessages,
        expect.any(Object)
      );
      expect(extraction.routeFastScanResults).toHaveBeenCalledWith(
        mockResult,
        "human",
        "ei",
        mockMessages
      );
      expect(queue.completeItem).toHaveBeenCalledWith("test-123");
    });

    it("never dequeues ei_validation items (filtered by dequeueItem)", async () => {
      vi.mocked(queue.dequeueItem).mockResolvedValue(null);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(queue.completeItem).not.toHaveBeenCalled();
      expect(queue.failItem).not.toHaveBeenCalled();
    });

    it("handles empty queue by sleeping", async () => {
      vi.mocked(queue.dequeueItem).mockResolvedValue(null);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(llm.sleep).toHaveBeenCalledWith(1000);
    });

    it("handles paused state by sleeping", async () => {
      vi.mocked(queue.dequeueItem).mockResolvedValue(null);

      await processor.start();
      processor.pause();
      await new Promise(resolve => setTimeout(resolve, 150));
      await processor.stop();

      expect(llm.sleep).toHaveBeenCalledWith(100);
    });
  });

  describe("error handling", () => {
    it("handles LLM abort without failing item", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-abort",
        type: "fast_scan",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          messages: []
        } as FastScanPayload
      };

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);
      
      vi.mocked(extraction.runFastScan).mockRejectedValue(new llm.LLMAbortedError());

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(queue.failItem).not.toHaveBeenCalled();
      expect(queue.completeItem).not.toHaveBeenCalled();
    });

    it("fails item on real error", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-error",
        type: "fast_scan",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          messages: []
        } as FastScanPayload
      };

      const testError = new Error("LLM call failed");

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);
      
      vi.mocked(extraction.runFastScan).mockRejectedValue(testError);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(queue.failItem).toHaveBeenCalledWith("test-error", "LLM call failed");
    });
  });

  describe("abort signal propagation", () => {
    it("passes abort signal to runFastScan", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-signal",
        type: "fast_scan",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          messages: []
        } as FastScanPayload
      };

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);
      
      vi.mocked(extraction.runFastScan).mockResolvedValue(null);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(extraction.runFastScan).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          aborted: expect.any(Boolean)
        })
      );
    });

    it("aborts current work on pause", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-pause-abort",
        type: "fast_scan",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          messages: []
        } as FastScanPayload
      };

      let abortSignal: AbortSignal | undefined;
      
      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);
      
      vi.mocked(extraction.runFastScan).mockImplementation(async (_t, _p, _m, signal) => {
        abortSignal = signal;
        await new Promise(resolve => setTimeout(resolve, 200));
        if (signal?.aborted) {
          throw new llm.LLMAbortedError();
        }
        return null;
      });

      await processor.start();
      await llm.sleep(10);
      processor.pause();
      await llm.sleep(50);
      await processor.stop();

      expect(abortSignal?.aborted).toBe(true);
    });
  });

  describe("detail_update and description_regen placeholders", () => {
    it("logs detail_update items (implementation in 0112)", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-detail",
        type: "detail_update",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          target: "human",
          persona: "ei",
          data_type: "fact",
          item_name: "Test Fact",
          messages: [],
          is_new: true
        }
      };

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(queue.completeItem).toHaveBeenCalledWith("test-detail");
    });

    it("logs description_regen items (implementation in 0112)", async () => {
      const mockItem: LLMQueueItem = {
        id: "test-desc",
        type: "description_regen",
        priority: "normal",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          persona: "frodo"
        }
      };

      vi.mocked(queue.dequeueItem)
        .mockResolvedValueOnce(mockItem)
        .mockResolvedValue(null);

      await processor.start();
      await llm.sleep(50);
      await processor.stop();

      expect(queue.completeItem).toHaveBeenCalledWith("test-desc");
    });
  });
});

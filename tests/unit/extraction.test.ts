import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFastScan, routeFastScanResults, FastScanResult } from "../../src/extraction.js";
import type { HumanEntity, PersonaEntity, Message } from "../../src/types.js";
import * as storage from "../../src/storage.js";
import * as llm from "../../src/llm.js";
import * as queue from "../../src/llm-queue.js";

vi.mock("../../src/storage.js");
vi.mock("../../src/llm.js");
vi.mock("../../src/llm-queue.js");

describe("extraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("runFastScan", () => {
    const mockMessages: Message[] = [
      { role: "human", content: "I love hiking", timestamp: new Date().toISOString() },
      { role: "system", content: "That's great!", timestamp: new Date().toISOString() }
    ];

    const mockHumanEntity: HumanEntity = {
      entity: "human",
      facts: [{ name: "Birthday", description: "Jan 1", sentiment: 0, last_updated: new Date().toISOString(), confidence: 1.0 }],
      traits: [{ name: "Introverted", description: "Prefers quiet", sentiment: 0, last_updated: new Date().toISOString() }],
      topics: [{ name: "Programming", description: "Software dev", sentiment: 0.8, level_current: 0.5, level_ideal: 0.7, last_updated: new Date().toISOString() }],
      people: [{ name: "Alice", description: "Friend", relationship: "friend", sentiment: 0.6, level_current: 0.4, level_ideal: 0.5, last_updated: new Date().toISOString() }],
      last_updated: null
    };

    const mockPersonaEntity: PersonaEntity = {
      entity: "system",
      traits: [{ name: "Friendly", description: "Warm", sentiment: 0.5, last_updated: new Date().toISOString() }],
      topics: [{ name: "Music", description: "Enjoys music", sentiment: 0.7, level_current: 0.6, level_ideal: 0.8, last_updated: new Date().toISOString() }],
      last_updated: null
    };

    it("scans human entity and returns results", async () => {
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([{ name: "ei", aliases: [] }]);
      
      const mockResult: FastScanResult = {
        mentioned: [{ name: "Programming", type: "topic", confidence: "high" }],
        new_items: [{ name: "Hiking", type: "topic", confidence: "high", reason: "User expressed love for hiking" }]
      };
      
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);

      const result = await runFastScan("human", "ei", mockMessages);

      expect(result).toEqual(mockResult);
      expect(storage.loadHumanEntity).toHaveBeenCalled();
      expect(llm.callLLMForJSON).toHaveBeenCalledWith(
        expect.stringContaining("scanning a conversation"),
        expect.stringContaining("Known Items"),
        expect.objectContaining({ temperature: 0.3, operation: "concept" })
      );
    });

    it("scans persona entity and returns results", async () => {
      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(mockPersonaEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([{ name: "ei", aliases: [] }]);
      
      const mockResult: FastScanResult = {
        mentioned: [{ name: "Music", type: "topic", confidence: "medium" }],
        new_items: []
      };
      
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);

      const result = await runFastScan("system", "ei", mockMessages);

      expect(result).toEqual(mockResult);
      expect(storage.loadPersonaEntity).toHaveBeenCalledWith("ei");
    });

    it("filters out persona names from new_items", async () => {
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "ei", aliases: ["assistant"] },
        { name: "frodo", aliases: [] }
      ]);
      
      const mockResult: FastScanResult = {
        mentioned: [],
        new_items: [
          { name: "Alice", type: "person", confidence: "high", reason: "Friend mentioned" },
          { name: "ei", type: "person", confidence: "high", reason: "Should be filtered" },
          { name: "ASSISTANT", type: "person", confidence: "medium", reason: "Should be filtered (case insensitive)" }
        ]
      };
      
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);

      const result = await runFastScan("human", "ei", mockMessages);

      expect(result?.new_items).toHaveLength(1);
      expect(result?.new_items[0].name).toBe("Alice");
    });

    it("returns null on LLM failure", async () => {
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([]);
      vi.mocked(llm.callLLMForJSON).mockRejectedValue(new Error("LLM error"));

      const result = await runFastScan("human", "ei", mockMessages);

      expect(result).toBeNull();
    });

    it("includes known persona names in system prompt", async () => {
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "ei", aliases: ["assistant", "core"] },
        { name: "frodo", aliases: [] }
      ]);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue({ mentioned: [], new_items: [] });

      await runFastScan("human", "ei", mockMessages);

      const systemPromptCall = vi.mocked(llm.callLLMForJSON).mock.calls[0][0];
      expect(systemPromptCall).toContain("- ei");
      expect(systemPromptCall).toContain("- assistant");
      expect(systemPromptCall).toContain("- core");
      expect(systemPromptCall).toContain("- frodo");
    });
  });

  describe("routeFastScanResults", () => {
    const mockMessages: Message[] = [
      { role: "human", content: "Test", timestamp: new Date().toISOString() }
    ];

    beforeEach(() => {
      vi.mocked(queue.enqueueItem).mockResolvedValue("test-id");
    });

    it("routes high confidence mentioned items to detail_update", async () => {
      const result: FastScanResult = {
        mentioned: [
          { name: "Programming", type: "topic", confidence: "high" },
          { name: "Music", type: "topic", confidence: "medium" }
        ],
        new_items: []
      };

      await routeFastScanResults(result, "human", "ei", mockMessages);

      expect(queue.enqueueItem).toHaveBeenCalledTimes(2);
      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "detail_update",
          priority: "normal",
          payload: expect.objectContaining({
            target: "human",
            persona: "ei",
            data_type: "topic",
            item_name: "Programming",
            is_new: false
          })
        })
      );
    });

    it("routes high confidence new items to detail_update", async () => {
      const result: FastScanResult = {
        mentioned: [],
        new_items: [
          { name: "Hiking", type: "topic", confidence: "high", reason: "User loves hiking" }
        ]
      };

      await routeFastScanResults(result, "human", "ei", mockMessages);

      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "detail_update",
          payload: expect.objectContaining({
            item_name: "Hiking",
            is_new: true
          })
        })
      );
    });

    it("routes low confidence items to ei_validation", async () => {
      const result: FastScanResult = {
        mentioned: [
          { name: "Maybe", type: "topic", confidence: "low" }
        ],
        new_items: [
          { name: "Uncertain", type: "fact", confidence: "low", reason: "Not sure" }
        ]
      };

      await routeFastScanResults(result, "human", "ei", mockMessages);

      expect(queue.enqueueItem).toHaveBeenCalledTimes(2);
      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ei_validation",
          priority: "low",
          payload: expect.objectContaining({
            validation_type: "fact_confirm",
            item_name: "Maybe"
          })
        })
      );
      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "ei_validation",
          payload: expect.objectContaining({
            item_name: "Uncertain",
            context: expect.stringContaining("Not sure")
          })
        })
      );
    });

    it("does not route medium confidence to validation", async () => {
      const result: FastScanResult = {
        mentioned: [{ name: "Maybe", type: "topic", confidence: "medium" }],
        new_items: []
      };

      await routeFastScanResults(result, "human", "ei", mockMessages);

      const calls = vi.mocked(queue.enqueueItem).mock.calls;
      const validationCalls = calls.filter(call => call[0].type === "ei_validation");
      expect(validationCalls).toHaveLength(0);
    });

    it("includes original messages in detail_update payload", async () => {
      const result: FastScanResult = {
        mentioned: [],
        new_items: [
          { name: "Test", type: "topic", confidence: "high", reason: "testing" }
        ]
      };

      await routeFastScanResults(result, "human", "ei", mockMessages);

      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            messages: mockMessages
          })
        })
      );
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { runFastScan, routeFastScanResults, runDetailUpdate, FastScanResult } from "../../src/extraction.js";
import type { HumanEntity, PersonaEntity, Message, Fact, Trait, Topic, Person } from "../../src/types.js";
import * as storage from "../../src/storage.js";
import * as llm from "../../src/llm.js";
import * as queue from "../../src/llm-queue.js";
import type { DetailUpdatePayload } from "../../src/llm-queue.js";

vi.mock("../../src/storage.js");
vi.mock("../../src/llm.js");
vi.mock("../../src/llm-queue.js");
vi.mock("../../src/extraction-frequency.js", () => ({
  recordExtraction: vi.fn().mockResolvedValue(undefined),
}));

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
            validation_type: "data_confirm",
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

  describe("runDetailUpdate", () => {
    const mockMessages: Message[] = [
      { role: "human", content: "I'm 35 years old", timestamp: new Date().toISOString() },
      { role: "system", content: "Thanks for sharing", timestamp: new Date().toISOString() }
    ];

    const mockHumanEntity: HumanEntity = {
      entity: "human",
      facts: [],
      traits: [],
      topics: [],
      people: [],
      last_updated: null
    };

    const mockPersonaEntity: PersonaEntity = {
      entity: "system",
      traits: [],
      topics: [],
      last_updated: null
    };

    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("creates new fact for human entity", async () => {
      const payload: DetailUpdatePayload = {
        target: "human",
        persona: "ei",
        data_type: "fact",
        item_name: "Age",
        messages: mockMessages,
        is_new: true
      };

      const mockResult: Fact = {
        name: "Age",
        description: "35 years old",
        sentiment: 0.0,
        confidence: 0.9,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([{ name: "ei", aliases: [] }]);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      await runDetailUpdate(payload);

      expect(storage.saveHumanEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          facts: expect.arrayContaining([
            expect.objectContaining({
              name: "Age",
              description: "35 years old",
              confidence: 0.9
            })
          ])
        })
      );
    });

    it("updates existing trait for persona entity", async () => {
      const existingTrait: Trait = {
        name: "Friendly",
        description: "Warm and welcoming",
        sentiment: 0.5,
        strength: 0.7,
        last_updated: new Date().toISOString()
      };

      const entityWithTrait: PersonaEntity = {
        ...mockPersonaEntity,
        traits: [existingTrait]
      };

      const payload: DetailUpdatePayload = {
        target: "system",
        persona: "frodo",
        data_type: "trait",
        item_name: "Friendly",
        messages: mockMessages,
        is_new: false
      };

      const updatedTrait: Trait = {
        name: "Friendly",
        description: "Warm, welcoming, and uses humor",
        sentiment: 0.6,
        strength: 0.8,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(entityWithTrait);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(updatedTrait);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();
      vi.mocked(queue.enqueueItem).mockResolvedValue("test-id");

      await runDetailUpdate(payload);

      expect(storage.savePersonaEntity).toHaveBeenCalledWith(
        expect.objectContaining({
          traits: expect.arrayContaining([
            expect.objectContaining({
              name: "Friendly",
              description: "Warm, welcoming, and uses humor",
              strength: 0.8
            })
          ])
        }),
        "frodo"
      );
    });

    it("adds change_log entry on update", async () => {
      const existingTopic: Topic = {
        name: "Programming",
        description: "Software development",
        sentiment: 0.7,
        level_current: 0.5,
        level_ideal: 0.8,
        last_updated: new Date().toISOString()
      };

      const entityWithTopic: HumanEntity = {
        ...mockHumanEntity,
        topics: [existingTopic]
      };

      const payload: DetailUpdatePayload = {
        target: "human",
        persona: "ei",
        data_type: "topic",
        item_name: "Programming",
        messages: mockMessages,
        is_new: false
      };

      const updatedTopic: Topic = {
        name: "Programming",
        description: "Software development, especially TypeScript",
        sentiment: 0.8,
        level_current: 0.7,
        level_ideal: 0.8,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entityWithTopic);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(updatedTopic);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      await runDetailUpdate(payload);

      const savedEntity = vi.mocked(storage.saveHumanEntity).mock.calls[0][0];
      const updatedTopicInEntity = savedEntity.topics.find(t => t.name === "Programming");
      
      expect(updatedTopicInEntity?.change_log).toBeDefined();
      expect(updatedTopicInEntity?.change_log).toHaveLength(1);
      expect(updatedTopicInEntity?.change_log?.[0]).toMatchObject({
        persona: "ei",
        delta_size: expect.any(Number)
      });
    });

    it("sets learned_by field on new items", async () => {
      const freshEntity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      const payload: DetailUpdatePayload = {
        target: "human",
        persona: "frodo",
        data_type: "fact",
        item_name: "Hometown",
        messages: mockMessages,
        is_new: true
      };

      const mockResult: Fact = {
        name: "Hometown",
        description: "Portland, Oregon",
        sentiment: 0.3,
        confidence: 0.8,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValueOnce(freshEntity);
      vi.mocked(llm.callLLMForJSON).mockResolvedValueOnce(mockResult);
      vi.mocked(storage.saveHumanEntity).mockResolvedValueOnce();

      await runDetailUpdate(payload);

      const savedEntity = vi.mocked(storage.saveHumanEntity).mock.calls[0][0];
      const newFact = savedEntity.facts[0];
      expect(newFact.learned_by).toBe("frodo");
    });

    it("queues description regen when persona trait changes", async () => {
      const payload: DetailUpdatePayload = {
        target: "system",
        persona: "frodo",
        data_type: "trait",
        item_name: "Curious",
        messages: mockMessages,
        is_new: true
      };

      const mockResult: Trait = {
        name: "Curious",
        description: "Always asking questions",
        sentiment: 0.6,
        strength: 0.7,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue(mockPersonaEntity);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();
      vi.mocked(queue.enqueueItem).mockResolvedValue("test-id");

      await runDetailUpdate(payload);

      expect(queue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "description_regen",
          priority: "low",
          payload: { persona: "frodo" }
        })
      );
    });

    it("does not queue description regen for ei persona", async () => {
      const payload: DetailUpdatePayload = {
        target: "system",
        persona: "ei",
        data_type: "trait",
        item_name: "Warm but Direct",
        messages: mockMessages,
        is_new: false
      };

      const mockResult: Trait = {
        name: "Warm but Direct",
        description: "Friendly and honest",
        sentiment: 0.5,
        strength: 0.8,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadPersonaEntity).mockResolvedValue({
        ...mockPersonaEntity,
        traits: [mockResult]
      });
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);
      vi.mocked(storage.savePersonaEntity).mockResolvedValue();

      await runDetailUpdate(payload);

      expect(queue.enqueueItem).not.toHaveBeenCalled();
    });

    it("handles invalid LLM result gracefully", async () => {
      const payload: DetailUpdatePayload = {
        target: "human",
        persona: "ei",
        data_type: "fact",
        item_name: "Age",
        messages: mockMessages,
        is_new: true
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([]);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue({ invalid: "data" });

      await runDetailUpdate(payload);

      expect(storage.saveHumanEntity).not.toHaveBeenCalled();
    });

    it("includes known personas in person detail prompt", async () => {
      const payload: DetailUpdatePayload = {
        target: "human",
        persona: "ei",
        data_type: "person",
        item_name: "Alice",
        messages: mockMessages,
        is_new: true
      };

      const mockResult: Person = {
        name: "Alice",
        relationship: "friend",
        description: "Close friend from college",
        sentiment: 0.7,
        level_current: 0.6,
        level_ideal: 0.7,
        last_updated: new Date().toISOString()
      };

      vi.mocked(storage.loadHumanEntity).mockResolvedValue(mockHumanEntity);
      vi.mocked(storage.listPersonas).mockResolvedValue([
        { name: "ei", aliases: ["assistant"] },
        { name: "frodo", aliases: [] }
      ]);
      vi.mocked(llm.callLLMForJSON).mockResolvedValue(mockResult);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();

      await runDetailUpdate(payload);

      const systemPrompt = vi.mocked(llm.callLLMForJSON).mock.calls[0][0];
      expect(systemPrompt).toContain("- ei");
      expect(systemPrompt).toContain("- assistant");
      expect(systemPrompt).toContain("- frodo");
    });
  });
});

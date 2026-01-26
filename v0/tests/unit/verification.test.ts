import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as verification from "../../src/verification.js";
import * as storage from "../../src/storage.js";
import * as llmQueue from "../../src/llm-queue.js";
import * as llm from "../../src/llm.js";
import { HumanEntity } from "../../src/types.js";
import type { LLMQueueItem, EiValidationPayload } from "../../src/llm-queue.js";

vi.mock("../../src/storage.js");
vi.mock("../../src/llm-queue.js");
vi.mock("../../src/llm.js");

describe("verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("shouldRunCeremony", () => {
    it("returns false if ceremony is disabled", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null,
        ceremony_config: {
          enabled: false,
          time: "09:00"
        }
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);

      const should = await verification.shouldRunCeremony();

      expect(should).toBe(false);
    });

    it("returns false if already ran today", async () => {
      const now = new Date();
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null,
        ceremony_config: {
          enabled: true,
          time: "09:00",
          last_ceremony: now.toISOString()
        }
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);

      const should = await verification.shouldRunCeremony();

      expect(should).toBe(false);
    });

    it("returns false if before ceremony time", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null,
        ceremony_config: {
          enabled: true,
          time: "23:59",
          last_ceremony: yesterday.toISOString()
        }
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);

      const should = await verification.shouldRunCeremony();

      expect(should).toBe(false);
    });

    it("returns true if new day and past ceremony time", async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null,
        ceremony_config: {
          enabled: true,
          time: "00:00",
          last_ceremony: yesterday.toISOString()
        }
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);

      const should = await verification.shouldRunCeremony();

      expect(should).toBe(true);
    });
  });

  describe("buildDailyCeremonyMessage", () => {
    it("returns null when no pending validations", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      vi.mocked(llmQueue.getPendingValidations).mockResolvedValue([]);

      const message = await verification.buildDailyCeremonyMessage();

      expect(message).toBeNull();
    });

    it("builds message with pending validations sorted by priority", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      
      const validations: LLMQueueItem[] = [
        {
          id: "1",
          type: "ei_validation",
          priority: "low",
          created_at: new Date().toISOString(),
          attempts: 0,
          payload: {
            validation_type: "data_confirm",
            item_name: "Python",
            data_type: "topic",
            context: "Mentioned with low confidence",
            confidence: 0.3
          } as EiValidationPayload
        },
        {
          id: "2",
          type: "ei_validation",
          priority: "low",
          created_at: new Date().toISOString(),
          attempts: 0,
          payload: {
            validation_type: "data_confirm",
            item_name: "Birthday",
            data_type: "fact",
            context: "Detected birthday",
            confidence: 0.5
          } as EiValidationPayload
        }
      ];
      vi.mocked(llmQueue.getPendingValidations).mockResolvedValue(validations);

      const message = await verification.buildDailyCeremonyMessage();

      expect(message).toContain("Daily Confirmations");
      expect(message).toContain("Birthday");
      expect(message).toContain("Python");
      const birthdayIndex = message!.indexOf("Birthday");
      const pythonIndex = message!.indexOf("Python");
      expect(birthdayIndex).toBeLessThan(pythonIndex);
    });

    it("limits message to 5 validations", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      
      const validations: LLMQueueItem[] = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        type: "ei_validation",
        priority: "low",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          validation_type: "data_confirm",
          item_name: `Item${i}`,
          data_type: "fact",
          context: "Test",
          confidence: 0.5
        } as EiValidationPayload
      }));
      vi.mocked(llmQueue.getPendingValidations).mockResolvedValue(validations);

      const message = await verification.buildDailyCeremonyMessage();

      const itemMatches = message!.match(/\d+\. \*\*/g);
      expect(itemMatches).toHaveLength(5);
    });
  });

  describe("findDataPointByName", () => {
    it("finds fact by name", () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [{ name: "Birthday", description: "Jan 1", sentiment: 0, last_updated: "2026-01-01", confidence: 1.0 }],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      const result = verification.findDataPointByName(entity, "Birthday");

      expect(result).toBeDefined();
      expect(result?.item_type).toBe("fact");
      expect(result?.name).toBe("Birthday");
    });

    it("returns null if not found", () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      const result = verification.findDataPointByName(entity, "NonExistent");

      expect(result).toBeNull();
    });
  });

  describe("removeDataPointByName", () => {
    it("removes fact from entity", () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [
          { name: "Keep", description: "test", sentiment: 0, last_updated: "2026-01-01", confidence: 1.0 },
          { name: "Remove", description: "test", sentiment: 0, last_updated: "2026-01-01", confidence: 1.0 }
        ],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };

      verification.removeDataPointByName(entity, "Remove");

      expect(entity.facts).toHaveLength(1);
      expect(entity.facts[0].name).toBe("Keep");
    });
  });

  describe("wasLastEiMessageCeremony", () => {
    it("returns false when no messages exist", async () => {
      vi.mocked(storage.loadHistory).mockResolvedValue({ messages: [] });

      const result = await verification.wasLastEiMessageCeremony();

      expect(result).toBe(false);
    });

    it("returns false when last message is from human", async () => {
      vi.mocked(storage.loadHistory).mockResolvedValue({
        messages: [
          { role: "human", content: "test", timestamp: new Date().toISOString(), read: true }
        ]
      });

      const result = await verification.wasLastEiMessageCeremony();

      expect(result).toBe(false);
    });

    it("returns true when last message is ceremony", async () => {
      vi.mocked(storage.loadHistory).mockResolvedValue({
        messages: [
          { 
            role: "system", 
            content: "## Daily Confirmations\n\nI've noted a few things...", 
            timestamp: new Date().toISOString(), 
            read: false 
          }
        ]
      });

      const result = await verification.wasLastEiMessageCeremony();

      expect(result).toBe(true);
    });

    it("returns false when last message is system but not ceremony", async () => {
      vi.mocked(storage.loadHistory).mockResolvedValue({
        messages: [
          { 
            role: "system", 
            content: "Just checking in!", 
            timestamp: new Date().toISOString(), 
            read: false 
          }
        ]
      });

      const result = await verification.wasLastEiMessageCeremony();

      expect(result).toBe(false);
    });

    it("handles whitespace before ceremony header", async () => {
      vi.mocked(storage.loadHistory).mockResolvedValue({
        messages: [
          { 
            role: "system", 
            content: "  \n## Daily Confirmations\n\nI've noted a few things...", 
            timestamp: new Date().toISOString(), 
            read: false 
          }
        ]
      });

      const result = await verification.wasLastEiMessageCeremony();

      expect(result).toBe(true);
    });
  });
});

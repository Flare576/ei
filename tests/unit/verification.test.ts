import { describe, it, expect, beforeEach, vi } from "vitest";
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

  describe("applyVerificationResults", () => {
    it("boosts confidence for confirmed facts", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [{ name: "Birthday", description: "Jan 1", sentiment: 0, last_updated: "2026-01-01", confidence: 0.5 }],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();
      vi.mocked(llmQueue.clearValidations).mockResolvedValue();

      const results: verification.VerificationResponse = {
        confirmed: ["Birthday"],
        corrected: [],
        rejected: [],
        roleplay: [],
        unclear: []
      };
      const validations: LLMQueueItem[] = [{
        id: "1",
        type: "ei_validation",
        priority: "low",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          validation_type: "data_confirm",
          item_name: "Birthday",
          data_type: "fact",
          context: "Test"
        } as EiValidationPayload
      }];

      await verification.applyVerificationResults(results, validations);

      expect(entity.facts[0].confidence).toBe(1.0);
      expect(entity.facts[0].last_confirmed).toBeDefined();
      expect(storage.saveHumanEntity).toHaveBeenCalledWith(entity);
      expect(llmQueue.clearValidations).toHaveBeenCalledWith(["1"]);
    });

    it("removes rejected data points", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [{ name: "WrongFact", description: "test", sentiment: 0, last_updated: "2026-01-01", confidence: 0.5 }],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();
      vi.mocked(llmQueue.clearValidations).mockResolvedValue();

      const results: verification.VerificationResponse = {
        confirmed: [],
        corrected: [],
        rejected: ["WrongFact"],
        roleplay: [],
        unclear: []
      };
      const validations: LLMQueueItem[] = [{
        id: "1",
        type: "ei_validation",
        priority: "low",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          validation_type: "data_confirm",
          item_name: "WrongFact",
          data_type: "fact",
          context: "Test"
        } as EiValidationPayload
      }];

      await verification.applyVerificationResults(results, validations);

      expect(entity.facts).toHaveLength(0);
      expect(storage.saveHumanEntity).toHaveBeenCalledWith(entity);
    });

    it("queues corrected items for re-extraction", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [{ name: "OldName", description: "test", sentiment: 0, last_updated: "2026-01-01", confidence: 0.5 }],
        traits: [],
        topics: [],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();
      vi.mocked(llmQueue.enqueueItem).mockResolvedValue("new-id");
      vi.mocked(llmQueue.clearValidations).mockResolvedValue();

      const results: verification.VerificationResponse = {
        confirmed: [],
        corrected: [{ name: "OldName", correction: "Actually it's NewName" }],
        rejected: [],
        roleplay: [],
        unclear: []
      };
      const validations: LLMQueueItem[] = [{
        id: "1",
        type: "ei_validation",
        priority: "low",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          validation_type: "data_confirm",
          item_name: "OldName",
          data_type: "fact",
          context: "Test"
        } as EiValidationPayload
      }];

      await verification.applyVerificationResults(results, validations);

      expect(llmQueue.enqueueItem).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "detail_update",
          priority: "high",
          payload: expect.objectContaining({
            item_name: "OldName",
            data_type: "fact"
          })
        })
      );
    });

    it("moves roleplay items to group", async () => {
      const entity: HumanEntity = {
        entity: "human",
        facts: [],
        traits: [],
        topics: [{ name: "Dragon", description: "test", sentiment: 0, last_updated: "2026-01-01", level_current: 0.5, level_ideal: 0.5 }],
        people: [],
        last_updated: null
      };
      vi.mocked(storage.loadHumanEntity).mockResolvedValue(entity);
      vi.mocked(storage.saveHumanEntity).mockResolvedValue();
      vi.mocked(llmQueue.clearValidations).mockResolvedValue();

      const results: verification.VerificationResponse = {
        confirmed: [],
        corrected: [],
        rejected: [],
        roleplay: [{ name: "Dragon", group: "Frodo" }],
        unclear: []
      };
      const validations: LLMQueueItem[] = [{
        id: "1",
        type: "ei_validation",
        priority: "low",
        created_at: new Date().toISOString(),
        attempts: 0,
        payload: {
          validation_type: "data_confirm",
          item_name: "Dragon",
          data_type: "topic",
          context: "Test"
        } as EiValidationPayload
      }];

      await verification.applyVerificationResults(results, validations);

      expect(entity.topics[0].persona_groups).toEqual(["Frodo"]);
      expect(storage.saveHumanEntity).toHaveBeenCalledWith(entity);
    });
  });
});

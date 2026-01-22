import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { 
  enqueueItem, 
  dequeueItem, 
  completeItem,
  clearQueue,
  getAllItems
} from "../../src/llm-queue.js";
import type { Message } from "../../src/types.js";
import * as path from "path";
import { mkdirSync, rmSync, existsSync } from "fs";

const TEST_DATA_PATH = path.join(process.cwd(), "test-data-llm-queue");

describe("llm-queue", () => {
  beforeEach(async () => {
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true, force: true });
    }
    mkdirSync(TEST_DATA_PATH, { recursive: true });
    process.env.EI_DATA_PATH = TEST_DATA_PATH;
    await clearQueue();
  });

  afterEach(() => {
    if (existsSync(TEST_DATA_PATH)) {
      rmSync(TEST_DATA_PATH, { recursive: true, force: true });
    }
    delete process.env.EI_DATA_PATH;
  });

  describe("dequeueItem", () => {
    const mockMessages: Message[] = [
      { role: "human", content: "Test", timestamp: new Date().toISOString() }
    ];

    it("returns null when queue is empty", async () => {
      const item = await dequeueItem();
      expect(item).toBeNull();
    });

    it("returns fast_scan items normally", async () => {
      await enqueueItem({
        type: "fast_scan",
        priority: "normal",
        payload: {
          target: "human",
          persona: "ei",
          messages: mockMessages
        }
      });

      const item = await dequeueItem();
      expect(item).not.toBeNull();
      expect(item?.type).toBe("fast_scan");
    });

    it("skips ei_validation items entirely", async () => {
      await enqueueItem({
        type: "ei_validation",
        priority: "normal",
        payload: {
          validation_type: "data_confirm",
          item_name: "Test Fact",
          data_type: "fact",
          context: "Testing"
        }
      });

      const item = await dequeueItem();
      expect(item).toBeNull();
    });

    it("returns fast_scan when both fast_scan and ei_validation exist", async () => {
      await enqueueItem({
        type: "ei_validation",
        priority: "high",
        payload: {
          validation_type: "data_confirm",
          item_name: "Test",
          data_type: "fact",
          context: "Test"
        }
      });

      await enqueueItem({
        type: "fast_scan",
        priority: "normal",
        payload: {
          target: "human",
          persona: "ei",
          messages: mockMessages
        }
      });

      const item = await dequeueItem();
      expect(item).not.toBeNull();
      expect(item?.type).toBe("fast_scan");
    });

    it("returns null when queue only has ei_validation items", async () => {
      await enqueueItem({
        type: "ei_validation",
        priority: "high",
        payload: {
          validation_type: "data_confirm",
          item_name: "Test1",
          data_type: "fact",
          context: "Test"
        }
      });

      await enqueueItem({
        type: "ei_validation",
        priority: "normal",
        payload: {
          validation_type: "cross_persona",
          item_name: "Test2",
          data_type: "topic",
          context: "Test",
          source_persona: "frodo"
        }
      });

      const item = await dequeueItem();
      expect(item).toBeNull();

      const allItems = await getAllItems();
      expect(allItems).toHaveLength(2);
      expect(allItems.every(i => i.type === "ei_validation")).toBe(true);
    });

    it("respects priority for non-ei_validation items", async () => {
      await enqueueItem({
        type: "detail_update",
        priority: "low",
        payload: {
          target: "human",
          persona: "ei",
          data_type: "fact",
          item_name: "Low Priority",
          messages: mockMessages,
          is_new: true
        }
      });

      await enqueueItem({
        type: "detail_update",
        priority: "high",
        payload: {
          target: "human",
          persona: "ei",
          data_type: "fact",
          item_name: "High Priority",
          messages: mockMessages,
          is_new: true
        }
      });

      const item = await dequeueItem();
      expect(item).not.toBeNull();
      expect((item?.payload as any).item_name).toBe("High Priority");
    });

    it("does not remove items from queue (only returns them)", async () => {
      const id = await enqueueItem({
        type: "fast_scan",
        priority: "normal",
        payload: {
          target: "human",
          persona: "ei",
          messages: mockMessages
        }
      });

      await dequeueItem();
      
      const allItems = await getAllItems();
      expect(allItems).toHaveLength(1);
      expect(allItems[0].id).toBe(id);
    });
  });

  describe("ei_validation persistence", () => {
    it("ei_validation items stay in queue across multiple dequeue calls", async () => {
      await enqueueItem({
        type: "ei_validation",
        priority: "normal",
        payload: {
          validation_type: "data_confirm",
          item_name: "Persistent Item",
          data_type: "fact",
          context: "Should stay"
        }
      });

      for (let i = 0; i < 5; i++) {
        const item = await dequeueItem();
        expect(item).toBeNull();
      }

      const allItems = await getAllItems();
      expect(allItems).toHaveLength(1);
      expect(allItems[0].type).toBe("ei_validation");
    });

    it("ei_validation items can be completed via completeItem", async () => {
      const id = await enqueueItem({
        type: "ei_validation",
        priority: "normal",
        payload: {
          validation_type: "data_confirm",
          item_name: "To Be Completed",
          data_type: "fact",
          context: "Test"
        }
      });

      await completeItem(id);

      const allItems = await getAllItems();
      expect(allItems).toHaveLength(0);
    });
  });
});

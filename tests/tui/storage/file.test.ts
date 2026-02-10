import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FileStorage } from "../../../tui/src/storage/file";
import type { StorageState, HumanEntity } from "../../../src/core/types";
import { join } from "path";
import { rm } from "fs/promises";
import { tmpdir } from "os";

const TEST_DATA_PATH = join(tmpdir(), `ei-test-${Date.now()}`);

const createMockState = (timestamp: string = new Date().toISOString()): StorageState => ({
  version: 1,
  timestamp,
  human: {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: timestamp,
    last_activity: timestamp,
  } as HumanEntity,
  personas: {},
  queue: [],
});

describe("FileStorage", () => {
  let storage: FileStorage;

  beforeEach(() => {
    storage = new FileStorage(TEST_DATA_PATH);
  });

  afterEach(async () => {
    try {
      await rm(TEST_DATA_PATH, { recursive: true, force: true });
    } catch {
      return;
    }
  });

  test("isAvailable returns true when filesystem is writable", async () => {
    const result = await storage.isAvailable();
    expect(result).toBe(true);
  });

  test("listCheckpoints returns empty array when no checkpoints exist", async () => {
    const checkpoints = await storage.listCheckpoints();
    expect(checkpoints).toEqual([]);
  });

  test("saveAutoCheckpoint and loadCheckpoint work for auto-saves", async () => {
    const state = createMockState("2024-01-01T00:00:00Z");
    await storage.saveAutoCheckpoint(state);

    const loaded = await storage.loadCheckpoint(0);
    expect(loaded).toEqual(state);
  });

  test("auto-saves maintain FIFO queue with max 10 items", async () => {
    for (let i = 0; i < 12; i++) {
      const state = createMockState(`2024-01-01T00:00:${String(i).padStart(2, "0")}Z`);
      await storage.saveAutoCheckpoint(state);
    }

    const checkpoints = await storage.listCheckpoints();
    const autoSaves = checkpoints.filter((c) => c.index < 10);
    expect(autoSaves.length).toBe(10);

    const firstSave = await storage.loadCheckpoint(0);
    expect(firstSave?.timestamp).toBe("2024-01-01T00:00:02Z");
  });

  test("saveManualCheckpoint and loadCheckpoint work for manual saves", async () => {
    const state = createMockState("2024-01-01T12:00:00Z");
    await storage.saveManualCheckpoint(10, "Test Save", state);

    const loaded = await storage.loadCheckpoint(10);
    expect(loaded).toEqual(state);
  });

  test("listCheckpoints includes manual checkpoint names", async () => {
    const state = createMockState("2024-01-01T12:00:00Z");
    await storage.saveManualCheckpoint(12, "My Manual Save", state);

    const checkpoints = await storage.listCheckpoints();
    const manual = checkpoints.find((c) => c.index === 12);
    expect(manual?.name).toBe("My Manual Save");
  });

  test("saveManualCheckpoint throws error for invalid slot numbers", async () => {
    const state = createMockState();

    expect(async () => {
      await storage.saveManualCheckpoint(5, "Invalid", state);
    }).toThrow("CHECKPOINT_INVALID_SLOT");

    expect(async () => {
      await storage.saveManualCheckpoint(15, "Invalid", state);
    }).toThrow("CHECKPOINT_INVALID_SLOT");
  });

  test("deleteManualCheckpoint removes checkpoint and returns true", async () => {
    const state = createMockState();
    await storage.saveManualCheckpoint(11, "To Delete", state);

    const deleted = await storage.deleteManualCheckpoint(11);
    expect(deleted).toBe(true);

    const loaded = await storage.loadCheckpoint(11);
    expect(loaded).toBeNull();
  });

  test("deleteManualCheckpoint returns false when checkpoint doesn't exist", async () => {
    const deleted = await storage.deleteManualCheckpoint(13);
    expect(deleted).toBe(false);
  });

  test("deleteManualCheckpoint throws error for auto-save slots", async () => {
    expect(async () => {
      await storage.deleteManualCheckpoint(5);
    }).toThrow("CHECKPOINT_SLOT_PROTECTED");
  });

  test("loadCheckpoint returns null for non-existent checkpoint", async () => {
    const loaded = await storage.loadCheckpoint(7);
    expect(loaded).toBeNull();
  });
});

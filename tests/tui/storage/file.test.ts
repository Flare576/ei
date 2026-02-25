import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { FileStorage } from "../../../tui/src/storage/file";
import type { StorageState, HumanEntity } from "../../../src/core/types";
import { ValidationLevel } from "../../../src/core/types";
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

  test("load returns null when no data exists", async () => {
    const result = await storage.load();
    expect(result).toBeNull();
  });

  test("save and load work correctly", async () => {
    const state = createMockState("2024-01-01T00:00:00Z");
    await storage.save(state);

    const loaded = await storage.load();
    expect(loaded).toEqual(state);
  });

  test("save overwrites existing data", async () => {
    const state1 = createMockState("2024-01-01T00:00:00Z");
    await storage.save(state1);

    const state2 = createMockState("2024-01-01T12:00:00Z");
    state2.human.facts = [{ 
      id: "test", 
      name: "Test Fact", 
      description: "", 
      sentiment: 0, 
      last_updated: "",
      validated: ValidationLevel.None,
      validated_date: ""
    }];
    await storage.save(state2);

    const loaded = await storage.load();
    expect(loaded?.human.facts).toHaveLength(1);
    expect(loaded?.human.facts[0].name).toBe("Test Fact");
  });
});

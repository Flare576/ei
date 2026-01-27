import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../src/core/processor.js";
import type { Ei_Interface } from "../src/core/types.js";

function createMockInterface(): { interface: Ei_Interface; calls: string[] } {
  const calls: string[] = [];
  return {
    interface: {
      onPersonaAdded: () => calls.push("onPersonaAdded"),
      onPersonaRemoved: () => calls.push("onPersonaRemoved"),
      onPersonaUpdated: (name: string) => calls.push(`onPersonaUpdated:${name}`),
      onMessageAdded: (name: string) => calls.push(`onMessageAdded:${name}`),
      onMessageProcessing: (name: string) => calls.push(`onMessageProcessing:${name}`),
      onMessageQueued: (name: string) => calls.push(`onMessageQueued:${name}`),
      onHumanUpdated: () => calls.push("onHumanUpdated"),
      onQueueStateChanged: (state: "idle" | "busy") => calls.push(`onQueueStateChanged:${state}`),
      onError: (error) => calls.push(`onError:${error.code}`),
      onCheckpointStart: () => calls.push("onCheckpointStart"),
      onCheckpointCreated: (index?: number) =>
        calls.push(index !== undefined ? `onCheckpointCreated:${index}` : "onCheckpointCreated:auto"),
      onCheckpointDeleted: (index: number) => calls.push(`onCheckpointDeleted:${index}`),
    },
    calls,
  };
}

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    listCheckpoints: vi.fn().mockResolvedValue([]),
    loadCheckpoint: vi.fn().mockResolvedValue(null),
    saveAutoCheckpoint: vi.fn().mockResolvedValue(undefined),
    saveManualCheckpoint: vi.fn().mockResolvedValue(undefined),
    deleteManualCheckpoint: vi.fn().mockResolvedValue(true),
  };
}

describe("Processor Event System", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  it("fires onPersonaAdded when creating a persona", async () => {
    await processor.createPersona("TestBot", "A test persona");
    expect(mock.calls).toContain("onPersonaAdded");
  });

  it("fires onPersonaRemoved when archiving a persona", async () => {
    await processor.createPersona("TestBot", "A test persona");
    mock.calls.length = 0;
    await processor.archivePersona("TestBot");
    expect(mock.calls).toContain("onPersonaRemoved");
  });

  it("fires onPersonaUpdated when updating a persona", async () => {
    await processor.createPersona("TestBot", "A test persona");
    mock.calls.length = 0;
    await processor.updatePersona("TestBot", { short_description: "Updated" });
    expect(mock.calls).toContain("onPersonaUpdated:TestBot");
  });

  it("fires onMessageAdded and onMessageQueued when sending a message", async () => {
    await processor.createPersona("TestBot", "A test persona");
    mock.calls.length = 0;
    await processor.sendMessage("TestBot", "Hello!");
    expect(mock.calls).toContain("onMessageAdded:TestBot");
    expect(mock.calls).toContain("onMessageQueued:TestBot");
  });

  it("fires onHumanUpdated when upserting facts", async () => {
    await processor.upsertFact({
      id: "fact-1",
      name: "Test Fact",
      description: "A test fact",
      sentiment: 0,
      confidence: 0.9,
      last_updated: new Date().toISOString(),
    });
    expect(mock.calls).toContain("onHumanUpdated");
  });

  it("fires onHumanUpdated when upserting traits", async () => {
    await processor.upsertTrait({
      id: "trait-1",
      name: "Test Trait",
      description: "A test trait",
      sentiment: 0,
      last_updated: new Date().toISOString(),
    });
    expect(mock.calls).toContain("onHumanUpdated");
  });

  it("fires onHumanUpdated when removing data items", async () => {
    await processor.upsertFact({
      id: "fact-1",
      name: "Test Fact",
      description: "A test fact",
      sentiment: 0,
      confidence: 0.9,
      last_updated: new Date().toISOString(),
    });
    mock.calls.length = 0;
    await processor.removeDataItem("fact", "fact-1");
    expect(mock.calls).toContain("onHumanUpdated");
  });

  it("handles missing event handlers gracefully", async () => {
    const emptyProcessor = new Processor({});
    const emptyStorage = createMockStorage();
    await emptyProcessor.start(emptyStorage);
    
    await expect(emptyProcessor.createPersona("TestBot", "A test persona")).resolves.not.toThrow();
    await expect(emptyProcessor.sendMessage("TestBot", "Hello!")).resolves.not.toThrow();
    
    await emptyProcessor.stop();
  });

  afterEach(async () => {
    await processor.stop();
  });
});

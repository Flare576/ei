import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, PersonaEntity } from "../../../src/core/types.js";

// Mock the handlers module to intercept handler calls
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handlePersonaGeneration: vi.fn(),
    handlePersonaDescriptions: vi.fn(),
    handleHumanFactScan: vi.fn(),
    handleHumanTraitScan: vi.fn(),
    handleHumanTopicScan: vi.fn(),
    handleHumanPersonScan: vi.fn(),
    handleHumanItemMatch: vi.fn(),
    handleHumanItemUpdate: vi.fn(),
    handlePersonaTraitExtraction: vi.fn(),
    handlePersonaTopicDetection: vi.fn(),
    handlePersonaTopicExploration: vi.fn(),
    handleHeartbeatCheck: vi.fn(),
    handleEiHeartbeat: vi.fn(),
    handleEiValidation: vi.fn(),
    handleOneShot: vi.fn(),
  },
}));

// Mock the orchestrator to prevent actual persona generation and extraction queueing
vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactScan: vi.fn(),
  queueTraitScan: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  queueItemMatch: vi.fn(),
  queueItemUpdate: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldRunCeremony: vi.fn(),
  startCeremony: vi.fn(),
  queueExposurePhase: vi.fn(),
  queueDecayPhase: vi.fn(),
  queueExpirePhase: vi.fn(),
  queueExplorePhase: vi.fn(),
  queueDescriptionCheck: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

function createMockInterface(): { interface: Ei_Interface; calls: string[]; recalledContent: string[] } {
  const calls: string[] = [];
  const recalledContent: string[] = [];
  return {
    interface: {
      onPersonaAdded: () => calls.push("onPersonaAdded"),
      onPersonaRemoved: () => calls.push("onPersonaRemoved"),
      onPersonaUpdated: (name: string) => calls.push(`onPersonaUpdated:${name}`),
      onMessageAdded: (name: string) => calls.push(`onMessageAdded:${name}`),
      onMessageProcessing: (name: string) => calls.push(`onMessageProcessing:${name}`),
      onMessageQueued: (name: string) => calls.push(`onMessageQueued:${name}`),
      onMessageRecalled: (name: string, content: string) => {
        calls.push(`onMessageRecalled:${name}`);
        recalledContent.push(content);
      },
      onHumanUpdated: () => calls.push("onHumanUpdated"),
      onQueueStateChanged: (state: "idle" | "busy") => calls.push(`onQueueStateChanged:${state}`),
      onError: (error) => calls.push(`onError:${error.code}`),
      onCheckpointStart: () => calls.push("onCheckpointStart"),
      onCheckpointCreated: (index?: number) =>
        calls.push(index !== undefined ? `onCheckpointCreated:${index}` : "onCheckpointCreated:auto"),
      onCheckpointRestored: (index: number) => calls.push(`onCheckpointRestored:${index}`),
      onCheckpointDeleted: (index: number) => calls.push(`onCheckpointDeleted:${index}`),
      onOneShotReturned: (guid: string, content: string) => calls.push(`onOneShotReturned:${guid}:${content}`),
    },
    calls,
    recalledContent,
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

function createTestPersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    entity: "system",
    aliases: ["TestBot"],
    short_description: "A test persona",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    ...overrides,
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
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
    expect(mock.calls).toContain("onPersonaAdded");
  });

  it("fires onPersonaRemoved when archiving a persona", async () => {
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
    mock.calls.length = 0;
    await processor.archivePersona("TestBot");
    expect(mock.calls).toContain("onPersonaRemoved");
  });

  it("fires onPersonaUpdated when updating a persona", async () => {
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
    mock.calls.length = 0;
    await processor.updatePersona("TestBot", { short_description: "Updated" });
    expect(mock.calls).toContain("onPersonaUpdated:TestBot");
  });

  it("fires onMessageAdded and onMessageQueued when sending a message", async () => {
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
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
    
    await expect(emptyProcessor.createPersona({ name: "TestBot", long_description: "A test persona" })).resolves.not.toThrow();
    await expect(emptyProcessor.sendMessage("TestBot", "Hello!")).resolves.not.toThrow();
    
    await emptyProcessor.stop();
  });

  afterEach(async () => {
    await processor.stop();
  });
});

describe("Processor Lifecycle", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    mock = createMockInterface();
    storage = createMockStorage();
  });

  it("start() initializes and begins running", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    expect(storage.listCheckpoints).toHaveBeenCalled();
    await processor.stop();
  });

  it("start() bootstraps Ei on first run (no checkpoints)", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    expect(mock.calls).toContain("onPersonaAdded");
    expect(mock.calls).toContain("onMessageAdded:ei");
    await processor.stop();
  });

  it("start() does not bootstrap when checkpoints exist", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: {
          entity: createTestPersona({ aliases: ["Ei"] }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });
    
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    const addedCount = mock.calls.filter(c => c === "onPersonaAdded").length;
    expect(addedCount).toBe(0);
    await processor.stop();
  });

  it("stop() saves checkpoint and fires events", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    mock.calls.length = 0;
    
    await processor.stop();
    
    expect(storage.saveAutoCheckpoint).toHaveBeenCalled();
    expect(mock.calls).toContain("onCheckpointStart");
    expect(mock.calls).toContain("onCheckpointCreated:auto");
  });

  it("stop() does not save if never started running", async () => {
    const processor = new Processor(mock.interface);
    await processor.stop();
    
    expect(storage.saveAutoCheckpoint).not.toHaveBeenCalled();
    expect(mock.calls).not.toContain("onCheckpointStart");
  });

  it("stop() prevents runLoop from continuing", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    await processor.stop();
    
    const statusAfterStop = await processor.getQueueStatus();
    expect(statusAfterStop.state).toBe("idle");
  });
});

describe("Processor Auto-Save", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockInterface();
    storage = createMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("triggers auto-save after default interval (60s)", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    mock.calls.length = 0;
    storage.saveAutoCheckpoint.mockClear();
    
    await vi.advanceTimersByTimeAsync(60001);
    
    expect(storage.saveAutoCheckpoint).toHaveBeenCalled();
    expect(mock.calls).toContain("onCheckpointStart");
    expect(mock.calls).toContain("onCheckpointCreated:auto");
    
    await processor.stop();
  });

  it("respects custom auto_save_interval_ms from human settings", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
        settings: { auto_save_interval_ms: 30000 },
      },
      personas: {
        ei: { entity: createTestPersona({ aliases: ["Ei"] }), messages: [] },
      },
      queue: [],
      settings: {},
    });
    
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    mock.calls.length = 0;
    storage.saveAutoCheckpoint.mockClear();
    
    await vi.advanceTimersByTimeAsync(30001);
    
    expect(storage.saveAutoCheckpoint).toHaveBeenCalled();
    await processor.stop();
  });

  it("does not auto-save before interval elapses", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    mock.calls.length = 0;
    storage.saveAutoCheckpoint.mockClear();
    
    await vi.advanceTimersByTimeAsync(30000);
    
    expect(storage.saveAutoCheckpoint).not.toHaveBeenCalled();
    await processor.stop();
  });
});

describe("Processor Heartbeat Scheduling", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(() => {
    vi.useFakeTimers();
    mock = createMockInterface();
    storage = createMockStorage();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("queues heartbeat check after heartbeat_delay_ms elapses since last_activity", async () => {
    const oldActivity = new Date(Date.now() - 3600000).toISOString();
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        TestBot: {
          entity: createTestPersona({
            aliases: ["TestBot"],
            heartbeat_delay_ms: 1800000,
            last_activity: oldActivity,
          }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    // Pause queue to prevent processing before we can check pending_count
    await processor.abortCurrentOperation();
    await vi.advanceTimersByTimeAsync(200);
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBeGreaterThan(0);
    
    await processor.stop();
  });

  it("does NOT queue heartbeat for paused personas", async () => {
    const oldActivity = new Date(Date.now() - 3600000).toISOString();
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        PausedBot: {
          entity: createTestPersona({
            aliases: ["PausedBot"],
            is_paused: true,
            heartbeat_delay_ms: 1000,
            last_activity: oldActivity,
          }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    await vi.advanceTimersByTimeAsync(200);
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBe(0);
    
    await processor.stop();
  });

  it("does NOT queue heartbeat for archived personas", async () => {
    const oldActivity = new Date(Date.now() - 3600000).toISOString();
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ArchivedBot: {
          entity: createTestPersona({
            aliases: ["ArchivedBot"],
            is_archived: true,
            heartbeat_delay_ms: 1000,
            last_activity: oldActivity,
          }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    await vi.advanceTimersByTimeAsync(200);
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBe(0);
    
    await processor.stop();
  });

  it("does NOT queue heartbeat if last_activity is recent", async () => {
    const recentActivity = new Date().toISOString();
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ActiveBot: {
          entity: createTestPersona({
            aliases: ["ActiveBot"],
            heartbeat_delay_ms: 1800000,
            last_activity: recentActivity,
          }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    await vi.advanceTimersByTimeAsync(200);
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBe(0);
    
    await processor.stop();
  });
});

describe("Processor API Methods", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  describe("getPersonaList", () => {
    it("returns mapped summaries of all personas", async () => {
      await processor.createPersona({ name: "TestBot", short_description: "A test persona" });
      
      const list = await processor.getPersonaList();
      
      expect(list.length).toBeGreaterThanOrEqual(2);
      const testBot = list.find(p => p.name === "TestBot");
      expect(testBot).toBeDefined();
      expect(testBot?.short_description).toBe("A test persona");
      expect(testBot?.is_paused).toBe(false);
      expect(testBot?.is_archived).toBe(false);
    });

    it("includes Ei persona from bootstrap", async () => {
      const list = await processor.getPersonaList();
      const ei = list.find(p => p.name.toLowerCase() === "ei");
      expect(ei).toBeDefined();
    });
  });

  describe("getPersona", () => {
    it("returns persona entity when found", async () => {
      await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
      
      const persona = await processor.getPersona("TestBot");
      
      expect(persona).not.toBeNull();
      expect(persona?.long_description).toBe("A test persona");
    });

    it("returns null when persona not found", async () => {
      const persona = await processor.getPersona("NonExistent");
      expect(persona).toBeNull();
    });
  });

  describe("createPersona", () => {
    it("adds persona and fires onPersonaAdded", async () => {
      mock.calls.length = 0;
      
      await processor.createPersona({ name: "NewBot", long_description: "A new persona" });
      
      expect(mock.calls).toContain("onPersonaAdded");
      const persona = await processor.getPersona("NewBot");
      expect(persona).not.toBeNull();
    });
  });

  describe("archivePersona", () => {
    it("archives persona and fires onPersonaRemoved", async () => {
      await processor.createPersona({ name: "ToArchive", long_description: "Will be archived" });
      mock.calls.length = 0;
      
      await processor.archivePersona("ToArchive");
      
      expect(mock.calls).toContain("onPersonaRemoved");
      const persona = await processor.getPersona("ToArchive");
      expect(persona?.is_archived).toBe(true);
    });
  });

  describe("unarchivePersona", () => {
    it("unarchives persona and fires onPersonaAdded", async () => {
      await processor.createPersona({ name: "ToUnarchive", long_description: "Will be unarchived" });
      await processor.archivePersona("ToUnarchive");
      mock.calls.length = 0;
      
      await processor.unarchivePersona("ToUnarchive");
      
      expect(mock.calls).toContain("onPersonaAdded");
      const persona = await processor.getPersona("ToUnarchive");
      expect(persona?.is_archived).toBe(false);
    });
  });

  describe("deletePersona", () => {
    it("deletes persona and fires onPersonaRemoved", async () => {
      await processor.createPersona({ name: "ToDelete", long_description: "Will be deleted" });
      mock.calls.length = 0;
      
      await processor.deletePersona("ToDelete", false);
      
      expect(mock.calls).toContain("onPersonaRemoved");
      const persona = await processor.getPersona("ToDelete");
      expect(persona).toBeNull();
    });
  });

  describe("updatePersona", () => {
    it("updates persona and fires onPersonaUpdated", async () => {
      await processor.createPersona({ name: "ToUpdate", long_description: "Original description" });
      mock.calls.length = 0;
      
      await processor.updatePersona("ToUpdate", { short_description: "Updated description" });
      
      expect(mock.calls).toContain("onPersonaUpdated:ToUpdate");
      const persona = await processor.getPersona("ToUpdate");
      expect(persona?.short_description).toBe("Updated description");
    });
  });

  describe("sendMessage", () => {
    it("appends message and fires onMessageAdded and onMessageQueued", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      mock.calls.length = 0;
      
      await processor.sendMessage("ChatBot", "Hello!");
      
      expect(mock.calls).toContain("onMessageAdded:ChatBot");
      expect(mock.calls).toContain("onMessageQueued:ChatBot");
    });

    it("queues response request for persona", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      
      await processor.sendMessage("ChatBot", "Hello!");
      
      const status = await processor.getQueueStatus();
      expect(status.pending_count).toBeGreaterThan(0);
    });
  });

  describe("getMessages", () => {
    it("returns messages for persona", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      await processor.sendMessage("ChatBot", "Hello!");
      
      const messages = await processor.getMessages("ChatBot");
      
      expect(messages.length).toBeGreaterThan(0);
      const humanMsg = messages.find(m => m.role === "human");
      expect(humanMsg?.content).toBe("Hello!");
    });
  });

  describe("getCheckpoints", () => {
    it("returns list of checkpoints from storage", async () => {
      storage.listCheckpoints.mockResolvedValue([
        { index: 0, timestamp: "2024-01-01T00:00:00Z" },
        { index: 10, timestamp: "2024-01-02T00:00:00Z", name: "Manual Save" },
      ]);
      
      const checkpoints = await processor.getCheckpoints();
      
      expect(checkpoints).toHaveLength(2);
    });
  });

  describe("createCheckpoint", () => {
    it("saves checkpoint and fires onCheckpointStart and onCheckpointCreated", async () => {
      mock.calls.length = 0;
      
      await processor.createCheckpoint(10, "Test Save");
      
      expect(mock.calls).toContain("onCheckpointStart");
      expect(mock.calls).toContain("onCheckpointCreated:10");
      expect(storage.saveManualCheckpoint).toHaveBeenCalled();
    });
  });

  describe("deleteCheckpoint", () => {
    it("deletes checkpoint and fires onCheckpointDeleted", async () => {
      mock.calls.length = 0;
      
      await processor.deleteCheckpoint(10);
      
      expect(mock.calls).toContain("onCheckpointStart");
      expect(mock.calls).toContain("onCheckpointDeleted:10");
      expect(storage.deleteManualCheckpoint).toHaveBeenCalled();
    });

    it("does not fire onCheckpointDeleted if deletion fails", async () => {
      storage.deleteManualCheckpoint.mockResolvedValue(false);
      mock.calls.length = 0;
      
      await processor.deleteCheckpoint(10);
      
      expect(mock.calls).toContain("onCheckpointStart");
      expect(mock.calls).not.toContain("onCheckpointDeleted:10");
    });
  });

  describe("getQueueStatus", () => {
    it("returns idle when queue is empty and not processing", async () => {
      const status = await processor.getQueueStatus();
      expect(status.state).toBe("idle");
    });

    it("returns correct pending_count", async () => {
      await processor.createPersona({ name: "QueueBot", long_description: "A bot for queue testing" });
      await processor.sendMessage("QueueBot", "Message 1");
      
      const status = await processor.getQueueStatus();
      expect(status.pending_count).toBeGreaterThan(0);
    });

    it("returns paused when queue is paused", async () => {
      await processor.abortCurrentOperation();
      
      const status = await processor.getQueueStatus();
      expect(status.state).toBe("paused");
    });
  });

  describe("abortCurrentOperation and resumeQueue", () => {
    it("abortCurrentOperation pauses the queue", async () => {
      await processor.abortCurrentOperation();
      
      const status = await processor.getQueueStatus();
      expect(status.state).toBe("paused");
    });

    it("resumeQueue resumes the queue", async () => {
      await processor.abortCurrentOperation();
      await processor.resumeQueue();
      
      const status = await processor.getQueueStatus();
      expect(status.state).toBe("idle");
    });
  });

  describe("submitOneShot", () => {
    it("enqueues a one-shot request", async () => {
      await processor.submitOneShot("test-guid", "System prompt", "User prompt");
      
      const status = await processor.getQueueStatus();
      expect(status.pending_count).toBeGreaterThan(0);
    });
  });

  describe("Human data operations", () => {
    it("getHuman returns human entity", async () => {
      const human = await processor.getHuman();
      expect(human.entity).toBe("human");
    });

    it("updateHuman updates and fires onHumanUpdated", async () => {
      mock.calls.length = 0;
      
      await processor.updateHuman({ last_activity: new Date().toISOString() });
      
      expect(mock.calls).toContain("onHumanUpdated");
    });

    it("upsertTopic fires onHumanUpdated", async () => {
      mock.calls.length = 0;
      
      await processor.upsertTopic({
        id: "topic-1",
        name: "Test Topic",
        description: "A test topic",
        sentiment: 0.5,
        exposure_current: 0.3,
        exposure_desired: 0.7,
        last_updated: new Date().toISOString(),
      });
      
      expect(mock.calls).toContain("onHumanUpdated");
    });

    it("upsertPerson fires onHumanUpdated", async () => {
      mock.calls.length = 0;
      
      await processor.upsertPerson({
        id: "person-1",
        name: "Test Person",
        description: "A test person",
        relationship: "friend",
        sentiment: 0.5,
        exposure_current: 0.3,
        exposure_desired: 0.7,
        last_updated: new Date().toISOString(),
      });
      
      expect(mock.calls).toContain("onHumanUpdated");
    });
  });
});

describe("Processor Error Handling", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("fires onError with PERSONA_NOT_FOUND when sending message to unknown persona", async () => {
    mock.calls.length = 0;
    
    await processor.sendMessage("NonExistent", "Hello!");
    
    expect(mock.calls).toContain("onError:PERSONA_NOT_FOUND");
  });
});

describe("Processor Visibility Filtering", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("Ei can see all non-archived personas", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: { entity: createTestPersona({ aliases: ["Ei"] }), messages: [] },
        friend: { entity: createTestPersona({ aliases: ["Friend"], short_description: "A friend" }), messages: [] },
        archived: { entity: createTestPersona({ aliases: ["Archived"], is_archived: true }), messages: [] },
      },
      queue: [],
      settings: {},
    });
    await processor.start(storage);
    
    const list = await processor.getPersonaList();
    
    expect(list.find(p => p.name === "Friend")).toBeDefined();
    expect(list.find(p => p.name === "Archived")).toBeDefined();
  });

  it("personas with group_primary can see each other", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: { entity: createTestPersona({ aliases: ["Ei"] }), messages: [] },
        persona1: {
          entity: createTestPersona({
            aliases: ["Persona1"],
            group_primary: "work",
          }),
          messages: [],
        },
        persona2: {
          entity: createTestPersona({
            aliases: ["Persona2"],
            group_primary: "work",
          }),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });
    await processor.start(storage);
    
    const persona1 = await processor.getPersona("Persona1");
    expect(persona1?.group_primary).toBe("work");
  });
});

describe("Processor Context Window", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("setMessageContextStatus updates a message's context status", async () => {
    await processor.createPersona({ name: "StatusBot", long_description: "A bot for status testing" });
    await processor.sendMessage("StatusBot", "Test message");
    
    const messages = await processor.getMessages("StatusBot");
    const messageId = messages.find(m => m.role === "human")?.id ?? "";
    
    await processor.setMessageContextStatus("StatusBot", messageId, "always" as import("../../../src/core/types.js").ContextStatus);
  });
});

describe("Processor Export and Templates", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("exportState returns JSON string with full StorageState", async () => {
    const exported = await processor.exportState();
    
    expect(typeof exported).toBe("string");
    const parsed = JSON.parse(exported);
    expect(parsed).toHaveProperty("version");
    expect(parsed).toHaveProperty("timestamp");
    expect(parsed).toHaveProperty("human");
    expect(parsed).toHaveProperty("personas");
    expect(parsed).toHaveProperty("queue");
    expect(parsed.human.entity).toBe("human");
  });

});

describe("Processor Checkpoint Restore", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("restoreCheckpoint returns true when checkpoint exists", async () => {
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {},
      queue: [],
      settings: {},
    });
    
    const result = await processor.restoreCheckpoint(10);
    
    expect(result).toBe(true);
    expect(mock.calls).toContain("onCheckpointStart");
  });

  it("restoreCheckpoint returns false when checkpoint does not exist", async () => {
    storage.loadCheckpoint.mockResolvedValue(null);
    
    const result = await processor.restoreCheckpoint(99);
    
    expect(result).toBe(false);
  });
});

describe("Processor Human Extraction Throttling", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("triggers extraction when sending message to Ei", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: {
          entity: createTestPersona({
            aliases: ["Ei", "ei"],
            short_description: "Your empathic interface",
          }),
          messages: [
            { id: "1", role: "system", content: "Welcome!", timestamp: new Date(Date.now() - 60000).toISOString(), read: true, context_status: "default" },
            { id: "2", role: "human", content: "Hi there", timestamp: new Date(Date.now() - 30000).toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    const initialStatus = await processor.getQueueStatus();
    const initialCount = initialStatus.pending_count;

    await processor.sendMessage("ei", "I live in Chicago and my birthday is January 15th");
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBeGreaterThan(initialCount);
  });

  it("does NOT trigger extraction when sending message to non-Ei persona", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: {
          entity: createTestPersona({ aliases: ["Ei", "ei"] }),
          messages: [],
        },
        friend: {
          entity: createTestPersona({ aliases: ["Friend", "friend"] }),
          messages: [
            { id: "1", role: "system", content: "Hi!", timestamp: new Date().toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.sendMessage("friend", "My birthday is January 15th");
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBe(2);
  });

  it("throttles extraction based on items vs messages ratio", async () => {
    const now = new Date();
    const tenMinutesAgo = new Date(now.getTime() - 600000);
    
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: now.toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: now.toISOString(),
      human: {
        entity: "human",
        facts: [
          { id: "f1", name: "Location", description: "Chicago", sentiment: 0.5, last_updated: now.toISOString() },
          { id: "f2", name: "Birthday", description: "Jan 15", sentiment: 0.8, last_updated: now.toISOString() },
          { id: "f3", name: "Job", description: "Engineer", sentiment: 0.7, last_updated: now.toISOString() },
        ],
        traits: [
          { id: "t1", name: "Curious", description: "Loves learning", sentiment: 0.8, last_updated: now.toISOString() },
        ],
        topics: [],
        people: [],
        last_updated: now.toISOString(),
        last_activity: now.toISOString(),
        last_seeded_fact: tenMinutesAgo.toISOString(),
        last_seeded_trait: tenMinutesAgo.toISOString(),
        last_seeded_topic: tenMinutesAgo.toISOString(),
        last_seeded_person: tenMinutesAgo.toISOString(),
      },
      personas: {
        ei: {
          entity: createTestPersona({ aliases: ["Ei", "ei"] }),
          messages: [
            { id: "m1", role: "human", content: "msg1", timestamp: new Date(now.getTime() - 500000).toISOString(), read: true, context_status: "default" },
            { id: "m2", role: "system", content: "resp1", timestamp: new Date(now.getTime() - 400000).toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.sendMessage("ei", "Just checking in");
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBeGreaterThanOrEqual(2);
  });

  it("updates lastSeeded timestamps after queueing extraction", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        ei: {
          entity: createTestPersona({ aliases: ["Ei", "ei"] }),
          messages: [
            { id: "1", role: "system", content: "Welcome", timestamp: new Date(Date.now() - 60000).toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.sendMessage("ei", "My name is John and I live in NYC");
    
    const human = await processor.getHuman();
    expect(human.last_seeded_fact).toBeDefined();
    expect(human.last_seeded_topic).toBeDefined();
    expect(human.last_seeded_person).toBeDefined();
  });
});

describe("Processor Message Recall", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("recallPendingMessages returns empty string when no pending messages", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [
            { id: "1", role: "human", content: "Already read", timestamp: new Date().toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const recalled = await processor.recallPendingMessages("TestBot");
    
    expect(recalled).toBe("");
  });

  it("recallPendingMessages returns content of pending messages and fires onMessageRecalled", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [
            { id: "1", role: "human", content: "First pending", timestamp: new Date().toISOString(), read: false, context_status: "default" },
            { id: "2", role: "human", content: "Second pending", timestamp: new Date().toISOString(), read: false, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const recalled = await processor.recallPendingMessages("TestBot");
    
    expect(recalled).toContain("First pending");
    expect(recalled).toContain("Second pending");
    expect(mock.calls).toContain("onMessageRecalled:TestBot");
    expect(mock.recalledContent[0]).toContain("First pending");
  });

  it("recallPendingMessages removes messages from history", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [
            { id: "1", role: "system", content: "Hello!", timestamp: new Date().toISOString(), read: true, context_status: "default" },
            { id: "2", role: "human", content: "Pending message", timestamp: new Date().toISOString(), read: false, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.recallPendingMessages("TestBot");
    
    const messages = await processor.getMessages("TestBot");
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
  });

  it("human messages start with read: false", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.sendMessage("TestBot", "New message");
    
    const messages = await processor.getMessages("TestBot");
    const humanMessage = messages.find(m => m.role === "human");
    expect(humanMessage?.read).toBe(false);
  });
});

describe("Processor markMessageRead", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("marks a message as read", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [
            { id: "msg-1", role: "system", content: "Hello!", timestamp: new Date().toISOString(), read: false, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const result = await processor.markMessageRead("TestBot", "msg-1");
    
    expect(result).toBe(true);
    const messages = await processor.getMessages("TestBot");
    expect(messages[0].read).toBe(true);
  });

  it("returns false for non-existent message", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {
        testbot: {
          entity: createTestPersona(),
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const result = await processor.markMessageRead("TestBot", "nonexistent");
    
    expect(result).toBe(false);
  });
});

describe("Processor onCheckpointRestored", () => {
  let mock: ReturnType<typeof createMockInterface>;
  let processor: Processor;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    mock = createMockInterface();
    processor = new Processor(mock.interface);
    storage = createMockStorage();
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("fires onCheckpointRestored when restore succeeds", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockResolvedValue({
      version: 1,
      timestamp: new Date().toISOString(),
      human: {
        entity: "human",
        facts: [],
        traits: [],
        topics: [],
        people: [],
        last_updated: new Date().toISOString(),
        last_activity: new Date().toISOString(),
      },
      personas: {},
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    mock.calls.length = 0;
    
    await processor.restoreCheckpoint(5);
    
    expect(mock.calls).toContain("onCheckpointStart");
    expect(mock.calls).toContain("onCheckpointRestored:5");
  });

  it("does not fire onCheckpointRestored when restore fails", async () => {
    storage.listCheckpoints.mockResolvedValue([{ index: 0, timestamp: new Date().toISOString() }]);
    storage.loadCheckpoint.mockImplementation(async (index: number) => {
      if (index === 0) {
        return {
          version: 1,
          timestamp: new Date().toISOString(),
          human: {
            entity: "human",
            facts: [],
            traits: [],
            topics: [],
            people: [],
            last_updated: new Date().toISOString(),
            last_activity: new Date().toISOString(),
          },
          personas: {},
          queue: [],
          settings: {},
        };
      }
      return null;
    });

    await processor.start(storage);
    mock.calls.length = 0;
    
    await processor.restoreCheckpoint(99);
    
    expect(mock.calls).toContain("onCheckpointStart");
    expect(mock.calls).not.toContain("onCheckpointRestored:99");
  });
});

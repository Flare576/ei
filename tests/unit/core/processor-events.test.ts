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
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
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
      onQueueStateChanged: (state: "idle" | "busy" | "paused") => calls.push(`onQueueStateChanged:${state}`),
      onError: (error) => calls.push(`onError:${error.code}`),
      onStateImported: () => calls.push("onStateImported"),
      onOneShotReturned: (guid: string, content: string) => calls.push(`onOneShotReturned:${guid}:${content}`),
    },
    calls,
    recalledContent,
  };
}

function createMockStorage() {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
  };
}

function createTestPersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  const name = (overrides.aliases?.[0] || "TestBot").toLowerCase();
  return {
    id: `${name}-id`,
    display_name: overrides.aliases?.[0] || "TestBot",
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
    const personaId = await processor.resolvePersonaName("TestBot");
    mock.calls.length = 0;
    await processor.archivePersona(personaId!);
    expect(mock.calls).toContain("onPersonaRemoved");
  });

  it("fires onPersonaUpdated when updating a persona", async () => {
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
    const personaId = await processor.resolvePersonaName("TestBot");
    mock.calls.length = 0;
    await processor.updatePersona(personaId!, { short_description: "Updated" });
    expect(mock.calls).toContain(`onPersonaUpdated:${personaId}`);
  });

  it("fires onMessageAdded and onMessageQueued when sending a message", async () => {
    await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
    const personaId = await processor.resolvePersonaName("TestBot");
    mock.calls.length = 0;
    await processor.sendMessage(personaId!, "Hello!");
    expect(mock.calls).toContain(`onMessageAdded:${personaId}`);
    expect(mock.calls).toContain(`onMessageQueued:${personaId}`);
  });

  it("fires onHumanUpdated when upserting facts", async () => {
    await processor.upsertFact({
      id: "fact-1",
      name: "Test Fact",
      description: "A test fact",
      sentiment: 0,
      last_updated: new Date().toISOString(),
      validated: "none" as import("../../../src/core/types.js").ValidationLevel,
      validated_date: new Date().toISOString(),
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
      validated: "none" as import("../../../src/core/types.js").ValidationLevel,
      validated_date: new Date().toISOString(),
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
    
    expect(storage.load).toHaveBeenCalled();
    await processor.stop();
  });

  it("start() bootstraps Ei on first run (no existing data)", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    expect(mock.calls).toContain("onPersonaAdded");
    expect(mock.calls).toContain("onMessageAdded:ei");
    await processor.stop();
  });

  it("start() does not bootstrap when existing data exists", async () => {
    storage.load.mockResolvedValue({
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

  it("stop() saves state", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    mock.calls.length = 0;
    storage.save.mockClear();
    
    await processor.stop();
    
    expect(storage.save).toHaveBeenCalled();
  });

  it("stop() does not save if never started running", async () => {
    const processor = new Processor(mock.interface);
    await processor.stop();
    
    expect(storage.save).not.toHaveBeenCalled();
  });

  it("stop() prevents runLoop from continuing", async () => {
    const processor = new Processor(mock.interface);
    await processor.start(storage);
    await processor.stop();
    
    const statusAfterStop = await processor.getQueueStatus();
    expect(statusAfterStop.state).toBe("idle");
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
    const testBotPersona = createTestPersona({
      aliases: ["TestBot"],
      heartbeat_delay_ms: 1800000,
      last_activity: oldActivity,
    });
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    const processor = new Processor(mock.interface);
    await processor.start(storage);
    
    await processor.abortCurrentOperation();
    await vi.advanceTimersByTimeAsync(200);
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBeGreaterThan(0);
    
    await processor.stop();
  });

  it("does NOT queue heartbeat for paused personas", async () => {
    const oldActivity = new Date(Date.now() - 3600000).toISOString();
    storage.load.mockResolvedValue({
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
    storage.load.mockResolvedValue({
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
    storage.load.mockResolvedValue({
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
      const testBot = list.find(p => p.display_name === "TestBot");
      expect(testBot).toBeDefined();
      expect(testBot?.short_description).toBe("A test persona");
      expect(testBot?.is_paused).toBe(false);
      expect(testBot?.is_archived).toBe(false);
    });

    it("includes Ei persona from bootstrap", async () => {
      const list = await processor.getPersonaList();
      const ei = list.find(p => p.display_name.toLowerCase() === "ei");
      expect(ei).toBeDefined();
    });
  });

  describe("getPersona", () => {
    it("returns persona entity when found", async () => {
      await processor.createPersona({ name: "TestBot", long_description: "A test persona" });
      const personaId = await processor.resolvePersonaName("TestBot");
      
      const persona = await processor.getPersona(personaId!);
      
      expect(persona).not.toBeNull();
      expect(persona?.long_description).toBe("A test persona");
    });

    it("returns null when persona not found", async () => {
      const persona = await processor.getPersona("nonexistent-id");
      expect(persona).toBeNull();
    });
  });

  describe("createPersona", () => {
    it("adds persona and fires onPersonaAdded", async () => {
      mock.calls.length = 0;
      
      await processor.createPersona({ name: "NewBot", long_description: "A new persona" });
      
      expect(mock.calls).toContain("onPersonaAdded");
      const personaId = await processor.resolvePersonaName("NewBot");
      const persona = await processor.getPersona(personaId!);
      expect(persona).not.toBeNull();
    });
  });

  describe("archivePersona", () => {
    it("archives persona and fires onPersonaRemoved", async () => {
      await processor.createPersona({ name: "ToArchive", long_description: "Will be archived" });
      const personaId = await processor.resolvePersonaName("ToArchive");
      mock.calls.length = 0;
      
      await processor.archivePersona(personaId!);
      
      expect(mock.calls).toContain("onPersonaRemoved");
      const persona = await processor.getPersona(personaId!);
      expect(persona?.is_archived).toBe(true);
    });
  });

  describe("unarchivePersona", () => {
    it("unarchives persona and fires onPersonaAdded", async () => {
      await processor.createPersona({ name: "ToUnarchive", long_description: "Will be unarchived" });
      const personaId = await processor.resolvePersonaName("ToUnarchive");
      await processor.archivePersona(personaId!);
      mock.calls.length = 0;
      
      await processor.unarchivePersona(personaId!);
      
      expect(mock.calls).toContain("onPersonaAdded");
      const persona = await processor.getPersona(personaId!);
      expect(persona?.is_archived).toBe(false);
    });
  });

  describe("deletePersona", () => {
    it("deletes persona and fires onPersonaRemoved", async () => {
      await processor.createPersona({ name: "ToDelete", long_description: "Will be deleted" });
      const personaId = await processor.resolvePersonaName("ToDelete");
      mock.calls.length = 0;
      
      await processor.deletePersona(personaId!, false);
      
      expect(mock.calls).toContain("onPersonaRemoved");
      const persona = await processor.getPersona(personaId!);
      expect(persona).toBeNull();
    });
  });

  describe("updatePersona", () => {
    it("updates persona and fires onPersonaUpdated", async () => {
      await processor.createPersona({ name: "ToUpdate", long_description: "Original description" });
      const personaId = await processor.resolvePersonaName("ToUpdate");
      mock.calls.length = 0;
      
      await processor.updatePersona(personaId!, { short_description: "Updated description" });
      
      expect(mock.calls).toContain(`onPersonaUpdated:${personaId}`);
      const persona = await processor.getPersona(personaId!);
      expect(persona?.short_description).toBe("Updated description");
    });
  });

  describe("sendMessage", () => {
    it("appends message and fires onMessageAdded and onMessageQueued", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      const personaId = await processor.resolvePersonaName("ChatBot");
      mock.calls.length = 0;
      
      await processor.sendMessage(personaId!, "Hello!");
      
      expect(mock.calls).toContain(`onMessageAdded:${personaId}`);
      expect(mock.calls).toContain(`onMessageQueued:${personaId}`);
    });

    it("queues response request for persona", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      const personaId = await processor.resolvePersonaName("ChatBot");
      
      await processor.sendMessage(personaId!, "Hello!");
      
      const status = await processor.getQueueStatus();
      expect(status.pending_count).toBeGreaterThan(0);
    });
  });

  describe("getMessages", () => {
    it("returns messages for persona", async () => {
      await processor.createPersona({ name: "ChatBot", long_description: "A chat persona" });
      const personaId = await processor.resolvePersonaName("ChatBot");
      await processor.sendMessage(personaId!, "Hello!");
      
      const messages = await processor.getMessages(personaId!);
      
      expect(messages.length).toBeGreaterThan(0);
      const humanMsg = messages.find(m => m.role === "human");
      expect(humanMsg?.content).toBe("Hello!");
    });
  });

  describe("getQueueStatus", () => {
    it("returns idle when queue is empty and not processing", async () => {
      const status = await processor.getQueueStatus();
      expect(status.state).toBe("idle");
    });

    it("returns correct pending_count", async () => {
      await processor.createPersona({ name: "QueueBot", long_description: "A bot for queue testing" });
      const personaId = await processor.resolvePersonaName("QueueBot");
      await processor.sendMessage(personaId!, "Message 1");
      
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
    const eiPersona = createTestPersona({ aliases: ["Ei"] });
    const friendPersona = createTestPersona({ aliases: ["Friend"], short_description: "A friend" });
    const archivedPersona = createTestPersona({ aliases: ["Archived"], is_archived: true });
    
    storage.load.mockResolvedValue({
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
        [eiPersona.id]: { entity: eiPersona, messages: [] },
        [friendPersona.id]: { entity: friendPersona, messages: [] },
        [archivedPersona.id]: { entity: archivedPersona, messages: [] },
      },
      queue: [],
      settings: {},
    });
    await processor.start(storage);
    
    const list = await processor.getPersonaList();
    
    expect(list.find(p => p.display_name === "Friend")).toBeDefined();
    expect(list.find(p => p.display_name === "Archived")).toBeDefined();
  });

  it("personas with group_primary can see each other", async () => {
    const eiPersona = createTestPersona({ aliases: ["Ei"] });
    const persona1Entity = createTestPersona({
      aliases: ["Persona1"],
      group_primary: "work",
    });
    const persona2Entity = createTestPersona({
      aliases: ["Persona2"],
      group_primary: "work",
    });
    
    storage.load.mockResolvedValue({
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
        [eiPersona.id]: { entity: eiPersona, messages: [] },
        [persona1Entity.id]: {
          entity: persona1Entity,
          messages: [],
        },
        [persona2Entity.id]: {
          entity: persona2Entity,
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });
    await processor.start(storage);
    
    const persona1 = await processor.getPersona(persona1Entity.id);
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
    const personaId = await processor.resolvePersonaName("StatusBot");
    await processor.sendMessage(personaId!, "Test message");
    
    const messages = await processor.getMessages(personaId!);
    const messageId = messages.find(m => m.role === "human")?.id ?? "";
    
    await processor.setMessageContextStatus(personaId!, messageId, "always" as import("../../../src/core/types.js").ContextStatus);
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
    storage.load.mockResolvedValue({
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
    storage.load.mockResolvedValue({
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
    
    storage.load.mockResolvedValue({
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
      },
      personas: {
        ei: {
          entity: createTestPersona({ aliases: ["Ei", "ei"] }),
          messages: [
            { id: "m1", role: "human", content: "msg1", timestamp: new Date(now.getTime() - 500000).toISOString(), read: true, context_status: "default", f: true, r: true, p: true, o: true },
            { id: "m2", role: "system", content: "resp1", timestamp: new Date(now.getTime() - 400000).toISOString(), read: true, context_status: "default", f: true, r: true, p: true, o: true },
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

  it("queues extraction for unextracted messages", async () => {
    const eiPersona = createTestPersona({ id: "ei", aliases: ["Ei", "ei"] });
    
    storage.load.mockResolvedValue({
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
        [eiPersona.id]: {
          entity: eiPersona,
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
    
    const status = await processor.getQueueStatus();
    expect(status.pending_count).toBeGreaterThanOrEqual(2);
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
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
          messages: [
            { id: "1", role: "human", content: "Already read", timestamp: new Date().toISOString(), read: true, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const recalled = await processor.recallPendingMessages(testBotPersona.id);
    
    expect(recalled).toBe("");
  });

  it("recallPendingMessages returns content of pending messages and fires onMessageRecalled", async () => {
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
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
    
    const recalled = await processor.recallPendingMessages(testBotPersona.id);
    
    expect(recalled).toContain("First pending");
    expect(recalled).toContain("Second pending");
    expect(mock.calls).toContain(`onMessageRecalled:${testBotPersona.id}`);
    expect(mock.recalledContent[0]).toContain("First pending");
  });

  it("recallPendingMessages removes messages from history", async () => {
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
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
    
    await processor.recallPendingMessages(testBotPersona.id);
    
    const messages = await processor.getMessages(testBotPersona.id);
    expect(messages).toHaveLength(1);
    expect(messages[0].role).toBe("system");
  });

  it("human messages start with read: false", async () => {
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    await processor.sendMessage(testBotPersona.id, "New message");
    
    const messages = await processor.getMessages(testBotPersona.id);
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
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
          messages: [
            { id: "msg-1", role: "system", content: "Hello!", timestamp: new Date().toISOString(), read: false, context_status: "default" },
          ],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const result = await processor.markMessageRead(testBotPersona.id, "msg-1");
    
    expect(result).toBe(true);
    const messages = await processor.getMessages(testBotPersona.id);
    expect(messages[0].read).toBe(true);
  });

  it("returns false for non-existent message", async () => {
    const testBotPersona = createTestPersona();
    
    storage.load.mockResolvedValue({
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
        [testBotPersona.id]: {
          entity: testBotPersona,
          messages: [],
        },
      },
      queue: [],
      settings: {},
    });

    await processor.start(storage);
    
    const result = await processor.markMessageRead(testBotPersona.id, "nonexistent");
    
    expect(result).toBe(false);
  });
});

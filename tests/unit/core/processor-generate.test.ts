import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, StorageState } from "../../../src/core/types.js";
import { LLMNextStep, LLMRequestType, LLMPriority } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handlePersonaGeneration: vi.fn(),
    handleFactFind: vi.fn(),
    handleHumanTopicScan: vi.fn(),
    handleHumanPersonScan: vi.fn(),
    handlePersonaTraitExtraction: vi.fn(),
    handlePersonaTopicDetection: vi.fn(),
    handlePersonaTopicExploration: vi.fn(),
    handleHeartbeatCheck: vi.fn(),
    handleEiHeartbeat: vi.fn(),
    handleOneShot: vi.fn(),
  },
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueReflectionDrain: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
}));

vi.mock("../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  findTopK: vi.fn((queryVec: number[], items: { id: string }[], k: number) =>
    items.slice(0, k).map((item, idx) => ({ item, similarity: 0.9 - idx * 0.1 }))
  ),
  needsEmbeddingUpdate: vi.fn(() => false),
  needsQuoteEmbeddingUpdate: vi.fn(() => false),
  computeDataItemEmbedding: vi.fn(),
  computeQuoteEmbedding: vi.fn(),
}));

function createMockInterface(): Ei_Interface {
  return {
    onPersonaAdded: vi.fn(),
    onPersonaRemoved: vi.fn(),
    onPersonaUpdated: vi.fn(),
    onMessageAdded: vi.fn(),
    onMessageProcessing: vi.fn(),
    onMessageQueued: vi.fn(),
    onMessageRecalled: vi.fn(),
    onHumanUpdated: vi.fn(),
    onQueueStateChanged: vi.fn(),
    onError: vi.fn(),
    onStateImported: vi.fn(),
    onOneShotReturned: vi.fn(),
    onDocumentGenerated: vi.fn(),
  };
}

function createMockStorage(preloadState?: any) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(preloadState ?? null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
  };
}

function makeFact(id: string, name: string) {
  return {
    id,
    name,
    description: `Description of ${name}`,
    sentiment: 0,
    last_updated: new Date().toISOString(),
    validated_date: "",
    embedding: new Array(384).fill(0.1),
  };
}

describe("Processor.generateDocument()", () => {
  let processor: Processor;
  let mockInterface: Ei_Interface;

  beforeEach(async () => {
    mockInterface = createMockInterface();
    processor = new Processor(mockInterface);
    const storage = createMockStorage(null);
    await processor.start(storage);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("throws when searchHumanData returns all empty arrays", async () => {
    await expect(processor.generateDocument("nonexistent topic")).rejects.toThrow(
      "No knowledge found about 'nonexistent topic'"
    );
  });

  it("queues request with type=Raw and next_step=HandleKnowledgeSynthesis", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));

    const { slug } = await processor.generateDocument("Test Subject");
    expect(slug).toBeTruthy();

    const activeItems = sm.queue_getAllActiveItems();
    const synthItem = activeItems.find(
      r => r.next_step === LLMNextStep.HandleKnowledgeSynthesis
    );
    expect(synthItem).toBeDefined();
    expect(synthItem!.type).toBe(LLMRequestType.Raw);
  });

  it("queues request with correct slug in data", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));

    const { slug } = await processor.generateDocument("Test Subject");

    const activeItems = sm.queue_getAllActiveItems();
    const synthItem = activeItems.find(
      r => r.next_step === LLMNextStep.HandleKnowledgeSynthesis
    );
    expect(synthItem!.data.slug).toBe(slug);
  });

  it("slug format: slugified subject + underscore + ISO timestamp", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "My Test Topic"));

    const { slug } = await processor.generateDocument("My Test Topic");

    expect(slug).toMatch(/^[a-z0-9-]{1,40}_\d{4}-\d{2}-\d{2}T/);
  });

  it("slug base is slugified from subject (lowercase, non-alphanumeric → dash)", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Hello World!"));

    const { slug } = await processor.generateDocument("Hello World!");

    expect(slug.startsWith("hello-world-")).toBe(true);
  });

  it("slug base is capped at 40 characters before the underscore", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "a very long subject name that exceeds forty characters easily"));

    const { slug } = await processor.generateDocument("a very long subject name that exceeds forty characters easily");

    const base = slug.split("_")[0];
    expect(base.length).toBeLessThanOrEqual(40);
  });

  it("calls bootstrapEmmett (Emmett persona exists after generateDocument)", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));

    await processor.generateDocument("Test Subject");

    const personas = await processor.getPersonaList();
    const emmett = personas.find(p => p.id === "emmet");
    expect(emmett).toBeDefined();
  });

  it("passes rewrite_model as model field when set", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, rewrite_model: "MyProvider:my-rewrite-model" } });
    await processor.generateDocument("Test Subject");

    const activeItems = sm.queue_getAllActiveItems();
    const synthItem = activeItems.find(
      r => r.next_step === LLMNextStep.HandleKnowledgeSynthesis
    );
    expect(synthItem!.model).toBe("MyProvider:my-rewrite-model");
  });

  it("passes undefined model when rewrite_model is not set", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));
    const human2 = sm.getHuman();
    sm.setHuman({ ...human2, settings: { ...human2.settings, rewrite_model: undefined } });

    await processor.generateDocument("Test Subject");

    const activeItems = sm.queue_getAllActiveItems();
    const synthItem = activeItems.find(
      r => r.next_step === LLMNextStep.HandleKnowledgeSynthesis
    );
    expect(synthItem!.model).toBeUndefined();
  });

  it("falls back to settings.conversation_model when rewrite_model is not set", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, rewrite_model: undefined, conversation_model: "MyProvider:conv-model" },
    });
    await processor.generateDocument("Test Subject");

    const activeItems = sm.queue_getAllActiveItems();
    const synthItem = activeItems.find(
      r => r.next_step === LLMNextStep.HandleKnowledgeSynthesis
    );
    expect(synthItem!.model).toBe("MyProvider:conv-model");
  });
});

describe("Processor.checkGenerationModel()", () => {
  let processor: Processor;

  beforeEach(async () => {
    processor = new Processor(createMockInterface());
    await processor.start(createMockStorage(null));
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("returns isRewriteModel=true with rewrite_model when set", () => {
    const sm = processor.getStateManager();
    const h = sm.getHuman();
    sm.setHuman({ ...h, settings: { ...h.settings, rewrite_model: "Provider:sonnet" } });

    const result = processor.checkGenerationModel();
    expect(result.isRewriteModel).toBe(true);
    expect(result.model).toBe("Provider:sonnet");
  });

  it("returns isRewriteModel=false with conversation_model when no rewrite_model", () => {
    const sm = processor.getStateManager();
    const h = sm.getHuman();
    sm.setHuman({ ...h, settings: { ...h.settings, rewrite_model: undefined, conversation_model: "Provider:default" } });

    const result = processor.checkGenerationModel();
    expect(result.isRewriteModel).toBe(false);
    expect(result.model).toBe("Provider:default");
  });

  it("returns 'unknown' when neither rewrite_model nor conversation_model is set", () => {
    const sm = processor.getStateManager();
    const h = sm.getHuman();
    sm.setHuman({ ...h, settings: { ...h.settings, rewrite_model: undefined, conversation_model: undefined } });

    const result = processor.checkGenerationModel();
    expect(result.isRewriteModel).toBe(false);
    expect(result.model).toBe("unknown");
  });

  it("backward-read: old-shape state (only default_model set, pre-migration) still resolves a usable model", async () => {
    const sm = processor.getStateManager();
    const restoredState: StorageState = createDefaultTestState();
    restoredState.human.settings = { default_model: "Provider:legacy" };

    sm.restoreFromState(restoredState);

    const result = processor.checkGenerationModel();
    expect(result.isRewriteModel).toBe(false);
    expect(result.model).toBe("Provider:legacy");
  });
});

describe("Processor.getGeneratedDocumentContent()", () => {
  let processor: Processor;

  beforeEach(async () => {
    processor = new Processor(createMockInterface());
    await processor.start(createMockStorage(null));
    processor.getStateManager().persona_add({
      id: "emmet",
      entity: "persona",
      display_name: "Emmett",
      last_updated: new Date().toISOString(),
      tools: [],
    });
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("returns null for non-existent slug", async () => {
    const result = await processor.getGeneratedDocumentContent("nonexistent-slug");
    expect(result).toBeNull();
  });

  it("returns content for matching slug", async () => {
    const sm = processor.getStateManager();
    const slug = "test-slug_2026-05-04T00-00-00-000Z";
    sm.messages_append("emmet", {
      id: `generate:document:${slug}:msg-1`,
      role: "assistant",
      content: "# Generated Document\n\nSome content here.",
      timestamp: new Date().toISOString(),
    });

    const result = await processor.getGeneratedDocumentContent(slug);
    expect(result).toBe("# Generated Document\n\nSome content here.");
  });

  it("returns null when slug doesn't match any message source_tag", async () => {
    const sm = processor.getStateManager();
    sm.messages_append("emmet", {
      id: "msg-2",
      role: "assistant",
      content: "Some content.",
      timestamp: new Date().toISOString(),
      source_tag: "generate:document:other-slug_2026-05-04T00-00-00-000Z",
    });

    const result = await processor.getGeneratedDocumentContent("different-slug_2026-05-04T00-00-00-000Z");
    expect(result).toBeNull();
  });
});

describe("QueueStatus.generating_documents", () => {
  let processor: Processor;

  beforeEach(async () => {
    processor = new Processor(createMockInterface());
    await processor.start(createMockStorage(null));
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("includes slugs from active HandleKnowledgeSynthesis items", async () => {
    const sm = processor.getStateManager();
    sm.getHuman().facts.push(makeFact("f1", "Test Subject"));

    const { slug } = await processor.generateDocument("Test Subject");

    const status = await processor.getQueueStatus();
    expect(status.generating_documents).toBeDefined();
    expect(status.generating_documents).toContain(slug);
  });

  it("is undefined when no HandleKnowledgeSynthesis items are active", async () => {
    const status = await processor.getQueueStatus();
    expect(status.generating_documents).toBeUndefined();
  });
});

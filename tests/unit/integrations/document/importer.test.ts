import { describe, it, expect, vi } from "vitest";
import { LLMRequestType, LLMPriority, LLMNextStep, type HumanEntity, type HumanSettings, type Ei_Interface } from "../../../../src/core/types.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import { importDocument } from "../../../../src/integrations/document/importer.js";

function makeHuman(settings: HumanSettings): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings,
  };
}

function createMockStateManager(settings: HumanSettings) {
  const human = makeHuman(settings);
  return {
    getHuman: vi.fn(() => human),
    persona_getById: vi.fn(() => undefined),
    persona_unarchive: vi.fn(),
    persona_add: vi.fn(),
    messages_get: vi.fn(() => []),
    messages_remove: vi.fn(),
    queue_enqueue: vi.fn(),
  };
}

function createMockInterface(): Ei_Interface {
  return { onPersonaAdded: vi.fn() };
}

const CONTENT = "Test document content for extraction model resolution.";
const FILENAME = "notes.txt";

describe("importDocument — extraction model 3-tier fallback", () => {
  it("tier 1: per-integration override (document.extraction_model) wins over settings.extraction_model and settings.conversation_model", async () => {
    const state = createMockStateManager({
      document: { extraction_model: "doc-override-guid" },
      extraction_model: "settings-extraction-guid",
      conversation_model: "settings-conversation-guid",
    });

    await importDocument({
      stateManager: state as unknown as StateManager,
      interface: createMockInterface(),
      content: CONTENT,
      filename: FILENAME,
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        next_step: LLMNextStep.HandleDocumentSegmentation,
        model: "doc-override-guid",
      })
    );
  });

  it("tier 2: settings.extraction_model wins over settings.conversation_model when no per-integration override is set", async () => {
    const state = createMockStateManager({
      document: {},
      extraction_model: "settings-extraction-guid",
      conversation_model: "settings-conversation-guid",
    });

    await importDocument({
      stateManager: state as unknown as StateManager,
      interface: createMockInterface(),
      content: CONTENT,
      filename: FILENAME,
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ model: "settings-extraction-guid" })
    );
  });

  it("tail: falls back to settings.conversation_model when extraction_model is unset at every tier — never empty/undefined", async () => {
    const state = createMockStateManager({
      document: {},
      conversation_model: "settings-conversation-guid",
      // extraction_model intentionally omitted at both document and top-level settings tiers.
    });

    await importDocument({
      stateManager: state as unknown as StateManager,
      interface: createMockInterface(),
      content: CONTENT,
      filename: FILENAME,
    });

    const call = state.queue_enqueue.mock.calls[0]?.[0] as { model?: string } | undefined;
    expect(call?.model).toBe("settings-conversation-guid");
    expect(call?.model).not.toBeUndefined();
    expect(call?.model).not.toBe("");
  });

  it("tail: no settings at all still queues without throwing (model resolves to undefined only when conversation_model itself is unset)", async () => {
    // This documents the boundary the 3-tier chain does NOT cover: if
    // conversation_model is itself unset (a state that should be impossible
    // post-migration per T1/T5), the chain has nothing left to fall back to.
    const state = createMockStateManager({});

    await importDocument({
      stateManager: state as unknown as StateManager,
      interface: createMockInterface(),
      content: CONTENT,
      filename: FILENAME,
    });

    const call = state.queue_enqueue.mock.calls[0]?.[0] as { model?: string } | undefined;
    expect(call?.model).toBeUndefined();
  });
});

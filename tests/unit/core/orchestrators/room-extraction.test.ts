import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HumanEntity, PersonaEntity, HumanSettings, Message } from "../../../../src/core/types.js";
import type { StateManager } from "../../../../src/core/state-manager.js";

const mockQueueTopicScan = vi.fn();
const mockQueuePersonScan = vi.fn();
const mockQueueEventSummary = vi.fn();
vi.mock("../../../../src/core/orchestrators/human-extraction.js", () => ({
  queueTopicScan: (...args: unknown[]) => mockQueueTopicScan(...args),
  queuePersonScan: (...args: unknown[]) => mockQueuePersonScan(...args),
  queueEventSummary: (...args: unknown[]) => mockQueueEventSummary(...args),
}));

const mockQueuePersonaTopicRating = vi.fn();
vi.mock("../../../../src/core/orchestrators/persona-topics.js", () => ({
  queuePersonaTopicRating: (...args: unknown[]) => mockQueuePersonaTopicRating(...args),
}));

import { queuePersonaCapture } from "../../../../src/core/orchestrators/room-extraction.js";

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

function makePersona(): PersonaEntity {
  return {
    id: "ei",
    display_name: "Ei",
    entity: "system",
    aliases: ["ei"],
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "",
  };
}

function makeMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: "hi",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: "default",
    t: true,
    p: true,
  } as Message;
}

function createMockStateManager(settings: HumanSettings) {
  const human = makeHuman(settings);
  const persona = makePersona();
  return {
    getHuman: vi.fn(() => human),
    persona_getById: vi.fn(() => persona),
    messages_get: vi.fn(() => [makeMessage("m1")]),
    messages_getUnextracted: vi.fn(() => [makeMessage("m1")]),
    messages_getUnextractedForPersona: vi.fn(() => []),
  };
}

describe("queuePersonaCapture — extraction model 3-tier fallback tail (room-extraction.ts:341)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves settings.extraction_model when set (tier 2 — no per-integration override input at this call site)", () => {
    const state = createMockStateManager({
      extraction_model: "settings-extraction-guid",
      conversation_model: "settings-conversation-guid",
    });

    queuePersonaCapture(state as unknown as StateManager, "ei");

    expect(mockQueueTopicScan).toHaveBeenCalledWith(
      expect.anything(),
      state,
      { extraction_model: "settings-extraction-guid" }
    );
    expect(mockQueuePersonScan).toHaveBeenCalledWith(
      expect.anything(),
      state,
      { extraction_model: "settings-extraction-guid" }
    );
    expect(mockQueueEventSummary).toHaveBeenCalledWith(
      "ei",
      state,
      { extraction_model: "settings-extraction-guid" }
    );
  });

  it("falls back to settings.conversation_model when extraction_model is unset at every tier — never undefined (tail)", () => {
    const state = createMockStateManager({
      conversation_model: "settings-conversation-guid",
      // extraction_model intentionally omitted — proves the tail, not the deprecated default_model.
    });

    queuePersonaCapture(state as unknown as StateManager, "ei");

    const optionsArg = mockQueueTopicScan.mock.calls[0]?.[2] as { extraction_model?: string } | undefined;
    expect(optionsArg?.extraction_model).toBe("settings-conversation-guid");
    expect(optionsArg?.extraction_model).not.toBeUndefined();
    expect(optionsArg?.extraction_model).not.toBe("");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LLMNextStep, RoomMode, type HumanEntity, type PersonaEntity, type HumanSettings, type Message, type RoomEntity, type RoomMessage } from "../../../../src/core/types.js";
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

import { queuePersonaCapture, queueRoomCapture } from "../../../../src/core/orchestrators/room-extraction.js";

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

function createRoomCaptureState(flags: Pick<RoomMessage, "t" | "p" | "e">) {
  const human = makeHuman({
    extraction_model: "extraction-guid",
    conversation_model: "conversation-guid",
  });
  const persona = makePersona();
  const message: RoomMessage = {
    id: "old-room-message",
    parent_id: null,
    role: "human",
    content: "A deterministic old room message.",
    timestamp: "2020-01-01T00:00:00.000Z",
    read: true,
    context_status: "default" as RoomMessage["context_status"],
    ...flags,
  };
  const room: RoomEntity = {
    id: "room-1",
    display_name: "Test Room",
    entity: "room",
    mode: RoomMode.FreeForAll,
    persona_ids: [persona.id],
    active_node_id: null,
    is_archived: false,
    created_at: "2020-01-01T00:00:00.000Z",
    last_updated: "2020-01-01T00:00:00.000Z",
    messages: [message],
  };
  const queue_enqueue = vi.fn();
  const state = {
    getHuman: vi.fn(() => human),
    getRoom: vi.fn((roomId: string) => roomId === room.id ? room : undefined),
    getRoomMessages: vi.fn((roomId: string) => roomId === room.id ? [message] : []),
    getRoomActivePath: vi.fn(() => [message]),
    persona_getById: vi.fn((personaId: string) => personaId === persona.id ? persona : undefined),
    markRoomMessagesExtracted: vi.fn(() => 1),
    getRoomUnextractedMessagesForPersona: vi.fn(() => []),
    queue_enqueue,
  };

  return { state, queue_enqueue };
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

describe("queueRoomCapture — extraction model propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Tested by Beta — 2026-07-15
  it("enqueues topic scans with the extraction model in the request and descendant data", () => {
    // Arrange
    const { state, queue_enqueue } = createRoomCaptureState({ t: false, p: true, e: true });

    // Act
    queueRoomCapture(state as unknown as StateManager, "room-1");

    // Assert
    expect(queue_enqueue).toHaveBeenCalledTimes(1);
    expect(queue_enqueue.mock.calls[0]?.[0]).toMatchObject({
      next_step: LLMNextStep.HandleHumanTopicScan,
      model: "extraction-guid",
      data: { extraction_model: "extraction-guid" },
    });
  });

  // Tested by Beta — 2026-07-15
  it("enqueues person scans with the extraction model in the request and descendant data", () => {
    // Arrange
    const { state, queue_enqueue } = createRoomCaptureState({ t: true, p: false, e: true });

    // Act
    queueRoomCapture(state as unknown as StateManager, "room-1");

    // Assert
    expect(queue_enqueue).toHaveBeenCalledTimes(1);
    expect(queue_enqueue.mock.calls[0]?.[0]).toMatchObject({
      next_step: LLMNextStep.HandleHumanPersonScan,
      model: "extraction-guid",
      data: { extraction_model: "extraction-guid" },
    });
  });

  // Tested by Beta — 2026-07-15
  it("enqueues event scans with the extraction model in the request and descendant data", () => {
    // Arrange
    const { state, queue_enqueue } = createRoomCaptureState({ t: true, p: true, e: false });

    // Act
    queueRoomCapture(state as unknown as StateManager, "room-1");

    // Assert
    expect(queue_enqueue).toHaveBeenCalledTimes(1);
    expect(queue_enqueue.mock.calls[0]?.[0]).toMatchObject({
      next_step: LLMNextStep.HandleEventScan,
      model: "extraction-guid",
      data: { extraction_model: "extraction-guid" },
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonMatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getTopicEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getPersonEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
}));

vi.mock("../../../../src/core/llm-client.js", () => ({
  cleanResponseContent: vi.fn((content: string) => content),
  parseJSONResponse: vi.fn(),
}));

vi.mock("../../../../src/core/prompt-context-builder.js", () => ({
  buildRoomResponsePromptData: vi.fn().mockResolvedValue({ system: "", user: "" }),
}));

import { handleRoomJudge } from "../../../../src/core/handlers/rooms.js";
import {
  ContextStatus,
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequest,
  type LLMResponse,
  type LLMRequestState,
} from "../../../../src/core/types.js";
import type { RoomMessage, RoomEntity } from "../../../../src/core/types/rooms.js";
import type { PersonaEntity, HumanEntity } from "../../../../src/core/types/entities.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { RoomJudgeResult } from "../../../../src/prompts/room/index.js";

// ─── Factories ────────────────────────────────────────────────────────────────

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "TestPersona",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function makeRoomMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: crypto.randomUUID(),
    parent_id: "parent-msg-1",
    role: "persona",
    persona_id: "persona-1",
    content: "My response",
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

function makeRoom(overrides: Partial<RoomEntity> = {}): RoomEntity {
  return {
    id: "room-1",
    display_name: "Test Room",
    entity: "room",
    mode: "map" as any,
    persona_ids: ["persona-1", "persona-2"],
    judge_persona_id: "judge-1",
    active_node_id: null,
    is_archived: false,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    messages: [],
    ...overrides,
  };
}

function makeJudgeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "judge-req-1",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.Raw,
    priority: LLMPriority.Room,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleRoomJudge,
    data: {
      roomId: "room-1",
      judgePersonaId: "judge-1",
      judgePersonaDisplayName: "TheJudge",
    },
    ...overrides,
  };
}

function makeJudgeResponse(
  result: Partial<RoomJudgeResult> | null,
  requestOverrides: Partial<LLMRequest> = {}
): LLMResponse {
  return {
    request: makeJudgeRequest(requestOverrides),
    success: true,
    content: null,
    parsed: result ?? undefined,
    error: undefined,
  };
}

// ─── Mock State Factory ───────────────────────────────────────────────────────

function createMockRoomState(options: {
  messages?: RoomMessage[];
  room?: RoomEntity | null;
  setRoomActiveNodeResult?: boolean;
  personaById?: (id: string) => PersonaEntity | null;
  humanSettings?: HumanEntity["settings"];
} = {}) {
  const _roomMessages: RoomMessage[] = [];
  const _queuedRequests: any[] = [];
  const _removedMessageIds: string[] = [];

  const messages = options.messages ?? [];
  const room = options.room !== undefined ? options.room : makeRoom();
  const setResult = options.setRoomActiveNodeResult ?? true;

  return {
    getRoomMessages: vi.fn(() => messages),
    setRoomActiveNode: vi.fn(() => setResult),
    removeRoomMessages: vi.fn((_roomId: string, ids: string[]) => {
      _removedMessageIds.push(...ids);
    }),
    appendRoomMessage: vi.fn((_roomId: string, msg: any) => {
      _roomMessages.push(msg);
    }),
    getRoom: vi.fn(() => room),
    persona_getById: vi.fn((id: string) => {
      if (options.personaById) return options.personaById(id);
      return makePersona({ id });
    }),
    queue_enqueue: vi.fn((req: any) => {
      _queuedRequests.push(req);
      return "enqueued-id";
    }),
    getHuman: vi.fn(() => ({
      settings: options.humanSettings ?? { conversation_model: "test-model" },
    })),
    // Inspection handles
    _roomMessages,
    _queuedRequests,
    _removedMessageIds,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleRoomJudge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Validation & Error Handling ──────────────────────────────────────────

  it("throws when roomId is missing from request data", async () => {
    const state = createMockRoomState();
    const response = makeJudgeResponse(
      { winner_message_id: "msg-1" },
      { data: { judgePersonaId: "judge-1", judgePersonaDisplayName: "TheJudge" } }
    );

    await expect(handleRoomJudge(response, state as any)).rejects.toThrow(
      "[handleRoomJudge] Missing roomId"
    );
  });

  it("throws when response.parsed is missing", async () => {
    const state = createMockRoomState();
    const response = makeJudgeResponse(null);

    await expect(handleRoomJudge(response, state as any)).rejects.toThrow(
      "[handleRoomJudge] No parsed result"
    );
  });

  it("throws when result has no winner_message_id", async () => {
    const state = createMockRoomState();
    const response = makeJudgeResponse({ winner_message_id: "" });

    await expect(handleRoomJudge(response, state as any)).rejects.toThrow(
      "[handleRoomJudge] Judge"
    );
  });

  it("throws when winner_message_id is not found in room messages", async () => {
    const state = createMockRoomState({ messages: [] });
    const response = makeJudgeResponse({ winner_message_id: "nonexistent-id" });

    await expect(handleRoomJudge(response, state as any)).rejects.toThrow(
      "[handleRoomJudge] Winner message nonexistent-id not found"
    );
  });

  it("throws when setRoomActiveNode returns false", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const state = createMockRoomState({
      messages: [winner],
      setRoomActiveNodeResult: false,
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await expect(handleRoomJudge(response, state as any)).rejects.toThrow(
      "[handleRoomJudge] Could not set active node"
    );
  });

  // ── Normal Flow ──────────────────────────────────────────────────────────

  it("sets active node to winner_message_id", async () => {
    const winner = makeRoomMessage({ id: "winner-id", parent_id: "parent-1" });
    const state = createMockRoomState({ messages: [winner] });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    expect(state.setRoomActiveNode).toHaveBeenCalledWith("room-1", "winner-id");
  });

  it("deletes all sibling messages sharing the same parent_id as the winner", async () => {
    const winner = makeRoomMessage({ id: "winner-id", parent_id: "parent-1" });
    const loser1 = makeRoomMessage({ id: "loser-1", parent_id: "parent-1" });
    const loser2 = makeRoomMessage({ id: "loser-2", parent_id: "parent-1" });
    // A message from a different round (different parent_id) — must NOT be deleted
    const otherRound = makeRoomMessage({ id: "other-round", parent_id: "parent-2" });

    const state = createMockRoomState({
      messages: [winner, loser1, loser2, otherRound],
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    expect(state._removedMessageIds).toContain("loser-1");
    expect(state._removedMessageIds).toContain("loser-2");
    expect(state._removedMessageIds).not.toContain("winner-id");
    expect(state._removedMessageIds).not.toContain("other-round");
  });

  it("does not call removeRoomMessages when there are no losers", async () => {
    const winner = makeRoomMessage({ id: "winner-id", parent_id: "parent-1" });
    // Only the winner exists under this parent — nothing to delete
    const state = createMockRoomState({ messages: [winner] });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    expect(state.removeRoomMessages).not.toHaveBeenCalled();
  });

  it("appends verdict message when result.reason is present", async () => {
    const winner = makeRoomMessage({ id: "winner-id", parent_id: "parent-1" });
    const state = createMockRoomState({ messages: [winner] });
    const response = makeJudgeResponse({
      winner_message_id: "winner-id",
      reason: "The best argument won.",
    });

    await handleRoomJudge(response, state as any);

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    const verdictMsg = state._roomMessages[0];
    expect(verdictMsg.silence_reason).toBe("The best argument won.");
    expect(verdictMsg.role).toBe("persona");
    expect(verdictMsg.persona_id).toBe("judge-1");
    expect(verdictMsg.parent_id).toBe("parent-1");
    expect(verdictMsg.content).toBeUndefined();
  });

  it("does not append verdict message when result.reason is absent", async () => {
    const winner = makeRoomMessage({ id: "winner-id", parent_id: "parent-1" });
    const state = createMockRoomState({ messages: [winner] });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    expect(state.appendRoomMessage).not.toHaveBeenCalled();
  });

  // ── Next-Round Queue ─────────────────────────────────────────────────────

  it("queues HandleRoomResponse for each non-judge persona", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({
      persona_ids: ["persona-1", "persona-2", "judge-1"],
      judge_persona_id: "judge-1",
    });
    const state = createMockRoomState({
      messages: [winner],
      room,
      personaById: (id) => makePersona({ id, is_archived: false, is_paused: false }),
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    const enqueuedPersonaIds = state._queuedRequests.map((r) => r.data.personaId);
    expect(enqueuedPersonaIds).toContain("persona-1");
    expect(enqueuedPersonaIds).toContain("persona-2");
    // Judge must not be queued
    expect(enqueuedPersonaIds).not.toContain("judge-1");
  });

  it("does not queue HandleRoomResponse for archived personas", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({
      persona_ids: ["persona-active", "persona-archived"],
      judge_persona_id: "judge-1",
    });
    const state = createMockRoomState({
      messages: [winner],
      room,
      personaById: (id) =>
        makePersona({
          id,
          is_archived: id === "persona-archived",
          is_paused: false,
        }),
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    const enqueuedPersonaIds = state._queuedRequests.map((r) => r.data.personaId);
    expect(enqueuedPersonaIds).toContain("persona-active");
    expect(enqueuedPersonaIds).not.toContain("persona-archived");
  });

  it("does not queue HandleRoomResponse for paused personas", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({
      persona_ids: ["persona-active", "persona-paused"],
      judge_persona_id: "judge-1",
    });
    const state = createMockRoomState({
      messages: [winner],
      room,
      personaById: (id) =>
        makePersona({
          id,
          is_archived: false,
          is_paused: id === "persona-paused",
        }),
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    const enqueuedPersonaIds = state._queuedRequests.map((r) => r.data.personaId);
    expect(enqueuedPersonaIds).toContain("persona-active");
    expect(enqueuedPersonaIds).not.toContain("persona-paused");
  });

  it("queued requests use winner_message_id as parentMessageId for next round", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({
      persona_ids: ["persona-1"],
      judge_persona_id: "judge-1",
    });
    const state = createMockRoomState({ messages: [winner], room });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as any);

    expect(state._queuedRequests[0].data.parentMessageId).toBe("winner-id");
    expect(state._queuedRequests[0].next_step).toBe(LLMNextStep.HandleRoomResponse);
  });

  // ── Model resolution (persona.model || settings.conversation_model) ────────

  it("uses persona.model for the queued response when set", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({ persona_ids: ["persona-1"], judge_persona_id: "judge-1" });
    const state = createMockRoomState({
      messages: [winner],
      room,
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id, model: "Persona:override" }),
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as unknown as StateManager);

    expect(state._queuedRequests[0].model).toBe("Persona:override");
  });

  it("falls back to settings.conversation_model for the queued response when persona.model is unset", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const room = makeRoom({ persona_ids: ["persona-1"], judge_persona_id: "judge-1" });
    const state = createMockRoomState({
      messages: [winner],
      room,
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id }),
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    await handleRoomJudge(response, state as unknown as StateManager);

    expect(state._queuedRequests[0].model).toBe("conv-guid");
  });

  it("skips queue when getRoom returns null after deletion", async () => {
    const winner = makeRoomMessage({ id: "winner-id" });
    const state = createMockRoomState({
      messages: [winner],
      room: null,
    });
    const response = makeJudgeResponse({ winner_message_id: "winner-id" });

    // Should not throw — early return when room is null
    await expect(handleRoomJudge(response, state as any)).resolves.toBeUndefined();
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });
});

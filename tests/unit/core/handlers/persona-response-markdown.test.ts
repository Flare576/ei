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

import { getMessageContent } from "../../../../src/core/handlers/utils.js";
import { handlePersonaResponse } from "../../../../src/core/handlers/persona-response.js";
import { handleRoomResponse } from "../../../../src/core/handlers/rooms.js";
import { PersonaState } from "../../../../src/core/state/index.js";

import {
  ContextStatus,
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequest,
  type LLMResponse,
  type LLMRequestState,
  type Message,
} from "../../../../src/core/types.js";

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "test-id",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.Raw,
    priority: LLMPriority.High,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandlePersonaResponse,
    data: {
      personaId: "persona-1",
      personaDisplayName: "TestPersona",
    },
    ...overrides,
  };
}

function makeResponse(content: string | null, request?: LLMRequest): LLMResponse {
  const req = request ?? makeRequest();
  return {
    request: req,
    success: content !== null,
    content,
    parsed: undefined,
    error: content === null ? "no content" : undefined,
  };
}

function createMockState() {
  const appendedMessages: Message[] = [];
  const appendedRoomMessages: any[] = [];

  return {
    messages_markPendingAsRead: vi.fn(),
    messages_append: vi.fn((_personaId: string, msg: Message) => {
      appendedMessages.push(msg);
    }),
    appendRoomMessage: vi.fn((_roomId: string, msg: any) => {
      appendedRoomMessages.push(msg);
    }),
    getHuman: vi.fn(() => ({ settings: {} })),
    persona_getById: vi.fn(() => null),
    queue_enqueue: vi.fn(),
    getRoomMessages: vi.fn(() => []),
    getRoom: vi.fn(() => null),
    _messages: appendedMessages,
    _roomMessages: appendedRoomMessages,
  };
}

describe("getMessageContent()", () => {
  it("returns content when present", () => {
    expect(getMessageContent({ content: "Hello there" })).toBe("Hello there");
  });

  it("returns content even when other fields also present", () => {
    expect(
      getMessageContent({
        content: "content wins",
        verbal_response: "verbal ignored",
        action_response: "action ignored",
      })
    ).toBe("content wins");
  });

  it("returns _action_\\n\\nverbal when action_response and verbal_response present but no content", () => {
    expect(
      getMessageContent({
        action_response: "leans forward",
        verbal_response: "Hello there",
      })
    ).toBe("_leans forward_\n\nHello there");
  });

  it("returns _action_ alone when only action_response present", () => {
    expect(getMessageContent({ action_response: "waves hand" })).toBe("_waves hand_");
  });

  it("returns verbal_response when only verbal_response present", () => {
    expect(getMessageContent({ verbal_response: "Just words" })).toBe("Just words");
  });

  it("returns empty string when nothing is present", () => {
    expect(getMessageContent({})).toBe("");
  });
});

describe("handlePersonaResponse — No Response parsing", () => {
  let state: ReturnType<typeof createMockState>;

  beforeEach(() => {
    state = createMockState();
    vi.clearAllMocks();
  });

  const silenceCases = [
    ["## No Response", "exact double-hash"],
    ["# No Response", "single hash (H1)"],
    ["# # No Response", "spaced hashes (model typo)"],
    ["## no response", "lowercase"],
    ["No Response", "no hash at all"],
    ["No_Response", "underscore variant"],
    ["**No Response**", "bold variant"],
    ["no response ##", "trailing hashes"],
  ];

  it.each(silenceCases)('detects silence for "%s" (%s)', (input) => {
    handlePersonaResponse(makeResponse(input), state as any);

    expect(state.messages_append).toHaveBeenCalledTimes(1);
    const msg: Message = state._messages[0];
    expect(msg.content).toBeUndefined();
  });

  it('stores reason text on subsequent lines', () => {
    handlePersonaResponse(makeResponse("## No Response\n\nThe user said goodnight"), state as any);

    const msg: Message = state._messages[0];
    expect(msg.silence_reason).toBe("The user said goodnight");
    expect(msg.content).toBeUndefined();
  });

  it('stores undefined silence_reason when no reason text follows', () => {
    handlePersonaResponse(makeResponse("## No Response"), state as any);

    expect(state._messages[0].silence_reason).toBeUndefined();
  });

  it('does NOT treat normal italic action as no-response', () => {
    handlePersonaResponse(makeResponse("_leans forward_\n\nHello there"), state as any);

    const msg: Message = state._messages[0];
    expect(msg.content).toBe("_leans forward_\n\nHello there");
    expect(msg.silence_reason).toBeUndefined();
  });

  it('does NOT match no-response heading mid-message', () => {
    handlePersonaResponse(makeResponse("Some text\n\n## No Response"), state as any);

    const msg: Message = state._messages[0];
    expect(msg.content).toBe("Some text\n\n## No Response");
    expect(msg.silence_reason).toBeUndefined();
  });

  it("silence message has correct role and context_status", () => {
    handlePersonaResponse(makeResponse("## No Response\n\nGoodnight"), state as any);

    const msg: Message = state._messages[0];
    expect(msg.role).toBe("system");
    expect(msg.context_status).toBe(ContextStatus.Default);
    expect(msg.read).toBe(false);
  });
});

describe("handleRoomResponse — ## No Response parsing", () => {
  let state: ReturnType<typeof createMockState>;

  function makeRoomRequest(): LLMRequest {
    return makeRequest({
      next_step: LLMNextStep.HandleRoomResponse,
      data: {
        roomId: "room-1",
        personaId: "persona-1",
        personaDisplayName: "TestPersona",
        parentMessageId: null,
      },
    });
  }

  beforeEach(() => {
    state = createMockState();
    vi.clearAllMocks();
  });

  it('matches exact "## No Response" and stores silence room message', () => {
    handleRoomResponse(makeResponse("## No Response", makeRoomRequest()), state as any);

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    const msg = state._roomMessages[0];
    expect(msg.silence_reason).toBeUndefined();
    expect(msg.content).toBeUndefined();
  });

  it('matches lowercase "## no response"', () => {
    handleRoomResponse(makeResponse("## no response", makeRoomRequest()), state as any);

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    expect(state._roomMessages[0].content).toBeUndefined();
  });

  it('stores reason when present after "## No Response"', () => {
    handleRoomResponse(
      makeResponse("## No Response\n\nThe user said goodnight", makeRoomRequest()),
      state as any
    );

    expect(state._roomMessages[0].silence_reason).toBe("The user said goodnight");
  });

  it('does NOT treat normal content as no-response', () => {
    handleRoomResponse(
      makeResponse("_leans forward_\n\nHello there", makeRoomRequest()),
      state as any
    );

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    const msg = state._roomMessages[0];
    expect(msg.content).toBe("_leans forward_\n\nHello there");
    expect(msg.silence_reason).toBeUndefined();
  });

  it('does NOT match when heading is not at start of string', () => {
    handleRoomResponse(
      makeResponse("Some text\n\n## No Response", makeRoomRequest()),
      state as any
    );

    const msg = state._roomMessages[0];
    expect(msg.content).toBe("Some text\n\n## No Response");
    expect(msg.silence_reason).toBeUndefined();
  });

  it("silence room message has correct role and persona_id", () => {
    handleRoomResponse(
      makeResponse("## No Response\n\nGoodnight", makeRoomRequest()),
      state as any
    );

    const msg = state._roomMessages[0];
    expect(msg.role).toBe("persona");
    expect(msg.persona_id).toBe("persona-1");
    expect(msg.read).toBe(false);
  });
});

describe("PersonaState.load() — migrateMessage() round-trip", () => {
  const basePersona = {
    id: "p-1",
    display_name: "TestBot",
    entity: "system" as const,
    aliases: [],
    short_description: "Test",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  const baseMsg = {
    id: "msg-1",
    role: "system" as const,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };

  it("migrates verbal_response-only message → content field, clears verbal_response", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg, verbal_response: "Hello there" } as any],
      },
    });

    const messages = state.messages_get("p-1");
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe("Hello there");
    expect(messages[0].verbal_response).toBeUndefined();
  });

  it("migrates action_response + verbal_response → italic+verbal content, clears both fields", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [
          { ...baseMsg, action_response: "leans forward", verbal_response: "Hello there" } as any,
        ],
      },
    });

    const messages = state.messages_get("p-1");
    expect(messages[0].content).toBe("_leans forward_\n\nHello there");
    expect(messages[0].action_response).toBeUndefined();
    expect(messages[0].verbal_response).toBeUndefined();
  });

  it("skips migration for message that already has content", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg, content: "Already migrated" } as any],
      },
    });

    expect(state.messages_get("p-1")[0].content).toBe("Already migrated");
  });

  it("skips migration for silence message (has silence_reason)", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg, silence_reason: "User said goodbye" } as any],
      },
    });

    const messages = state.messages_get("p-1");
    expect(messages[0].content).toBeUndefined();
    expect(messages[0].silence_reason).toBe("User said goodbye");
  });

  it("migrates human messages with verbal_response to content", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [
          { ...baseMsg, role: "human" as const, verbal_response: "Human said this" } as any,
        ],
      },
    });

    const messages = state.messages_get("p-1");
    expect(messages[0].content).toBe("Human said this");
    expect((messages[0] as any).verbal_response).toBeUndefined();
  });

  it("skips migration when message has no content fields", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg } as any],
      },
    });

    expect(state.messages_get("p-1")[0].content).toBeUndefined();
  });

  it("handles mixed batch: migrates only messages that need it", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [
          { ...baseMsg, id: "m1", content: "already has content" } as any,
          { ...baseMsg, id: "m2", verbal_response: "needs migration" } as any,
          { ...baseMsg, id: "m3", silence_reason: "gone quiet" } as any,
          { ...baseMsg, id: "m4", action_response: "gestures", verbal_response: "and speaks" } as any,
        ],
      },
    });

    const messages = state.messages_get("p-1");
    expect(messages).toHaveLength(4);
    expect(messages[0].content).toBe("already has content");
    expect(messages[1].content).toBe("needs migration");
    expect(messages[2].content).toBeUndefined();
    expect(messages[2].silence_reason).toBe("gone quiet");
    expect(messages[3].content).toBe("_gestures_\n\nand speaks");
  });
});

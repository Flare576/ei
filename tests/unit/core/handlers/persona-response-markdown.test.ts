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

describe("handleRoomResponse — JSON-parsed path (response.parsed branch)", () => {
  let state: ReturnType<typeof createMockState>;

  function makeRoomRequest(overrides: Partial<{ roomId: string; personaId: string }> = {}): LLMRequest {
    return makeRequest({
      next_step: LLMNextStep.HandleRoomResponse,
      data: {
        roomId: overrides.roomId ?? "room-1",
        personaId: overrides.personaId ?? "persona-1",
        personaDisplayName: "TestPersona",
        parentMessageId: null,
      },
    });
  }

  function makeRoomResponseParsed(parsed: object | undefined, roomOverrides: Partial<{ roomId: string; personaId: string }> = {}): LLMResponse {
    return {
      request: makeRoomRequest(roomOverrides),
      success: true,
      content: null,
      parsed,
      error: undefined,
    };
  }

  beforeEach(() => {
    state = createMockState();
    vi.clearAllMocks();
  });

  it("throws when roomId is missing from request data", () => {
    const response = makeRoomResponseParsed({ should_respond: true, content: "hello" }, { roomId: "" });

    expect(() => handleRoomResponse(response, state as any)).toThrow(
      "[handleRoomResponse] Missing roomId or personaId"
    );
  });

  it("throws when personaId is missing from request data", () => {
    const response = makeRoomResponseParsed({ should_respond: true, content: "hello" }, { personaId: "" });

    expect(() => handleRoomResponse(response, state as any)).toThrow(
      "[handleRoomResponse] Missing roomId or personaId"
    );
  });

  it("stores silence message when should_respond is false and reason is present", () => {
    const response = makeRoomResponseParsed({ should_respond: false, reason: "Not relevant to me" });

    handleRoomResponse(response, state as any);

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    const msg = state._roomMessages[0];
    expect(msg.silence_reason).toBe("Not relevant to me");
    expect(msg.content).toBeUndefined();
    expect(msg.role).toBe("persona");
  });

  it("does not call appendRoomMessage when should_respond is false and reason is absent", () => {
    const response = makeRoomResponseParsed({ should_respond: false });

    handleRoomResponse(response, state as any);

    expect(state.appendRoomMessage).not.toHaveBeenCalled();
  });

  it("does not call appendRoomMessage when should_respond is true but content is empty", () => {
    const response = makeRoomResponseParsed({ should_respond: true, content: "" });

    handleRoomResponse(response, state as any);

    expect(state.appendRoomMessage).not.toHaveBeenCalled();
  });

  it("stores content message when should_respond is true and content is present", () => {
    const response = makeRoomResponseParsed({ should_respond: true, content: "Here is my response." });

    handleRoomResponse(response, state as any);

    expect(state.appendRoomMessage).toHaveBeenCalledTimes(1);
    const msg = state._roomMessages[0];
    expect(msg.content).toBe("Here is my response.");
    expect(msg.silence_reason).toBeUndefined();
    expect(msg.role).toBe("persona");
    expect(msg.persona_id).toBe("persona-1");
  });
});

describe("PersonaState.load() — message loading", () => {
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
  };

  const baseMsg = {
    id: "msg-1",
    role: "system" as const,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Default,
  };

  it("loads message with content field", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg, content: "Already migrated" } as any],
      },
    });

    expect(state.messages_get("p-1")[0].content).toBe("Already migrated");
  });

  it("loads silence message (has silence_reason, no content)", () => {
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

  it("loads message with no content fields", () => {
    const state = new PersonaState();
    state.load({
      "p-1": {
        entity: basePersona,
        messages: [{ ...baseMsg } as any],
      },
    });

    expect(state.messages_get("p-1")[0].content).toBeUndefined();
  });

});

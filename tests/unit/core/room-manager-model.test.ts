import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/core/prompt-context-builder.js", () => ({
  buildRoomResponsePromptData: vi.fn().mockResolvedValue({ system: "sys", user: "usr" }),
}));

vi.mock("../../../src/prompts/room/index.js", () => ({
  buildRoomJudgePrompt: vi.fn().mockReturnValue({ system: "sys", user: "usr" }),
}));

import { createRoom, activateRoom } from "../../../src/core/room-manager.js";
import { RoomMode, ContextStatus } from "../../../src/core/types.js";
import type { StateManager } from "../../../src/core/state-manager.js";
import type {
  PersonaEntity,
  RoomEntity,
  RoomMessage,
  HumanEntity,
} from "../../../src/core/types.js";

// ─── Factories ──────────────────────────────────────────────────────────────

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

function makeHuman(settings: HumanEntity["settings"]): HumanEntity {
  return {
    entity: "human",
    facts: [],
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    settings,
  };
}

function makeRoom(overrides: Partial<RoomEntity> = {}): RoomEntity {
  return {
    id: "room-1",
    display_name: "Test Room",
    entity: "room",
    mode: RoomMode.FreeForAll,
    persona_ids: ["persona-1"],
    active_node_id: "root-msg",
    is_archived: false,
    created_at: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    messages: [],
    ...overrides,
  };
}

function makeRoomMessage(overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id: crypto.randomUUID(),
    parent_id: null,
    role: "human",
    content: "hi",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

// ─── Fake StateManager ──────────────────────────────────────────────────────

interface FakeSmOptions {
  room?: RoomEntity | null;
  roomMessages?: RoomMessage[];
  personaById?: (id: string) => PersonaEntity | null;
  humanSettings?: HumanEntity["settings"];
  addRoomResult?: RoomEntity;
}

function makeFakeSm(options: FakeSmOptions = {}) {
  const queued: Array<{ model?: string; [key: string]: unknown }> = [];
  const human = makeHuman(options.humanSettings);

  const fake = {
    addRoom: vi.fn(() => options.addRoomResult ?? makeRoom()),
    getRoom: vi.fn(() => (options.room !== undefined ? options.room : makeRoom())),
    getRoomMessages: vi.fn(() => options.roomMessages ?? []),
    getRoomActivePath: vi.fn(() => options.roomMessages ?? []),
    persona_getById: vi.fn((id: string) =>
      options.personaById ? options.personaById(id) : makePersona({ id })
    ),
    getHuman: vi.fn(() => human),
    queue_enqueue: vi.fn((req: { model?: string; [key: string]: unknown }) => {
      queued.push(req);
      return "enqueued-id";
    }),
    setRoomActiveNode: vi.fn(() => true),
    _queued: queued,
  };

  return fake;
}

const noop = () => {};

describe("room-manager: queueRoomPersonaResponses (via createRoom)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("persona.model wins over settings.conversation_model", async () => {
    const room = makeRoom({ mode: RoomMode.FreeForAll, persona_ids: ["persona-1"] });
    const fake = makeFakeSm({
      addRoomResult: room,
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id, model: "Persona:override" }),
    });

    await createRoom(
      fake as unknown as StateManager,
      { display_name: "R", mode: RoomMode.FreeForAll, persona_ids: ["persona-1"], initial_message: "hi" },
      false,
      noop,
      noop,
      noop
    );

    expect(fake._queued[0].model).toBe("Persona:override");
  });

  it("falls back to settings.conversation_model when persona.model is unset", async () => {
    const room = makeRoom({ mode: RoomMode.FreeForAll, persona_ids: ["persona-1"] });
    const fake = makeFakeSm({
      addRoomResult: room,
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id }),
    });

    await createRoom(
      fake as unknown as StateManager,
      { display_name: "R", mode: RoomMode.FreeForAll, persona_ids: ["persona-1"], initial_message: "hi" },
      false,
      noop,
      noop,
      noop
    );

    expect(fake._queued[0].model).toBe("conv-guid");
  });

  it("resolves to empty string (not throw) when neither persona.model nor conversation_model is set", async () => {
    const room = makeRoom({ mode: RoomMode.FreeForAll, persona_ids: ["persona-1"] });
    const fake = makeFakeSm({
      addRoomResult: room,
      humanSettings: {},
      personaById: (id) => makePersona({ id }),
    });

    await createRoom(
      fake as unknown as StateManager,
      { display_name: "R", mode: RoomMode.FreeForAll, persona_ids: ["persona-1"], initial_message: "hi" },
      false,
      noop,
      noop,
      noop
    );

    expect(fake._queued[0].model).toBe("");
  });
});

describe("room-manager: judge persona model resolution (via activateRoom, MAP mode)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mapRoom() {
    return makeRoom({
      mode: RoomMode.MessagesAgainstPersona,
      persona_ids: ["persona-1"],
      judge_persona_id: "judge-1",
      active_node_id: "parent-1",
    });
  }

  it("judgePersona.model wins over settings.conversation_model", async () => {
    const humanMsg = makeRoomMessage({ id: "human-msg", parent_id: "parent-1", role: "human" });
    const fake = makeFakeSm({
      room: mapRoom(),
      roomMessages: [humanMsg],
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id, model: id === "judge-1" ? "Judge:override" : undefined }),
    });

    await activateRoom(fake as unknown as StateManager, "room-1", false, noop, noop, noop);

    expect(fake._queued[0].model).toBe("Judge:override");
  });

  it("falls back to settings.conversation_model when judgePersona.model is unset", async () => {
    const humanMsg = makeRoomMessage({ id: "human-msg", parent_id: "parent-1", role: "human" });
    const fake = makeFakeSm({
      room: mapRoom(),
      roomMessages: [humanMsg],
      humanSettings: { conversation_model: "conv-guid" },
      personaById: (id) => makePersona({ id }),
    });

    await activateRoom(fake as unknown as StateManager, "room-1", false, noop, noop, noop);

    expect(fake._queued[0].model).toBe("conv-guid");
  });
});

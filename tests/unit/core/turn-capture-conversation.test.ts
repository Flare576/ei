import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
  callLLMRaw: vi.fn(),
}));

import {
  createTurnFixture,
  malformedToolRound,
  stopRound,
  toolRound,
  type TurnFixture,
} from "../../helpers/turn-capture-fixture.js";
import { handlePersonaResponse } from "../../../src/core/handlers/persona-response.js";
import {
  LLMNextStep,
  LLMPriority,
  LLMRequestType,
  TOOLS_RAN_NO_REPLY_SILENCE_REASON,
} from "../../../src/core/types.js";
import type { Message, RoomMessage } from "../../../src/core/types.js";

type Mode = "1:1" | "room";
const modes: Mode[] = ["1:1", "room"];

function send(fx: TurnFixture, mode: Mode): void {
  if (mode === "room") fx.sendRoomTurn();
  else fx.sendPersonaTurn();
}

function rows(fx: TurnFixture, mode: Mode): Array<Message | RoomMessage> {
  return mode === "room" ? fx.roomMessages() : fx.messages();
}

function finalRow(fx: TurnFixture, mode: Mode): Message | RoomMessage {
  const row = rows(fx, mode).at(-1);
  if (!row) throw new Error("no row written");
  return row;
}

/** Rows the persona wrote (excludes the human's own rows). */
function personaReplies(fx: TurnFixture, mode: Mode): Array<Message | RoomMessage> {
  return rows(fx, mode).filter((row) => row.role === (mode === "room" ? "persona" : "system"));
}

describe.each(modes)("whole-turn capture — %s", (mode) => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("writes one row carrying every round's tool calls in order, retaining executed system tools", async () => {
    fx = await createTurnFixture();
    const findResult = "find_memory result sentinel";
    const noteResult = "ordinary tool result sentinel";
    fx.registerExecutor({ name: "find_memory", execute: async () => findResult });
    const ordinary = fx.registerTool({ kind: "write", result: noteResult });
    const before = personaReplies(fx, mode).length;

    fx.script([
      toolRound([{ id: "call-a", name: "find_memory", arguments: { query: "remember this" } }]),
      toolRound([{ id: "call-b", name: ordinary.name, arguments: { note: "write this" } }]),
      stopRound("all done"),
    ]);
    send(fx, mode);
    await fx.settle();

    expect(personaReplies(fx, mode)).toHaveLength(before + 1);
    expect(finalRow(fx, mode).tool_calls).toEqual([
      { name: "find_memory", arguments: { query: "remember this" }, result: findResult, error: false, kind: "read" },
      { name: ordinary.name, arguments: { note: "write this" }, result: noteResult, error: false, kind: "write" },
    ]);
    expect(fx.llmCalls).toHaveLength(3);
  });

  it("concatenates thinking across rounds with a blank line, skipping a round that has none", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool();

    fx.script([
      toolRound([{ id: "c1", name: tool.name, arguments: { n: 1 } }], "round one thinking"),
      toolRound([{ id: "c2", name: tool.name, arguments: { n: 2 } }]),
      stopRound("finished", "round three thinking"),
    ]);
    send(fx, mode);
    await fx.settle();

    expect(finalRow(fx, mode).thinking).toBe("round one thinking\n\nround three thinking");
  });

  it("keeps provider thinking on an ordinary single-round reply", async () => {
    fx = await createTurnFixture();
    fx.script([stopRound("a plain reply", "only thinking")]);
    send(fx, mode);
    await fx.settle();

    const row = finalRow(fx, mode);
    expect(row.content).toBe("a plain reply");
    expect(row.thinking).toBe("only thinking");
    expect("tool_calls" in row).toBe(false);
  });

  it("keeps thinking when malformed tool calls parse to none and the turn stops", async () => {
    fx = await createTurnFixture();
    fx.script([malformedToolRound("reply after malformed calls", "malformed round thinking")]);
    send(fx, mode);
    await fx.settle();

    const row = finalRow(fx, mode);
    expect(row.content).toBe("reply after malformed calls");
    expect(row.thinking).toBe("malformed round thinking");
    expect("tool_calls" in row).toBe(false);
  });

  it("omits both fields entirely when the turn made no tool calls and had no thinking", async () => {
    fx = await createTurnFixture();
    fx.script([stopRound("nothing extra")]);
    send(fx, mode);
    await fx.settle();

    const row = finalRow(fx, mode);
    expect("tool_calls" in row).toBe(false);
    expect("thinking" in row).toBe(false);
  });
});

describe("room turns keep their capture out of the persona's 1:1 store", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("persists a silence-reason room row with the turn's tool calls and thinking", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ kind: "read", result: "looked it up" });
    const personaRowsBefore = fx.messages().length;

    fx.script([
      toolRound([{ id: "c1", name: tool.name, arguments: { q: "x" } }], "deciding"),
      stopRound("NoResponse\nnothing to add here", "decided to stay quiet"),
    ]);
    fx.sendRoomTurn();
    await fx.settle();

    const row = fx.roomMessages().at(-1);
    expect(row?.silence_reason).toBe("nothing to add here");
    expect(row?.tool_calls).toEqual([
      { name: tool.name, arguments: { q: "x" }, result: "looked it up", error: false, kind: "read" },
    ]);
    expect(row?.thinking).toBe("deciding\n\ndecided to stay quiet");
    expect(fx.messages()).toHaveLength(personaRowsBefore);
  });

  it("persists a content room row with tool calls and leaves the persona's Message store untouched", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ kind: "write" });
    const personaRowsBefore = fx.messages().length;

    fx.script([toolRound([{ id: "c1", name: tool.name, arguments: {} }]), stopRound("room reply")]);
    fx.sendRoomTurn();
    await fx.settle();

    expect(fx.roomMessages().at(-1)?.content).toBe("room reply");
    expect(fx.roomMessages().at(-1)?.tool_calls).toHaveLength(1);
    expect(fx.messages()).toHaveLength(personaRowsBefore);
  });

  it("creates no room row when a tool-calling turn ends with empty output and no failure", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool();
    const roomRowsBefore = fx.roomMessages().length;

    fx.script([toolRound([{ id: "c1", name: tool.name, arguments: {} }], "thought"), stopRound("")]);
    fx.sendRoomTurn();
    await fx.settle();

    expect(fx.roomMessages()).toHaveLength(roomRowsBefore);
  });
});

describe("1:1 turn that ran tools and produced no reply", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("writes the fallback row with the turn's tool calls when the output is empty and has no NoResponse", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ kind: "read", result: "tool output" });

    fx.script([toolRound([{ id: "c1", name: tool.name, arguments: { q: 1 } }], "pondering"), stopRound("")]);
    fx.sendPersonaTurn();
    await fx.settle();

    const row = fx.messages().at(-1);
    expect(row?.role).toBe("system");
    expect(row?.content).toBeUndefined();
    expect(row?.silence_reason).toBe(TOOLS_RAN_NO_REPLY_SILENCE_REASON);
    expect(row?.tool_calls).toEqual([
      { name: tool.name, arguments: { q: 1 }, result: "tool output", error: false, kind: "read" },
    ]);
    expect(row?.thinking).toBe("pondering");
  });

  it("keeps the sentinel-derived reason, not the fallback constant, when the turn ends via NoResponse with a reason", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool();

    fx.script([
      toolRound([{ id: "c1", name: tool.name, arguments: {} }]),
      stopRound("NoResponse\nthe human did not ask anything"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    const row = fx.messages().at(-1);
    expect(row?.silence_reason).toBe("the human did not ask anything");
    expect(row?.silence_reason).not.toBe(TOOLS_RAN_NO_REPLY_SILENCE_REASON);
    expect(row?.tool_calls).toHaveLength(1);
  });

  it("keeps the reasonless shape and the tool calls when the turn ends via a bare NoResponse", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool();

    fx.script([toolRound([{ id: "c1", name: tool.name, arguments: {} }]), stopRound("NoResponse")]);
    fx.sendPersonaTurn();
    await fx.settle();

    const row = fx.messages().at(-1);
    expect(row?.content).toBeUndefined();
    expect(row?.silence_reason).toBeUndefined();
    expect(row?.tool_calls).toHaveLength(1);
  });

  it("creates no row for the same empty output when no tool ran", async () => {
    fx = await createTurnFixture();
    const before = fx.messages().length;

    handlePersonaResponse(
      {
        request: {
          id: "direct-request",
          created_at: new Date().toISOString(),
          attempts: 0,
          state: "processing",
          type: LLMRequestType.Raw,
          priority: LLMPriority.High,
          system: "s",
          user: "u",
          next_step: LLMNextStep.HandlePersonaResponse,
          data: { personaId: fx.personaId, personaDisplayName: fx.personaName },
        },
        success: true,
        content: "",
      },
      fx.stateManager,
    );

    expect(fx.messages()).toHaveLength(before);
  });
});

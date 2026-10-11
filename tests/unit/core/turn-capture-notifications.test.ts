import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callLLMRaw: vi.fn(),
}));

import {
  createTurnFixture,
  stopRound,
  toolRound,
  type TurnFixture,
} from "../../helpers/turn-capture-fixture.js";
import type { Message, RoomMessage, ToolCallRecord } from "../../../src/core/types.js";

const modes = ["persona", "room"] as const;

describe.each(modes)("whole-turn notifications — %s", (mode) => {
  let fx: TurnFixture;
  afterEach(async () => {
    if (fx) await fx.stop();
  });

  it("reveals the complete persisted turn once, only after the final round", async () => {
    let personaId = "";
    let roomId = "";
    let initialPersonaRows = 0;
    let initialRoomRows = 0;
    let expectedCalls: ToolCallRecord[] = [];
    const expectedThinking = "first thought\n\nsecond thought\n\nfinal thought";
    const personaSnapshots: Message[][] = [];
    const roomSnapshots: RoomMessage[][] = [];
    fx = await createTurnFixture({
      onMessageAdded(id) {
        if (id === personaId) personaSnapshots.push(structuredClone(fx.messages()));
      },
      onRoomMessageAdded(id) {
        if (id === roomId) roomSnapshots.push(structuredClone(fx.roomMessages()));
      },
    });
    personaId = fx.personaId;
    roomId = fx.roomId;

    const a = fx.registerTool({ kind: "read", result: "lookup result" });
    const b = fx.registerTool({ kind: "write", result: "saved result" });
    expectedCalls = [
      { name: a.name, arguments: { topic: "first" }, result: "lookup result", error: false, kind: "read" },
      { name: b.name, arguments: { topic: "second" }, result: "saved result", error: false, kind: "write" },
    ];
    initialPersonaRows = fx.messages().length;
    initialRoomRows = fx.roomMessages().length;

    function assertStillInvisible(): void {
      expect(fx.spies.onMessageAdded.mock.calls.filter(([id]) => id === personaId)).toHaveLength(0);
      expect(fx.spies.onRoomMessageAdded.mock.calls.filter(([id]) => id === roomId)).toHaveLength(0);
      expect(personaSnapshots).toHaveLength(0);
      expect(roomSnapshots).toHaveLength(0);
      expect(fx.messages()).toHaveLength(initialPersonaRows + (mode === "persona" ? 1 : 0));
      expect(fx.roomMessages()).toHaveLength(initialRoomRows);
      expect(fx.messages().some((row) => "tool_calls" in row || "thinking" in row)).toBe(false);
      expect(fx.roomMessages().some((row) => "tool_calls" in row || "thinking" in row)).toBe(false);
    }

    fx.script([
      toolRound([{ id: "first", name: a.name, arguments: { topic: "first" } }], "first thought"),
      () => {
        assertStillInvisible();
        return toolRound([{ id: "second", name: b.name, arguments: { topic: "second" } }], "second thought");
      },
      () => {
        assertStillInvisible();
        return stopRound("finished", "final thought");
      },
    ]);
    if (mode === "room") fx.sendRoomTurn();
    else fx.sendPersonaTurn();
    // The human's own initial row is not a partial Persona response.
    const personaRowsBeforeFinal = fx.messages().length;
    await fx.settle();

    const calls = expectedCalls;
    const expectedRow = mode === "room" ? fx.roomMessages().at(-1) : fx.messages().at(-1);
    expect(expectedRow?.content).toBe("finished");
    expect(expectedRow?.tool_calls).toEqual(calls);
    expect(expectedRow?.thinking).toBe(expectedThinking);
    expect(fx.llmCalls).toHaveLength(3);
    expect(fx.spies.onMessageAdded.mock.calls.filter(([id]) => id === personaId)).toHaveLength(1);
    expect(fx.spies.onRoomMessageAdded.mock.calls.filter(([id]) => id === roomId)).toHaveLength(mode === "room" ? 1 : 0);
    expect(roomSnapshots).toHaveLength(mode === "room" ? 1 : 0);
    expect(personaSnapshots).toHaveLength(1);

    if (mode === "room") {
      expect(fx.roomMessages()).toHaveLength(initialRoomRows + 1);
      expect(roomSnapshots[0]).toEqual(fx.roomMessages());
      expect(roomSnapshots[0].at(-1)?.tool_calls).toEqual(calls);
      expect(roomSnapshots[0].at(-1)?.thinking).toBe(expectedThinking);
      // Even when the Room continuation notifies the persona, its 1:1 re-fetch cannot expose Room data.
      expect(personaSnapshots[0]).toEqual(fx.messages());
      expect(fx.messages()).toHaveLength(initialPersonaRows);
    } else {
      expect(fx.messages()).toHaveLength(personaRowsBeforeFinal + 1);
      expect(personaSnapshots[0]).toEqual(fx.messages());
      expect(personaSnapshots[0].at(-1)?.tool_calls).toEqual(calls);
      expect(personaSnapshots[0].at(-1)?.thinking).toBe(expectedThinking);
      expect(fx.roomMessages()).toHaveLength(initialRoomRows);
    }
  });
});

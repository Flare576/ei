import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
  callLLMRaw: vi.fn(),
}));

import {
  createTurnFixture,
  stopRound,
  submitRound,
  toolRound,
  type LLMRound,
  type TurnFixture,
} from "../../helpers/turn-capture-fixture.js";
import { LLMNextStep, type Message, type RoomMessage } from "../../../src/core/types.js";

const MARKER = "... (truncated)";

interface Writer {
  name: string;
  /** Persona the turn's tools are assigned to. */
  toolOwner: (fx: TurnFixture) => string;
  send: (fx: TurnFixture) => void;
  /** The turn-ending round that makes the writer persist its row. */
  finish: (fx: TurnFixture) => LLMRound;
  row: (fx: TurnFixture) => Message | RoomMessage | undefined;
}

const writers: Writer[] = [
  {
    name: "1:1 Message",
    toolOwner: (fx) => fx.personaId,
    send: (fx) => fx.sendPersonaTurn(),
    finish: () => stopRound("final reply"),
    row: (fx) => fx.messages().at(-1),
  },
  {
    name: "RoomMessage",
    toolOwner: (fx) => fx.personaId,
    send: (fx) => fx.sendRoomTurn(),
    finish: () => stopRound("final room reply"),
    row: (fx) => fx.roomMessages().at(-1),
  },
  {
    name: "HandleHeartbeatCheck Message",
    toolOwner: (fx) => fx.personaId,
    send: (fx) => fx.sendHeartbeatCheck(),
    finish: () => submitRound("submit_heartbeat_check", { should_respond: true, topic: "t", message: "reaching out" }),
    row: (fx) => fx.messages().at(-1),
  },
  {
    name: "HandleEiHeartbeat Message",
    toolOwner: () => "ei",
    send: (fx) => fx.sendEiHeartbeat({ offeredId: fx.personaId }),
    finish: (fx) => submitRound("submit_ei_heartbeat", { should_respond: true, id: fx.personaId, my_response: "checking in" }),
    row: (fx) => fx.eiMessages().at(-1),
  },
];

describe.each(writers)("persisted tool result cap — $name", (writer) => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("keeps a 150-unit result, cuts 151 and 300 with the marker, never cuts arguments, and backs up over a surrogate pair", async () => {
    fx = await createTurnFixture();
    const owner = writer.toolOwner(fx);
    const emoji = "\u{1F600}";
    const results = {
      exact150: "a".repeat(150),
      over151: "b".repeat(151),
      long300: "c".repeat(300),
      pair: `${"d".repeat(149)}${emoji}trailing text that pushes the length over the cap`,
    };
    const longArgument = "z".repeat(300);
    const tools = {
      exact150: fx.registerTool({ personaId: owner, kind: "read", result: results.exact150 }),
      over151: fx.registerTool({ personaId: owner, kind: "read", result: results.over151 }),
      long300: fx.registerTool({ personaId: owner, kind: "read", result: results.long300 }),
      pair: fx.registerTool({ personaId: owner, kind: "read", result: results.pair }),
    };

    let carried: Array<{ name: string; arguments: Record<string, unknown>; result: string }> | undefined;
    fx.script([
      toolRound([
        { id: "c-exact", name: tools.exact150.name, arguments: { n: 1 } },
        { id: "c-over", name: tools.over151.name, arguments: { n: 2 } },
        { id: "c-long", name: tools.long300.name, arguments: { payload: longArgument } },
        { id: "c-pair", name: tools.pair.name, arguments: { n: 4 } },
      ]),
      () => {
        // Observed mid-turn: the accumulator queued for the next round is complete.
        const continuation = fx.stateManager
          .getStorageState()
          .queue.find((request) => request.next_step === LLMNextStep.HandleToolContinuation);
        carried = (continuation?.data.turnCapture as { tool_calls: typeof carried } | undefined)?.tool_calls;
        return writer.finish(fx);
      },
    ]);
    writer.send(fx);
    await fx.settle();

    expect(carried?.map((call) => [call.name, call.result])).toEqual([
      [tools.exact150.name, results.exact150],
      [tools.over151.name, results.over151],
      [tools.long300.name, results.long300],
      [tools.pair.name, results.pair],
    ]);
    expect(carried?.find((call) => call.name === tools.long300.name)?.arguments).toEqual({ payload: longArgument });
    const toolCalls = writer.row(fx)?.tool_calls ?? [];
    const byName = new Map(toolCalls.map((call) => [call.name, call]));

    expect(toolCalls).toHaveLength(4);
    expect(byName.get(tools.exact150.name)?.result).toBe(results.exact150);
    expect(byName.get(tools.over151.name)?.result).toBe(`${"b".repeat(150)}${MARKER}`);
    expect(byName.get(tools.long300.name)?.result).toBe(`${"c".repeat(150)}${MARKER}`);
    expect(byName.get(tools.long300.name)?.arguments).toEqual({ payload: longArgument });
    expect(byName.get(tools.pair.name)?.result).toBe(`${"d".repeat(149)}${MARKER}`);

    // The continuation request that followed the tools received every result in full.
    const historyByName = new Map(
      fx.llmCalls[1].messages.filter((m) => m.role === "tool").map((m) => [m.name, m.content]),
    );
    expect(historyByName.get(tools.long300.name)).toBe(results.long300);
    expect(historyByName.get(tools.over151.name)).toBe(results.over151);
    expect(historyByName.get(tools.pair.name)).toBe(results.pair);
  });
});

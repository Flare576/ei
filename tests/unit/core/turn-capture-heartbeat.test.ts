import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
  callLLMRaw: vi.fn(),
}));

import {
  createTurnFixture,
  submitRound,
  toolRound,
  type TurnFixture,
} from "../../helpers/turn-capture-fixture.js";
import { registerExecutor } from "../../../src/core/tools/index.js";
import { currentlyPlayingExecutor } from "../../../src/core/tools/builtin/currently-playing.js";
import type { Message } from "../../../src/core/types.js";

/** The heartbeat flavors: each persists a Message only when the persona reaches out. */
interface Heartbeat {
  name: string;
  owner: (fx: TurnFixture) => string;
  send: (fx: TurnFixture) => void;
  /** Submit-tool name and the arguments that reach out with `message`. */
  submit: string;
  reachOut: (fx: TurnFixture, message: string) => Record<string, unknown>;
  pass: Record<string, unknown>;
  rows: (fx: TurnFixture) => Message[];
}

const heartbeats: Heartbeat[] = [
  {
    name: "HandleHeartbeatCheck",
    owner: (fx) => fx.personaId,
    send: (fx) => fx.sendHeartbeatCheck(),
    submit: "submit_heartbeat_check",
    reachOut: (_fx, message) => ({ should_respond: true, topic: "a topic", message }),
    pass: { should_respond: false },
    rows: (fx) => fx.messages(),
  },
  {
    name: "HandleEiHeartbeat",
    owner: () => "ei",
    send: (fx) => fx.sendEiHeartbeat({ offeredId: fx.personaId }),
    submit: "submit_ei_heartbeat",
    reachOut: (fx, message) => ({ should_respond: true, id: fx.personaId, my_response: message }),
    pass: { should_respond: false },
    rows: (fx) => fx.eiMessages(),
  },
];

describe.each(heartbeats)("heartbeat capture — $name", (hb) => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
    // The currently-playing test swaps in a spy under the real tool's name; put the real executor back.
    registerExecutor(currentlyPlayingExecutor);
  });

  it("persists tool calls and thinking on the message the persona reaches out with", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ personaId: hb.owner(fx), kind: "read", result: "heartbeat lookup result" });
    const before = hb.rows(fx).length;

    fx.script([
      toolRound([{ id: "h1", name: tool.name, arguments: { topic: "unique heartbeat argument" } }], "thinking before reaching out"),
      submitRound(hb.submit, hb.reachOut(fx, "hello, thinking of you"), { thinking: "decided to send it" }),
    ]);
    hb.send(fx);
    await fx.settle();

    const rows = hb.rows(fx);
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)?.content).toBe("hello, thinking of you");
    expect(rows.at(-1)?.tool_calls).toEqual([
      { name: tool.name, arguments: { topic: "unique heartbeat argument" }, result: "heartbeat lookup result", error: false, kind: "read" },
    ]);
    expect(rows.at(-1)?.thinking).toBe("thinking before reaching out\n\ndecided to send it");
  });

  it("writes no message when the persona passes, even after running a tool", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ personaId: hb.owner(fx) });
    const before = hb.rows(fx).length;

    fx.script([
      toolRound([{ id: "h1", name: tool.name, arguments: {} }], "looked around"),
      submitRound(hb.submit, hb.pass, { thinking: "nothing to say" }),
    ]);
    hb.send(fx);
    await fx.settle();

    expect(hb.rows(fx)).toHaveLength(before);
  });

  it("drops a batched sibling of the submit call but keeps the earlier rounds' calls and every round's thinking", async () => {
    fx = await createTurnFixture();
    const owner = hb.owner(fx);
    const readTool = fx.registerTool({ personaId: owner, kind: "read", result: "read result sentinel" });
    const writeTool = fx.registerTool({ personaId: owner, kind: "write", result: "write result sentinel" });
    const discarded = fx.registerTool({ personaId: owner, result: "never produced" });

    fx.script([
      toolRound(
        [
          { id: "r1", name: readTool.name, arguments: { which: "read" } },
          { id: "r2", name: writeTool.name, arguments: { which: "write" } },
        ],
        "alpha thinking",
      ),
      submitRound(hb.submit, hb.reachOut(fx, "the message"), {
        thinking: "beta thinking",
        alongside: [{ id: "r3", name: discarded.name, arguments: { which: "discarded" } }],
      }),
    ]);
    hb.send(fx);
    await fx.settle();

    const row = hb.rows(fx).at(-1);
    expect(row?.content).toBe("the message");
    expect(row?.tool_calls).toEqual([
      { name: readTool.name, arguments: { which: "read" }, result: "read result sentinel", error: false, kind: "read" },
      { name: writeTool.name, arguments: { which: "write" }, result: "write result sentinel", error: false, kind: "write" },
    ]);
    expect(row?.thinking).toBe("alpha thinking\n\nbeta thinking");
    expect(discarded.executions).toEqual([]);
  });

  it("carries only the submit round's own thinking, and no tool_calls, on a direct single-round submit", async () => {
    fx = await createTurnFixture();
    const sibling = fx.registerTool({ personaId: hb.owner(fx), result: "must not run" });

    fx.script([
      submitRound(hb.submit, hb.reachOut(fx, "straight to the point"), {
        thinking: "beta only",
        alongside: [{ id: "x1", name: sibling.name, arguments: { lookup: "spotify" } }],
      }),
    ]);
    hb.send(fx);
    await fx.settle();

    const row = hb.rows(fx).at(-1);
    expect(row?.content).toBe("straight to the point");
    expect(row?.thinking).toBe("beta only");
    expect("tool_calls" in (row as Message)).toBe(false);
    expect(sibling.executions).toEqual([]);
  });

  it("never executes or records a batched currently-playing lookup alongside the submit call", async () => {
    fx = await createTurnFixture();
    const spotify = fx.registerTool({ name: "get_currently_playing", personaId: hb.owner(fx), kind: "read", result: "must not run" });

    fx.script([
      submitRound(hb.submit, hb.reachOut(fx, "saw what you are listening to"), {
        thinking: "spotify round thinking",
        alongside: [{ id: "spotify-1", name: "get_currently_playing", arguments: { market: "US" } }],
      }),
    ]);
    hb.send(fx);
    await fx.settle();

    const row = hb.rows(fx).at(-1);
    expect(spotify.executions).toEqual([]);
    expect(row?.content).toBe("saw what you are listening to");
    expect(row?.thinking).toBe("spotify round thinking");
    expect("tool_calls" in (row as Message)).toBe(false);
  });
});

describe("HandleEiHeartbeat — every message-producing path carries the turn's capture", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("attaches it to the Temporal Anchor message (no id)", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ personaId: "ei", kind: "read", result: "anchor lookup" });
    const before = fx.eiMessages().length;

    fx.script([
      toolRound([{ id: "t1", name: tool.name, arguments: { for: "anchor" } }], "anchor thinking one"),
      submitRound("submit_ei_heartbeat", { should_respond: true, my_response: "remember when?" }, { thinking: "anchor thinking two" }),
    ]);
    fx.sendEiHeartbeat();
    await fx.settle();

    const rows = fx.eiMessages();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)?.content).toBe("remember when?");
    expect(rows.at(-1)?.tool_calls?.map((call) => [call.name, call.arguments, call.result])).toEqual([
      [tool.name, { for: "anchor" }, "anchor lookup"],
    ]);
    expect(rows.at(-1)?.thinking).toBe("anchor thinking one\n\nanchor thinking two");
  });

  it("attaches it to the found-fact notice", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ personaId: "ei", kind: "read", result: "fact lookup" });
    fx.addFact("fact-under-review");
    const before = fx.eiMessages().length;

    fx.script([
      toolRound([{ id: "f1", name: tool.name, arguments: { for: "fact" } }], "fact thinking one"),
      submitRound("submit_ei_heartbeat", { should_respond: true, id: "fact-under-review" }, { thinking: "fact thinking two" }),
    ]);
    fx.sendEiHeartbeat({ offeredId: "fact-under-review" });
    await fx.settle();

    const rows = fx.eiMessages();
    expect(rows).toHaveLength(before + 1);
    expect(rows.at(-1)?.content).toContain("Another persona updated a fact");
    expect(rows.at(-1)?.tool_calls?.map((call) => [call.name, call.arguments, call.result])).toEqual([
      [tool.name, { for: "fact" }, "fact lookup"],
    ]);
    expect(rows.at(-1)?.thinking).toBe("fact thinking one\n\nfact thinking two");
  });
});

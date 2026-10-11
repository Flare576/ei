import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
  callLLMRaw: vi.fn(),
}));

import { createTurnFixture, stopRound, toolRound, type TurnFixture } from "../../helpers/turn-capture-fixture.js";

describe("persisted tool-call kind", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("classifies each definition source on the row the real handler writes", async () => {
    fx = await createTurnFixture();
    fx.registerExecutor({ name: "find_memory", execute: async () => "memories" });
    const unclassified = fx.registerTool();
    const readTool = fx.registerTool({ kind: "read" });
    const writeTool = fx.registerTool({ kind: "write" });
    expect("kind" in unclassified.definition).toBe(false);

    fx.script([
      toolRound([
        { id: "k1", name: "find_memory", arguments: { query: "q" } },
        { id: "k2", name: "edit_trait", arguments: { action: "add", name: "curious", description: "asks questions", sentiment: 0.5 } },
        { id: "k3", name: unclassified.name, arguments: {} },
        { id: "k4", name: readTool.name, arguments: {} },
        { id: "k5", name: writeTool.name, arguments: {} },
        { id: "k6", name: "no_such_tool_anywhere", arguments: {} },
      ]),
      stopRound("done"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    const kinds = Object.fromEntries((fx.messages().at(-1)?.tool_calls ?? []).map((call) => [call.name, call.kind]));
    expect(kinds).toEqual({
      find_memory: "read",
      edit_trait: "write",
      [unclassified.name]: "write",
      [readTool.name]: "read",
      [writeTool.name]: "write",
      no_such_tool_anywhere: "write",
    });
  });

  it("classifies a call to a tool already filtered out as exhausted as write, leaving the earlier read entry alone", async () => {
    fx = await createTurnFixture();
    const filler = fx.registerTool({ kind: "write" });
    const limited = fx.registerTool({ kind: "read", maxCallsPerInteraction: 1 });

    fx.script([
      toolRound([{ id: "e1", name: filler.name, arguments: {} }]),
      toolRound([{ id: "e2", name: limited.name, arguments: { attempt: 1 } }]),
      toolRound([{ id: "e3", name: limited.name, arguments: { attempt: 2 } }]),
      stopRound("done"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    const calls = fx.messages().at(-1)?.tool_calls ?? [];
    expect(calls.map((call) => [call.name, call.arguments, call.kind])).toEqual([
      [filler.name, {}, "write"],
      [limited.name, { attempt: 1 }, "read"],
      [limited.name, { attempt: 2 }, "write"],
    ]);
    expect(limited.executions).toEqual([{ attempt: 1 }]);
  });

  it("keeps the kind stamped at execution when the definition changes or disappears before the final write", async () => {
    fx = await createTurnFixture();
    const tool = fx.registerTool({ kind: "read" });

    fx.script([
      toolRound([{ id: "s1", name: tool.name, arguments: {} }]),
      () => {
        fx.stateManager.tools_update(tool.definition.id, { kind: "write" });
        fx.stateManager.tools_remove(tool.definition.id);
        return stopRound("done");
      },
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    expect(fx.messages().at(-1)?.tool_calls?.[0]?.kind).toBe("read");

    const snapshot = structuredClone(fx.stateManager.getStorageState());
    snapshot.tools = (snapshot.tools ?? []).map((t) => ({ ...t, kind: "write" as const }));
    fx.stateManager.restoreFromState(snapshot);

    expect(fx.messages().at(-1)?.tool_calls?.[0]?.kind).toBe("read");
  });
});

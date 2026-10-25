/**
 * The one adversarial override of `executeToolCalls`: tuples must pair a call with
 * its result by call id, never by position. Every other turn-capture test runs the
 * real executor; here the module mock defaults to a passthrough to the real
 * implementation and only the single test below overrides one call.
 */
import { describe, it, expect, afterEach, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/core/llm-client.js")>()),
  callLLMRaw: vi.fn(),
}));

vi.mock("../../../src/core/tools/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/tools/index.js")>();
  return { ...actual, executeToolCalls: vi.fn(actual.executeToolCalls) };
});

import { executeToolCalls } from "../../../src/core/tools/index.js";
import { createTurnFixture, stopRound, toolRound, type TurnFixture } from "../../helpers/turn-capture-fixture.js";

describe("tool-call tuples are paired by call id", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    await fx.stop();
  });

  it("returns complete tuples for X and Z in request order when results arrive reversed with Y's omitted", async () => {
    fx = await createTurnFixture();
    const x = fx.registerTool({ kind: "read" });
    const y = fx.registerTool({ kind: "write" });
    const z = fx.registerTool({ kind: "write" });

    vi.mocked(executeToolCalls).mockImplementationOnce(async (calls) => {
      const [callX, , callZ] = calls;
      return {
        results: [
          { tool_call_id: callZ.id, name: callZ.name, result: "Z result sentinel", error: true },
          { tool_call_id: callX.id, name: callX.name, result: "X result sentinel", error: false },
        ],
        exhaustedToolNames: new Set<string>(),
      };
    });

    fx.script([
      toolRound([
        { id: "id-x", name: x.name, arguments: { which: "x", n: 1 } },
        { id: "id-y", name: y.name, arguments: { which: "y", n: 2 } },
        { id: "id-z", name: z.name, arguments: { which: "z", n: 3 } },
      ]),
      stopRound("done"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    expect(fx.messages().at(-1)?.tool_calls).toEqual([
      { name: x.name, arguments: { which: "x", n: 1 }, result: "X result sentinel", error: false, kind: "read" },
      { name: z.name, arguments: { which: "z", n: 3 }, result: "Z result sentinel", error: true, kind: "write" },
    ]);
  });

  it("gives each of two calls sharing an id its own result through the real executor", async () => {
    fx = await createTurnFixture();
    const echo = fx.registerTool({ kind: "read", result: (args) => `echo:${String(args.which)}` });
    const failing = fx.registerTool({ kind: "write", throws: "boom" });

    fx.script([
      toolRound([
        { id: "shared-id", name: echo.name, arguments: { which: "first" } },
        { id: "shared-id", name: failing.name, arguments: { which: "second" } },
        { id: "shared-id", name: echo.name, arguments: { which: "third" } },
      ]),
      stopRound("done"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    expect(
      fx.messages().at(-1)?.tool_calls?.map((call) => [call.name, call.arguments, call.result, call.error, call.kind]),
    ).toEqual([
      [echo.name, { which: "first" }, "echo:first", false, "read"],
      [failing.name, { which: "second" }, expect.stringContaining("boom"), true, "write"],
      [echo.name, { which: "third" }, "echo:third", false, "read"],
    ]);
  });

  it("pairs by id, not position, when a shared id and a distinct id arrive out of request order", async () => {
    fx = await createTurnFixture();
    const a = fx.registerTool({ kind: "read" });
    const b = fx.registerTool({ kind: "write" });
    const c = fx.registerTool({ kind: "read" });

    vi.mocked(executeToolCalls).mockImplementationOnce(async (calls) => {
      const [callA, callB, callC] = calls;
      return {
        results: [
          { tool_call_id: callB.id, name: callB.name, result: "B result", error: false },
          { tool_call_id: callA.id, name: callA.name, result: "A result", error: false },
          { tool_call_id: callC.id, name: callC.name, result: "C result", error: true },
        ],
        exhaustedToolNames: new Set<string>(),
      };
    });

    fx.script([
      toolRound([
        { id: "dup", name: a.name, arguments: { which: "a" } },
        { id: "solo", name: b.name, arguments: { which: "b" } },
        { id: "dup", name: c.name, arguments: { which: "c" } },
      ]),
      stopRound("done"),
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    expect(
      fx.messages().at(-1)?.tool_calls?.map((call) => [call.name, call.result, call.error]),
    ).toEqual([
      [a.name, "A result", false],
      [b.name, "B result", false],
      [c.name, "C result", true],
    ]);
  });
});

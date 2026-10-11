import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/core/llm-client.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  callLLMRaw: vi.fn(),
}));

import { createTurnFixture, stopRound, toolRound, type TurnFixture } from "../../helpers/turn-capture-fixture.js";
import { HARD_TOOL_CALL_LIMIT } from "../../../src/core/tools/index.js";
import { LLMNextStep } from "../../../src/core/types.js";

describe("tool calls at the interaction hard limit", () => {
  let fx: TurnFixture;
  afterEach(async () => {
    if (fx) await fx.stop();
  });

  it("executes and persists only the ten calls that receive results", async () => {
    fx = await createTurnFixture();
    expect(HARD_TOOL_CALL_LIMIT).toBe(10);
    const tools = Array.from({ length: 11 }, (_, index) =>
      fx.registerTool({ kind: index % 2 === 0 ? "read" : "write", result: `result-${index}` }),
    );
    const requested = tools.map((tool, index) => ({
      id: `call-${index}`,
      name: tool.name,
      arguments: { request: `argument-${index}` },
    }));
    const previousRows = fx.messages().length;
    let continuationCounter: unknown;
    fx.script([
      toolRound(requested),
      () => {
        const continuation = fx.stateManager.getStorageState().queue.find(
          (request) => request.next_step === LLMNextStep.HandleToolContinuation,
        );
        continuationCounter = continuation?.data.totalCallCount;
        return stopRound("all available results received");
      },
    ]);
    fx.sendPersonaTurn();
    await fx.settle();

    expect(continuationCounter).toBe(10);
    expect(fx.llmCalls).toHaveLength(2);
    const executed = tools.map((tool) => tool.executions.length);
    expect(executed).toEqual([...Array(10).fill(1), 0]);
    const historyResults = fx.llmCalls[1].messages.filter((message) => message.role === "tool");
    expect(historyResults.map((message) => message.tool_call_id)).toEqual(requested.slice(0, 10).map((call) => call.id));
    expect(fx.messages()).toHaveLength(previousRows + 2);
    expect(fx.messages().at(-1)?.content).toBe("all available results received");
    expect(fx.messages().at(-1)?.tool_calls).toEqual(
      tools.slice(0, 10).map((tool, index) => ({
        name: tool.name,
        arguments: requested[index].arguments,
        result: `result-${index}`,
        error: false,
        kind: index % 2 === 0 ? "read" : "write",
      })),
    );
    expect(fx.messages().at(-1)?.tool_calls?.some((call) => call.name === tools[10].name)).toBe(false);
  });
});

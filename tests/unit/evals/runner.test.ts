import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runEval } from "../../evals/runner.js";

const originalFetch = globalThis.fetch;
const tempDirs: string[] = [];

function makeOutputPath(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return join(dir, "eval.json");
}

function makeCompletionResponse(options: {
  content?: string;
  toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
}) {
  return {
    choices: [
      {
        message: {
          ...(options.content !== undefined ? { content: options.content } : {}),
          ...(options.toolCalls?.length
            ? {
                tool_calls: options.toolCalls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: {
                    name: call.name,
                    arguments: JSON.stringify(call.arguments),
                  },
                })),
              }
            : {}),
        },
      },
    ],
    usage: {
      prompt_tokens: 1,
      completion_tokens: 1,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
  };
}

function stubFetchSequence(sequence: unknown[], seenBodies: Record<string, unknown>[] = []) {
  const mockFetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
    seenBodies.push(JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>);
    const next = sequence.shift();
    if (!next) {
      throw new Error("Unexpected extra fetch call");
    }
    return {
      ok: true,
      status: 200,
      json: async () => next,
      text: async () => JSON.stringify(next),
    };
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

const TOOL = {
  type: "function" as const,
  function: {
    name: "find_memory",
    description: "Lookup memory",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("runEval agentic assertion routing", () => {
  it("uses collected tool calls for tool-calls assertions in toolExecutor cases", async () => {
    stubFetchSequence([
      makeCompletionResponse({
        toolCalls: [{ id: "call_1", name: "find_memory", arguments: { query: "Jess" } }],
      }),
      makeCompletionResponse({ content: "done" }),
    ]);

    const summary = await runEval(
      [
        {
          description: "agentic tool-calls assertion",
          tags: ["unit"],
          tools: [TOOL],
          maxTurns: 4,
          toolExecutor: async () => JSON.stringify({ hits: ["Jess"] }),
          prompt: () => ({ system: "system", user: "user" }),
          assert: [{ type: "tool-calls", minCalls: 1, requiredTools: ["find_memory"] }],
        },
      ],
      makeOutputPath("ei-eval-runner-")
    );

    expect(summary.cases[0].passed).toBe(true);
    expect(summary.cases[0].runs[0].assertions[0]).toMatchObject({
      type: "tool-calls",
      passed: true,
    });
  });

  it("uses the final assistant response for JSON assertions in toolExecutor cases", async () => {
    stubFetchSequence([
      makeCompletionResponse({
        toolCalls: [{ id: "call_1", name: "find_memory", arguments: { query: "Jess" } }],
      }),
      makeCompletionResponse({ content: '{"status":"ok"}' }),
    ]);

    const summary = await runEval(
      [
        {
          description: "agentic json assertion",
          tags: ["unit"],
          tools: [TOOL],
          maxTurns: 4,
          toolExecutor: async () => JSON.stringify({ hits: ["Jess"] }),
          prompt: () => ({ system: "system", user: "user" }),
          assert: [{ type: "is-json", schema: { required: ["status"] } }],
        },
      ],
      makeOutputPath("ei-eval-runner-")
    );

    expect(summary.cases[0].passed).toBe(true);
    expect(summary.cases[0].runs[0].assertions[0]).toMatchObject({
      type: "is-json",
      passed: true,
    });
  });

  it("still sends the full transcript to llm-judge in toolExecutor cases", async () => {
    const bodies: Record<string, unknown>[] = [];
    stubFetchSequence(
      [
        makeCompletionResponse({
          toolCalls: [{ id: "call_1", name: "find_memory", arguments: { query: "Jess" } }],
        }),
        makeCompletionResponse({ content: "Wrapped up." }),
        makeCompletionResponse({ content: "PASS transcript included the tool interaction." }),
      ],
      bodies
    );

    const summary = await runEval(
      [
        {
          description: "agentic llm judge",
          tags: ["unit"],
          tools: [TOOL],
          maxTurns: 4,
          toolExecutor: async () => JSON.stringify({ hits: ["Jess"] }),
          prompt: () => ({ system: "system", user: "user" }),
          assert: [{ type: "llm-judge", rubric: "PASS if the response includes the tool transcript." }],
        },
      ],
      makeOutputPath("ei-eval-runner-")
    );

    expect(summary.cases[0].passed).toBe(true);
    expect(String(bodies[2].messages?.[1]?.content ?? "")).toContain('TOOL[find_memory] → {"hits":["Jess"]}');
    expect(String(bodies[2].messages?.[1]?.content ?? "")).toContain("ASSISTANT:");
  });

  it("preserves single-shot tool-calls assertions", async () => {
    stubFetchSequence([
      makeCompletionResponse({
        toolCalls: [{ id: "call_1", name: "find_memory", arguments: { query: "Jess" } }],
      }),
    ]);

    const summary = await runEval(
      [
        {
          description: "single shot tool-calls assertion",
          tags: ["unit"],
          tools: [TOOL],
          prompt: () => ({ system: "system", user: "user" }),
          assert: [{ type: "tool-calls", minCalls: 1, requiredTools: ["find_memory"] }],
        },
      ],
      makeOutputPath("ei-eval-runner-")
    );

    expect(summary.cases[0].passed).toBe(true);
    expect(summary.cases[0].runs[0].assertions[0]).toMatchObject({
      type: "tool-calls",
      passed: true,
    });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  parseToolCalls,
  toOpenAITools,
  executeToolCalls,
  registerExecutor,
  HARD_TOOL_CALL_LIMIT,
} from "../../../src/core/tools/index.js";
import { ToolFailure } from "../../../src/core/tools/tool-error.js";
import type { ToolDefinition } from "../../../src/core/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeToolDef(
  name: string,
  overrides: Partial<ToolDefinition> = {}
): ToolDefinition {
  return {
    id: `${name}-id`,
    provider_id: "test-provider-id",
    name,
    display_name: name,
    description: `${name} description`,
    input_schema: { type: "object", properties: {} },
    runtime: "any",
    builtin: false,
    enabled: true,
    created_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeCall(
  name: string,
  id = "call-1",
  args: Record<string, unknown> = {}
): ToolCall {
  return { id, name, arguments: args };
}

function makeExecutor(name: string, result = '{"ok":true}'): ToolExecutor {
  return {
    name,
    execute: async (_args, _config) => result,
  };
}

// ---------------------------------------------------------------------------
// parseToolCalls
// ---------------------------------------------------------------------------

describe("parseToolCalls", () => {
  it("parses a valid { id, type: 'function', function: { name, arguments } } entry", () => {
    const raw = [
      {
        id: "call-abc123",
        type: "function",
        function: { name: "web_search", arguments: '{"query":"vitest"}' },
      },
    ];

    const result = parseToolCalls(raw);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: "call-abc123",
      name: "web_search",
      arguments: { query: "vitest" },
    });
  });

  it("skips entries where type !== 'function'", () => {
    const raw = [
      {
        id: "call-abc",
        type: "retrieval",
        function: { name: "web_search", arguments: "{}" },
      },
    ];

    expect(parseToolCalls(raw)).toHaveLength(0);
  });

  it("skips entries missing id", () => {
    const raw = [
      {
        type: "function",
        function: { name: "web_search", arguments: "{}" },
      },
    ];

    expect(parseToolCalls(raw)).toHaveLength(0);
  });

  it("skips entries missing function.name", () => {
    const raw = [
      {
        id: "call-abc",
        type: "function",
        function: { arguments: "{}" },
      },
    ];

    expect(parseToolCalls(raw)).toHaveLength(0);
  });

  it("skips entries with malformed JSON in arguments and does not throw", () => {
    const raw = [
      {
        id: "call-abc",
        type: "function",
        function: { name: "web_search", arguments: "{ bad json {{" },
      },
    ];

    expect(() => parseToolCalls(raw)).not.toThrow();
    expect(parseToolCalls(raw)).toHaveLength(0);
  });

  it("returns empty array for empty input", () => {
    expect(parseToolCalls([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// toOpenAITools
// ---------------------------------------------------------------------------

describe("toOpenAITools", () => {
  it("converts a ToolDefinition into the correct { type, function: { name, description, parameters } } shape", () => {
    const tool = makeToolDef("web_search", {
      description: "Search the web for information",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
        },
        required: ["query"],
      },
    });

    const result = toOpenAITools([tool]);

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      type: "function",
      function: {
        name: "web_search",
        description: "Search the web for information",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "The search query" },
          },
          required: ["query"],
        },
      },
    });
  });
});

// ---------------------------------------------------------------------------
// executeToolCalls
// ---------------------------------------------------------------------------

// Unique name guaranteed not to clash with any builtin executor
const TEST_TOOL = "ei_unit_test_tool_zz9plural_z_alpha";

describe("executeToolCalls", () => {
  let definition: ToolDefinition;

  beforeEach(() => {
    // Always register a fresh working executor before each test so the
    // module-level registry has a known-good state for TEST_TOOL.
    registerExecutor(makeExecutor(TEST_TOOL, '{"result":"ok"}'));
    definition = makeToolDef(TEST_TOOL, { max_calls_per_interaction: 3 });
  });

  it("executes a registered tool and returns result with correct tool_call_id and name", async () => {
    const call = makeCall(TEST_TOOL, "call-exec-1");
    const callCounts = new Map<string, number>();
    const totalCalls = { count: 0 };

    const { results, exhaustedToolNames } = await executeToolCalls(
      [call],
      [definition],
      callCounts,
      totalCalls
    );

    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe("call-exec-1");
    expect(results[0].name).toBe(TEST_TOOL);
    expect(results[0].error).toBe(false);
    expect(results[0].result).toBe('{"result":"ok"}');
    expect(exhaustedToolNames.size).toBe(0);
  });

  it("skips a tool when callCounts has already hit max_calls_per_interaction and returns error payload", async () => {
    const def = makeToolDef(TEST_TOOL, { max_calls_per_interaction: 2 });
    const call = makeCall(TEST_TOOL, "call-max-1");
    const callCounts = new Map([[TEST_TOOL, 2]]); // already at max=2
    const totalCalls = { count: 0 };

    const { results, exhaustedToolNames } = await executeToolCalls(
      [call],
      [def],
      callCounts,
      totalCalls
    );

    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe("call-max-1");
    expect(results[0].name).toBe(TEST_TOOL);
    expect(results[0].error).toBe(false);
    const parsed = JSON.parse(results[0].result) as { error: string; message: string };
    expect(parsed.error).toBe("tool_call_limit_reached");
    expect(parsed.message).toContain(TEST_TOOL);
    expect(exhaustedToolNames.has(TEST_TOOL)).toBe(true);
  });

  it("stops all calls when totalCalls.count >= HARD_TOOL_CALL_LIMIT", async () => {
    const call = makeCall(TEST_TOOL, "call-hard-1");
    const callCounts = new Map<string, number>();
    const totalCalls = { count: HARD_TOOL_CALL_LIMIT }; // already at hard limit

    const { results } = await executeToolCalls(
      [call, makeCall(TEST_TOOL, "call-hard-2")],
      [definition],
      callCounts,
      totalCalls
    );

    // Hard limit was already reached — loop breaks immediately, nothing executes
    expect(results).toHaveLength(0);
  });

  it("returns error: true and adds to exhaustedToolNames when executor throws", async () => {
    const throwingExecutor: ToolExecutor = {
      name: TEST_TOOL,
      execute: async () => {
        throw new Error("service unavailable");
      },
    };
    registerExecutor(throwingExecutor); // overwrite with a throwing executor

    const call = makeCall(TEST_TOOL, "call-throw-1");
    const callCounts = new Map<string, number>();
    const totalCalls = { count: 0 };

    const { results, exhaustedToolNames } = await executeToolCalls(
      [call],
      [definition],
      callCounts,
      totalCalls
    );

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe(true);
    const parsed = JSON.parse(results[0].result) as { error: string; message: string };
    expect(parsed.error).toBe("tool_failed");
    expect(parsed.message).toContain("service unavailable");
    expect(parsed.message).toContain(TEST_TOOL);
    expect(exhaustedToolNames.has(TEST_TOOL)).toBe(true);
  });

  it("turns a thrown ToolFailure into its code, message and remediation, marks error and exhausts the tool", async () => {
    registerExecutor({
      name: TEST_TOOL,
      execute: async () => {
        throw new ToolFailure("token_dead", "The refresh token was revoked.", "Re-run /auth spotify.", { integration: "spotify" });
      },
    });

    const { results, exhaustedToolNames } = await executeToolCalls(
      [makeCall(TEST_TOOL, "call-failure-1")],
      [definition],
      new Map<string, number>(),
      { count: 0 }
    );

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe(true);
    expect(JSON.parse(results[0].result)).toEqual({
      error: "token_dead",
      integration: "spotify",
      message: "The refresh token was revoked.",
      remediation: "Re-run /auth spotify.",
    });
    expect(exhaustedToolNames.has(TEST_TOOL)).toBe(true);
  });

  describe("Tavily failures through executeToolCalls", () => {
    const originalFetch = globalThis.fetch;
    const tavilyDef = (config: Record<string, string>) =>
      makeToolDef("tavily_web_search", { config, max_calls_per_interaction: 3 });
    const run = async (config: Record<string, string>) => {
      const out = await executeToolCalls(
        [makeCall("tavily_web_search", "call-tavily-1", { query: "ei" })],
        [tavilyDef(config)],
        new Map<string, number>(),
        { count: 0 }
      );
      return {
        result: JSON.parse(out.results[0].result) as { error: string; message: string; remediation?: string },
        flagged: out.results[0].error,
        exhausted: out.exhaustedToolNames.has("tavily_web_search"),
      };
    };

    afterEach(() => {
      globalThis.fetch = originalFetch;
    });

    it("reports not_configured with a remediation when the api key is missing", async () => {
      const fetchSpy = vi.fn();
      globalThis.fetch = fetchSpy as unknown as typeof fetch;
      const { result, flagged, exhausted } = await run({});
      expect(result.error).toBe("not_configured");
      expect(result.remediation).toContain("Settings → Toolkits → Tavily");
      expect(result.remediation).toContain("/tools → Tavily Search");
      expect(flagged).toBe(true);
      expect(exhausted).toBe(true);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("reports api_key_rejected with a remediation on HTTP 401", async () => {
      globalThis.fetch = vi.fn(async () => new Response("unauthorized", { status: 401 })) as unknown as typeof fetch;
      const { result, flagged } = await run({ api_key: "bad" });
      expect(result.error).toBe("api_key_rejected");
      expect(result.message).toContain("401");
      expect(result.remediation).toContain("Settings → Toolkits → Tavily");
      expect(result.remediation).toContain("/tools → Tavily Search");
      expect(flagged).toBe(true);
    });

    it("reports search_unavailable with the status on HTTP 503", async () => {
      globalThis.fetch = vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch;
      const { result } = await run({ api_key: "k" });
      expect(result.error).toBe("search_unavailable");
      expect(result.message).toContain("503");
    });

    it("reports search_failed with a capped body on other non-OK statuses", async () => {
      globalThis.fetch = vi.fn(async () => new Response("x".repeat(5000), { status: 400 })) as unknown as typeof fetch;
      const { result } = await run({ api_key: "k" });
      expect(result.error).toBe("search_failed");
      expect(result.message).toContain("400");
      expect(result.message.length).toBeLessThan(500);
    });
  });

  it("returns error: false with 'Unknown tool' payload when tool name has no registered executor", async () => {
    // Pass a call whose name is absent from the tools definition array — the
    // "Unknown tool" branch fires before the executor registry is consulted.
    const call = makeCall("__nonexistent_tool_xyz__", "call-unknown-1");
    const callCounts = new Map<string, number>();
    const totalCalls = { count: 0 };

    const { results, exhaustedToolNames } = await executeToolCalls(
      [call],
      [], // empty tools list — definition not found
      callCounts,
      totalCalls
    );

    expect(results).toHaveLength(1);
    expect(results[0].tool_call_id).toBe("call-unknown-1");
    expect(results[0].name).toBe("__nonexistent_tool_xyz__");
    expect(results[0].error).toBe(false);
    const parsed = JSON.parse(results[0].result) as { error: string; message: string; remediation?: string };
    expect(parsed.error).toBe("unknown_tool");
    expect(parsed.message).toContain("__nonexistent_tool_xyz__");
    expect(parsed.remediation).toBeTruthy();
    expect(exhaustedToolNames.has("__nonexistent_tool_xyz__")).toBe(false);
  });

  it("adds to exhaustedToolNames when a tool hits its max after this call", async () => {
    const def = makeToolDef(TEST_TOOL, { max_calls_per_interaction: 2 });
    const call = makeCall(TEST_TOOL, "call-exhaust-1");
    // currentCount = 1, after execution newCount = 2 == maxCalls → exhausted
    const callCounts = new Map([[TEST_TOOL, 1]]);
    const totalCalls = { count: 0 };

    const { results, exhaustedToolNames } = await executeToolCalls(
      [call],
      [def],
      callCounts,
      totalCalls
    );

    expect(results).toHaveLength(1);
    expect(results[0].error).toBe(false);
    expect(exhaustedToolNames.has(TEST_TOOL)).toBe(true);
  });

  it("increments both callCounts and totalCalls.count on each successful execution", async () => {
    const call = makeCall(TEST_TOOL, "call-count-1");
    const callCounts = new Map<string, number>();
    const totalCalls = { count: 0 };

    await executeToolCalls([call], [definition], callCounts, totalCalls);

    expect(callCounts.get(TEST_TOOL)).toBe(1);
    expect(totalCalls.count).toBe(1);
  });
});

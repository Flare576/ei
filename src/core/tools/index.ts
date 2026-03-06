/**
 * Tool execution layer.
 *
 * - Maintains a registry of executors (builtin + future user-registered)
 * - Tracks per-tool call counts within a single interaction
 * - Converts ToolDefinitions into the OpenAI-compatible tool format for the LLM
 * - Executes tool calls and returns ToolResult[]
 */
import type { ToolDefinition } from "../types.js";
import type { ToolCall, ToolResult, ToolExecutor } from "./types.js";
import { tavilyWebSearchExecutor, tavilyNewsSearchExecutor } from "./builtin/web-search.js";
// file-read is Node-only — imported lazily via registerFileReadExecutor() to avoid

/** Hard upper limit on total tool calls per interaction, regardless of individual limits. */
export const HARD_TOOL_CALL_LIMIT = 10;

/** Default max calls per tool if not set on the ToolDefinition. */
const DEFAULT_MAX_CALLS = 3;

// =============================================================================
// Executor registry
// =============================================================================

const executorRegistry = new Map<string, ToolExecutor>();

/** Register a tool executor. Call once at startup per builtin. */
export function registerExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

// Register builtins. read_memory is registered lazily via registerReadMemoryExecutor()
// because it requires Processor.searchHumanData injection.
registerExecutor(tavilyWebSearchExecutor);
registerExecutor(tavilyNewsSearchExecutor);
// file_read is registered lazily via registerFileReadExecutor() — Node/TUI only.

/**
 * Register the read_memory executor — called by Processor after it's initialized,
 * injecting its own searchHumanData method to avoid circular imports.
 */
export function registerReadMemoryExecutor(executor: ToolExecutor): void {
  executorRegistry.set(executor.name, executor);
}

/**
 * Register the file_read executor — called by Processor on TUI/Node only.
 * Dynamic import prevents node:fs/promises from being bundled in the web build.
 */
export async function registerFileReadExecutor(): Promise<void> {
  const { fileReadExecutor } = await import("./builtin/file-read.js");
  executorRegistry.set(fileReadExecutor.name, fileReadExecutor);
}

// =============================================================================
// OpenAI tool format conversion
// =============================================================================

/** Convert ToolDefinition[] into the OpenAI-compatible `tools` array for the API request. */
export function toOpenAITools(tools: ToolDefinition[]): Record<string, unknown>[] {
  return tools.map(t => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

// =============================================================================
// Tool call execution
// =============================================================================

/**
 * Execute a batch of tool calls.
 * - Tracks call counts; tools that have hit their limit are skipped.
 * - Catastrophic failures (throws) → error=true; tool is marked for removal.
 * - Returns results and which tools should be dropped from subsequent LLM calls.
 */
export async function executeToolCalls(
  calls: ToolCall[],
  tools: ToolDefinition[],
  callCounts: Map<string, number>,
  totalCalls: { count: number }
): Promise<{ results: ToolResult[]; exhaustedToolNames: Set<string> }> {
  const results: ToolResult[] = [];
  const exhaustedToolNames = new Set<string>();
  const toolsByName = new Map(tools.map(t => [t.name, t]));

  for (const call of calls) {
    if (totalCalls.count >= HARD_TOOL_CALL_LIMIT) {
      console.log(`[Tools] Hard limit (${HARD_TOOL_CALL_LIMIT}) reached — skipping remaining tool calls`);
      break;
    }

    const definition = toolsByName.get(call.name);
    if (!definition) {
      console.warn(`[Tools] Unknown tool requested: ${call.name}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Unknown tool: ${call.name}` }),
        error: false,
      });
      continue;
    }

    const maxCalls = definition.max_calls_per_interaction ?? DEFAULT_MAX_CALLS;
    const currentCount = callCounts.get(call.name) ?? 0;

    if (currentCount >= maxCalls) {
      console.log(`[Tools] ${call.name} hit max_calls_per_interaction (${maxCalls}) — skipping`);
      exhaustedToolNames.add(call.name);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Tool call limit reached for ${call.name}` }),
        error: false,
      });
      continue;
    }

    const executor = executorRegistry.get(call.name);
    if (!executor) {
      console.warn(`[Tools] No executor registered for: ${call.name}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `No executor for tool: ${call.name}` }),
        error: true,
      });
      exhaustedToolNames.add(call.name);
      continue;
    }

    callCounts.set(call.name, currentCount + 1);
    totalCalls.count++;

    const newCount = currentCount + 1;
    if (newCount >= maxCalls) {
      exhaustedToolNames.add(call.name);
    }

    try {
      console.log(`[Tools] Executing ${call.name} (call ${newCount}/${maxCalls})`);
      const result = await executor.execute(call.arguments, definition.config);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result,
        error: false,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.warn(`[Tools] ${call.name} failed: ${errMsg}`);
      results.push({
        tool_call_id: call.id,
        name: call.name,
        result: JSON.stringify({ error: `Tool unavailable: ${errMsg}` }),
        error: true,
      });
      exhaustedToolNames.add(call.name);
    }
  }

  return { results, exhaustedToolNames };
}

/**
 * Parse tool_calls from the raw LLM API response choice message.
 * Returns empty array if no tool calls or on malformed JSON.
 */
export function parseToolCalls(rawToolCalls: unknown[]): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const raw of rawToolCalls) {
    try {
      const tc = raw as { id?: string; type?: string; function?: { name?: string; arguments?: string } };
      if (tc.type !== "function" || !tc.id || !tc.function?.name) continue;
      const args = JSON.parse(tc.function.arguments ?? "{}");
      calls.push({ id: tc.id, name: tc.function.name, arguments: args });
    } catch (err) {
      console.warn("[Tools] Malformed tool_call entry — skipping:", err);
    }
  }
  return calls;
}

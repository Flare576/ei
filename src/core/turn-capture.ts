/**
 * Whole-turn capture of tool calls and thinking for display.
 *
 * The QueueProcessor assembles a TurnCapture as a turn runs through its chained
 * tool-continuation rounds (carried untruncated in `request.data.turnCapture`)
 * and attaches it to the response that ends the turn. Whichever handler writes
 * the turn's final Message/RoomMessage spreads `turnCaptureFields(response)` into
 * the row — the single place the 150-character result cap is applied.
 *
 * Pure and browser-safe: no Node built-ins, no executor subsystem, only types and the
 * dependency-free tool-name resolution shared with `executeToolCalls`.
 */

import type { LLMResponse, ToolCallRecord, ToolDefinition, TurnCapture } from "./types.js";
import type { ToolCall, ToolResult } from "./tools/types.js";
import { dedupeToolsByName } from "./tools/dedupe.js";

/** Persisted tool results longer than this many UTF-16 code units are cut. */
export const TOOL_RESULT_MAX_CHARS = 150;

/** Appended to a persisted tool result whenever it was cut. */
export const TOOL_RESULT_TRUNCATION_SUFFIX = "... (truncated)";

/** Read the capture carried in a request's data bag; missing or malformed data reads as empty. */
export function readTurnCapture(data: Record<string, unknown>): TurnCapture {
  const carried = data.turnCapture as Partial<TurnCapture> | undefined;
  if (!carried || typeof carried !== "object") return { tool_calls: [] };
  return {
    tool_calls: Array.isArray(carried.tool_calls) ? carried.tool_calls : [],
    thinking: typeof carried.thinking === "string" && carried.thinking.length > 0 ? carried.thinking : undefined,
  };
}

/**
 * Fold one finished round into the capture: its thinking joins the earlier
 * rounds' with a blank line (a round with no thinking contributes nothing) and
 * the calls it executed are appended in request order. Never mutates `prior`.
 */
export function accumulateRound(
  prior: TurnCapture,
  round: { thinking?: string; tool_calls?: ToolCallRecord[] },
): TurnCapture {
  const thinking = round.thinking
    ? (prior.thinking ? `${prior.thinking}\n\n${round.thinking}` : round.thinking)
    : prior.thinking;
  return {
    tool_calls: round.tool_calls?.length ? [...prior.tool_calls, ...round.tool_calls] : prior.tool_calls,
    ...(thinking ? { thinking } : {}),
  };
}

/**
 * Pair each requested call with its result by call id and stamp `kind` from the
 * resolved definition now, at execution time. Providers do not guarantee unique call
 * ids, so each id keeps a queue of its results in result order and every call, in
 * request order, consumes its id's next result. A call with no result (dropped by
 * the hard call limit) yields no record. An unknown tool, or a definition with no
 * `kind`, is `write`. Results are carried complete; truncation is a write-time concern.
 */
export function buildToolCallRecords(
  calls: ToolCall[],
  results: ToolResult[],
  tools: ToolDefinition[],
): ToolCallRecord[] {
  const definitionsByName = new Map(dedupeToolsByName(tools).map(t => [t.name, t]));
  const resultsById = new Map<string, ToolResult[]>();
  for (const result of results) {
    const queue = resultsById.get(result.tool_call_id);
    if (queue) queue.push(result);
    else resultsById.set(result.tool_call_id, [result]);
  }

  const records: ToolCallRecord[] = [];
  for (const call of calls) {
    const result = resultsById.get(call.id)?.shift();
    if (!result) continue;
    records.push({
      name: call.name,
      arguments: call.arguments,
      result: result.result,
      error: result.error,
      kind: definitionsByName.get(call.name)?.kind === "read" ? "read" : "write",
    });
  }
  return records;
}

/**
 * Cap a tool result at TOOL_RESULT_MAX_CHARS UTF-16 code units, appending the
 * truncation marker. The cut backs up one unit rather than split a surrogate pair.
 */
export function truncateToolResult(result: string): string {
  if (result.length <= TOOL_RESULT_MAX_CHARS) return result;
  let cut = TOOL_RESULT_MAX_CHARS;
  const last = result.charCodeAt(cut - 1);
  const next = result.charCodeAt(cut);
  if (last >= 0xd800 && last <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) cut -= 1;
  return `${result.slice(0, cut)}${TOOL_RESULT_TRUNCATION_SUFFIX}`;
}

/**
 * The `tool_calls`/`thinking` fields for a turn's final row, ready to spread
 * into a Message/RoomMessage literal. Each key is omitted entirely when empty
 * (never `[]` or `""`). Tool results are capped here; arguments and thinking never are.
 */
export function turnCaptureFields(response: LLMResponse): Pick<TurnCapture, "thinking"> & { tool_calls?: ToolCallRecord[] } {
  const capture = response.turn_capture;
  if (!capture) return {};
  return {
    ...(capture.tool_calls.length > 0
      ? { tool_calls: capture.tool_calls.map(call => ({ ...call, result: truncateToolResult(call.result) })) }
      : {}),
    ...(capture.thinking ? { thinking: capture.thinking } : {}),
  };
}

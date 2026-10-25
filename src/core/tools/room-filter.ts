/**
 * Room tool gate. Dependency-free (types only), pure, per-request assembly filter.
 */
import type { ToolDefinition } from "../types.js";

/**
 * Personas in a Room get only `read` tools. Deny-by-default: a definition whose
 * `kind` is not exactly "read" (including a missing `kind`) is dropped, mirroring the
 * display rule that treats an unclassified tool as write. Heartbeat gating is a
 * separate axis (`heartbeat_eligible`) and is not consulted here. Apply this BEFORE a
 * handler's dedicated submit tool is injected so infrastructure tools are unaffected.
 * Never mutates the input.
 */
export function filterToolsForRoom(tools: ToolDefinition[]): ToolDefinition[] {
  return tools.filter(t => t.kind === "read");
}

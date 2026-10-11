/**
 * Tool-definition name resolution. Dependency-free (types only) so both the
 * executor layer and the browser-safe turn-capture path share one rule.
 */
import type { ToolDefinition } from "../types.js";

/**
 * Collapse a tool list to one definition per name, builtin wins. A builtin/native
 * tool definition -- e.g. resolve_signal's or edit_trait's per-request
 * config.persona_id, injected fresh by buildResolveSignalTool()/
 * buildPersonaIdentityTools() every call and never persisted -- must never
 * be shadowed by a persisted custom tool sharing its name, regardless of
 * assembly order. Only a later non-builtin definition may replace an
 * earlier non-builtin one of the same name; a builtin definition, once set,
 * always wins. Processor calls this before building the model request so a
 * legacy persisted collision contributes exactly one native definition to
 * the LLM call; executeToolCalls applies it again at execution dispatch as
 * defense in depth, and turn capture resolves each call's `kind` through it.
 * Never mutates the input definitions or any stored StateManager record --
 * purely a per-request assembly filter.
 */
export function dedupeToolsByName(tools: ToolDefinition[]): ToolDefinition[] {
  const toolsByName = new Map<string, ToolDefinition>();
  for (const t of tools) {
    if (toolsByName.get(t.name)?.builtin && !t.builtin) continue;
    toolsByName.set(t.name, t);
  }
  return [...toolsByName.values()];
}

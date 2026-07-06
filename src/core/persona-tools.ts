/**
 * Shared boolean-map <-> flat-id-array conversion for PersonaEntity.tools.
 *
 * PersonaEntity.tools is persisted (and written by external CRUD callers)
 * as a flat array of ToolDefinition ids. That's opaque to a human or an
 * external agent — nothing about a bare UUID says which provider it
 * belongs to, what it's called, or whether it's even grantable right now
 * (a tool under a disabled provider is unusable regardless of whether its
 * id sits in this array). buildPersonaToolsMap/resolvePersonaToolsFromMap
 * convert between that flat storage shape and a self-documenting
 * `{ [providerDisplayName]: { [toolDisplayName]: boolean } }` map — the
 * same shape the TUI's $EDITOR/YAML persona editor has used since before
 * this module existed (originally defined in
 * tui/src/util/yaml-persona.ts, relocated here so the external CRUD
 * surface — src/cli/retrieval.ts's lookupById and
 * src/cli/persona-corrections.ts's create/update — can present and accept
 * the identical shape instead of a raw UUID array).
 *
 * Relocation is verbatim: same names, same signatures, same bodies as the
 * TUI originals. The TUI now imports both functions from here rather than
 * defining its own copies.
 */
import type { ToolDefinition, ToolProvider } from "./types.js";

export function buildPersonaToolsMap(
  enabledToolIds: string[],
  allTools: ToolDefinition[],
  allProviders: ToolProvider[]
): Record<string, Record<string, boolean>> | undefined {
  if (allTools.length === 0) return undefined;
  const enabledSet = new Set(enabledToolIds);
  const result: Record<string, Record<string, boolean>> = {};
  for (const provider of allProviders.filter(p => p.enabled)) {
    const providerTools = allTools.filter(t => t.provider_id === provider.id);
    if (providerTools.length === 0) continue;
    result[provider.display_name] = Object.fromEntries(
      providerTools.map(t => [t.display_name, enabledSet.has(t.id)])
    );
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function resolvePersonaToolsFromMap(
  toolsMap: Record<string, Record<string, boolean>> | undefined,
  allTools: ToolDefinition[],
  allProviders: ToolProvider[]
): string[] | undefined {
  if (!toolsMap) return undefined;
  const enabledIds: string[] = [];
  for (const [providerDisplayName, toolToggles] of Object.entries(toolsMap)) {
    const provider = allProviders.find(p => p.display_name === providerDisplayName);
    if (!provider) continue;
    for (const [toolDisplayName, enabled] of Object.entries(toolToggles)) {
      if (!enabled) continue;
      const tool = allTools.find(t => t.provider_id === provider.id && t.display_name === toolDisplayName);
      if (tool) enabledIds.push(tool.id);
    }
  }
  return enabledIds.length > 0 ? enabledIds : [];
}

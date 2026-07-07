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

/**
 * A tool id belonging to a currently-disabled provider is invisible to
 * buildPersonaToolsMap and therefore can never appear in a caller's
 * submitted map -- not because the caller chose to omit it, but because
 * they had no way to see it. Full-record-replace semantics only apply to
 * the portion of tools[] a caller could actually read and edit; anything
 * outside that boundary must survive an edit unconditionally, or a normal
 * read-edit-write cycle silently destroys stored state the caller never
 * had a chance to preserve correctly. This is intentionally NOT a general
 * merge -- resolvedVisibleIds still fully governs every id whose provider
 * IS enabled; only ids that are structurally unaddressable right now get
 * carried forward.
 */
export function preserveHiddenToolGrants(
  resolvedVisibleIds: string[] | undefined,
  existingIds: string[] | undefined,
  allTools: ToolDefinition[],
  allProviders: ToolProvider[]
): string[] | undefined {
  const providerById = new Map(allProviders.map(p => [p.id, p]));
  const toolById = new Map(allTools.map(t => [t.id, t]));
  const hidden = (existingIds ?? []).filter(id => {
    const tool = toolById.get(id);
    if (!tool) return false;
    const provider = providerById.get(tool.provider_id);
    return provider ? !provider.enabled : false;
  });
  if (hidden.length === 0) return resolvedVisibleIds;
  const merged = new Set([...(resolvedVisibleIds ?? []), ...hidden]);
  return merged.size > 0 ? Array.from(merged) : undefined;
}

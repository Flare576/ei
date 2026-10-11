/**
 * AT7 — completeness check over every built-in ToolDefinition registration
 * source (named, not discovered): SYSTEM_TOOLS, buildPersonaNoteTools,
 * buildPersonaIdentityTools, buildResolveSignalTool, and the built-in upserts
 * performed by bootstrapTools. Every built-in carries `kind`; exactly the six
 * identity-mutating tools are "write"; every other built-in (including the
 * four is_submit tools) is "read".
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  SYSTEM_TOOLS,
  buildPersonaNoteTools,
  buildPersonaIdentityTools,
  buildResolveSignalTool,
} from "../../../src/core/tools/index.js";
import { bootstrapTools } from "../../../src/core/bootstrap-tools.js";
import { StateManager } from "../../../src/core/state-manager.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { ToolDefinition } from "../../../src/core/types.js";

const WRITE_TOOLS = [
  "add_note",
  "clear_note",
  "edit_topic",
  "edit_trait",
  "resolve_signal",
  "update_description",
];

async function bootstrapUpserts(): Promise<ToolDefinition[]> {
  const sm = new StateManager();
  const storage = createMockStorage();
  vi.mocked(storage.load).mockResolvedValue(createDefaultTestState());
  await sm.initialize(storage);
  bootstrapTools(sm);
  return sm.tools_getAll().filter(t => t.builtin);
}

describe("built-in ToolDefinition kind classification (AT7)", () => {
  let builderTools: ToolDefinition[];
  let systemTools: ToolDefinition[];
  let bootstrapped: ToolDefinition[];
  let all: ToolDefinition[];

  beforeEach(async () => {
    const personaId = "persona-1";
    systemTools = [...SYSTEM_TOOLS];
    builderTools = [
      ...buildPersonaNoteTools(personaId),
      ...buildPersonaIdentityTools(personaId),
      ...buildResolveSignalTool(personaId),
    ];
    bootstrapped = await bootstrapUpserts();
    all = [...systemTools, ...builderTools, ...bootstrapped];
  });

  it("enumerates all named sources, including the four is_submit tools", () => {
    expect(systemTools.length).toBeGreaterThan(0);
    expect(builderTools.length).toBeGreaterThan(0);
    expect(bootstrapped.filter(t => t.is_submit).map(t => t.name).sort()).toEqual([
      "submit_dedup_decisions",
      "submit_ei_heartbeat",
      "submit_heartbeat_check",
      "submit_response",
    ]);
  });

  it("every built-in carries a kind of 'read' or 'write'", () => {
    const unclassified = all.filter(t => t.kind !== "read" && t.kind !== "write").map(t => t.name);
    expect(unclassified).toEqual([]);
  });

  it("exactly the six identity-mutating tools are 'write'", () => {
    const writes = [...new Set(all.filter(t => t.kind === "write").map(t => t.name))].sort();
    expect(writes).toEqual(WRITE_TOOLS);
  });

  it("the six write tools come from the builder sources, not the bootstrap upserts", () => {
    expect(bootstrapped.filter(t => t.kind === "write").map(t => t.name)).toEqual([]);
    expect(builderTools.filter(t => t.kind === "write").map(t => t.name).sort()).toEqual(WRITE_TOOLS);
  });

  it("every other built-in is 'read' (find_memory, Spotify, and the is_submit tools included)", () => {
    const nonWrite = all.filter(t => !WRITE_TOOLS.includes(t.name));
    expect(nonWrite.length).toBeGreaterThan(0);
    expect(nonWrite.filter(t => t.kind !== "read").map(t => t.name)).toEqual([]);
    const names = new Set(nonWrite.map(t => t.name));
    for (const expected of ["find_memory", "get_currently_playing", "get_liked_songs", "get_my_identity", "submit_response"]) {
      expect(names.has(expected)).toBe(true);
    }
  });
});

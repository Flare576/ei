import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, StorageState, ToolDefinition } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

// Importing or restoring a backup replaces the in-memory tool list wholesale. A backup written before
// tool `kind` existed carries built-in tools without it, and a call's persisted kind is stamped once from
// the definition in effect when the tool runs, so a missing kind is backfilled from the current built-in
// definition. Nothing else about a restored definition changes: re-running the bootstrap upsert would
// overwrite the backup's per-tool config and heartbeat_eligible.

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

function createMockInterface(): Ei_Interface {
  return {
    onPersonaAdded: vi.fn(),
    onPersonaRemoved: vi.fn(),
    onPersonaUpdated: vi.fn(),
    onMessageAdded: vi.fn(),
    onMessageProcessing: vi.fn(),
    onMessageQueued: vi.fn(),
    onMessageRecalled: vi.fn(),
    onHumanUpdated: vi.fn(),
    onQueueStateChanged: vi.fn(),
    onError: vi.fn(),
    onStateImported: vi.fn(),
    onOneShotReturned: vi.fn(),
  };
}

function createMockStorage(preloadState: StorageState) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(preloadState),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
  };
}

const restorers = [
  ["importState", (p: Processor, state: StorageState) => p.importState(JSON.stringify(state))],
  ["restoreFromState", (p: Processor, state: StorageState) => p.restoreFromState(state)],
] as const;

describe.each(restorers)("built-in tool kind after %s", (_name, restore) => {
  let processor: Processor;
  let backup: StorageState;

  const toolIn = (state: StorageState, name: string): ToolDefinition => {
    const tool = state.tools?.find(candidate => candidate.name === name);
    if (!tool) throw new Error(`no tool ${name} in state`);
    return tool;
  };

  beforeEach(async () => {
    processor = new Processor(createMockInterface());
    await processor.start(createMockStorage(createDefaultTestState()));
    // The state a pre-`kind` build would have exported: every built-in tool without `kind`.
    const state = processor.getStateManager().getStorageState();
    const tools = (state.tools ?? []).map(tool => {
      const { kind: _kind, ...withoutKind } = tool;
      return withoutKind as ToolDefinition;
    });
    backup = structuredClone({ ...state, tools });
    // Control: the backup really is shaped like an old one, with built-ins present and unclassified.
    expect(backup.tools?.filter(tool => tool.builtin).length).toBeGreaterThan(0);
    expect(backup.tools?.some(tool => tool.kind !== undefined)).toBe(false);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("leaves every built-in tool classified, with file_read as read", async () => {
    await restore(processor, backup);

    const builtIns = processor.getStateManager().tools_getAll().filter(tool => tool.builtin);
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.filter(tool => tool.kind !== "read" && tool.kind !== "write").map(tool => tool.name)).toEqual([]);
    expect(builtIns.find(tool => tool.name === "file_read")?.kind).toBe("read");
  });

  it("backfills only the kind: a restored built-in keeps its config, heartbeat exclusion, enabled flag, description and id", async () => {
    const saved = toolIn(backup, "tavily_web_search");
    saved.config = { api_key: "USER_TOOL_LEVEL_KEY" };
    saved.heartbeat_eligible = false;
    saved.enabled = false;
    saved.description = "A description the backup carried";
    const fileRead = toolIn(backup, "file_read");
    fileRead.enabled = false;
    const tavilyProvider = backup.providers?.find(provider => provider.id === "tavily");
    if (!tavilyProvider) throw new Error("no tavily provider in state");
    tavilyProvider.config = { api_key: "PROVIDER_KEY" };
    tavilyProvider.enabled = true;
    const expectedBeforeKind = structuredClone(backup.tools);

    await restore(processor, backup);

    const after = processor.getStateManager().getStorageState();
    expect(after.tools?.map(({ kind: _kind, ...rest }) => rest)).toEqual(expectedBeforeKind);
    expect(toolIn(after, "tavily_web_search").kind).toBe("read");
    expect(toolIn(after, "file_read").kind).toBe("read");
    expect(after.providers).toEqual(backup.providers);
  });

  it("does not overwrite a kind the backup already carries", async () => {
    toolIn(backup, "file_read").kind = "write";

    await restore(processor, backup);

    const after = processor.getStateManager().getStorageState();
    expect(toolIn(after, "file_read").kind).toBe("write");
    expect(toolIn(after, "list_directory").kind).toBe("read");
  });

  it("does not add a built-in tool the backup lacks", async () => {
    backup.tools = backup.tools?.filter(tool => tool.name !== "list_directory");

    await restore(processor, backup);

    expect(processor.getStateManager().tools_getByName("list_directory")).toBeNull();
    expect(processor.getStateManager().tools_getByName("file_read")?.kind).toBe("read");
  });
});

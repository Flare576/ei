import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, StorageState, ToolDefinition } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

// Importing or restoring a backup replaces the in-memory tool list wholesale. A backup written before
// tool `kind` existed carries built-in tools without it, and a call's persisted kind is stamped once from
// the definition in effect when the tool runs, so the built-ins must be re-normalised by the same
// bootstrap that runs at startup.

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

describe("built-in tool kind after importing or restoring a backup", () => {
  let processor: Processor;
  let backup: StorageState;

  beforeEach(async () => {
    processor = new Processor(createMockInterface());
    await processor.start(createMockStorage(createDefaultTestState()));
    // The state a pre-`kind` build would have exported: every built-in tool without `kind`.
    const state = processor.getStateManager().getStorageState();
    const tools = (state.tools ?? []).map(tool => {
      const { kind: _kind, ...withoutKind } = tool;
      return withoutKind as ToolDefinition;
    });
    backup = { ...state, tools };
    // Control: the backup really is shaped like an old one, with built-ins present and unclassified.
    expect(backup.tools?.filter(tool => tool.builtin).length).toBeGreaterThan(0);
    expect(backup.tools?.some(tool => tool.kind !== undefined)).toBe(false);
  });

  afterEach(async () => {
    await processor.stop();
  });

  it.each([
    ["importState", (p: Processor, state: StorageState) => p.importState(JSON.stringify(state))],
    ["restoreFromState", (p: Processor, state: StorageState) => p.restoreFromState(state)],
  ])("%s leaves every built-in tool classified, with file_read as read", async (_name, restore) => {
    await restore(processor, backup);

    const builtIns = processor.getStateManager().tools_getAll().filter(tool => tool.builtin);
    expect(builtIns.length).toBeGreaterThan(0);
    expect(builtIns.filter(tool => tool.kind !== "read" && tool.kind !== "write").map(tool => tool.name)).toEqual([]);
    expect(builtIns.find(tool => tool.name === "file_read")?.kind).toBe("read");
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { IntegrationSyncManager } from "../../../src/core/integration-sync-manager.js";
import { StateManager } from "../../../src/core/state-manager.js";
import type { Ei_Interface, PersonaEntity, Person } from "../../../src/core/types.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { ompMainSession, ompMessage, ompSubAgent, writeOmpTree } from "../integrations/shared/omp-transcript-fixtures.js";
import { OmpReader } from "../../../src/integrations/omp/reader.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as tests/unit/core/handlers/extraction.test.ts and
// tests/unit/core/state-manager.test.ts. Real `StateManager` reaches Zod
// via entity-schemas.ts.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

function makeTestPersona(id: string, displayName: string): PersonaEntity {
  return {
    id,
    display_name: displayName,
    entity: "system",
    aliases: [displayName],
    short_description: `${displayName} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeLinkedPerson(id: string, name: string, personaId: string): Person {
  return {
    id,
    name,
    description: `${name}'s description`,
    relationship: "AI Persona",
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    validated_date: "",
    identifiers: [
      { type: "Ei Persona", value: personaId },
      { type: "Nickname", value: name, is_primary: true },
    ],
  };
}

const POLLING_INTERVAL_MS = 60_000;
const HOUR_MS = 60 * 60 * 1000;

function externalContents(sm: StateManager, personaId: string): string[] {
  return sm
    .messages_get(personaId)
    .filter((m) => m.external === true)
    .map((m) => m.content ?? "");
}

function activeIds(sm: StateManager): string[] {
  return sm.queue_getAllActiveItems().map((r) => r.id);
}

describe("IntegrationSyncManager OMP tree scheduling", () => {
  let tmpHome: string;
  let sm: StateManager;
  let originalHome: string | undefined;
  let wallNow: number;
  let descendantPath: string;

  const ompSettings = () => sm.getHuman().settings?.omp;
  const waitForIdleImport = (manager: IntegrationSyncManager) =>
    vi.waitFor(() => expect(manager["ompImportInProgress"]).toBe(false), { timeout: 4000, interval: 10 });

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sync-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    wallNow = Date.now();

    sm = new StateManager();
    await sm.initialize(createMockStorage());

    sm.persona_add(makeTestPersona("beta-persona", "Beta"));
    sm.human_person_upsert(makeLinkedPerson("beta-person", "Beta Bot", "beta-persona"));

    // A root session with no messages and two sub-agent transcripts that both name the same agent.
    const older = new Date(wallNow - 2 * HOUR_MS);
    const written = await writeOmpTree(path.join(tmpHome, ".omp", "agent", "sessions"), {
      projectDir: "arbitrary-folder",
      stem: "root_session-tree",
      main: ompMainSession({ messages: [] }),
      children: {
        First: ompSubAgent({
          agent: "Beta",
          messages: [
            ompMessage("user", "first block question", {
              attribution: "agent",
              timestamp: new Date(wallNow - 5 * HOUR_MS).toISOString(),
            }),
            ompMessage("assistant", "first block answer", { timestamp: new Date(wallNow - 5 * HOUR_MS + 60_000).toISOString() }),
          ],
        }),
        Second: ompSubAgent({
          agent: "Beta",
          messages: [
            ompMessage("user", "second block question", {
              attribution: "agent",
              timestamp: new Date(wallNow - 4 * HOUR_MS).toISOString(),
            }),
            ompMessage("assistant", "second block answer", { timestamp: new Date(wallNow - 4 * HOUR_MS + 60_000).toISOString() }),
          ],
        }),
      },
      mtime: older,
    });
    descendantPath = written.children.Second;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("starts the next block of an in-progress tree on the following tick without waiting out the polling interval", async () => {
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, omp: { integration: true, polling_interval_ms: POLLING_INTERVAL_MS } },
    });
    const manager = new IntegrationSyncManager(sm, true, null, new AbortController(), {} as Ei_Interface);

    // First tick queues the first block only.
    await manager.checkAll(sm.getHuman(), wallNow);
    await vi.waitFor(
      () => {
        expect(sm.queue_length()).toBeGreaterThan(0);
        expect(ompSettings()?.current_tree?.done).toHaveLength(1);
      },
      { timeout: 4000, interval: 10 }
    );
    await waitForIdleImport(manager);

    const firstCursor = structuredClone(ompSettings()?.current_tree);
    const firstItemIds = activeIds(sm);
    const firstMessages = structuredClone(sm.messages_get("beta-persona"));
    expect(externalContents(sm, "beta-persona")).toEqual(["first block question", "first block answer"]);
    expect(ompSettings()?.processed_sessions).toBeUndefined();

    // While the first block's scans are pending, later ticks change nothing.
    await manager.checkAll(sm.getHuman(), wallNow + 1_000);
    await manager.checkAll(sm.getHuman(), wallNow + 2_000);
    await waitForIdleImport(manager);
    expect(ompSettings()?.current_tree).toEqual(firstCursor);
    expect(activeIds(sm)).toEqual(firstItemIds);
    expect(sm.messages_get("beta-persona")).toEqual(firstMessages);
    expect(externalContents(sm, "beta-persona")).toEqual(["first block question", "first block answer"]);

    // Drain the queue; the very next tick (well inside the interval) starts the second block.
    for (const item of sm.queue_getAllActiveItems()) sm.queue_complete(item.id);
    expect(sm.queue_length()).toBe(0);
    const tickAfterDrain = wallNow + 5_000;
    expect(tickAfterDrain - wallNow).toBeLessThan(POLLING_INTERVAL_MS);
    await manager.checkAll(sm.getHuman(), tickAfterDrain);

    await vi.waitFor(
      () => {
        expect(externalContents(sm, "beta-persona")).toEqual(["second block question", "second block answer"]);
        expect(ompSettings()?.current_tree).toBeUndefined();
      },
      { timeout: 4000, interval: 10 }
    );
    await waitForIdleImport(manager);

    expect(sm.queue_length()).toBeGreaterThan(0);
    expect(Object.keys(ompSettings()?.processed_sessions ?? {})).toHaveLength(1);
    expect(sm.messages_get("beta-persona").some((m) => m.content === "first block answer")).toBe(false);
  });

  it("lists a quiet-guard-deferred resumed tree at most once per polling interval, then completes it atomically once the tree is quiet", async () => {
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, omp: { integration: true, polling_interval_ms: POLLING_INTERVAL_MS } },
    });
    const manager = new IntegrationSyncManager(sm, true, null, new AbortController(), {} as Ei_Interface);

    // First tick queues the first block only and leaves the tree's cursor set.
    await manager.checkAll(sm.getHuman(), wallNow);
    await vi.waitFor(
      () => {
        expect(sm.queue_length()).toBeGreaterThan(0);
        expect(ompSettings()?.current_tree?.done).toHaveLength(1);
      },
      { timeout: 4000, interval: 10 }
    );
    await waitForIdleImport(manager);

    const originalCursor = structuredClone(ompSettings()?.current_tree);
    const originalProcessed = structuredClone(ompSettings()?.processed_sessions);
    const originalMessages = structuredClone(sm.messages_get("beta-persona"));
    expect(originalCursor).toBeDefined();
    expect(originalProcessed).toBeUndefined();
    expect(externalContents(sm, "beta-persona")).toEqual(["first block question", "first block answer"]);

    // Drain the queue and make a descendant transcript fresh, so the quiet-tree guard defers the resumed tree.
    for (const item of sm.queue_getAllActiveItems()) sm.queue_complete(item.id);
    expect(sm.queue_length()).toBe(0);
    await fs.utimes(descendantPath, new Date(), new Date());

    const listTrees = vi.spyOn(OmpReader.prototype, "listTrees");
    const setHuman = vi.spyOn(sm, "setHuman");
    const messagesAppend = vi.spyOn(sm, "messages_append");
    const messagesRemove = vi.spyOn(sm, "messages_remove");

    // Many idle ticks, all far inside the polling interval; each import settles before the next tick.
    for (let i = 1; i <= 50; i++) {
      await manager.checkAll(sm.getHuman(), wallNow + i * 100);
      await waitForIdleImport(manager);
    }

    // The deferred tree was listed (so the probe did real work), but only once, with a single last_sync write.
    expect(listTrees).toHaveBeenCalledTimes(1);
    expect(setHuman).toHaveBeenCalledTimes(1);
    for (const [written] of setHuman.mock.calls) {
      expect(written.settings?.omp?.current_tree).toEqual(originalCursor);
      expect(written.settings?.omp?.processed_sessions).toBeUndefined();
      expect(written.settings?.omp?.last_sync).toBeDefined();
    }
    expect(messagesAppend).not.toHaveBeenCalled();
    expect(messagesRemove).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
    expect(sm.messages_get("beta-persona")).toEqual(originalMessages);
    expect(ompSettings()?.current_tree).toEqual(originalCursor);
    expect(ompSettings()?.processed_sessions).toBeUndefined();

    // Once the descendant is quiet and the interval (measured from the persisted last_sync) has elapsed, the tree resumes.
    await fs.utimes(descendantPath, new Date(Date.now() - 2 * HOUR_MS), new Date(Date.now() - 2 * HOUR_MS));
    const eligibleNow = Date.now() + POLLING_INTERVAL_MS + 1_000;
    const setHumanCallsBefore = setHuman.mock.calls.length;
    await manager.checkAll(sm.getHuman(), eligibleNow);
    await vi.waitFor(
      () => {
        expect(externalContents(sm, "beta-persona")).toEqual(["second block question", "second block answer"]);
        expect(ompSettings()?.current_tree).toBeUndefined();
      },
      { timeout: 4000, interval: 10 }
    );
    await waitForIdleImport(manager);

    expect(listTrees).toHaveBeenCalledTimes(2);
    expect(sm.queue_length()).toBeGreaterThan(0);
    expect(sm.messages_get("beta-persona").some((m) => m.content === "first block answer")).toBe(false);
    expect(ompSettings()?.processed_sessions?.[originalCursor!.tree]).toBe(originalCursor!.planned_at);
    const completions = setHuman.mock.calls
      .slice(setHumanCallsBefore)
      .filter(([written]) => written.settings?.omp?.processed_sessions?.[originalCursor!.tree] !== undefined);
    expect(completions).toHaveLength(1);
    expect(completions[0][0].settings?.omp?.current_tree).toBeUndefined();
  });

  it("with omp.integration left at its default, the tick never imports — no queue items, no checkpoints, no stored messages", async () => {
    const manager = new IntegrationSyncManager(sm, true, null, new AbortController(), {} as Ei_Interface);

    await manager.checkAll(sm.getHuman(), wallNow);

    expect(sm.queue_getAllActiveItems()).toHaveLength(0);
    expect(ompSettings()?.processed_sessions).toBeUndefined();
    expect(ompSettings()?.current_tree).toBeUndefined();
    expect(ompSettings()?.last_sync).toBeUndefined();
    expect(sm.messages_get("beta-persona")).toHaveLength(0);
  });

  it("keeps an omp.integration pause saved while the rolling backup was in flight, and imports nothing", async () => {
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: {
        ...human.settings,
        backup: { enabled: true, interval_ms: 1_000 },
        omp: { integration: true, polling_interval_ms: POLLING_INTERVAL_MS },
      },
    });
    let releaseBackup!: () => void;
    const backupDone = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    const storage = { ...createMockStorage(), saveRollingBackup: vi.fn((): Promise<void> => backupDone) };
    const manager = new IntegrationSyncManager(sm, true, storage, new AbortController(), {} as Ei_Interface);
    const listTrees = vi.spyOn(OmpReader.prototype, "listTrees");
    const messagesAppend = vi.spyOn(sm, "messages_append");

    const tick = manager.checkAll(sm.getHuman(), wallNow);
    try {
      await vi.waitFor(() => expect(storage.saveRollingBackup).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 10 });
      const live = sm.getHuman();
      sm.setHuman({
        ...live,
        settings: { ...live.settings, omp: { integration: false, polling_interval_ms: POLLING_INTERVAL_MS } },
      });
    } finally {
      releaseBackup();
      await tick;
    }
    await waitForIdleImport(manager);

    expect(ompSettings()?.integration).toBe(false);
    expect(ompSettings()?.last_sync).toBeUndefined();
    expect(ompSettings()?.current_tree).toBeUndefined();
    expect(ompSettings()?.processed_sessions).toBeUndefined();
    expect(listTrees).not.toHaveBeenCalled();
    expect(messagesAppend).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
    expect(externalContents(sm, "beta-persona")).toEqual([]);
  });

  it("keeps progress and model saved while the rolling backup was in flight, changing only last_sync", async () => {
    const [tree] = await new OmpReader().listTrees();
    expect(tree).toBeDefined();
    // A fresh descendant keeps the quiet-tree guard deferring the tree, so the importer itself cannot alter progress.
    await fs.utimes(descendantPath, new Date(), new Date());

    const olderWatermark = "2026-01-01T00:00:00.000Z";
    const newerWatermark = "2026-02-02T00:00:00.000Z";
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: {
        ...human.settings,
        backup: { enabled: true, interval_ms: 1_000 },
        omp: {
          integration: true,
          polling_interval_ms: POLLING_INTERVAL_MS,
          extraction_model: "Old:model",
          processed_sessions: { [tree.id]: olderWatermark },
          current_tree: { tree: tree.id, planned_at: olderWatermark, done: ["stale-block"] },
        },
      },
    });
    let releaseBackup!: () => void;
    const backupDone = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    const storage = { ...createMockStorage(), saveRollingBackup: vi.fn((): Promise<void> => backupDone) };
    const manager = new IntegrationSyncManager(sm, true, storage, new AbortController(), {} as Ei_Interface);
    const listTrees = vi.spyOn(OmpReader.prototype, "listTrees");

    const tick = manager.checkAll(sm.getHuman(), wallNow);
    try {
      await vi.waitFor(() => expect(storage.saveRollingBackup).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 10 });
      const live = sm.getHuman();
      sm.setHuman({
        ...live,
        settings: {
          ...live.settings,
          omp: {
            integration: true,
            polling_interval_ms: POLLING_INTERVAL_MS,
            extraction_model: "New:model",
            processed_sessions: { [tree.id]: newerWatermark },
          },
        },
      });
    } finally {
      releaseBackup();
      await tick;
    }
    await waitForIdleImport(manager);

    expect(listTrees).toHaveBeenCalledTimes(1);
    expect(ompSettings()).toEqual({
      integration: true,
      polling_interval_ms: POLLING_INTERVAL_MS,
      extraction_model: "New:model",
      processed_sessions: { [tree.id]: newerWatermark },
      last_sync: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(ompSettings()!.last_sync!))).toBe(false);
    expect(sm.queue_length()).toBe(0);
    expect(externalContents(sm, "beta-persona")).toEqual([]);
  });

  it("imports the first block normally after an unchanged rolling backup completes", async () => {
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: {
        ...human.settings,
        backup: { enabled: true, interval_ms: 1_000 },
        omp: { integration: true, polling_interval_ms: POLLING_INTERVAL_MS },
      },
    });
    let releaseBackup!: () => void;
    const backupDone = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    const storage = { ...createMockStorage(), saveRollingBackup: vi.fn((): Promise<void> => backupDone) };
    const manager = new IntegrationSyncManager(sm, true, storage, new AbortController(), {} as Ei_Interface);

    const tick = manager.checkAll(sm.getHuman(), wallNow);
    try {
      await vi.waitFor(() => expect(storage.saveRollingBackup).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 10 });
      expect(sm.getHuman().settings?.backup?.last_backup).toBe(new Date(wallNow).toISOString());
    } finally {
      releaseBackup();
      await tick;
    }
    await vi.waitFor(
      () => {
        expect(sm.queue_length()).toBeGreaterThan(0);
        expect(ompSettings()?.current_tree?.done).toHaveLength(1);
      },
      { timeout: 4000, interval: 10 }
    );
    await waitForIdleImport(manager);

    expect(externalContents(sm, "beta-persona")).toEqual(["first block question", "first block answer"]);
    expect(ompSettings()?.integration).toBe(true);
    expect(ompSettings()?.last_sync).toBeDefined();
    expect(ompSettings()?.processed_sessions).toBeUndefined();
    expect(ompSettings()?.current_tree).toBeDefined();
  });

  it("honors a longer polling interval saved while the rolling backup was in flight", async () => {
    await fs.utimes(descendantPath, new Date(), new Date());
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, omp: { integration: true, polling_interval_ms: 1_000 } },
    });
    let releaseBackup!: () => void;
    const backupDone = new Promise<void>((resolve) => {
      releaseBackup = resolve;
    });
    const storage = { ...createMockStorage(), saveRollingBackup: vi.fn((): Promise<void> => backupDone) };
    const manager = new IntegrationSyncManager(sm, true, storage, new AbortController(), {} as Ei_Interface);
    const listTrees = vi.spyOn(OmpReader.prototype, "listTrees");

    // Prime: a quiet-deferred import with no progress, so the same manager has synced once and has no continuation.
    await manager.checkAll(sm.getHuman(), wallNow);
    await waitForIdleImport(manager);
    expect(listTrees).toHaveBeenCalledTimes(1);
    expect(manager["ompContinuation"]).toBe(false);
    expect(sm.queue_length()).toBe(0);
    const firstSync = ompSettings()?.last_sync;
    expect(firstSync).toBeDefined();

    // Backup is due now; the short interval has elapsed since the first sync.
    const afterPrime = sm.getHuman();
    sm.setHuman({
      ...afterPrime,
      settings: { ...afterPrime.settings, backup: { enabled: true, interval_ms: 1_000 } },
    });
    const tick = manager.checkAll(sm.getHuman(), Date.parse(firstSync!) + 5_000);
    try {
      await vi.waitFor(() => expect(storage.saveRollingBackup).toHaveBeenCalledTimes(1), { timeout: 4000, interval: 10 });
      const live = sm.getHuman();
      sm.setHuman({
        ...live,
        settings: { ...live.settings, omp: { integration: true, polling_interval_ms: 60_000, last_sync: firstSync } },
      });
    } finally {
      releaseBackup();
      await tick;
    }
    await waitForIdleImport(manager);

    expect(listTrees).toHaveBeenCalledTimes(1);
    expect(ompSettings()?.last_sync).toBe(firstSync);
    expect(ompSettings()?.polling_interval_ms).toBe(60_000);
    expect(sm.queue_length()).toBe(0);
    expect(externalContents(sm, "beta-persona")).toEqual([]);
  });
});

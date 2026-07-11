// THROWAWAY QA ARTIFACT — Final Verification Wave, item F3 (Beta).
// Not a plan deliverable. Exercises scenario 5 of the F3 assignment:
// "Model resolution after migration: a state with only `default_model` set
// — confirm `conversation_model`/`extraction_model` populate correctly via
// both fresh load AND `restoreFromState`, AND survive a simulated sync
// merge round-trip."
//
// migration-model-split.test.ts already covers fresh-load and
// restoreFromState in isolation, and merge.test.ts already covers merge
// preservation with independently-set conversation_model values. What none
// of those files do is chain the three together end to end — this file
// migrates a real default_model-only fixture, merges the RESULT against a
// simulated pre-migration remote peer, restores the merged output into a
// fresh running instance, and proves the resolvers actually resolve a real
// model spec out the other end.
import { describe, it, expect, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { yoloMerge } from "../../../src/storage/merge.js";
import { getModelForPersona, getOneshotModel } from "../../../src/core/heartbeat-manager.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { StorageState } from "../../../src/core/types.js";

const GUID = "33333333-3333-3333-3333-333333333333";

describe("Final QA — model resolution after migration (fresh load + restoreFromState + sync merge round-trip)", () => {
  it("fresh load: default_model-only state migrates and resolves via getModelForPersona/getOneshotModel", async () => {
    const state = createDefaultTestState();
    state.human.settings = { default_model: GUID };
    const storage = createMockStorage();
    vi.mocked(storage.load).mockResolvedValue(state);

    const sm = new StateManager();
    await sm.initialize(storage);

    expect(sm.getHuman().settings?.conversation_model).toBe(GUID);
    expect(sm.getHuman().settings?.extraction_model).toBe(GUID);
    expect(getModelForPersona(sm, undefined)).toBe(GUID);
    expect(getOneshotModel(sm)).toBe(GUID);
  });

  it("restoreFromState leg: a legacy default_model-only backup restored into a running instance resolves the same way", async () => {
    const sm = new StateManager();
    const storage = createMockStorage();
    await sm.initialize(storage); // fresh/empty instance, no settings yet

    const legacyBackup = createDefaultTestState();
    legacyBackup.human.settings = { default_model: GUID };
    sm.restoreFromState(legacyBackup);

    expect(sm.getHuman().settings?.conversation_model).toBe(GUID);
    expect(sm.getHuman().settings?.extraction_model).toBe(GUID);
    expect(getModelForPersona(sm, undefined)).toBe(GUID);
    expect(getOneshotModel(sm)).toBe(GUID);
  });

  it("sync-merge round-trip: migrating THIS machine then pulling a not-yet-migrated remote must not drop the locally-migrated fields, and the merged result still resolves", async () => {
    // 1. This machine: migrate a default_model-only state via a real
    // StateManager.initialize() (List-B migration path).
    const localPreMigration = createDefaultTestState();
    localPreMigration.human.settings = { default_model: GUID };
    const localStorage = createMockStorage();
    vi.mocked(localStorage.load).mockResolvedValue(localPreMigration);
    const localSm = new StateManager();
    await localSm.initialize(localStorage);
    const localMigrated: StorageState = localSm.getStorageState();
    expect(localMigrated.human.settings?.conversation_model).toBe(GUID);
    expect(localMigrated.human.settings?.extraction_model).toBe(GUID);

    // 2. A DIFFERENT (remote) peer that has NOT run this release yet — still
    // old-shape, only default_model, no conversation_model/extraction_model
    // at all. Its timestamp is NEWER, so yoloMerge's preferRemote branch is
    // exercised — exactly the branch merge.ts:150-151's syncdrop guard
    // protects (remote's `undefined` must not overwrite local's migrated
    // value with `undefined`).
    const remotePreMigration = createDefaultTestState();
    remotePreMigration.human.settings = { default_model: GUID, queue_paused: true };
    remotePreMigration.timestamp = new Date(Date.now() + 60_000).toISOString();

    const merged = yoloMerge(localMigrated, remotePreMigration);

    expect(merged.human.settings?.conversation_model).toBe(GUID);
    expect(merged.human.settings?.extraction_model).toBe(GUID);
    // Remote's genuinely-newer, genuinely-different field DID win — proves
    // preferRemote actually ran (not a no-op merge that would make the
    // assertion above vacuously true).
    expect(merged.human.settings?.queue_paused).toBe(true);

    // 3. Feed the merged (post sync-pull) state back through
    // restoreFromState on a running instance and confirm the CHAT/oneshot
    // resolvers still resolve a real model spec end to end.
    const sm3 = new StateManager();
    const storage3 = createMockStorage();
    await sm3.initialize(storage3);
    sm3.restoreFromState(merged);

    expect(sm3.getHuman().settings?.conversation_model).toBe(GUID);
    expect(getModelForPersona(sm3, undefined)).toBe(GUID);
    expect(getOneshotModel(sm3)).toBe(GUID);
  });
});

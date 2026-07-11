import { describe, it, expect, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { getModelForPersona, getOneshotModel } from "../../../src/core/heartbeat-manager.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { PersonaEntity, StorageState } from "../../../src/core/types.js";

const GUID = "11111111-1111-1111-1111-111111111111";
const CONV_GUID = "22222222-2222-2222-2222-222222222222";

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "p1",
    display_name: "Persona One",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

async function makeStateManager(): Promise<StateManager> {
  const sm = new StateManager();
  const storage = createMockStorage();
  vi.mocked(storage.load).mockResolvedValue(null);
  await sm.initialize(storage);
  return sm;
}

describe("getModelForPersona", () => {
  it("persona.model wins over settings.conversation_model", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1", model: "Persona:override" }));
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm, "p1")).toBe("Persona:override");
  });

  it("falls back to settings.conversation_model when persona.model unset", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm, "p1")).toBe(CONV_GUID);
  });

  it("with no personaId, returns settings.conversation_model directly", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm)).toBe(CONV_GUID);
  });

  it("backward-read: old-shape state (only default_model set, pre-migration) still resolves via migrated conversation_model", async () => {
    // Simulate a pre-migration backup/sync-pull restore: only `default_model` on disk.
    const sm = new StateManager();
    await sm.initialize(createMockStorage()); // fresh load, no saved data

    const restoredState: StorageState = createDefaultTestState();
    restoredState.human.settings = { default_model: GUID };
    restoredState.personas = {
      p1: {
        entity: makePersona({ id: "p1" }),
        messages: [],
      } as unknown as StorageState["personas"][string],
    };

    sm.restoreFromState(restoredState);

    // runMigrations() (invoked by restoreFromState) backfills conversation_model
    // from the legacy default_model before any read site ever sees settings.
    expect(sm.getHuman().settings?.conversation_model).toBe(GUID);
    expect(getModelForPersona(sm, "p1")).toBe(GUID);
    expect(getModelForPersona(sm)).toBe(GUID);
  });
});

describe("getOneshotModel", () => {
  it("oneshot_model wins over settings.conversation_model", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, oneshot_model: "Oneshot:special", conversation_model: CONV_GUID },
    });

    expect(getOneshotModel(sm)).toBe("Oneshot:special");
  });

  it("falls back to settings.conversation_model when oneshot_model unset", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, oneshot_model: undefined, conversation_model: CONV_GUID } });

    expect(getOneshotModel(sm)).toBe(CONV_GUID);
  });

  it("backward-read: old-shape state (only default_model set) still resolves a usable oneshot model", async () => {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());

    const restoredState: StorageState = createDefaultTestState();
    restoredState.human.settings = { default_model: GUID };
    sm.restoreFromState(restoredState);

    expect(getOneshotModel(sm)).toBe(GUID);
  });
});

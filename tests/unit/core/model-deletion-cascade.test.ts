import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { ProviderType } from "../../../src/core/types/enums.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types/entities.js";
import type { StorageState } from "../../../src/core/types.js";

describe("StateManager.deleteModel()", () => {
  let sm: StateManager;

  function makeModel(name: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
    return {
      id: crypto.randomUUID(),
      name,
      ...overrides,
    };
  }

  function makeProvider(name: string, models: ModelConfig[], overrides: Partial<ProviderAccount> = {}): ProviderAccount {
    return {
      id: crypto.randomUUID(),
      name,
      type: ProviderType.LLM,
      url: "https://api.example.com",
      created_at: new Date().toISOString(),
      models,
      default_model: models[0]?.id,
      ...overrides,
    };
  }

  function makePersonaRecord(id: string, model?: string) {
    return {
      entity: {
        id,
        display_name: `Persona ${id}`,
        entity: "system" as const,
        traits: [],
        topics: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: new Date().toISOString(),
        model,
      },
      messages: [],
    };
  }

  async function initWithState(state: StorageState): Promise<void> {
    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);
  }

  beforeEach(() => {
    sm = new StateManager();
  });

  it("test 1: deleting a model clears all reference types", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("gpt-4o");
    const modelB = makeModel("gpt-3.5-turbo");
    const provider = makeProvider("OpenAI", [modelA, modelB]);
    provider.default_model = modelA.id;

    state.human.settings = {
      accounts: [provider],
      default_model: modelA.id,
      oneshot_model: modelA.id,
      rewrite_model: modelA.id,
      opencode: { extraction_model: modelA.id },
      claudeCode: { extraction_model: modelA.id },
    };
    state.personas = {
      p1: makePersonaRecord("p1", modelA.id) as any,
    };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelA.id);

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();

    const human = sm.getHuman();
    expect(human.settings!.default_model).toBeUndefined();
    expect(human.settings!.oneshot_model).toBeUndefined();
    expect(human.settings!.rewrite_model).toBeUndefined();
    expect(human.settings!.opencode?.extraction_model).toBeUndefined();
    expect(human.settings!.claudeCode?.extraction_model).toBeUndefined();

    const accounts = human.settings!.accounts!;
    const prov = accounts.find(a => a.id === provider.id)!;
    expect(prov.default_model).toBeUndefined();

    const personas = sm.persona_getAll();
    const p1 = personas.find(p => p.id === "p1")!;
    expect(p1.model).toBeUndefined();
  });

  it("test 2: cleared list accurately lists all touched references", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("claude-opus-4");
    const modelB = makeModel("claude-haiku");
    const provider = makeProvider("Anthropic", [modelA, modelB]);
    provider.default_model = modelA.id;

    state.human.settings = {
      accounts: [provider],
      default_model: modelA.id,
      opencode: { extraction_model: modelA.id },
    };
    state.personas = {
      p1: makePersonaRecord("p1", modelA.id) as any,
      p2: makePersonaRecord("p2", modelB.id) as any,
    };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelA.id);

    expect(result.success).toBe(true);
    expect(result.cleared).toContain("settings.default_model");
    expect(result.cleared).toContain("settings.opencode.extraction_model");
    expect(result.cleared).toContain("provider.default_model");
    expect(result.cleared).toContain("persona:Persona p1");
    // p2 uses modelB, not cleared
    expect(result.cleared).not.toContain("persona:Persona p2");
    expect(result.cleared).toHaveLength(4);
  });

  it("test 3: refuses deletion when model is the last one on the provider", async () => {
    const state = createDefaultTestState();
    const modelOnly = makeModel("gpt-4o");
    const provider = makeProvider("OpenAI", [modelOnly]);

    state.human.settings = {
      accounts: [provider],
      default_model: modelOnly.id,
    };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelOnly.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.cleared).toHaveLength(0);

    const human = sm.getHuman();
    const accounts = human.settings!.accounts!;
    const prov = accounts.find(a => a.id === provider.id)!;
    expect(prov.models).toHaveLength(1);
    expect(prov.models![0].id).toBe(modelOnly.id);
  });

  it("test 4: model is removed from provider.models[] after deletion", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("model-a");
    const modelB = makeModel("model-b");
    const provider = makeProvider("TestProvider", [modelA, modelB]);

    state.human.settings = { accounts: [provider] };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelA.id);

    expect(result.success).toBe(true);

    const human = sm.getHuman();
    const prov = human.settings!.accounts!.find(a => a.id === provider.id)!;
    expect(prov.models).toHaveLength(1);
    expect(prov.models![0].id).toBe(modelB.id);
    expect(prov.models!.find(m => m.id === modelA.id)).toBeUndefined();
  });

  it("test 5: deleting unreferenced model succeeds with empty cleared list", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("model-a");
    const modelB = makeModel("model-b");
    const provider = makeProvider("TestProvider", [modelA, modelB]);

    state.human.settings = {
      accounts: [provider],
      default_model: modelA.id,
    };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelB.id);

    expect(result.success).toBe(true);
    expect(result.cleared).toHaveLength(0);

    const human = sm.getHuman();
    const prov = human.settings!.accounts!.find(a => a.id === provider.id)!;
    expect(prov.models).toHaveLength(1);
    expect(prov.models![0].id).toBe(modelA.id);
  });

  it("test 6: provider with 2 models → delete one → 1 model remains", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("alpha");
    const modelB = makeModel("beta");
    const provider = makeProvider("Provider", [modelA, modelB]);

    state.human.settings = { accounts: [provider] };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelA.id);

    expect(result.success).toBe(true);

    const human = sm.getHuman();
    const prov = human.settings!.accounts!.find(a => a.id === provider.id)!;
    expect(prov.models).toHaveLength(1);
    expect(prov.models![0].id).toBe(modelB.id);
  });

  it("test 7: nonexistent provider ID returns error", async () => {
    const state = createDefaultTestState();
    const model = makeModel("gpt-4o");
    const provider = makeProvider("OpenAI", [model]);
    state.human.settings = { accounts: [provider] };

    await initWithState(state);

    const result = sm.deleteModel("non-existent-provider-id", model.id);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.cleared).toHaveLength(0);
  });

  it("test 8: nonexistent model ID returns error", async () => {
    const state = createDefaultTestState();
    const model = makeModel("gpt-4o");
    const provider = makeProvider("OpenAI", [model]);
    state.human.settings = { accounts: [provider] };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, "non-existent-model-id");

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.cleared).toHaveLength(0);
  });

  it("test 9: only personas using the deleted model are cleared", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("model-a");
    const modelB = makeModel("model-b");
    const provider = makeProvider("Provider", [modelA, modelB]);

    state.human.settings = { accounts: [provider] };
    state.personas = {
      p1: makePersonaRecord("p1", modelA.id) as any,
      p2: makePersonaRecord("p2", modelB.id) as any,
      p3: makePersonaRecord("p3", modelA.id) as any,
      p4: makePersonaRecord("p4", undefined) as any,
    };

    await initWithState(state);

    const result = sm.deleteModel(provider.id, modelA.id);

    expect(result.success).toBe(true);

    const personas = sm.persona_getAll();
    const p1 = personas.find(p => p.id === "p1")!;
    const p2 = personas.find(p => p.id === "p2")!;
    const p3 = personas.find(p => p.id === "p3")!;
    const p4 = personas.find(p => p.id === "p4")!;

    expect(p1.model).toBeUndefined();
    expect(p2.model).toBe(modelB.id);
    expect(p3.model).toBeUndefined();
    expect(p4.model).toBeUndefined();

    const clearedPersonas = result.cleared.filter(c => c.startsWith("persona:"));
    expect(clearedPersonas).toHaveLength(2);
    expect(result.cleared).toContain("persona:Persona p1");
    expect(result.cleared).toContain("persona:Persona p3");
    expect(result.cleared).not.toContain("persona:Persona p2");
    expect(result.cleared).not.toContain("persona:Persona p4");
  });

  it("test 10: successful deletion triggers a save", async () => {
    const state = createDefaultTestState();
    const modelA = makeModel("model-a");
    const modelB = makeModel("model-b");
    const provider = makeProvider("Provider", [modelA, modelB]);
    state.human.settings = { accounts: [provider] };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const saveBefore = (storage.save as any).mock.calls.length;

    sm.deleteModel(provider.id, modelA.id);

    await sm.flush();

    expect((storage.save as any).mock.calls.length).toBeGreaterThan(saveBefore);
  });
});

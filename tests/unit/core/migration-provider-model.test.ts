import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { ProviderType } from "../../../src/core/types/enums.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types/entities.js";

describe("StateManager.migrateProviderModel()", () => {
  let sm: StateManager;

  function makeProvider(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
    return {
      id: crypto.randomUUID(),
      name: "TestProvider",
      type: ProviderType.LLM,
      url: "https://api.example.com",
      created_at: new Date().toISOString(),
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

  beforeEach(async () => {
    sm = new StateManager();
  });

  it("test 1: empty state (no providers, no settings) → no-op", async () => {
    const state = createDefaultTestState();
    state.human.settings = {};

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    expect(human.settings?.accounts).toBeUndefined();
  });

  it("test 2: provider with default_model and token_limit → ModelConfig with token_limit, default_model becomes GUID", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({
      name: "OpenAI",
      default_model: "gpt-4o",
      token_limit: 128000,
    });
    state.human.settings = { accounts: [provider] };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];

    expect(account.models).toBeDefined();
    expect(account.models!.length).toBe(1);

    const model = account.models![0];
    expect(model.name).toBe("gpt-4o");
    expect(model.token_limit).toBe(128000);
    expect(model.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(account.default_model).toBe(model.id);
    expect((account as any).token_limit).toBeUndefined();
  });

  it("test 3: provider with no default_model and no token_limit → gets single 'default' sentinel model", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({ name: "LocalLLM" });
    state.human.settings = { accounts: [provider] };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];

    expect(account.models).toBeDefined();
    expect(account.models!.length).toBe(1);
    expect(account.models![0].name).toBe("default");
    expect(account.models![0].token_limit).toBeUndefined();
    expect(account.default_model).toBe(account.models![0].id);
  });

  it("test 4: provider with default_model but no token_limit → named model with no limits", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({
      name: "Anthropic",
      default_model: "claude-opus-4",
    });
    state.human.settings = { accounts: [provider] };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];

    expect(account.models).toBeDefined();
    expect(account.models!.length).toBe(1);
    const model = account.models![0];
    expect(model.name).toBe("claude-opus-4");
    expect(model.token_limit).toBeUndefined();
    expect(account.default_model).toBe(model.id);
  });

  it("test 5: all 5 reference fields migrated from Provider:model to GUID", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({ name: "OpenAI", default_model: "gpt-4o" });
    state.human.settings = {
      accounts: [provider],
      default_model: "OpenAI:gpt-4o",
      oneshot_model: "OpenAI:gpt-4o",
      rewrite_model: "OpenAI:gpt-4o",
      opencode: { extraction_model: "OpenAI:gpt-4o" },
      claudeCode: { extraction_model: "OpenAI:gpt-4o" },
    };
    state.personas = { p1: makePersonaRecord("p1", "OpenAI:gpt-4o") as any };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];
    const modelGuid = account.models![0].id;

    expect(human.settings!.default_model).toBe(modelGuid);
    expect(human.settings!.oneshot_model).toBe(modelGuid);
    expect(human.settings!.rewrite_model).toBe(modelGuid);
    expect(human.settings!.opencode?.extraction_model).toBe(modelGuid);
    expect(human.settings!.claudeCode?.extraction_model).toBe(modelGuid);

    const personas = sm.persona_getAll();
    const p = personas.find(p => p.id === "p1");
    expect(p).toBeDefined();
    expect(p!.model).toBe(modelGuid);
  });

  it("test 6: reference to nonexistent provider → cleared to undefined (orphan handling)", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({ name: "OpenAI", default_model: "gpt-4o" });

    state.human.settings = {
      accounts: [provider],
      default_model: "NonExistentProvider:gpt-4o",
      oneshot_model: "OpenAI:gpt-4o",
    };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];
    const modelGuid = account.models![0].id;

    expect(human.settings!.default_model).toBeUndefined();
    expect(human.settings!.oneshot_model).toBe(modelGuid);
  });

  it("test 7: already-migrated state (models[] exists) → skipped, no changes", async () => {
    const existingModel: ModelConfig = {
      id: "00000000-0000-0000-0000-000000000001",
      name: "gpt-4o",
      token_limit: 128000,
    };
    const state = createDefaultTestState();
    const provider = makeProvider({
      name: "OpenAI",
      default_model: existingModel.id,
      models: [existingModel],
    });

    state.human.settings = {
      accounts: [provider],
      default_model: existingModel.id,
    };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];

    expect(account.models).toHaveLength(1);
    expect(account.models![0].id).toBe(existingModel.id);
    expect(account.models![0].name).toBe("gpt-4o");
    expect(account.models![0].token_limit).toBe(128000);
    expect(account.default_model).toBe(existingModel.id);
  });

  it("test 8: multiple providers, multiple personas → all references updated", async () => {
    const state = createDefaultTestState();
    const openaiProvider = makeProvider({ name: "OpenAI", default_model: "gpt-4o" });
    const anthropicProvider = makeProvider({ name: "Anthropic", default_model: "claude-opus-4" });

    state.human.settings = {
      accounts: [openaiProvider, anthropicProvider],
      default_model: "OpenAI:gpt-4o",
    };
    state.personas = {
      p1: makePersonaRecord("p1", "OpenAI:gpt-4o") as any,
      p2: makePersonaRecord("p2", "Anthropic:claude-opus-4") as any,
      p3: makePersonaRecord("p3", "OpenAI:gpt-4o") as any,
    };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const accounts = human.settings!.accounts!;
    const openai = accounts.find(a => a.name === "OpenAI")!;
    const anthropic = accounts.find(a => a.name === "Anthropic")!;

    const openaiGuid = openai.models![0].id;
    const anthropicGuid = anthropic.models![0].id;

    expect(openai.models).toHaveLength(1);
    expect(openai.models![0].name).toBe("gpt-4o");
    expect(anthropic.models).toHaveLength(1);
    expect(anthropic.models![0].name).toBe("claude-opus-4");

    expect(human.settings!.default_model).toBe(openaiGuid);

    const personas = sm.persona_getAll();
    const p1 = personas.find(p => p.id === "p1")!;
    const p2 = personas.find(p => p.id === "p2")!;
    const p3 = personas.find(p => p.id === "p3")!;
    expect(p1.model).toBe(openaiGuid);
    expect(p2.model).toBe(anthropicGuid);
    expect(p3.model).toBe(openaiGuid);
  });

  it("test 9b: existing '(default)' model name is migrated to 'default' sentinel", async () => {
    const state = createDefaultTestState();
    const existingModelId = crypto.randomUUID();
    const provider = makeProvider({
      name: "LMStudio",
      default_model: existingModelId,
      models: [{ id: existingModelId, name: "(default)", model_id: "(default)" } as ModelConfig],
    });
    state.human.settings = { accounts: [provider] };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const account = human.settings!.accounts![0];
    expect(account.models![0].name).toBe("default");
    expect(account.models![0].model_id).toBeUndefined();
    expect(account.default_model).toBe(existingModelId);
  });

  it("test 9: extraction_token_limit removed from OpenCodeSettings and ClaudeCodeSettings after migration", async () => {
    const state = createDefaultTestState();
    const provider = makeProvider({ name: "OpenAI", default_model: "gpt-4o" });

    state.human.settings = {
      accounts: [provider],
      opencode: {
        extraction_model: "OpenAI:gpt-4o",
        extraction_token_limit: 32000,
      } as any,
      claudeCode: {
        extraction_model: "OpenAI:gpt-4o",
        extraction_token_limit: 16000,
      } as any,
    };

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    expect((human.settings!.opencode as any)?.extraction_token_limit).toBeUndefined();
    expect((human.settings!.claudeCode as any)?.extraction_token_limit).toBeUndefined();
  });
});

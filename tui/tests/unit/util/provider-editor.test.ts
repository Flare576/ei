import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProviderViaEditor, openProviderEditor } from "../../../src/util/provider-editor";
import type { CommandContext } from "../../../src/commands/registry";
import type { EiContextValue } from "../../../src/context/ei";
import type { CliRenderer } from "@opentui/core";
import type { HumanEntity, HumanSettings, PersonaEntity } from "../../../../src/core/types";

// A valid new-provider YAML (name/url filled in, one non-deleted model) that
// `newProviderFromYAML` will accept without throwing.
const VALID_PROVIDER_YAML = [
  "name: TestProvider",
  "type: llm",
  "url: https://api.test.example/v1",
  "api_key: sk-test-key",
  "default_model: default",
  "token_limit: null",
  "extra_headers: {}",
  "enabled: true",
  "models:",
  "  - name: default",
  "    model_id: default",
  "    token_limit: null",
  "    max_output_tokens: null",
  "    thinking_budget: null",
].join("\n") + "\n";

function createMockRenderer(): CliRenderer {
  return {
    suspend: () => {},
    resume: () => {},
    currentRenderBuffer: { clear: () => {} },
    requestRender: () => {},
  } as unknown as CliRenderer;
}

/** Writes a source file with `content` and returns an $EDITOR command that
 * copies it verbatim onto whatever tmp file spawnEditor asks it to edit. */
function fakeEditorFor(content: string): { editorCmd: string; cleanup: () => void } {
  const srcFile = path.join(
    os.tmpdir(),
    `fake-editor-src-${Date.now()}-${Math.random().toString(36).slice(2)}.yaml`
  );
  fs.writeFileSync(srcFile, content, "utf-8");
  return {
    editorCmd: `bash -c 'cp "${srcFile}" "$1"' --`,
    cleanup: () => {
      try { fs.unlinkSync(srcFile); } catch {}
    },
  };
}

function makeHuman(settings: HumanSettings): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: "2024-01-01T00:00:00.000Z",
    settings,
  };
}

function makeContext(
  human: HumanEntity,
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>,
  personaRecords: Record<string, PersonaEntity> = {},
  options: {
    deleteModel?: EiContextValue["deleteModel"];
    deleteProvider?: EiContextValue["deleteProvider"];
    onNotify?: (message: string, level: "error" | "warn" | "info") => void;
  } = {}
): CommandContext {
  const clearModelReferences = (modelId: string) => {
    const settings = human.settings;
    if (!settings) return;
    if (settings.default_model === modelId) settings.default_model = undefined;
    if (settings.oneshot_model === modelId) settings.oneshot_model = undefined;
    if (settings.rewrite_model === modelId) settings.rewrite_model = undefined;
    if (settings.conversation_model === modelId) settings.conversation_model = undefined;
    if (settings.extraction_model === modelId) settings.extraction_model = undefined;
    if (settings.opencode?.extraction_model === modelId) {
      settings.opencode = { ...settings.opencode, extraction_model: undefined };
    }
    if (settings.claudeCode?.extraction_model === modelId) {
      settings.claudeCode = { ...settings.claudeCode, extraction_model: undefined };
    }
    for (const id of Object.keys(personaRecords)) {
      if (personaRecords[id].model === modelId) {
        personaRecords[id] = { ...personaRecords[id], model: undefined };
      }
    }
  };

  // Mimics StateManager.deleteModel's cascade: drop the model from the
  // provider's model list, then sweep every settings pointer + persona pin.
  const defaultDeleteModel: EiContextValue["deleteModel"] = async (providerId, modelId) => {
    const account = (human.settings?.accounts ?? []).find((a) => a.id === providerId);
    if (!account) return { success: false, error: "Provider not found" };
    account.models = (account.models ?? []).filter((m) => m.id !== modelId);
    clearModelReferences(modelId);
    return { success: true };
  };

  // Mimics StateManager.deleteProvider's cascade: sweep every model the
  // provider owns, then remove the account itself.
  const defaultDeleteProvider: EiContextValue["deleteProvider"] = async (providerId) => {
    const account = (human.settings?.accounts ?? []).find((a) => a.id === providerId);
    if (!account) return { success: false, error: "Provider not found" };
    for (const model of account.models ?? []) {
      clearModelReferences(model.id);
    }
    if (human.settings) {
      human.settings.accounts = (human.settings.accounts ?? []).filter((a) => a.id !== providerId);
    }
    return { success: true };
  };

  return {
    showOverlay: () => {},
    hideOverlay: () => {},
    showNotification: (message: string, level: "error" | "warn" | "info") => {
      options.onNotify?.(message, level);
    },
    exitApp: async () => {},
    stopProcessor: async () => {},
    renderer: createMockRenderer(),
    setInputText: () => {},
    getInputText: () => "",
    ei: {
      getHuman: async () => human,
      updateSettings,
      personas: () => Object.values(personaRecords).map((p) => ({ id: p.id, display_name: p.display_name })),
      getPersona: async (id: string) => personaRecords[id] ?? null,
      updatePersona: async (id: string, updates: Partial<PersonaEntity>) => {
        if (personaRecords[id]) personaRecords[id] = { ...personaRecords[id], ...updates };
      },
      deleteModel: options.deleteModel ?? defaultDeleteModel,
      deleteProvider: options.deleteProvider ?? defaultDeleteProvider,
    } as unknown as EiContextValue,
  };
}

describe("createProviderViaEditor - conversation_model/extraction_model seeding (T8)", () => {
  let originalEditor: string | undefined;
  let cleanupEditor: (() => void) | null = null;

  beforeEach(() => {
    originalEditor = process.env.EDITOR;
  });

  afterEach(() => {
    if (originalEditor !== undefined) process.env.EDITOR = originalEditor;
    else delete process.env.EDITOR;
    cleanupEditor?.();
    cleanupEditor = null;
  });

  test("seeds conversation_model and extraction_model when neither is set (first provider via /provider)", async () => {
    const { editorCmd, cleanup } = fakeEditorFor(VALID_PROVIDER_YAML);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({});
    let saved: Partial<HumanSettings> | undefined;
    const ctx = makeContext(human, async (updates) => { saved = updates; });

    const result = await createProviderViaEditor(ctx);

    expect(result.created).toBe(true);
    if (!saved) throw new Error("expected ctx.ei.updateSettings to be called");
    expect(saved.conversation_model).toBe("TestProvider:default");
    expect(saved.extraction_model).toBe("TestProvider:default");
    expect(saved.default_model).toBeUndefined();
  });

  test("does NOT overwrite an already-set conversation_model", async () => {
    const { editorCmd, cleanup } = fakeEditorFor(VALID_PROVIDER_YAML);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ conversation_model: "existing-guid", extraction_model: "existing-guid" });
    let saved: Partial<HumanSettings> | undefined;
    const ctx = makeContext(human, async (updates) => { saved = updates; });

    await createProviderViaEditor(ctx);

    if (!saved) throw new Error("expected ctx.ei.updateSettings to be called");
    expect(saved.conversation_model).toBeUndefined();
    expect(saved.extraction_model).toBeUndefined();
  });

  test("seeds only the field that is still unset (per-field idempotency, mirrors migrateModelSplit)", async () => {
    const { editorCmd, cleanup } = fakeEditorFor(VALID_PROVIDER_YAML);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ conversation_model: "existing-guid" }); // extraction_model still unset
    let saved: Partial<HumanSettings> | undefined;
    const ctx = makeContext(human, async (updates) => { saved = updates; });

    await createProviderViaEditor(ctx);

    if (!saved) throw new Error("expected ctx.ei.updateSettings to be called");
    expect(saved.conversation_model).toBeUndefined();
    expect(saved.extraction_model).toBe("TestProvider:default");
  });

  test("always includes the new account in accounts regardless of seeding", async () => {
    const { editorCmd, cleanup } = fakeEditorFor(VALID_PROVIDER_YAML);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ conversation_model: "existing-guid", extraction_model: "existing-guid" });
    let saved: Partial<HumanSettings> | undefined;
    const ctx = makeContext(human, async (updates) => { saved = updates; });

    await createProviderViaEditor(ctx);

    if (!saved) throw new Error("expected ctx.ei.updateSettings to be called");
    expect(saved.accounts).toHaveLength(1);
    expect(saved.accounts?.[0].name).toBe("TestProvider");
  });
});


describe("openProviderEditor - model deletion cleanup", () => {
  let originalEditor: string | undefined;
  let cleanupEditor: (() => void) | null = null;

  beforeEach(() => {
    originalEditor = process.env.EDITOR;
  });

  afterEach(() => {
    if (originalEditor !== undefined) process.env.EDITOR = originalEditor;
    else delete process.env.EDITOR;
    cleanupEditor?.();
    cleanupEditor = null;
  });

  test("clears every settings reference when YAML explicitly deletes a model", async () => {
    const account = {
      id: "provider-1",
      name: "TestProvider",
      type: "llm" as const,
      url: "https://api.test.example/v1",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      default_model: "model-1",
      models: [
        { id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" },
        { id: "model-2", name: "claude-haiku", model_id: "claude-haiku-4-5" },
      ],
    };
    const editedYaml = [
      "name: TestProvider",
      "type: llm",
      "url: https://api.test.example/v1",
      "enabled: true",
      "models:",
      "  - name: claude-opus",
      "    model_id: claude-opus-4-8",
      "    _delete: true",
      "  - name: claude-haiku",
      "    model_id: claude-haiku-4-5",
      "    _delete: false",
    ].join("\n");
    const { editorCmd, cleanup } = fakeEditorFor(editedYaml);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({
      accounts: [account],
      default_model: "model-1",
      oneshot_model: "model-1",
      rewrite_model: "model-1",
      conversation_model: "model-1",
      extraction_model: "model-1",
      opencode: { extraction_model: "model-1" },
      claudeCode: { extraction_model: "model-1" },
    });
    const ctx = makeContext(human, async (updates) => {
      human.settings = { ...human.settings, ...updates };
    });

    await openProviderEditor(account, ctx);

    expect({
      modelIds: human.settings.accounts?.[0]?.models?.map((model) => model.id),
      default_model: human.settings.default_model,
      oneshot_model: human.settings.oneshot_model,
      rewrite_model: human.settings.rewrite_model,
      conversation_model: human.settings.conversation_model,
      extraction_model: human.settings.extraction_model,
      opencode: human.settings.opencode?.extraction_model,
      claudeCode: human.settings.claudeCode?.extraction_model,
    }).toEqual({
      modelIds: ["model-2"],
      default_model: undefined,
      oneshot_model: undefined,
      rewrite_model: undefined,
      conversation_model: undefined,
      extraction_model: undefined,
      opencode: undefined,
      claudeCode: undefined,
    });
  });

  test("clears persona.model pins when YAML explicitly deletes the pinned model", async () => {
    const account = {
      id: "provider-1",
      name: "TestProvider",
      type: "llm" as const,
      url: "https://api.test.example/v1",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      models: [
        { id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" },
        { id: "model-2", name: "claude-haiku", model_id: "claude-haiku-4-5" },
      ],
    };
    const editedYaml = [
      "name: TestProvider",
      "type: llm",
      "url: https://api.test.example/v1",
      "enabled: true",
      "models:",
      "  - name: claude-opus",
      "    model_id: claude-opus-4-8",
      "    _delete: true",
      "  - name: claude-haiku",
      "    model_id: claude-haiku-4-5",
      "    _delete: false",
    ].join("\n");
    const { editorCmd, cleanup } = fakeEditorFor(editedYaml);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ accounts: [account] });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const basePersona = {
      entity: "system" as const,
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: timestamp,
      last_heartbeat: timestamp,
    };
    const personaRecords: Record<string, PersonaEntity> = {
      "persona-1": { ...basePersona, id: "persona-1", display_name: "Pinned", model: "model-1" },
      "persona-2": { ...basePersona, id: "persona-2", display_name: "Other", model: "model-2" },
    };
    const ctx = makeContext(
      human,
      async (updates) => { human.settings = { ...human.settings, ...updates }; },
      personaRecords
    );

    await openProviderEditor(account, ctx);

    expect(personaRecords["persona-1"].model).toBeUndefined();
    expect(personaRecords["persona-2"].model).toBe("model-2");
  });
});

describe("openProviderEditor - whole-provider deletion cascade (T4)", () => {
  let originalEditor: string | undefined;
  let cleanupEditor: (() => void) | null = null;

  beforeEach(() => {
    originalEditor = process.env.EDITOR;
  });

  afterEach(() => {
    if (originalEditor !== undefined) process.env.EDITOR = originalEditor;
    else delete process.env.EDITOR;
    cleanupEditor?.();
    cleanupEditor = null;
  });

  test("deleting a whole provider clears both a persona pin and a global settings field across its models", async () => {
    const account = {
      id: "provider-1",
      name: "TestProvider",
      type: "llm" as const,
      url: "https://api.test.example/v1",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      models: [
        { id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" },
        { id: "model-2", name: "claude-haiku", model_id: "claude-haiku-4-5" },
      ],
    };
    // Top-level `_delete: true` triggers providerFromYAML's whole-provider path;
    // name/url are still required for parsing to reach that branch.
    const editedYaml = [
      "name: TestProvider",
      "url: https://api.test.example/v1",
      "_delete: true",
    ].join("\n");
    const { editorCmd, cleanup } = fakeEditorFor(editedYaml);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({
      accounts: [account],
      default_model: "model-2",
    });
    const timestamp = "2026-01-01T00:00:00.000Z";
    const basePersona = {
      entity: "system" as const,
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: timestamp,
      last_heartbeat: timestamp,
    };
    const personaRecords: Record<string, PersonaEntity> = {
      "persona-1": { ...basePersona, id: "persona-1", display_name: "Pinned", model: "model-1" },
    };
    const ctx = makeContext(
      human,
      async (updates) => { human.settings = { ...human.settings, ...updates }; },
      personaRecords
    );

    const result = await openProviderEditor(account, ctx);

    expect(result.success).toBe(true);
    expect(result.deleted).toBe(true);
    expect(human.settings.accounts ?? []).toEqual([]);
    expect(human.settings.default_model).toBeUndefined();
    expect(personaRecords["persona-1"].model).toBeUndefined();
  });
});

describe("openProviderEditor - cascade failure surfaces error, does not report success", () => {
  let originalEditor: string | undefined;
  let cleanupEditor: (() => void) | null = null;

  beforeEach(() => {
    originalEditor = process.env.EDITOR;
  });

  afterEach(() => {
    if (originalEditor !== undefined) process.env.EDITOR = originalEditor;
    else delete process.env.EDITOR;
    cleanupEditor?.();
    cleanupEditor = null;
  });

  test("deleteProvider failure is surfaced and the account is not treated as removed", async () => {
    const account = {
      id: "provider-1",
      name: "TestProvider",
      type: "llm" as const,
      url: "https://api.test.example/v1",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      models: [
        { id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" },
      ],
    };
    const editedYaml = [
      "name: TestProvider",
      "url: https://api.test.example/v1",
      "_delete: true",
    ].join("\n");
    const { editorCmd, cleanup } = fakeEditorFor(editedYaml);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ accounts: [account] });
    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(
      human,
      async (updates) => { human.settings = { ...human.settings, ...updates }; },
      {},
      {
        deleteProvider: async () => ({ success: false, error: "provider is in use" }),
        onNotify: (message, level) => notifications.push({ message, level }),
      }
    );

    const result = await openProviderEditor(account, ctx);

    expect(result.success).toBe(false);
    expect(result.deleted).not.toBe(true);
    expect(human.settings.accounts).toEqual([account]);
    expect(notifications).toContainEqual({ message: "provider is in use", level: "error" });
  });

  test("deleteModel failure is surfaced and no edits are saved", async () => {
    const account = {
      id: "provider-1",
      name: "TestProvider",
      type: "llm" as const,
      url: "https://api.test.example/v1",
      enabled: true,
      created_at: "2026-01-01T00:00:00.000Z",
      models: [
        { id: "model-1", name: "claude-opus", model_id: "claude-opus-4-8" },
        { id: "model-2", name: "claude-haiku", model_id: "claude-haiku-4-5" },
      ],
    };
    const editedYaml = [
      "name: TestProvider",
      "type: llm",
      "url: https://api.test.example/v1",
      "enabled: true",
      "models:",
      "  - name: claude-opus",
      "    model_id: claude-opus-4-8",
      "    _delete: true",
      "  - name: claude-haiku",
      "    model_id: claude-haiku-4-5",
      "    _delete: false",
    ].join("\n");
    const { editorCmd, cleanup } = fakeEditorFor(editedYaml);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ accounts: [account] });
    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(
      human,
      async (updates) => { human.settings = { ...human.settings, ...updates }; },
      {},
      {
        deleteModel: async () => ({ success: false, error: "model is in use" }),
        onNotify: (message, level) => notifications.push({ message, level }),
      }
    );

    const result = await openProviderEditor(account, ctx);

    expect(result.success).toBe(false);
    expect(human.settings.accounts?.[0]?.models?.map((m) => m.id)).toEqual(["model-1", "model-2"]);
    expect(notifications).toContainEqual({ message: "model is in use", level: "error" });
  });
});
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { createProviderViaEditor } from "../../../src/util/provider-editor";
import type { CommandContext } from "../../../src/commands/registry";
import type { EiContextValue } from "../../../src/context/ei";
import type { CliRenderer } from "@opentui/core";
import type { HumanEntity, HumanSettings } from "../../../../src/core/types";

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
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>
): CommandContext {
  return {
    showOverlay: () => {},
    hideOverlay: () => {},
    showNotification: () => {},
    exitApp: async () => {},
    stopProcessor: async () => {},
    renderer: createMockRenderer(),
    setInputText: () => {},
    getInputText: () => "",
    ei: {
      getHuman: async () => human,
      updateSettings,
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

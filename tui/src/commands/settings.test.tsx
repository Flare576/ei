import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { settingsCommand } from "./settings";
import { settingsToYAML } from "../util/yaml-serializers";
import type { CommandContext } from "./registry";
import type { EiContextValue } from "../context/ei";
import type { CliRenderer } from "@opentui/core";
import type { HumanEntity, HumanSettings, ProviderAccount } from "../../../src/core/types";
import { ProviderType } from "../../../src/core/types";

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

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

const timestamp = "2024-01-01T00:00:00.000Z";

const account: ProviderAccount = {
  id: "acc-1",
  name: "Anthropic",
  type: ProviderType.LLM,
  url: "https://api.anthropic.com",
  enabled: true,
  created_at: timestamp,
  models: [{ id: "model-guid-1", name: "claude-haiku-4-5" }],
};

function makeHuman(settings: HumanSettings): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: timestamp,
    settings,
  };
}

function makeContext(
  human: HumanEntity,
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>,
  showOverlay: CommandContext["showOverlay"] = () => {}
): CommandContext {
  return {
    showOverlay,
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

describe("settingsCommand - conversation_model validation (T8)", () => {
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

  test("accepts a resolvable Provider:Model conversation_model edit and saves the resolved GUID", async () => {
    const { editorCmd, cleanup } = fakeEditorFor("conversation_model: Anthropic:claude-haiku-4-5\n");
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ accounts: [account] });
    let saved: Partial<HumanSettings> | undefined;
    const ctx = makeContext(human, async (updates) => { saved = updates; });

    await settingsCommand.execute([], ctx);

    if (!saved) throw new Error("expected ctx.ei.updateSettings to be called");
    expect(saved.conversation_model).toBe("model-guid-1");
    expect(saved.default_model).toBeUndefined();
  });

  test("rejects an unresolvable Provider:Model conversation_model and does not save", async () => {
    const { editorCmd, cleanup } = fakeEditorFor("conversation_model: Anthropic:no-such-model\n");
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const human = makeHuman({ accounts: [account] });
    let updateCalled = false;
    let overlayCalled = false;
    const ctx = makeContext(
      human,
      async () => { updateCalled = true; },
      () => { overlayCalled = true; }
    );

    // `execute()`'s catch branch awaits a promise that only resolves once the
    // ConfirmOverlay's onConfirm/onCancel fires — which requires a full Solid
    // render tree we don't have here. We intentionally don't await execute()
    // to completion; we only need to observe that validation rejected the
    // edit (showOverlay reached, updateSettings never called) before that
    // point. The abandoned promise is harmless — it holds no timers/handles.
    void settingsCommand.execute([], ctx);

    // Let the fake editor spawn/exit and the validation microtasks flush.
    await delay(300);

    expect(overlayCalled).toBe(true);
    expect(updateCalled).toBe(false);
  });
});

/** Like fakeEditorFor, but the editor stays open (and says so) until release() is called. */
function heldEditorFor(content: string): {
  editorCmd: string;
  waitUntilOpen: () => Promise<void>;
  release: () => void;
  cleanup: () => void;
} {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "held-editor-"));
  const srcFile = path.join(dir, "edited.yaml");
  const startedFile = path.join(dir, "started");
  const gateFile = path.join(dir, "gate");
  fs.writeFileSync(srcFile, content, "utf-8");
  return {
    editorCmd: `bash -c 'touch "${startedFile}"; while [ ! -e "${gateFile}" ]; do sleep 0.02; done; cp "${srcFile}" "$1"' --`,
    waitUntilOpen: async () => {
      for (let i = 0; i < 200 && !fs.existsSync(startedFile); i++) await delay(25);
      if (!fs.existsSync(startedFile)) throw new Error("editor never opened");
    },
    release: () => fs.writeFileSync(gateFile, ""),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe("settingsCommand - omp save while the editor is open", () => {
  const earlier = "2026-10-20T10:00:00.000Z";
  const later = "2026-10-20T11:00:00.000Z";
  const ompAccount: ProviderAccount = {
    ...account,
    models: [
      { id: "model-guid-1", name: "claude-haiku-4-5" },
      { id: "model-guid-2", name: "claude-sonnet-4-5" },
    ],
  };

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

  function seededState(): HumanEntity {
    return makeHuman({
      accounts: [ompAccount],
      pi: { integration: true },
      omp: {
        integration: false,
        polling_interval_ms: 120000,
        extraction_model: "model-guid-1",
        last_sync: earlier,
        processed_sessions: { "tree-a": earlier },
        current_tree: { tree: "tree-b", planned_at: earlier, done: ["blk-1"] },
      },
    });
  }

  /** Opens /settings on `initial` with `edit` applied to the generated YAML and holds the editor open
   * while `whileOpen` produces the stored state the importer would have written meanwhile (stored
   * states are replaced, never mutated, as the real store does), then releases the editor, waits for
   * the save and returns what was stored. */
  async function saveWhileEditorOpen(
    initial: HumanEntity,
    edit: (yaml: string) => string,
    whileOpen: (stored: HumanEntity) => HumanEntity
  ): Promise<HumanEntity> {
    const editor = heldEditorFor(edit(settingsToYAML(initial.settings, [ompAccount])));
    cleanupEditor = editor.cleanup;
    process.env.EDITOR = editor.editorCmd;

    let stored = initial;
    const ctx = makeContext(initial, async (updates) => {
      stored = { ...stored, settings: { ...stored.settings, ...updates } };
    });
    ctx.ei.getHuman = async () => stored;
    const done = settingsCommand.execute([], ctx);
    await editor.waitUntilOpen();
    stored = whileOpen(stored);
    editor.release();
    await done;
    return stored;
  }

  test("keeps the importer progress made while the editor was open and applies the toggle edit", async () => {
    const saved = await saveWhileEditorOpen(
      seededState(),
      (yaml) => yaml.replace("omp:\n  integration: false", "omp:\n  integration: true"),
      (stored) => ({
        ...stored,
        settings: {
          ...stored.settings,
          omp: {
            ...stored.settings?.omp,
            last_sync: later,
            processed_sessions: { "tree-a": earlier, "tree-b": later },
            current_tree: { tree: "tree-c", planned_at: later, done: [] },
          },
        },
      })
    );

    const omp = saved.settings?.omp;
    expect(omp?.integration).toBe(true);
    expect(omp?.current_tree).toEqual({ tree: "tree-c", planned_at: later, done: [] });
    expect(omp?.processed_sessions).toEqual({ "tree-a": earlier, "tree-b": later });
    expect(omp?.last_sync).toBe(later);
    expect(omp?.polling_interval_ms).toBe(120000);
    expect(omp?.extraction_model).toBe("model-guid-1");
    expect(saved.settings?.pi?.integration).toBe(true);
  });

  test("a cursor cleared while the editor was open stays cleared after the save", async () => {
    const saved = await saveWhileEditorOpen(
      seededState(),
      (yaml) => yaml.replace("omp:\n  integration: false", "omp:\n  integration: true"),
      (stored) => {
        const { current_tree: _cleared, ...rest } = stored.settings!.omp!;
        return { ...stored, settings: { ...stored.settings, omp: rest } };
      }
    );

    const omp = saved.settings?.omp;
    expect(omp?.integration).toBe(true);
    expect(omp?.current_tree).toBeUndefined();
    expect(omp?.processed_sessions).toEqual({ "tree-a": earlier });
    expect(omp?.last_sync).toBe(earlier);
  });

  test("applies edited integration, polling_interval_ms and extraction_model", async () => {
    const saved = await saveWhileEditorOpen(
      seededState(),
      (yaml) =>
        yaml.replace(
          /^(omp:\n  integration: )false\n  polling_interval_ms: 2m\n  extraction_model: [^\n]*/m,
          "$1true\n  polling_interval_ms: 5m\n  extraction_model: Anthropic:claude-sonnet-4-5"
        ),
      (stored) => stored
    );

    const omp = saved.settings?.omp;
    expect(omp?.integration).toBe(true);
    expect(omp?.polling_interval_ms).toBe(300000);
    expect(omp?.extraction_model).toBe("model-guid-2");
    expect(omp?.current_tree).toEqual({ tree: "tree-b", planned_at: earlier, done: ["blk-1"] });
  });
});

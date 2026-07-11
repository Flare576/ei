import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { settingsCommand } from "./settings";
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

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import YAML from "yaml";
import { openPersonaEditor } from "../../../src/util/persona-editor";
import {
  personaToYAML,
  personaFromYAML,
  personaEditableFingerprint,
} from "../../../src/util/yaml-serializers";
import type { CommandContext } from "../../../src/commands/registry";
import type { EiContextValue } from "../../../src/context/ei";
import type { CliRenderer } from "@opentui/core";
import type { HumanEntity, PersonaEntity } from "../../../../src/core/types";

// show_thinking is a per-persona display setting whose absence means `true`
// (always show). Unlike the neighbouring default-false booleans (is_paused,
// is_static, include_message_timestamps), an explicit `false` is a real value
// and must survive every YAML round trip.

const timestamp = "2024-01-01T00:00:00.000Z";

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "TestBot",
    entity: "system",
    short_description: "A test persona",
    long_description: "A persona used for show_thinking tests.",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: timestamp,
    ...overrides,
  };
}

function minimalYAML(extraLines: string[] = [], shortDescription = "A test persona"): string {
  return [
    "display_name: TestBot",
    `short_description: ${shortDescription}`,
    "long_description: A persona used for show_thinking tests.",
    "traits: []",
    "topics: []",
    ...extraLines,
  ].join("\n") + "\n";
}

describe("show_thinking YAML parsing and serialization", () => {
  test("omitted field reads back as true from hand-authored YAML", () => {
    const { updates } = personaFromYAML(minimalYAML(), makePersona());
    expect(updates.show_thinking).toBe(true);
  });

  test("absent field on the entity serializes then reads back as true", () => {
    const persona = makePersona();
    expect(persona.show_thinking).toBeUndefined();
    const { updates } = personaFromYAML(personaToYAML(persona), persona);
    expect(updates.show_thinking).toBe(true);
  });

  test("explicit false is written by the serializer and survives an unrelated edit round trip", () => {
    const persona = makePersona({ show_thinking: false });
    const yamlText = personaToYAML(persona);
    expect(YAML.parse(yamlText).show_thinking).toBe(false);

    // Unrelated edit: change only the short description, then reload.
    const edited = yamlText.replace("short_description: A test persona", "short_description: Edited");
    expect(edited).not.toBe(yamlText);
    const { updates } = personaFromYAML(edited, persona);
    expect(updates.short_description).toBe("Edited");
    expect(updates.show_thinking).toBe(false);

    // Re-serializing the applied result and reloading keeps it false.
    const applied = makePersona({ ...updates, show_thinking: updates.show_thinking });
    expect(personaFromYAML(personaToYAML(applied), applied).updates.show_thinking).toBe(false);
  });

  test("explicit true round-trips as true", () => {
    const persona = makePersona({ show_thinking: true });
    const yamlText = personaToYAML(persona);
    expect(YAML.parse(yamlText).show_thinking).toBe(true);
    expect(personaFromYAML(yamlText, persona).updates.show_thinking).toBe(true);
  });

  test("hand-authored explicit false reads as false", () => {
    const { updates } = personaFromYAML(minimalYAML(["show_thinking: false"]), makePersona());
    expect(updates.show_thinking).toBe(false);
  });

  test("string \"false\" is rejected in the same style as the other boolean fields", () => {
    expect(() =>
      personaFromYAML(minimalYAML(['show_thinking: "false"']), makePersona())
    ).toThrow(/show_thinking must be true, false, or omitted \(got: "false"\)/);

    // Same rejection style as a neighbouring boolean.
    expect(() =>
      personaFromYAML(minimalYAML(['is_static: "false"']), makePersona())
    ).toThrow(/is_static must be true, false, or omitted/);
  });
});

describe("personaEditableFingerprint covers show_thinking", () => {
  test("false and true fingerprint differently", () => {
    expect(personaEditableFingerprint(makePersona({ show_thinking: false })))
      .not.toBe(personaEditableFingerprint(makePersona({ show_thinking: true })));
  });

  test("absent and explicit true fingerprint equal", () => {
    expect(personaEditableFingerprint(makePersona()))
      .toBe(personaEditableFingerprint(makePersona({ show_thinking: true })));
  });

  test("absent and explicit false fingerprint differently", () => {
    expect(personaEditableFingerprint(makePersona()))
      .not.toBe(personaEditableFingerprint(makePersona({ show_thinking: false })));
  });
});

// --- Real stale-edit path through openPersonaEditor ---

function createMockRenderer(): CliRenderer {
  return {
    suspend: () => {},
    resume: () => {},
    currentRenderBuffer: { clear: () => {} },
    requestRender: () => {},
    controlState: "normal",
  } as unknown as CliRenderer;
}

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

function makeHuman(): HumanEntity {
  return {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: timestamp,
    settings: {},
  };
}

interface EditorHarness {
  ctx: CommandContext;
  notifications: Array<{ message: string; level: string }>;
  updateCalls: Array<{ id: string; updates: Partial<PersonaEntity> }>;
}

// `concurrentWrite` is applied to the stored record immediately before the
// editor's save-time re-read (the first getPersona call), i.e. after the editor
// opened and took its fingerprint and before the save lands.
function makeHarness(
  personaRecords: Record<string, PersonaEntity>,
  concurrentWrite?: Partial<PersonaEntity>
): EditorHarness {
  const notifications: Array<{ message: string; level: string }> = [];
  const updateCalls: Array<{ id: string; updates: Partial<PersonaEntity> }> = [];
  const ctx: CommandContext = {
    showOverlay: () => {},
    hideOverlay: () => {},
    showNotification: (message: string, level: "error" | "warn" | "info") => {
      notifications.push({ message, level });
    },
    exitApp: async () => {},
    stopProcessor: async () => {},
    renderer: createMockRenderer(),
    setInputText: () => {},
    getInputText: () => "",
    ei: {
      getGroupList: async () => [],
      getToolList: () => [],
      getToolProviderList: () => [],
      getHuman: async () => makeHuman(),
      getPersona: async (id: string) => {
        if (concurrentWrite && personaRecords[id]) {
          personaRecords[id] = { ...personaRecords[id], ...concurrentWrite, last_updated: new Date().toISOString() };
        }
        return personaRecords[id] ?? null;
      },
      updatePersona: async (id: string, updates: Partial<PersonaEntity>) => {
        updateCalls.push({ id, updates });
        if (personaRecords[id]) {
          personaRecords[id] = { ...personaRecords[id], ...updates, last_updated: new Date().toISOString() };
        }
      },
    } as unknown as EiContextValue,
  };
  return { ctx, notifications, updateCalls };
}

const STALE_MESSAGE =
  "Persona changed by another process since editor opened — re-open to see current state and re-apply your edits.";

describe("openPersonaEditor - stale-edit guard covers show_thinking", () => {
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

  function useEditor(content: string): void {
    const { editorCmd, cleanup } = fakeEditorFor(content);
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;
  }

  test("opened as false, stored becomes true before save: stale outcome, no updatePersona", async () => {
    const persona = makePersona({ show_thinking: false });
    const records: Record<string, PersonaEntity> = { "persona-1": persona };
    useEditor(minimalYAML(["show_thinking: false"], "Edited by user"));
    const { ctx, notifications, updateCalls } = makeHarness(records, { show_thinking: true });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(false);
    expect(result.personaWasModified).toBe(false);
    expect(notifications).toContainEqual({ message: STALE_MESSAGE, level: "warn" });
    expect(updateCalls).toHaveLength(0);
    expect(records["persona-1"].show_thinking).toBe(true);
  });

  test("opened as true, stored becomes false before save: stale outcome, no updatePersona", async () => {
    const persona = makePersona({ show_thinking: true });
    const records: Record<string, PersonaEntity> = { "persona-1": persona };
    useEditor(minimalYAML(["show_thinking: true"], "Edited by user"));
    const { ctx, notifications, updateCalls } = makeHarness(records, { show_thinking: false });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(false);
    expect(result.personaWasModified).toBe(false);
    expect(notifications).toContainEqual({ message: STALE_MESSAGE, level: "warn" });
    expect(updateCalls).toHaveLength(0);
    expect(records["persona-1"].show_thinking).toBe(false);
  });

  test("opened with the field absent, stored becomes false before save: stale outcome, no updatePersona", async () => {
    const persona = makePersona();
    const records: Record<string, PersonaEntity> = { "persona-1": persona };
    useEditor(minimalYAML([], "Edited by user"));
    const { ctx, notifications, updateCalls } = makeHarness(records, { show_thinking: false });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(false);
    expect(notifications).toContainEqual({ message: STALE_MESSAGE, level: "warn" });
    expect(updateCalls).toHaveLength(0);
  });

  test("explicit false saved through the editor is passed to updatePersona as false", async () => {
    const persona = makePersona({ show_thinking: true });
    const records: Record<string, PersonaEntity> = { "persona-1": persona };
    useEditor(minimalYAML(["show_thinking: false"]));
    const { ctx, updateCalls } = makeHarness(records);

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(true);
    expect(result.personaWasModified).toBe(true);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].updates.show_thinking).toBe(false);
    expect(records["persona-1"].show_thinking).toBe(false);
  });
});

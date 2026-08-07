import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { openPersonaEditor } from "../../../src/util/persona-editor";
import { personaEditableFingerprint } from "../../../src/util/yaml-serializers";
import type { CommandContext } from "../../../src/commands/registry";
import type { EiContextValue } from "../../../src/context/ei";
import type { CliRenderer } from "@opentui/core";
import type { HumanEntity, PersonaEntity } from "../../../../src/core/types";

// ADR-009's concurrency guard, extended to Persona (IRQ-3 / issue #101's split-off
// sibling): tui/src/util/yaml-persona.ts:personaEditableFingerprint +
// tui/src/util/persona-editor.tsx:openPersonaEditor's save-time re-check.

function createMockRenderer(): CliRenderer {
  return {
    suspend: () => {},
    resume: () => {},
    currentRenderBuffer: { clear: () => {} },
    requestRender: () => {},
    controlState: "normal",
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

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "TestBot",
    entity: "system",
    short_description: "A test persona",
    long_description: "A persona used for stale-edit-guard tests.",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: timestamp,
    ...overrides,
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

function makeContext(
  personaRecords: Record<string, PersonaEntity>,
  options: {
    onNotify?: (message: string, level: "error" | "warn" | "info") => void;
    onGetPersona?: (id: string) => void;
  } = {}
): CommandContext {
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
      getGroupList: async () => [],
      getToolList: () => [],
      getToolProviderList: () => [],
      getHuman: async () => makeHuman(),
      getPersona: async (id: string) => {
        options.onGetPersona?.(id);
        return personaRecords[id] ?? null;
      },
      updatePersona: async (id: string, updates: Partial<PersonaEntity>) => {
        if (personaRecords[id]) {
          personaRecords[id] = { ...personaRecords[id], ...updates, last_updated: new Date().toISOString() };
        }
      },
    } as unknown as EiContextValue,
  };
}

function delay(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

describe("openPersonaEditor - stale-edit guard (ADR-009 extended to Persona)", () => {
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

  test("(a) saves normally when nothing changed underneath the open editor buffer", async () => {
    const persona = makePersona({ short_description: "Original" });
    const personaRecords: Record<string, PersonaEntity> = { "persona-1": persona };

    const { editorCmd, cleanup } = fakeEditorFor(
      [
        "display_name: TestBot",
        "short_description: Edited by user",
        "long_description: A persona used for stale-edit-guard tests.",
        "traits: []",
        "topics: []",
      ].join("\n") + "\n"
    );
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(personaRecords, {
      onNotify: (message, level) => notifications.push({ message, level }),
    });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(true);
    expect(result.personaWasModified).toBe(true);
    expect(personaRecords["persona-1"].short_description).toBe("Edited by user");
    expect(notifications.some(n => n.message.includes("Updated"))).toBe(true);
    expect(notifications.some(n => n.message.includes("changed by another process"))).toBe(false);
  });

  test("(b) rejects the save when a concurrent write touched the same persona's editable fields, and the concurrent write survives", async () => {
    const persona = makePersona({ short_description: "Original" });
    const personaRecords: Record<string, PersonaEntity> = { "persona-1": persona };

    const { editorCmd, cleanup } = fakeEditorFor(
      [
        "display_name: TestBot",
        "short_description: Edited by user",
        "long_description: A persona used for stale-edit-guard tests.",
        "traits: []",
        "topics: []",
      ].join("\n") + "\n"
    );
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    // Simulate a concurrent writer (extraction/reflection/correction) landing
    // while the editor buffer is open, before the fake $EDITOR even runs
    // (spawnEditor has a mandatory 50ms pre-spawn delay, so 10ms lands safely
    // inside that window every time).
    setTimeout(() => {
      personaRecords["persona-1"] = {
        ...personaRecords["persona-1"],
        short_description: "Concurrently changed by reflection",
        last_updated: new Date().toISOString(),
      };
    }, 10);

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(personaRecords, {
      onNotify: (message, level) => notifications.push({ message, level }),
    });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(false);
    expect(result.personaWasModified).toBe(false);
    // The concurrent write's data survived untouched — the stale editor buffer
    // (which would have overwritten it with "Edited by user") never landed.
    expect(personaRecords["persona-1"].short_description).toBe("Concurrently changed by reflection");
    expect(notifications).toContainEqual({
      message: "Persona changed by another process since editor opened — re-open to see current state and re-apply your edits.",
      level: "warn",
    });
  });

  test("(c) does not false-positive-reject when unrelated activity bumps last_updated without touching any editable field", async () => {
    // Mirrors PersonaState.messages_append/messages_update: they stamp a
    // fresh entity.last_updated on every inbound/outbound chat message, with
    // zero change to any field the YAML editor renders. A root-timestamp
    // guard (the naive port of /me's staleInState) would treat this as a
    // collision and reject the save; the content fingerprint must not.
    const persona = makePersona({ short_description: "Original" });
    const personaRecords: Record<string, PersonaEntity> = { "persona-1": persona };

    const { editorCmd, cleanup } = fakeEditorFor(
      [
        "display_name: TestBot",
        "short_description: Edited by user",
        "long_description: A persona used for stale-edit-guard tests.",
        "traits: []",
        "topics: []",
      ].join("\n") + "\n"
    );
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    // A same-shape "message append" side effect: last_updated moves, no
    // editable field does. Confirmed distinct from a real content change —
    // the fingerprint of before/after is asserted equal below.
    const before = personaEditableFingerprint(personaRecords["persona-1"]);
    setTimeout(() => {
      personaRecords["persona-1"] = {
        ...personaRecords["persona-1"],
        last_updated: new Date(Date.now() + 60_000).toISOString(),
      };
    }, 10);

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(personaRecords, {
      onNotify: (message, level) => notifications.push({ message, level }),
    });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    await delay(20);
    const after = personaEditableFingerprint({
      ...persona,
      last_updated: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(after).toBe(before);

    expect(result.success).toBe(true);
    expect(result.personaWasModified).toBe(true);
    expect(personaRecords["persona-1"].short_description).toBe("Edited by user");
    expect(notifications.some(n => n.message.includes("changed by another process"))).toBe(false);
  });

  test("(T9) rejects the save when a concurrent write changes only a topic's sentiment, and the concurrent value survives", async () => {
    // Mirrors src/core/handlers/persona-generation.ts's identity-update flow,
    // which owns topic-sentiment updates independently of anything the YAML
    // editor exposes. Sentiment isn't rendered in the editable YAML at all
    // (see YAMLPersonaTopic), so a stale editor buffer that resaves the rest
    // of the topic unchanged must still be rejected once sentiment drifts
    // underneath it — otherwise personaFromYAML's `existing?.sentiment ?? 0`
    // silently reapplies the pre-open value and clobbers the concurrent write.
    const topic = {
      id: "topic-1",
      name: "Tech Trends",
      perspective: "Cautiously optimistic",
      approach: "Ask clarifying questions",
      personal_stake: "Directly affects my role",
      sentiment: 0.2,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: timestamp,
    };
    const persona = makePersona({ short_description: "Original", topics: [topic] });
    const personaRecords: Record<string, PersonaEntity> = { "persona-1": persona };

    const { editorCmd, cleanup } = fakeEditorFor(
      [
        "display_name: TestBot",
        "short_description: Edited by user",
        "long_description: A persona used for stale-edit-guard tests.",
        "traits: []",
        "topics:",
        "  - id: topic-1",
        "    name: Tech Trends",
        "    perspective: Cautiously optimistic",
        "    approach: Ask clarifying questions",
        "    personal_stake: Directly affects my role",
        "    exposure_current: 0.5",
        "    exposure_desired: 0.5",
      ].join("\n") + "\n"
    );
    cleanupEditor = cleanup;
    process.env.EDITOR = editorCmd;

    // Concurrent writer (persona-generation's identity-update flow) changes
    // ONLY this topic's sentiment, landing inside spawnEditor's 50ms
    // pre-spawn delay window.
    setTimeout(() => {
      personaRecords["persona-1"] = {
        ...personaRecords["persona-1"],
        topics: personaRecords["persona-1"].topics.map(t =>
          t.id === "topic-1" ? { ...t, sentiment: 0.8, last_updated: new Date().toISOString() } : t
        ),
        last_updated: new Date().toISOString(),
      };
    }, 10);

    const notifications: Array<{ message: string; level: string }> = [];
    const ctx = makeContext(personaRecords, {
      onNotify: (message, level) => notifications.push({ message, level }),
    });

    const result = await openPersonaEditor({ personaId: "persona-1", persona, ctx });

    expect(result.success).toBe(false);
    expect(result.personaWasModified).toBe(false);
    // The concurrent sentiment change survived untouched — the stale editor
    // buffer (which would have reapplied 0.2 via `existing?.sentiment ?? 0`)
    // never landed.
    expect(personaRecords["persona-1"].topics[0].sentiment).toBe(0.8);
    expect(notifications).toContainEqual({
      message: "Persona changed by another process since editor opened — re-open to see current state and re-apply your edits.",
      level: "warn",
    });
  });
});

describe("personaEditableFingerprint", () => {
  test("is stable for identical content regardless of trait/topic array order", () => {
    const traitA = { id: "t-a", name: "Curious", description: "Likes questions", sentiment: 0.2, strength: 0.6, last_updated: timestamp };
    const traitB = { id: "t-b", name: "Calm", description: "Stays level", sentiment: 0.1, strength: 0.4, last_updated: timestamp };

    const p1 = makePersona({ traits: [traitA, traitB] });
    const p2 = makePersona({ traits: [traitB, traitA] });

    expect(personaEditableFingerprint(p1)).toBe(personaEditableFingerprint(p2));
  });

  test("changes when an editable field (short_description) changes", () => {
    const p1 = makePersona({ short_description: "Original" });
    const p2 = makePersona({ short_description: "Changed" });

    expect(personaEditableFingerprint(p1)).not.toBe(personaEditableFingerprint(p2));
  });

  test("is unaffected by last_updated alone", () => {
    const p1 = makePersona({ last_updated: timestamp });
    const p2 = makePersona({ last_updated: "2030-01-01T00:00:00.000Z" });

    expect(personaEditableFingerprint(p1)).toBe(personaEditableFingerprint(p2));
  });

  test("is unaffected by non-editable fields (is_archived, last_heartbeat, description_embedding)", () => {
    const p1 = makePersona();
    const p2 = makePersona({
      is_archived: true,
      archived_at: timestamp,
      last_heartbeat: timestamp,
      description_embedding: [0.1, 0.2, 0.3],
    });

    expect(personaEditableFingerprint(p1)).toBe(personaEditableFingerprint(p2));
  });
});

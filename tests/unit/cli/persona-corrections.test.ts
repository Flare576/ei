import { describe, it, expect, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { PersonaEntity } from "../../../src/core/types/entities.js";
import type { ToolProvider, ToolDefinition } from "../../../src/core/types/integrations.js";
import { RESERVED_PERSONA_IDS, RESERVED_PERSONA_NAMES } from "../../../src/core/types/entities.js";

const INITIAL_NOW = "2026-01-01T00:00:00.000Z";
const PERSONA_ID = "11111111-1111-4111-8111-111111111111";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bare-specifier mock (matches corrections-endpoints.test.ts's own shim) --
// without it, evaluating corrections-endpoints.ts's module-level zod schema
// literals throws "z.string is not a function" while this file's other
// imports are being collected. NOT a local relative-path mock: those don't
// actually intercept anything in this repo's current vitest setup, which is
// why the rest of this file exercises createPersonaEntity/updatePersonaEntity/
// removePersonaEntity for real end-to-end (real embedding computation, real
// self-drain to a temp EI_DATA_PATH) and verifies outcomes by reloading
// state.json/corrections.json from disk afterward, the same strategy
// corrections-endpoints.test.ts and corrections-writer.test.ts already use.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

import { loadLatestState } from "../../../src/cli/retrieval.js";
import { createPersonaEntity, updatePersonaEntity, removePersonaEntity } from "../../../src/cli/persona-corrections.js";
import { CorrectionValidationError } from "../../../src/cli/corrections-endpoints.js";
import { buildPersonaToolsMap } from "../../../src/core/persona-tools.js";
import { NOTES_MAX } from "../../../src/core/tools/builtin/persona-notes.js";

function makeExistingPersonaEntity(id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: "Original Name",
    entity: "system",
    aliases: ["Original Alias"],
    short_description: "Original short desc",
    long_description: "Original long desc",
    model: "Local LLM:test-model",
    group_primary: "OriginalGroup",
    groups_visible: ["OriginalGroup"],
    traits: [],
    topics: [],
    tools: ["tool-1"],
    is_paused: false,
    is_archived: false,
    is_static: false,
    heartbeat_delay_ms: 1000,
    context_window_ms: 2000,
    include_message_timestamps: true,
    context_boundary: INITIAL_NOW,
    last_updated: INITIAL_NOW,
    avatar_emoji: "🙂",
    preferred_theme: "dark",
    notes: ["a note"],
    ...overrides,
  };
}

function makeState(
  personas: StorageState["personas"],
  extra: { providers?: ToolProvider[]; tools?: ToolDefinition[] } = {}
): StorageState {
  return {
    version: 1,
    timestamp: INITIAL_NOW,
    human: {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: INITIAL_NOW,
    },
    personas,
    queue: [],
    providers: extra.providers ?? [],
    tools: extra.tools ?? [],
  };
}

function makeToolProvider(overrides: Partial<ToolProvider> = {}): ToolProvider {
  return {
    id: crypto.randomUUID(),
    name: "provider",
    display_name: "Provider",
    builtin: false,
    config: {},
    enabled: true,
    created_at: INITIAL_NOW,
    ...overrides,
  };
}

function makeToolDefinition(overrides: Partial<ToolDefinition> = {}): ToolDefinition {
  return {
    id: crypto.randomUUID(),
    provider_id: "provider-id",
    name: "tool",
    display_name: "Tool",
    description: "d",
    input_schema: {},
    runtime: "any",
    builtin: false,
    enabled: true,
    created_at: INITIAL_NOW,
    ...overrides,
  };
}

let tempDir: string;

function writeState(state: StorageState): void {
  tempDir = mkdtempSync(join(tmpdir(), "ei-persona-corrections-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
}

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as never;
  }
  delete process.env.EI_DATA_PATH;
});

// ── createPersonaEntity ──────────────────────────────────────────────────────

describe("createPersonaEntity", () => {
  it("produces a full PersonaEntity with sensible defaults from a minimal create body", async () => {
    writeState(makeState({}));

    const { id, record } = await createPersonaEntity({ display_name: "Nova" });

    expect(id).toMatch(UUID_RE);
    expect(record.id).toBe(id);
    expect(record.display_name).toBe("Nova");
    expect(record.entity).toBe("system");
    expect(record.is_paused).toBe(false);
    expect(record.is_archived).toBe(false);
    expect(record.is_static).toBe(false);
    expect(record.aliases).toEqual(["Nova"]);
    expect(record.group_primary).toBe("General");
    expect(record.groups_visible).toEqual(["General"]);
    expect(record.traits).toEqual([]);
    expect(record.topics).toEqual([]);
    expect(record).not.toHaveProperty("description_embedding");
  });

  it("auto-assigns a fresh id to any trait or topic missing one", async () => {
    writeState(makeState({}));

    const { record } = await createPersonaEntity({
      display_name: "Nova",
      traits: [{ name: "Curious", description: "Loves learning", sentiment: 0.5 }],
      topics: [
        {
          name: "Space",
          perspective: "p",
          approach: "a",
          personal_stake: "s",
          sentiment: 0.2,
          exposure_current: 0.1,
          exposure_desired: 0.9,
        },
      ],
    });

    expect(record.traits[0].id).toMatch(UUID_RE);
    expect(record.topics[0].id).toMatch(UUID_RE);
  });

  it("preserves a caller-supplied trait/topic id instead of overwriting it", async () => {
    writeState(makeState({}));

    const { record } = await createPersonaEntity({
      display_name: "Nova",
      traits: [{ id: "trait-explicit", name: "Curious", description: "d", sentiment: 0 }],
    });

    expect(record.traits[0].id).toBe("trait-explicit");
  });

  it("rejects duplicate trait ids", async () => {
    writeState(makeState({}));

    await expect(
      createPersonaEntity({
        display_name: "Nova",
        traits: [
          { id: "t1", name: "A", description: "d", sentiment: 0 },
          { id: "t1", name: "B", description: "d", sentiment: 0 },
        ],
      })
    ).rejects.toThrow(/duplicate trait id "t1"/);
  });

  it("rejects duplicate topic ids", async () => {
    writeState(makeState({}));

    await expect(
      createPersonaEntity({
        display_name: "Nova",
        topics: [
          { id: "x1", name: "A", perspective: "p", approach: "a", personal_stake: "s", sentiment: 0, exposure_current: 0, exposure_desired: 0 },
          { id: "x1", name: "B", perspective: "p", approach: "a", personal_stake: "s", sentiment: 0, exposure_current: 0, exposure_desired: 0 },
        ],
      })
    ).rejects.toThrow(/duplicate topic id "x1"/);
  });

  it.each(RESERVED_PERSONA_NAMES)("rejects a reserved display_name %s", async (name) => {
    writeState(makeState({}));

    await expect(createPersonaEntity({ display_name: name })).rejects.toThrow(
      new RegExp(`Cannot use reserved name "${name}"`)
    );
  });

  it("rejects unknown top-level fields", async () => {
    writeState(makeState({}));

    await expect(createPersonaEntity({ display_name: "Nova", unexpected: true })).rejects.toThrow(
      /Unrecognized key\(s\) in object: 'unexpected'/
    );
  });

  it("rejects a missing display_name", async () => {
    writeState(makeState({}));

    await expect(createPersonaEntity({})).rejects.toThrow(/^Invalid persona: display_name: Required$/);
  });

  it("computes and persists description_embedding when long_description is present, but strips it from the returned record", async () => {
    writeState(makeState({}));

    const { id, record } = await createPersonaEntity({
      display_name: "Nova",
      long_description: "A thoughtful, curious explorer.",
    });

    expect(record).not.toHaveProperty("description_embedding");

    const persisted = await loadLatestState();
    const embedding = persisted!.personas[id].entity.description_embedding;
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding!.length).toBeGreaterThan(0);
    expect(embedding!.every((n) => typeof n === "number")).toBe(true);
  });

  it("never computes description_embedding when long_description is absent", async () => {
    writeState(makeState({}));

    const { id } = await createPersonaEntity({ display_name: "Nova" });

    const persisted = await loadLatestState();
    expect(persisted!.personas[id].entity.description_embedding).toBeUndefined();
  });

  it(`accepts exactly NOTES_MAX (${NOTES_MAX}) notes`, async () => {
    writeState(makeState({}));

    const notes = Array.from({ length: NOTES_MAX }, (_, i) => `note-${i}`);
    const { record } = await createPersonaEntity({ display_name: "Nova", notes });

    expect(record.notes).toHaveLength(NOTES_MAX);
  });

  it(`rejects NOTES_MAX + 1 (${NOTES_MAX + 1}) notes`, async () => {
    writeState(makeState({}));

    const notes = Array.from({ length: NOTES_MAX + 1 }, (_, i) => `note-${i}`);

    await expect(createPersonaEntity({ display_name: "Nova", notes })).rejects.toThrow(
      new RegExp(`^Invalid persona: notes: Array must contain at most ${NOTES_MAX} element`)
    );
  });

  it("grants a tool via a boolean-map tools payload, persisting only the resolved flat id and returning the re-enriched map", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const newsSearch = makeToolDefinition({ id: "t-news-search", provider_id: "p-brave", display_name: "News Search" });
    writeState(makeState({}, { providers: [brave], tools: [webSearch, newsSearch] }));

    const { id, record } = await createPersonaEntity({
      display_name: "Nova",
      tools: { "Brave Search": { "Web Search": true, "News Search": false } },
    });

    expect(record.tools).toEqual({ "Brave Search": { "Web Search": true, "News Search": false } });
    expect(Array.isArray(record.tools)).toBe(false);

    const persisted = await loadLatestState();
    expect(persisted!.personas[id].entity.tools).toEqual(["t-web-search"]);
  });

  it("rejects a tools payload naming an unknown provider", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    writeState(makeState({}, { providers: [brave], tools: [webSearch] }));

    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "Nonexistent Provider": { "Web Search": true } } })
    ).rejects.toThrow(CorrectionValidationError);
    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "Nonexistent Provider": { "Web Search": true } } })
    ).rejects.toThrow(/unknown provider "Nonexistent Provider"/);
  });

  it("rejects a tools payload naming an unknown tool under a known provider", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    writeState(makeState({}, { providers: [brave], tools: [webSearch] }));

    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "Brave Search": { "Nonexistent Tool": true } } })
    ).rejects.toThrow(CorrectionValidationError);
    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "Brave Search": { "Nonexistent Tool": true } } })
    ).rejects.toThrow(/unknown tool "Nonexistent Tool" under provider "Brave Search"/);
  });

  it("rejects granting a tool under a disabled provider instead of silently no-op-ing", async () => {
    const github = makeToolProvider({ id: "p-github", display_name: "GitHub", enabled: false });
    const listIssues = makeToolDefinition({ id: "t-list-issues", provider_id: "p-github", display_name: "List Issues" });
    writeState(makeState({}, { providers: [github], tools: [listIssues] }));

    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "GitHub": { "List Issues": true } } })
    ).rejects.toThrow(CorrectionValidationError);
    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "GitHub": { "List Issues": true } } })
    ).rejects.toThrow(/provider "GitHub" is disabled/);
  });
});

// ── updatePersonaEntity ───────────────────────────────────────────────────────

describe("updatePersonaEntity", () => {
  it("drops fields omitted from the update payload instead of preserving the prior value", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "New Name" });

    expect(updated.display_name).toBe("New Name");
    expect(updated.aliases).toBeUndefined();
    expect(updated.short_description).toBeUndefined();
    expect(updated.long_description).toBeUndefined();
    expect(updated.model).toBeUndefined();
    expect(updated.group_primary).toBeUndefined();
    expect(updated.groups_visible).toBeUndefined();
    expect(updated.tools).toBeUndefined();
    expect(updated.heartbeat_delay_ms).toBeUndefined();
    expect(updated.context_window_ms).toBeUndefined();
    expect(updated.avatar_emoji).toBeUndefined();
    expect(updated.notes).toBeUndefined();
  });

  it("resets traits/topics/is_paused/is_archived to their schema defaults (not the prior value) when omitted", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      is_paused: true,
      is_archived: true,
      traits: [{ id: "old-trait", name: "Old Trait", description: "d", sentiment: 0, last_updated: INITIAL_NOW }],
      topics: [
        {
          id: "old-topic",
          name: "Old Topic",
          perspective: "p",
          approach: "a",
          personal_stake: "s",
          sentiment: 0,
          exposure_current: 0,
          exposure_desired: 0,
          last_updated: INITIAL_NOW,
        },
      ],
    });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name" });

    expect(updated.is_paused).toBe(false);
    expect(updated.is_archived).toBe(false);
    expect(updated.traits).toEqual([]);
    expect(updated.topics).toEqual([]);
  });

  it("replaces the traits array wholesale when the payload supplies new traits, discarding the old ones entirely", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      traits: [{ id: "old-trait", name: "Old Trait", description: "d", sentiment: 0, last_updated: INITIAL_NOW }],
    });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, {
      display_name: "Original Name",
      traits: [{ name: "New Trait", description: "d2", sentiment: 0.3 }],
    });

    expect(updated.traits).toHaveLength(1);
    expect(updated.traits[0].name).toBe("New Trait");
    expect(updated.traits.some((t) => t.id === "old-trait")).toBe(false);
  });

  it("strips server-owned round-trip fields before validation so a lookupById-style read doesn't fail strictObject", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { description_embedding: [0.9, 0.9, 0.9], tools: undefined });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const roundTripPayload = {
      ...existing,
      type: "persona", // lookupById's discriminator -- not a PersonaEntity field at all
    };

    const updated = await updatePersonaEntity(PERSONA_ID, roundTripPayload);

    expect(updated.display_name).toBe("Original Name");
    expect(updated.aliases).toEqual(["Original Alias"]);
  });

  it("throws 'No persona found with id: X' for an unknown id", async () => {
    writeState(makeState({}));

    await expect(updatePersonaEntity("missing-id", { display_name: "Whoever" })).rejects.toThrow(
      /^No persona found with id: missing-id$/
    );
  });

  it.each(RESERVED_PERSONA_NAMES)("rejects renaming display_name to the reserved name %s", async (name) => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await expect(updatePersonaEntity(PERSONA_ID, { display_name: name })).rejects.toThrow(
      new RegExp(`Cannot use reserved name "${name}"`)
    );
  });

  it("recomputes description_embedding whenever long_description is present, even when unchanged", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { long_description: "Old description" });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, {
      display_name: "Original Name",
      long_description: "Old description",
    });

    expect(updated).not.toHaveProperty("description_embedding");

    const persisted = await loadLatestState();
    const embedding = persisted!.personas[PERSONA_ID].entity.description_embedding;
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding!.length).toBeGreaterThan(0);
  });

  it("never recomputes description_embedding when long_description is absent from the payload", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { long_description: "Old description" });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name" });

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.description_embedding).toBeUndefined();
  });

  it("always inherits is_static from the existing record, ignoring anything in the payload", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { is_static: true });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Renamed Static Persona" });

    expect(updated.is_static).toBe(true);
  });

  it(`accepts exactly NOTES_MAX (${NOTES_MAX}) notes`, async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const notes = Array.from({ length: NOTES_MAX }, (_, i) => `note-${i}`);
    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name", notes });

    expect(updated.notes).toHaveLength(NOTES_MAX);
  });

  it(`rejects NOTES_MAX + 1 (${NOTES_MAX + 1}) notes`, async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const notes = Array.from({ length: NOTES_MAX + 1 }, (_, i) => `note-${i}`);

    await expect(
      updatePersonaEntity(PERSONA_ID, { display_name: "Original Name", notes })
    ).rejects.toThrow(new RegExp(`^Invalid persona: notes: Array must contain at most ${NOTES_MAX} element`));
  });

  it("round-trips a tools map from a prior read, flipping exactly one flag while leaving every other grant untouched", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const newsSearch = makeToolDefinition({ id: "t-news-search", provider_id: "p-brave", display_name: "News Search" });
    const imageSearch = makeToolDefinition({ id: "t-image-search", provider_id: "p-brave", display_name: "Image Search" });
    const allTools = [webSearch, newsSearch, imageSearch];
    const allProviders = [brave];

    // Existing grants: Web Search + Image Search, NOT News Search.
    const existing = makeExistingPersonaEntity(PERSONA_ID, { tools: ["t-web-search", "t-image-search"] });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }, { providers: allProviders, tools: allTools }));

    // Simulate exactly what a caller following the documented `ei --id` ->
    // edit -> `ei update persona` round trip would send: the SAME
    // read-shaped map lookupById would have returned, with exactly one
    // flag flipped (News Search false -> true).
    const readShapedInput = buildPersonaToolsMap(existing.tools!, allTools, allProviders)!;
    expect(readShapedInput).toEqual({
      "Brave Search": { "Web Search": true, "News Search": false, "Image Search": true },
    });
    const flippedInput = {
      "Brave Search": { ...readShapedInput["Brave Search"], "News Search": true },
    };

    const updated = await updatePersonaEntity(PERSONA_ID, {
      display_name: existing.display_name,
      tools: flippedInput,
    });

    expect(updated.tools).toEqual({
      "Brave Search": { "Web Search": true, "News Search": true, "Image Search": true },
    });

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.tools?.slice().sort()).toEqual(
      ["t-image-search", "t-news-search", "t-web-search"].sort()
    );
  });

  it("rejects an update tools payload naming an unknown provider", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const existing = makeExistingPersonaEntity(PERSONA_ID, { tools: undefined });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }, { providers: [brave], tools: [webSearch] }));

    await expect(
      updatePersonaEntity(PERSONA_ID, {
        display_name: existing.display_name,
        tools: { "Nonexistent Provider": { "Web Search": true } },
      })
    ).rejects.toThrow(CorrectionValidationError);
    await expect(
      updatePersonaEntity(PERSONA_ID, {
        display_name: existing.display_name,
        tools: { "Nonexistent Provider": { "Web Search": true } },
      })
    ).rejects.toThrow(/unknown provider "Nonexistent Provider"/);
  });

  it("rejects an update tools payload naming an unknown tool under a known provider", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const existing = makeExistingPersonaEntity(PERSONA_ID, { tools: undefined });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }, { providers: [brave], tools: [webSearch] }));

    await expect(
      updatePersonaEntity(PERSONA_ID, {
        display_name: existing.display_name,
        tools: { "Brave Search": { "Nonexistent Tool": true } },
      })
    ).rejects.toThrow(CorrectionValidationError);
    await expect(
      updatePersonaEntity(PERSONA_ID, {
        display_name: existing.display_name,
        tools: { "Brave Search": { "Nonexistent Tool": true } },
      })
    ).rejects.toThrow(/unknown tool "Nonexistent Tool" under provider "Brave Search"/);
  });
});

// ── removePersonaEntity ───────────────────────────────────────────────────────
//
// CRITICAL: reserved-persona deletion must be rejected synchronously, before
// writeCorrection is ever invoked -- not merely "the promise rejects". These
// assertions check that corrections.json was never even created and that
// state.json is byte-for-byte unchanged, so a regression that queues the
// correction before throwing (or throws only after queuing) would be caught
// even if the returned/rejected value looked identical.

describe("removePersonaEntity", () => {
  it.each(RESERVED_PERSONA_IDS)(
    "throws the exact reserved-persona message for id %s and never queues a correction",
    async (reservedId) => {
      const existing = makeExistingPersonaEntity(reservedId, { display_name: reservedId });
      writeState(makeState({ [reservedId]: { entity: existing, messages: [] } }));
      const statePath = join(tempDir, "state.json");
      const originalStateJson = readFileSync(statePath, "utf-8");

      await expect(removePersonaEntity(reservedId)).rejects.toThrow(
        new RegExp(`^Cannot delete reserved persona "${reservedId}"\\. Use archive instead\\.$`)
      );

      expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
      expect(readFileSync(statePath, "utf-8")).toBe(originalStateJson);
    }
  );

  it("throws the not-found message (not the reserved message) when a reserved id isn't actually present in state, because the existence check runs first", async () => {
    writeState(makeState({}));

    await expect(removePersonaEntity("ei")).rejects.toThrow(/^No persona found with id: ei$/);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("throws 'No persona found with id: X' for a nonexistent non-reserved id and never queues a correction", async () => {
    writeState(makeState({}));

    await expect(removePersonaEntity("does-not-exist")).rejects.toThrow(
      /^No persona found with id: does-not-exist$/
    );
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("succeeds and removes an ordinary non-reserved id from persisted state", async () => {
    const existing = makeExistingPersonaEntity("regular-1");
    writeState(makeState({ "regular-1": { entity: existing, messages: [] } }));

    await expect(removePersonaEntity("regular-1")).resolves.toBeUndefined();

    const persisted = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    expect(persisted.personas["regular-1"]).toBeUndefined();
  });
});

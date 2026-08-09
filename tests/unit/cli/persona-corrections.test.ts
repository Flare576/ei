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
// removePersonaEntity for real end-to-end (mocked embedding computation, real
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

// computePersonaDescriptionEmbedding hits a real local fastembed model load
// when unmocked — mirrors corrections-endpoints.test.ts's mock of the sibling
// computeDataItemEmbedding/computeQuoteEmbedding functions for the same reason.
vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    computePersonaDescriptionEmbedding: vi.fn().mockResolvedValue([0.25, 0.5, 0.75]),
  };
});

import { loadLatestState } from "../../../src/cli/retrieval.js";
import { createPersonaEntity, updatePersonaEntity, removePersonaEntity } from "../../../src/cli/persona-corrections.js";
import { CorrectionValidationError } from "../../../src/cli/corrections-endpoints.js";
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
    external_reflection_only: false,
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
    expect(record).not.toHaveProperty("is_paused");
    expect(record).not.toHaveProperty("is_archived");
    expect(record.is_static).toBe(false);
    expect(record.aliases).toEqual(["Nova"]);
    expect(record.group_primary).toBe("General");
    expect(record.groups_visible).toEqual(["General"]);
    expect(record.traits).toEqual([]);
    expect(record.topics).toEqual([]);
    expect(record).not.toHaveProperty("description_embedding");
    // is_paused/is_archived are System Hidden (ADR-031) -- absent from the
    // response above -- but the "sensible defaults" claim still needs a
    // real assertion somewhere: verify the persisted record.
    const state = await loadLatestState();
    expect(state!.personas[id].entity.is_paused).toBe(false);
    expect(state!.personas[id].entity.is_archived).toBe(false);
  });

  it("defaults external_reflection_only to false when omitted from a create body", async () => {
    writeState(makeState({}));

    const { record } = await createPersonaEntity({ display_name: "Nova" });

    expect(record.external_reflection_only).toBe(false);
  });

  it("rejects a non-boolean external_reflection_only instead of coercing it", async () => {
    writeState(makeState({}));

    await expect(
      createPersonaEntity({ display_name: "Nova", external_reflection_only: "yes" })
    ).rejects.toThrow(/^Invalid persona: external_reflection_only: Expected boolean, received string$/);
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
      /Invalid persona: unrecognized field\(s\) present/
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

  // `tools` (along with model/group_primary/groups_visible/is_paused/
  // pause_until/is_archived/archived_at/heartbeat_delay_ms/context_window_ms/
  // include_message_timestamps/context_boundary) left the external write
  // contract entirely — ADR-031, this plan's TODO 3. Granting/revoking tools
  // is a TUI-only action now; the four "grants a tool via boolean-map
  // payload"/"rejects an unknown provider/tool" tests this block used to
  // have are replaced by this single red-first rejection test.
  it("rejects a tools payload on create as an unrecognized field (ADR-031)", async () => {
    writeState(makeState({}));

    await expect(
      createPersonaEntity({ display_name: "Nova", tools: { "Brave Search": { "Web Search": true } } })
    ).rejects.toThrow(/Invalid persona: unrecognized field\(s\) present/);

    // Nothing was written — the whole create is refused, not partially applied.
    const persisted = await loadLatestState();
    expect(Object.keys(persisted!.personas)).toHaveLength(0);
  });
});

// ── updatePersonaEntity ───────────────────────────────────────────────────────

describe("updatePersonaEntity", () => {
  // Red-first regression for GH-82/this plan's TODO 5 & 8: before ADR-029's
  // merge-patch pipeline, EVERY field a caller omitted from an `update`
  // payload was silently reset to its create-time default — omitting
  // `traits`/`aliases`/`notes` erased them, omitting `external_reflection_only`
  // re-enrolled a persona in the automatic critic. This test proves the fix:
  // a patch mentioning only `display_name` leaves every other field, on
  // every code path (server-owned/Hidden fields included, since they were
  // never reachable to begin with), exactly as it was stored.
  it("leaves every field the patch doesn't mention completely unchanged (ADR-029 omission-preserves, GH-82)", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      external_reflection_only: true,
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

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "New Name" });

    expect(updated.display_name).toBe("New Name");
    expect(updated.aliases).toEqual(existing.aliases);
    expect(updated.short_description).toBe(existing.short_description);
    expect(updated.long_description).toBe(existing.long_description);
    expect(updated.avatar_emoji).toBe(existing.avatar_emoji);
    expect(updated.preferred_theme).toBe(existing.preferred_theme);
    expect(updated.notes).toEqual(existing.notes);
    expect(updated.traits).toEqual(existing.traits);
    expect(updated.topics).toEqual(existing.topics);
    expect(updated.external_reflection_only).toBe(true);
    // Server-owned/Hidden fields are gone from the response entirely now
    // (ADR-031: System Hidden, not merely unwritable) -- verified against
    // the persisted record below instead, where they must still be
    // untouched by construction (never in the patch schema, so never
    // reachable via the payload at all).
    expect(updated.group_primary).toBe(existing.group_primary);
    expect(updated.groups_visible).toEqual(existing.groups_visible);

    const persisted = await loadLatestState();
    const reloaded = persisted!.personas[PERSONA_ID].entity;
    expect(reloaded.display_name).toBe("New Name");
    expect(reloaded.traits).toEqual(existing.traits);
    expect(reloaded.topics).toEqual(existing.topics);
    expect(reloaded.external_reflection_only).toBe(true);
    expect(reloaded.is_paused).toBe(existing.is_paused);
    expect(reloaded.is_archived).toBe(existing.is_archived);
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

  it("rejects every ADR-031 Hidden/System-Visible field on update as an unrecognized key, not a silent strip-and-ignore", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    const hiddenFields: Array<[string, unknown]> = [
      ["model", "Local LLM:other-model"],
      ["group_primary", "NewGroup"],
      ["groups_visible", ["NewGroup"]],
      ["tools", { "Brave Search": { "Web Search": true } }],
      ["is_paused", true],
      ["pause_until", "2027-01-01T00:00:00.000Z"],
      ["is_archived", true],
      ["archived_at", "2027-01-01T00:00:00.000Z"],
      ["heartbeat_delay_ms", 9999],
      ["context_window_ms", 9999],
      ["include_message_timestamps", false],
      ["context_boundary", "2027-01-01T00:00:00.000Z"],
    ];

    for (const [field, value] of hiddenFields) {
      writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));
      await expect(
        updatePersonaEntity(PERSONA_ID, { display_name: "Renamed", [field]: value })
      ).rejects.toThrow(/Invalid persona update: unrecognized field\(s\) present/);
      // Nothing was written — the whole update is refused, not partially applied.
      const persisted = await loadLatestState();
      expect(persisted!.personas[PERSONA_ID].entity.display_name).toBe(existing.display_name);
      rmSync(tempDir, { recursive: true, force: true });
    }
    tempDir = undefined as never;
  });

  it("strips the four structural round-trip fields (id/type/entity/last_updated) before validation so a lookupById-style read doesn't fail strictObject, once every Hidden/System-Visible field is also dropped by the caller", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      description_embedding: [0.9, 0.9, 0.9],
      tools: undefined,
      is_static: true,
      last_heartbeat: "2026-01-02T00:00:00.000Z",
      pending_update: {
        short_description: "Pending short description",
        long_description: "Pending long description",
        traits: [],
        topics: [],
        critique: "Pending critique",
        created_at: "2026-01-02T00:00:00.000Z",
      },
    });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    // The NEW round-trip pattern: a caller submits only the writable subset
    // of what `ei --id` returned — the four structural fields are tolerated
    // (silently stripped), but the ten Hidden/System-Visible fields
    // (model/group_primary/groups_visible/tools/is_paused/pause_until/
    // is_archived/archived_at/heartbeat_delay_ms/context_window_ms/
    // include_message_timestamps/context_boundary) and `pending_update`'s
    // own object form must be dropped by the caller first — this is exactly
    // the behavior change this plan's docs sweep (TODO 7) teaches.
    const {
      model, group_primary, groups_visible, tools, is_paused, pause_until,
      is_archived, archived_at, heartbeat_delay_ms, context_window_ms,
      include_message_timestamps, context_boundary, pending_update,
      ...writablePayload
    } = existing;
    void model; void group_primary; void groups_visible; void tools; void is_paused;
    void pause_until; void is_archived; void archived_at; void heartbeat_delay_ms;
    void context_window_ms; void include_message_timestamps; void context_boundary;
    void pending_update;

    const roundTripPayload = {
      ...writablePayload,
      type: "persona", // lookupById's discriminator -- not a PersonaEntity field at all
    };

    const updated = await updatePersonaEntity(PERSONA_ID, roundTripPayload);

    expect(updated.display_name).toBe(existing.display_name);
    expect(updated.aliases).toEqual(existing.aliases);
    expect(updated.short_description).toBe(existing.short_description);
    expect(updated.long_description).toBe(existing.long_description);
    expect(updated.notes).toEqual(existing.notes);
    // Untouched by the payload -- preserved by merge-patch omission, exactly
    // like every Hidden field the caller could never have sent anyway.
    // `last_heartbeat` is System Hidden (ADR-031) and is gone from the
    // response entirely now -- verified against the persisted record below.
    expect(updated.is_static).toBe(existing.is_static);
    // `pending_update` is Clearable, not auto-wiped: since this payload
    // never mentions it (excluded above), merge-patch leaves it exactly as
    // it was -- the opposite of the old full-record-replace behavior,
    // which used to drop it on every update regardless of payload. See the
    // dedicated "clears pending_update only when..." test below for the
    // explicit-null path.
    expect(updated.pending_update).toEqual(existing.pending_update);

    const persisted = await loadLatestState();
    const reloaded = persisted!.personas[PERSONA_ID].entity;
    expect(reloaded.display_name).toBe(existing.display_name);
    expect(reloaded.is_static).toBe(existing.is_static);
    expect(reloaded.last_heartbeat).toBe(existing.last_heartbeat);
    expect(reloaded.pending_update).toEqual(existing.pending_update);
  });

  it("clears pending_update only when the patch explicitly sends null -- never as a side effect of an unrelated field edit (ADR-029 clause 5)", async () => {
    const pendingUpdate = {
      short_description: "Pending short description",
      long_description: "Pending long description",
      traits: [],
      topics: [],
      critique: "Pending critique",
      created_at: "2026-01-02T00:00:00.000Z",
    };
    const existing = makeExistingPersonaEntity(PERSONA_ID, { pending_update: pendingUpdate });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    // An unrelated edit that never mentions pending_update leaves it in place.
    const afterUnrelatedEdit = await updatePersonaEntity(PERSONA_ID, { display_name: "New Name" });
    expect(afterUnrelatedEdit.pending_update).toEqual(pendingUpdate);

    // Explicit null clears it.
    const afterClear = await updatePersonaEntity(PERSONA_ID, { pending_update: null });
    expect(afterClear.pending_update).toBeUndefined();

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.pending_update).toBeUndefined();
  });

  it("rejects a non-null pending_update outright, writing nothing (Clearable, not settable)", async () => {
    const pendingUpdate = {
      short_description: "Pending short description",
      long_description: "Pending long description",
      traits: [],
      topics: [],
      critique: "Pending critique",
      created_at: "2026-01-02T00:00:00.000Z",
    };
    const existing = makeExistingPersonaEntity(PERSONA_ID, { pending_update: pendingUpdate });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await expect(
      updatePersonaEntity(PERSONA_ID, { pending_update: { critique: "Forged proposal" } })
    ).rejects.toThrow(CorrectionValidationError);

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.pending_update).toEqual(pendingUpdate);
  });

  it("preserves external_reflection_only: true when a round-trip payload omits it, and when an unrelated field changes", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { external_reflection_only: true, tools: undefined });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Renamed" });

    expect(updated.external_reflection_only).toBe(true);
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

  it("recomputes description_embedding whenever the candidate ends up with a long_description, even when the payload never mentions it", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { long_description: "Old description" });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name" });

    expect(updated).not.toHaveProperty("description_embedding");

    const persisted = await loadLatestState();
    const embedding = persisted!.personas[PERSONA_ID].entity.description_embedding;
    expect(Array.isArray(embedding)).toBe(true);
    expect(embedding!.length).toBeGreaterThan(0);
  });

  it("never computes description_embedding when the candidate has no long_description at all", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { long_description: undefined });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name" });

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.description_embedding).toBeUndefined();
  });

  it("clears description_embedding when a patch explicitly clears long_description (null)", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      long_description: "Old description",
      description_embedding: [0.1, 0.2, 0.3],
    });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await updatePersonaEntity(PERSONA_ID, { display_name: "Original Name", long_description: null });

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.long_description).toBeUndefined();
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
    ).rejects.toThrow(new RegExp(`^Invalid persona update: notes: Array must contain at most ${NOTES_MAX} element`));
  });

  // `tools` left the external write contract entirely (ADR-031) — granting/
  // revoking is a TUI-only action now. The eight round-trip/revoke/preserve
  // tests this block used to have (all exercising a `tools` update payload)
  // are replaced by these two: one proving the field is hard-rejected, one
  // proving an existing grant simply survives any update that (necessarily)
  // never mentions it, and still shows correctly in the enriched response.
  it("rejects a tools payload on update as an unrecognized field (ADR-031)", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const existing = makeExistingPersonaEntity(PERSONA_ID, { tools: ["t-web-search"] });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }, { providers: [brave], tools: [webSearch] }));

    await expect(
      updatePersonaEntity(PERSONA_ID, { display_name: "Renamed", tools: { "Brave Search": { "Web Search": false } } })
    ).rejects.toThrow(/Invalid persona update: unrecognized field\(s\) present/);

    // Nothing was written — the grant is untouched, the name is untouched.
    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.tools).toEqual(["t-web-search"]);
    expect(persisted!.personas[PERSONA_ID].entity.display_name).toBe(existing.display_name);
  });

  it("an existing tools grant survives an update that never mentions tools, and `tools` is absent from the response entirely (ADR-031 [I1])", async () => {
    const brave = makeToolProvider({ id: "p-brave", display_name: "Brave Search" });
    const webSearch = makeToolDefinition({ id: "t-web-search", provider_id: "p-brave", display_name: "Web Search" });
    const existing = makeExistingPersonaEntity(PERSONA_ID, { tools: ["t-web-search"] });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }, { providers: [brave], tools: [webSearch] }));

    const updated = await updatePersonaEntity(PERSONA_ID, { display_name: "Renamed Persona" });

    // `tools` is System Hidden (ADR-031) -- Beta's review [I1] found the
    // prior "enriched map" response was itself the leak this ADR closes.
    // Absent entirely now, not merely reshaped.
    expect(updated).not.toHaveProperty("tools");

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity.tools).toEqual(["t-web-search"]);
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
  it.each(RESERVED_PERSONA_IDS)("throws the exact reserved-persona message for id %s and never queues a correction", async (reservedId) => {
    const existing = makeExistingPersonaEntity(reservedId, { display_name: reservedId === "ei" ? "Ei" : "Emmett" });
    writeState(makeState({ [reservedId]: { entity: existing, messages: [] } }));
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const originalStateJson = readFileSync(statePath, "utf-8");

    await expect(removePersonaEntity(reservedId)).rejects.toThrow(
      new RegExp(`^Cannot delete reserved persona "${reservedId}" — reserved personas can't be deleted via this CLI/MCP path at all; use the TUI's /archive command instead\\.$`)
    );

    expect(existsSync(correctionsPath)).toBe(false);
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateJson);
  });

  it("removes a non-reserved persona, queuing/self-draining a remove correction", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    await removePersonaEntity(PERSONA_ID);

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID]).toBeUndefined();
  });

  it("throws 'No persona found with id: X' for an unknown id", async () => {
    writeState(makeState({}));

    await expect(removePersonaEntity("missing-id")).rejects.toThrow(/^No persona found with id: missing-id$/);
  });
});

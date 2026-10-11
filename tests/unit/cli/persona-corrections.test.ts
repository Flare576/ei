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

// R8/AT8's live-lock-drain half needs a real Processor.start() so the
// background runLoop doesn't try to reach a real LLM -- same mocks
// processor-corrections-drain.test.ts already uses for the identical
// reason.
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
  queuePersonaSignalValidate: vi.fn(),
}));

import { loadLatestState, lookupById } from "../../../src/cli/retrieval.js";
import { createPersonaEntity, updatePersonaEntity, removePersonaEntity, addPersonaObservation, applyPersonaSignal } from "../../../src/cli/persona-corrections.js";
import { CorrectionValidationError } from "../../../src/cli/corrections-endpoints.js";
import { NOTES_MAX } from "../../../src/core/tools/builtin/persona-notes.js";
import type { EmergentSignal, PersonaSignalCollections } from "../../../src/core/types/signals.js";
import { StateManager } from "../../../src/core/state-manager.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { handlePersonaSignalMatch } from "../../../src/core/handlers/human-matching.js";
import { LLMNextStep } from "../../../src/core/types/enums.js";
import type { LLMResponse } from "../../../src/core/types/llm.js";
import { writeCorrection } from "../../../src/cli/corrections-writer.js";
import { appendCorrection } from "../../../src/core/corrections.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface } from "../../../src/core/types.js";

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

function makeSignal(overrides: Partial<EmergentSignal> = {}): EmergentSignal {
  return {
    id: crypto.randomUUID(),
    subject_persona_id: PERSONA_ID,
    claim: "Consistently terse conversational tone.",
    dimension: "behavior",
    status: "candidate",
    evidence_ids: [],
    first_observed_at: INITIAL_NOW,
    last_observed_at: INITIAL_NOW,
    observer_kinds: ["human"],
    recurrence_count: 1,
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
  // `traits`/`aliases`/`notes` erased them. This test proves the fix:
  // a patch mentioning only `display_name` leaves every other field, on
  // every code path (server-owned/Hidden fields included, since they were
  // never reachable to begin with), exactly as it was stored.
  it("leaves every field the patch doesn't mention completely unchanged (ADR-029 omission-preserves, GH-82)", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
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
    expect(reloaded.is_paused).toBe(existing.is_paused);
    expect(reloaded.is_archived).toBe(existing.is_archived);
  });

  // R6/AT6 (Bolt 002 D3, Beta's review [I1]): reproduces Beta's exact
  // finding — a legacy persona still carrying `external_reflection_only`
  // from before ADR-007's sunset must not survive an unrelated self-drained
  // patch in EITHER direction. Reads the raw persisted `state.json` bytes
  // directly (not through loadLatestState(), which now applies its own D3
  // strip and would mask a regression in resolvePersonaPatchCandidate)
  // to prove the field is actually gone from disk, not just from this
  // call's in-memory response.
  it("R6/AT6: a legacy external_reflection_only value never survives an unrelated self-drained patch, in either direction", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID) as PersonaEntity & { external_reflection_only?: boolean };
    existing.external_reflection_only = true;
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { short_description: "changed" });

    expect(updated).not.toHaveProperty("external_reflection_only");
    expect(updated.short_description).toBe("changed");

    const rawStateJson = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    const rawPersistedEntity = rawStateJson.personas[PERSONA_ID].entity as Record<string, unknown>;
    expect(rawPersistedEntity).not.toHaveProperty("external_reflection_only");
    expect(rawPersistedEntity.short_description).toBe("changed");
  });

  // Bolt 004 D1 (Beta's review, S2): mirrors the R6/AT6 external_reflection_only
  // test immediately above, for the second legacy field this same choke point
  // strips. A legacy persona still carrying `pending_update` from before
  // ADR-039's retirement of the reflection-staging model must not survive an
  // unrelated self-drained patch in EITHER direction. Reads the raw persisted
  // `state.json` bytes directly (not through loadLatestState(), which now
  // applies its own strip and would mask a regression in
  // resolvePersonaPatchCandidate) to prove the field is actually gone from
  // disk, not just from this call's in-memory response.
  it("Bolt 004 D1: a legacy pending_update value never survives an unrelated self-drained patch, in either direction", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID) as PersonaEntity & { pending_update?: unknown };
    existing.pending_update = { summary: "stale identity revision", proposed_changes: {} };
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const updated = await updatePersonaEntity(PERSONA_ID, { short_description: "changed" });

    expect(updated).not.toHaveProperty("pending_update");
    expect(updated.short_description).toBe("changed");

    const rawStateJson = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    const rawPersistedEntity = rawStateJson.personas[PERSONA_ID].entity as Record<string, unknown>;
    expect(rawPersistedEntity).not.toHaveProperty("pending_update");
    expect(rawPersistedEntity.short_description).toBe("changed");
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
      ["show_thinking", false],
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

  it("AT13: a persona saved with show_thinking:false lacks the flag in the external lookup, a lookup-derived update (group fields removed) is accepted, and the flag survives on disk", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, { show_thinking: false });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    const looked = await lookupById(PERSONA_ID);
    expect(looked).not.toBeNull();
    expect("show_thinking" in looked!).toBe(false);

    // Remove only the keys the patch schema has never accepted for any persona (ADR-031 System Visible).
    const { group_primary, groups_visible, ...roundTrip } = looked!;
    void group_primary; void groups_visible;

    await updatePersonaEntity(PERSONA_ID, { ...roundTrip, display_name: "Renamed via lookup round trip" });

    const raw = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    const persisted = raw.personas[PERSONA_ID].entity;
    expect(persisted.display_name).toBe("Renamed via lookup round trip");
    expect(persisted.show_thinking).toBe(false);
  });

  it("strips the four structural round-trip fields (id/type/entity/last_updated) before validation so a lookupById-style read doesn't fail strictObject, once every Hidden/System-Visible field is also dropped by the caller", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID, {
      description_embedding: [0.9, 0.9, 0.9],
      tools: undefined,
      is_static: true,
      last_heartbeat: "2026-01-02T00:00:00.000Z",
    });
    writeState(makeState({ [PERSONA_ID]: { entity: existing, messages: [] } }));

    // The NEW round-trip pattern: a caller submits only the writable subset
    // of what `ei --id` returned — the four structural fields are tolerated
    // (silently stripped), but the ten Hidden/System-Visible fields
    // (model/group_primary/groups_visible/tools/is_paused/pause_until/
    // is_archived/archived_at/heartbeat_delay_ms/context_window_ms/
    // include_message_timestamps/context_boundary) must be dropped by the
    // caller first — this is exactly the behavior change this plan's docs
    // sweep (TODO 7) teaches.
    const {
      model, group_primary, groups_visible, tools, is_paused, pause_until,
      is_archived, archived_at, heartbeat_delay_ms, context_window_ms,
      include_message_timestamps, context_boundary,
      ...writablePayload
    } = existing;
    void model; void group_primary; void groups_visible; void tools; void is_paused;
    void pause_until; void is_archived; void archived_at; void heartbeat_delay_ms;
    void context_window_ms; void include_message_timestamps; void context_boundary;

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

    const persisted = await loadLatestState();
    const reloaded = persisted!.personas[PERSONA_ID].entity;
    expect(reloaded.display_name).toBe(existing.display_name);
    expect(reloaded.is_static).toBe(existing.is_static);
    expect(reloaded.last_heartbeat).toBe(existing.last_heartbeat);
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

// ── Add Observation / Apply Signal (Bolt 008, Spec §4.12) ───────────────────
//
// AT1-AT7 as named in persona-emergence-signals-bolt-008-cli-mcp-signal-
// write-surface.md's own "Requirements & Acceptance Tests" section --
// each is its own independent `it()` (its own writeState/tempDir), unlike
// the Spec's own AT-R12, which frames the same ground as one 9-step
// sequential fixture. AT1 is the only one that needs to actually resolve
// the queued Match request -- via the REAL handlePersonaSignalMatch, over
// a scratch StateManager hydrated from the self-drained state.json --
// since Add Observation's own job stops at getting that request queued
// (D1: "routes it through Match->Update/Reduce ... exactly as an
// extraction-produced observation would").

describe("Add Observation — R1/AT1", () => {
  it("AT1: attaches evidence to a matching open signal via the real Match/Update-Reduce path (not an ad hoc write), and mints a new candidate signal for an unrelated claim", async () => {
    const existingSignal = makeSignal({ claim: "Consistently terse conversational tone." });
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: {
        entity: existing,
        messages: [],
        observations: [],
        signals: { persona: [existingSignal], agent: [] },
      },
    }));

    // Same claim as the existing open signal -- Match should attach it as
    // evidence once resolved, never a separate ad hoc write.
    const result1 = await addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "confirms",
      claim: "Consistently terse conversational tone.",
      lens: "persona",
    });
    expect(result1.status).toBe("recorded");
    if (result1.status !== "recorded") throw new Error("unreachable");
    // Caller attribution (D1/§4.6): observer_kind/subject_person_id come
    // from the caller, not inferred from a conversation.
    expect(result1.observation.observer_kind).toBe("human");
    expect(result1.observation.subject_person_id).toBe("person-1");
    expect(result1.observation.subject_persona_id).toBe(PERSONA_ID);
    expect(result1.observation.claim).toBe("Consistently terse conversational tone.");

    // Unrelated claim -- should mint a brand-new candidate once Match
    // resolves "new", never attach to the existing signal.
    const result2 = await addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "novel",
      claim: "Prefers async written communication over calls.",
      lens: "persona",
    });
    expect(result2.status).toBe("recorded");
    if (result2.status !== "recorded") throw new Error("unreachable");

    const afterAdds = await loadLatestState();
    expect(afterAdds!.personas[PERSONA_ID].observations).toHaveLength(2);
    // Neither add-Observation call wrote a signal directly -- only the
    // pre-existing seeded one exists until Match/Update-Reduce actually runs.
    expect(afterAdds!.personas[PERSONA_ID].signals!.persona).toHaveLength(1);

    // Drive the queued Match requests through the REAL Bolt 004 handler.
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.restoreFromState(afterAdds!);

    const matchRequests = sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
    expect(matchRequests).toHaveLength(2);

    const req1 = matchRequests.find((r) => r.data.observationId === result1.observation.id)!;
    const response1: LLMResponse = { request: req1, success: true, content: JSON.stringify({ matched_guid: existingSignal.id }), parsed: { matched_guid: existingSignal.id } };
    handlePersonaSignalMatch(response1, sm);

    const req2 = matchRequests.find((r) => r.data.observationId === result2.observation.id)!;
    const response2: LLMResponse = { request: req2, success: true, content: JSON.stringify({ matched_guid: "new" }), parsed: { matched_guid: "new" } };
    handlePersonaSignalMatch(response2, sm);

    const finalSignals = sm.signals_get(PERSONA_ID).persona;
    const attached = finalSignals.find((s) => s.id === existingSignal.id)!;
    expect(attached.evidence_ids).toContain(result1.observation.id);

    const created = finalSignals.filter((s) => s.id !== existingSignal.id);
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("candidate");
    expect(created[0]!.claim).toBe("Prefers async written communication over calls.");
    expect(created[0]!.evidence_ids).toEqual([result2.observation.id]);
  });
});

describe("Apply Signal — confirm/dismiss reject delta and unrecognized fields (Bolt 003 D1/R1/AT1)", () => {
  it("AT1: a delta-bearing confirm is rejected outright, with no correction queued and no state change", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    const delta = {
      short_description: "Terse by default.",
      long_description: "Speaks in short, direct sentences unless asked to elaborate.",
      traits: [],
      topics: [],
    };
    await expect(applyPersonaSignal(PERSONA_ID, signal.id, "confirm", { actor: "flare576", delta })).rejects.toThrow(/unrecognized field\(s\) present/);

    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
    const persisted = await loadLatestState();
    const persona = persisted!.personas[PERSONA_ID].entity;
    expect(persona).toEqual(existing);
    const persistedSignal = persisted!.personas[PERSONA_ID].signals!.persona.find((s) => s.id === signal.id)!;
    expect(persistedSignal.status).toBe("candidate");
    expect(persistedSignal.reviewed_by).toBeUndefined();
  });

  it("AT1: a delta member field supplied at the top level (short_description) is rejected outright, same as a full delta", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    await expect(applyPersonaSignal(PERSONA_ID, signal.id, "confirm", { actor: "flare576", short_description: "Terse." })).rejects.toThrow(/unrecognized field\(s\) present/);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("AT1: a delta-bearing dismiss is rejected outright, with no correction queued and no state change", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    const delta = { short_description: "x", long_description: "y", traits: [], topics: [] };
    await expect(applyPersonaSignal(PERSONA_ID, signal.id, "dismiss", { actor: "flare576", delta })).rejects.toThrow(/unrecognized field\(s\) present/);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
    const persisted = await loadLatestState();
    const persistedSignal = persisted!.personas[PERSONA_ID].signals!.persona.find((s) => s.id === signal.id)!;
    expect(persistedSignal.status).toBe("candidate");
  });

  it("AT1: an unrecognized field entirely unrelated to delta (e.g. foo) is also rejected outright", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    await expect(applyPersonaSignal(PERSONA_ID, signal.id, "confirm", { actor: "flare576", foo: "bar" })).rejects.toThrow(/unrecognized field\(s\) present/);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("AT1/AT2: a clean confirm (no delta, no extra field) succeeds and transitions only the signal's status + audit field, for the Persona lens", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    const result = await applyPersonaSignal(PERSONA_ID, signal.id, "confirm", { actor: "flare576" });
    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") throw new Error("unreachable");
    expect(result.signal.status).toBe("reviewed");
    expect(result.signal.reviewed_by).toMatchObject({ actor: "flare576" });

    const persisted = await loadLatestState();
    const persona = persisted!.personas[PERSONA_ID].entity;
    expect(persona).toEqual(existing);
  });

  it("AT1: a clean confirm succeeds for the Agent lens too, with zero PersonaEntity mutation", async () => {
    const signal = makeSignal({ dimension: "identity" });
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [signal] } },
    }));

    const result = await applyPersonaSignal(PERSONA_ID, signal.id, "confirm", { actor: "flare576" });
    expect(result.status).toBe("recorded");
    if (result.status !== "recorded") throw new Error("unreachable");
    expect(result.signal.status).toBe("reviewed");

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].entity).toEqual(existing);
  });
});

describe("Apply Signal — dismiss / terminal-state refusals (R6/R7)", () => {
  it("AT6 (R6): dismiss transitions a recurring Persona-lens signal and a recurring Agent-lens signal, with zero PersonaEntity mutation for either", async () => {
    const personaSignal = makeSignal({ status: "recurring", recurrence_count: 2 });
    const agentSignal = makeSignal({ status: "recurring", recurrence_count: 2, dimension: "identity" });
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: {
        entity: existing,
        messages: [],
        observations: [],
        signals: { persona: [personaSignal], agent: [agentSignal] },
      },
    }));

    const result1 = await applyPersonaSignal(PERSONA_ID, personaSignal.id, "dismiss", { actor: "flare576" });
    expect(result1.status).toBe("recorded");
    if (result1.status !== "recorded") throw new Error("unreachable");
    expect(result1.signal.status).toBe("dismissed");
    expect(result1.signal.dismissed_by).toMatchObject({ actor: "flare576" });

    const result2 = await applyPersonaSignal(PERSONA_ID, agentSignal.id, "dismiss", { actor: "flare576" });
    expect(result2.status).toBe("recorded");
    if (result2.status !== "recorded") throw new Error("unreachable");
    expect(result2.signal.status).toBe("dismissed");
    expect(result2.signal.dismissed_by).toMatchObject({ actor: "flare576" });

    const persisted = await loadLatestState();
    const persona = persisted!.personas[PERSONA_ID].entity;
    expect(persona).toEqual(existing);
    expect(persisted!.personas[PERSONA_ID].signals!.persona[0]!.status).toBe("dismissed");
    expect(persisted!.personas[PERSONA_ID].signals!.agent[0]!.status).toBe("dismissed");
  });

  it("AT7 (R7): confirm and dismiss are both refused, with no state change, against an already-dismissed signal and against an already-reviewed signal", async () => {
    const dismissedSignal = makeSignal({ status: "dismissed", dismissed_by: { actor: "someone-else", timestamp: "2025-06-01T00:00:00.000Z" } });
    const reviewedSignal = makeSignal({ status: "reviewed", reviewed_by: { actor: "someone-else", timestamp: "2025-06-01T00:00:00.000Z" } });
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: {
        entity: existing,
        messages: [],
        observations: [],
        signals: { persona: [dismissedSignal, reviewedSignal], agent: [] },
      },
    }));

    await expect(applyPersonaSignal(PERSONA_ID, dismissedSignal.id, "confirm", { actor: "flare576" })).rejects.toThrow(/dismissed/);
    await expect(applyPersonaSignal(PERSONA_ID, dismissedSignal.id, "dismiss", { actor: "flare576" })).rejects.toThrow(/dismissed/);
    await expect(applyPersonaSignal(PERSONA_ID, reviewedSignal.id, "confirm", { actor: "flare576" })).rejects.toThrow(/reviewed/);
    await expect(applyPersonaSignal(PERSONA_ID, reviewedSignal.id, "dismiss", { actor: "flare576" })).rejects.toThrow(/reviewed/);

    const persisted = await loadLatestState();
    const signals = persisted!.personas[PERSONA_ID].signals!.persona;
    expect(signals.find((s) => s.id === dismissedSignal.id)!.status).toBe("dismissed");
    expect(signals.find((s) => s.id === reviewedSignal.id)!.status).toBe("reviewed");
    // The ORIGINAL audit stamp survives untouched -- no overwrite attempt landed.
    expect(signals.find((s) => s.id === dismissedSignal.id)!.dismissed_by).toEqual({ actor: "someone-else", timestamp: "2025-06-01T00:00:00.000Z" });
    expect(signals.find((s) => s.id === reviewedSignal.id)!.reviewed_by).toEqual({ actor: "someone-else", timestamp: "2025-06-01T00:00:00.000Z" });
  });
});

// ── Invalid input never mutates state, on either drain (R8/AT8) ─────────────
//
// AT8 as named in persona-emergence-signals-bolt-008-cli-mcp-signal-write-
// surface.md's "Requirements & Acceptance Tests" section. (a)/(c)/(d)
// exercise the CLI's own synchronous pre-queue checks (addPersonaObservation/
// applyPersonaSignal), same as AT1-AT7 above. (b) additionally drives a REAL
// Processor.drainCorrections() -- the live-lock drain -- via the same
// structural cast + MockStorage-with-getDataPath harness
// processor-corrections-drain.test.ts uses, since self-drain alone can't
// exercise Processor.applyCorrectionRecord's own isPersonaSignalCorrectionOp
// branch (D7's fix).

interface DrainableProcessor {
  drainCorrections(): Promise<void>;
}

function asDrainable(processor: Processor): DrainableProcessor {
  return processor as unknown as DrainableProcessor;
}

interface LiveDrainStorage {
  isAvailable: ReturnType<typeof vi.fn>;
  load: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  moveToBackup: ReturnType<typeof vi.fn>;
  loadBackup: ReturnType<typeof vi.fn>;
  saveRollingBackup: ReturnType<typeof vi.fn>;
  getDataPath: () => string;
}

function createLiveDrainStorage(dataPath: string): LiveDrainStorage {
  return {
    isAvailable: vi.fn().mockResolvedValue(true),
    load: vi.fn().mockResolvedValue(null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
    getDataPath: () => dataPath,
  };
}

function createDrainInterface(): Ei_Interface {
  return { onHumanUpdated: () => {} };
}

/** A malformed `observation.add` wire record -- invalid `dimension` enum
 * value, bypassing the CLI's own zod-validated addPersonaObservation
 * entirely, exactly as if it had been written directly to corrections.json
 * by some other producer. */
function makeMalformedObservationAdd(personaId: string): CorrectionRecord {
  return {
    op: "observation.add",
    entity_type: "persona",
    id: personaId,
    lens: "persona",
    observation: {
      subject_person_id: "person-1",
      observer_kind: "human",
      message_id: "msg-1",
      observed_at: INITIAL_NOW,
      dimension: "not-a-real-dimension",
      direction: "novel",
      claim: "Some claim.",
      extraction_confidence: 1,
    },
    timestamp: INITIAL_NOW,
  } as unknown as CorrectionRecord;
}

/** A malformed `signal.confirm` wire record -- carries a `delta` key,
 * which Bolt 003 D1/R1/AT1 now always rejects outright as an
 * unrecognized top-level key regardless of its own internal shape (the
 * allowlist check runs before delta's own fields are ever inspected) --
 * bypassing the CLI's own zod-validated applyPersonaSignal entirely. */
function makeMalformedSignalConfirm(personaId: string, signalId: string): CorrectionRecord {
  return {
    op: "signal.confirm",
    entity_type: "persona",
    id: personaId,
    signal_id: signalId,
    actor: "flare576",
    delta: { short_description: "x", long_description: "y", traits: "not-an-array", topics: [] },
    timestamp: INITIAL_NOW,
  } as unknown as CorrectionRecord;
}

describe("Add Observation — observed_at must be a parseable ISO 8601 timestamp (D6/AT8a)", () => {
  it("AT8(a): a fabricated non-ISO observed_at is refused, twice, with zero observations created", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [] } },
    }));

    await expect(addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "novel",
      claim: "Consistently terse conversational tone.",
      lens: "persona",
      observed_at: "fake-day-1",
    })).rejects.toThrow(/ISO 8601/);

    await expect(addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "novel",
      claim: "Consistently terse conversational tone.",
      lens: "persona",
      observed_at: "definitely-not-a-timestamp",
    })).rejects.toThrow(/ISO 8601/);

    // Nothing was ever queued for either attempt -- no corrections.json at
    // all, exactly like removePersonaEntity's own reserved-id refusal above.
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);

    const persisted = await loadLatestState();
    expect(persisted!.personas[PERSONA_ID].observations).toEqual([]);
    // With zero observations ever created, re-running Match/Update-Reduce
    // over whatever evidence legitimately exists has nothing fabricated to
    // act on -- the persona's signals are exactly the (empty) set they
    // started as, so no promotion could have been caused by either rejected
    // context.
    expect(persisted!.personas[PERSONA_ID].signals).toEqual({ persona: [], agent: [] });
  });
});

describe("Malformed persona-signal records are rejected atomically on both drains (D7/AT8b)", () => {
  it("AT8(b) self-drain: a malformed observation.add record is rejected, with zero observation/PersonaEntity/queue mutation", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [] } },
    }));
    const beforeState = readFileSync(join(tempDir, "state.json"), "utf-8");

    await expect(writeCorrection(makeMalformedObservationAdd(PERSONA_ID))).rejects.toThrow(/dimension/);

    // The self-drain never reached its own atomicWrite -- state.json is
    // byte-for-byte unchanged, not merely "logically equal".
    expect(readFileSync(join(tempDir, "state.json"), "utf-8")).toBe(beforeState);
  });

  it("AT8(b) self-drain: a malformed signal.confirm record (unrecognized delta key, Bolt 003 D1) is rejected, with zero signal/PersonaEntity mutation", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));
    const beforeState = readFileSync(join(tempDir, "state.json"), "utf-8");

    await expect(writeCorrection(makeMalformedSignalConfirm(PERSONA_ID, signal.id))).rejects.toThrow(/delta/);

    expect(readFileSync(join(tempDir, "state.json"), "utf-8")).toBe(beforeState);
  });

  it("AT8(b) live drain: a malformed observation.add record is rejected, with zero observation/PersonaEntity/queue mutation, and does not wedge the queue", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-persona-corrections-live-drain-"));
    try {
      // is_paused: true -- otherwise Processor's own background runLoop
      // (start() kicks it off for real) treats this freshly-restored
      // persona as overdue for a heartbeat and mutates
      // last_heartbeat/last_updated out-of-band, unrelated to what this
      // test is asserting.
      const existing = makeExistingPersonaEntity(PERSONA_ID, { is_paused: true });
      const seedState = makeState({
        [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [] } },
      });

      const processor = new Processor(createDrainInterface());
      try {
        await processor.start(createLiveDrainStorage(dataDir) as unknown as Parameters<Processor["start"]>[0]);
        processor.getStateManager().restoreFromState(seedState);

        const correctionsPath = join(dataDir, "corrections.json");
        await appendCorrection(correctionsPath, makeMalformedObservationAdd(PERSONA_ID));
        await asDrainable(processor).drainCorrections();

        const sm = processor.getStateManager();
        expect(sm.observations_get(PERSONA_ID)).toEqual([]);
        expect(sm.persona_getById(PERSONA_ID)).toEqual(existing);
        expect(sm.queue_getAllActiveItems()).toEqual([]);
        // The malformed record was DROPPED (logged, not re-queued forever) --
        // exactly like every other malformed record this drain already
        // tolerates, so the queue never wedges.
        expect(JSON.parse(readFileSync(correctionsPath, "utf-8"))).toEqual([]);
      } finally {
        await processor.stop();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it("AT8(b) live drain: a malformed signal.confirm record (unrecognized delta key, Bolt 003 D1) is rejected, with zero signal/PersonaEntity mutation", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-persona-corrections-live-drain-"));
    try {
      const signal = makeSignal();
      const existing = makeExistingPersonaEntity(PERSONA_ID, { is_paused: true });
      const seedState = makeState({
        [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
      });

      const processor = new Processor(createDrainInterface());
      try {
        await processor.start(createLiveDrainStorage(dataDir) as unknown as Parameters<Processor["start"]>[0]);
        processor.getStateManager().restoreFromState(seedState);

        const correctionsPath = join(dataDir, "corrections.json");
        await appendCorrection(correctionsPath, makeMalformedSignalConfirm(PERSONA_ID, signal.id));
        await asDrainable(processor).drainCorrections();

        const sm = processor.getStateManager();
        expect(sm.signals_get(PERSONA_ID).persona[0]!.status).toBe("candidate");
        expect(sm.signals_get(PERSONA_ID).persona[0]!.reviewed_by).toBeUndefined();
        expect(sm.persona_getById(PERSONA_ID)).toEqual(existing);
        expect(JSON.parse(readFileSync(correctionsPath, "utf-8"))).toEqual([]);
      } finally {
        await processor.stop();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

/** A well-formed `signal.confirm` wire record -- every branch-specific
 * field is valid -- but missing the shared wrapper `timestamp` field
 * every correction interface (CorrectionObservationAdd/
 * CorrectionSignalConfirm/CorrectionSignalDismiss) requires (I9),
 * bypassing the CLI's own zod-validated applyPersonaSignal entirely,
 * exactly as if it had been written directly to corrections.json by some
 * other producer. */
function makeTimestamplessSignalConfirm(personaId: string, signalId: string): CorrectionRecord {
  return {
    op: "signal.confirm",
    entity_type: "persona",
    id: personaId,
    signal_id: signalId,
    actor: "flare576",
  } as unknown as CorrectionRecord;
}

describe("A timestamp-less persona-signal record is rejected atomically on both drains (I9 regression)", () => {
  it("self-drain: a timestamp-less signal.confirm record is rejected, with zero signal/PersonaEntity mutation", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));
    const beforeState = readFileSync(join(tempDir, "state.json"), "utf-8");

    await expect(writeCorrection(makeTimestamplessSignalConfirm(PERSONA_ID, signal.id))).rejects.toThrow(/timestamp/);

    expect(readFileSync(join(tempDir, "state.json"), "utf-8")).toBe(beforeState);
  });

  it("live drain: a timestamp-less signal.confirm record is rejected, with zero signal/PersonaEntity mutation", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-persona-corrections-live-drain-"));
    try {
      const signal = makeSignal();
      const existing = makeExistingPersonaEntity(PERSONA_ID, { is_paused: true });
      const seedState = makeState({
        [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
      });

      const processor = new Processor(createDrainInterface());
      try {
        await processor.start(createLiveDrainStorage(dataDir) as unknown as Parameters<Processor["start"]>[0]);
        processor.getStateManager().restoreFromState(seedState);

        const correctionsPath = join(dataDir, "corrections.json");
        await appendCorrection(correctionsPath, makeTimestamplessSignalConfirm(PERSONA_ID, signal.id));
        await asDrainable(processor).drainCorrections();

        const sm = processor.getStateManager();
        expect(sm.signals_get(PERSONA_ID).persona[0]!.status).toBe("candidate");
        expect(sm.signals_get(PERSONA_ID).persona[0]!.reviewed_by).toBeUndefined();
        expect(sm.persona_getById(PERSONA_ID)).toEqual(existing);
        expect(JSON.parse(readFileSync(correctionsPath, "utf-8"))).toEqual([]);
      } finally {
        await processor.stop();
      }
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("personaId resolves only via an own-property check (D8/AT8c)", () => {
  it("AT8(c): a prototype-inherited personaId (\"constructor\") is refused as \"persona not found\" on Add Observation, with no correction ever queued", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [] } },
    }));

    await expect(addPersonaObservation("constructor", {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "novel",
      claim: "Some claim.",
      lens: "persona",
    })).rejects.toThrow(/persona found/);

    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("AT8(c): a prototype-inherited personaId (\"toString\") is refused as \"persona not found\" on Apply Signal, with no correction ever queued", async () => {
    const signal = makeSignal();
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [signal], agent: [] } },
    }));

    await expect(applyPersonaSignal("toString", signal.id, "confirm", { actor: "flare576" })).rejects.toThrow(/persona found/);

    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });
});

describe("Terminal control characters are stripped before a personaId reaches a CLI error message (D9/AT8d)", () => {
  it("AT8(d): a personaId containing an ESC/CSI control sequence is stripped from the \"persona not found\" error", async () => {
    const existing = makeExistingPersonaEntity(PERSONA_ID);
    writeState(makeState({
      [PERSONA_ID]: { entity: existing, messages: [], observations: [], signals: { persona: [], agent: [] } },
    }));

    const poisonedId = "nonexistent-\x1b[31mFAKE-RED\x1b[0m";
    await expect(addPersonaObservation(poisonedId, {
      subject_person_id: "person-1",
      observer_kind: "human",
      dimension: "behavior",
      direction: "novel",
      claim: "Some claim.",
      lens: "persona",
    })).rejects.toSatisfy((err: unknown) => {
      const message = (err as Error).message;
      return !message.includes("\x1b") && message.includes("nonexistent-[31mFAKE-RED[0m");
    });
  });
});

// ── Self-attested other_persona evidence cannot auto-promote (D11/R9) ───────
//
// R9/AT9 as named in persona-emergence-signals-bolt-008-cli-mcp-signal-
// write-surface.md's "Requirements & Acceptance Tests" section, added
// after Sisyphus's ruling on the caller-attribution needs-ruling issue.
// Drives the SAME real Match/Update-Reduce round-trip AT1 uses (queued
// Add-Observation -> real handlePersonaSignalMatch), so the promotion
// arithmetic this test exercises is the actual production path, not a
// stand-in for it.

describe("Self-attested other_persona evidence cannot auto-promote a signal (D11/R9)", () => {
  it("AT9: two Add-Observation calls with different self-attested observer_persona_id values attach to the same behavior-dimension candidate signal without auto-promoting it; an explicit signal.confirm still succeeds", async () => {
    const OBSERVER_A_ID = "22222222-2222-4222-8222-222222222222";
    const OBSERVER_B_ID = "33333333-3333-4333-8333-333333333333";
    const claim = "Frequently interrupts to redirect the conversation.";
    const existingSignal = makeSignal({ claim, dimension: "behavior", evidence_ids: [], recurrence_count: 0 });
    const subject = makeExistingPersonaEntity(PERSONA_ID);
    const observerA = makeExistingPersonaEntity(OBSERVER_A_ID, { display_name: "Observer A" });
    const observerB = makeExistingPersonaEntity(OBSERVER_B_ID, { display_name: "Observer B" });
    writeState(makeState({
      [PERSONA_ID]: { entity: subject, messages: [], observations: [], signals: { persona: [existingSignal], agent: [] } },
      [OBSERVER_A_ID]: { entity: observerA, messages: [], observations: [], signals: { persona: [], agent: [] } },
      [OBSERVER_B_ID]: { entity: observerB, messages: [], observations: [], signals: { persona: [], agent: [] } },
    }));

    // Same claim, two distinct self-attested witness identities -- exactly
    // the independence pattern (D9's PROMOTION_INDEPENDENCE_THRESHOLD.behavior
    // = 2) that would clear the automatic candidate->recurring bar if this
    // evidence were extraction-produced instead of direct-write.
    const result1 = await addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "other_persona",
      observer_persona_id: OBSERVER_A_ID,
      dimension: "behavior",
      direction: "confirms",
      claim,
      lens: "persona",
    });
    expect(result1.status).toBe("recorded");
    if (result1.status !== "recorded") throw new Error("unreachable");

    const result2 = await addPersonaObservation(PERSONA_ID, {
      subject_person_id: "person-1",
      observer_kind: "other_persona",
      observer_persona_id: OBSERVER_B_ID,
      dimension: "behavior",
      direction: "confirms",
      claim,
      lens: "persona",
    });
    expect(result2.status).toBe("recorded");
    if (result2.status !== "recorded") throw new Error("unreachable");

    const afterAdds = await loadLatestState();

    // Drive both queued Match requests through the REAL Bolt 004 handler,
    // attaching both observations as evidence on the SAME existing signal.
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.restoreFromState(afterAdds!);

    const matchRequests = sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
    expect(matchRequests).toHaveLength(2);

    const req1 = matchRequests.find((r) => r.data.observationId === result1.observation.id)!;
    const response1: LLMResponse = { request: req1, success: true, content: JSON.stringify({ matched_guid: existingSignal.id }), parsed: { matched_guid: existingSignal.id } };
    handlePersonaSignalMatch(response1, sm);

    const req2 = matchRequests.find((r) => r.data.observationId === result2.observation.id)!;
    const response2: LLMResponse = { request: req2, success: true, content: JSON.stringify({ matched_guid: existingSignal.id }), parsed: { matched_guid: existingSignal.id } };
    handlePersonaSignalMatch(response2, sm);

    const afterMatch = sm.signals_get(PERSONA_ID).persona.find((s) => s.id === existingSignal.id)!;
    expect(afterMatch.evidence_ids).toContain(result1.observation.id);
    expect(afterMatch.evidence_ids).toContain(result2.observation.id);
    // D11: both distinct claimed witness identities are self-attested,
    // direct-write other_persona evidence -- excluded from the automatic
    // independence tally, so the signal is NOT promoted despite matching
    // the exact pattern that would promote extraction-produced evidence.
    expect(afterMatch.status).toBe("candidate");

    // Persist sm's post-Match state to disk -- the explicit confirm below
    // is a self-drain that reads state.json fresh from EI_DATA_PATH.
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(sm.getStorageState()));

    // Separately: an explicit human signal.confirm on that same
    // still-candidate signal still succeeds -- D11 blocks only AUTOMATIC
    // promotion; the explicit human path (D2/R2) is untouched.
    const confirmResult = await applyPersonaSignal(PERSONA_ID, existingSignal.id, "confirm", { actor: "flare576" });
    expect(confirmResult.status).toBe("recorded");
    if (confirmResult.status !== "recorded") throw new Error("unreachable");
    expect(confirmResult.signal.status).toBe("reviewed");
    expect(confirmResult.signal.reviewed_by).toMatchObject({ actor: "flare576" });
  });
});

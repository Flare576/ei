/**
 * rewrite-length-floor-cleared-on-update.md / ADR-032 (amended 2026-08-09).
 *
 * Exercises the actual upsert choke point (`resolveRewriteLengthFloor` in
 * src/core/state/human.ts) through every real caller shape named in the
 * issue's acceptance criteria and the ADR amendment, using a real
 * StateManager rather than a hand-rolled mock — the bug this issue fixes
 * was specifically that a mock which just stores whatever object it's
 * given can't see the choke point at all.
 *
 * Bare-specifier zod mock (matches corrections-endpoints.test.ts /
 * merge-patch-pipeline-parity.test.ts's own shim) — without it, evaluating
 * entity-schemas.ts's module-level `z.string()`/`z.number()` literals
 * throws while corrections.ts (resolveTopicPatchCandidate/
 * resolvePersonPatchCandidate/applyCorrectionToHuman) is being collected.
 */
import { describe, it, expect, vi } from "vitest";
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

// computeDataItemEmbedding hits a real local embedding model when unmocked.
vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    computeDataItemEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    getEmbeddingService: vi.fn(() => ({
      embed: vi.fn(async (text: string) => [text.length, 0, 0]),
      embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 0, 0])),
      isReady: () => true,
    })),
  };
});

import { StateManager } from "../../../src/core/state-manager.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequestState,
  type LLMRequest,
  type LLMResponse,
  type Topic,
  type Person,
  type HumanEntity,
} from "../../../src/core/types.js";
import { handlers } from "../../../src/core/handlers/index.js";
import { computeRewriteLengthFloor } from "../../../src/core/utils/rewrite-floor.js";
import { upsertTopic, upsertPerson } from "../../../src/core/human-data-manager.js";
import { applyCorrectionToHuman, type CorrectionRecord } from "../../../src/core/corrections.js";
import { queueTopicRewritePhase, queuePersonRewritePhase } from "../../../src/core/orchestrators/ceremony.js";

const NOW = "2026-01-01T00:00:00.000Z";

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "topic-1",
    name: "Floor Test Topic",
    description: "A".repeat(100),
    sentiment: 0.2,
    category: "Interest",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Floor Test Person",
    description: "A".repeat(100),
    sentiment: 0.2,
    relationship: "Friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers: [{ type: "Nickname", value: "Floor Test Person", is_primary: true }],
    ...overrides,
  };
}

async function newState(): Promise<StateManager> {
  const sm = new StateManager();
  await sm.initialize(createMockStorage());
  return sm;
}

function setRewriteModel(sm: StateManager): void {
  const human = sm.getHuman();
  sm.setHuman({ ...human, settings: { ...human.settings, rewrite_model: "TestProvider:test-model" } });
}

function isQueuedForRewriteScan(sm: StateManager, itemId: string): boolean {
  return sm.queue_getAllActiveItems().some((r) => (r.data as Record<string, unknown> | undefined)?.itemId === itemId);
}

function makeRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "req-1",
    created_at: NOW,
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleTopicUpdate,
    data: {},
    ...overrides,
  };
}

function makeResponse(request: LLMRequest, parsed: unknown): LLMResponse {
  return { request, success: true, content: JSON.stringify(parsed), parsed, error: undefined };
}

// ---------------------------------------------------------------------------
// 1. Oracle — human-data-manager's upsertTopic/upsertPerson (TUI/web/live-drain
//    surface): a description that genuinely grew must get a floor recomputed
//    from the NEW length, and the ceremony must not immediately re-flag it.
// ---------------------------------------------------------------------------
describe("rewrite_length_floor choke point — human-data-manager surface (upsertTopic/upsertPerson)", () => {
  it("Topic: grown description recomputes the floor above the new length; ceremony no longer flags it", async () => {
    const sm = await newState();
    sm.human_topic_upsert(makeTopic({ description: "A".repeat(100) }));
    const seeded = sm.getHuman().topics.find((t) => t.id === "topic-1")!;
    expect(seeded.rewrite_length_floor).toBe(computeRewriteLengthFloor(100));

    // A real external caller (TUI/web/CLI self-drain) builds its write by
    // spreading over the record it just read — the exact shape the ADR-032
    // amendment identifies as universal. The spread carries the OLD floor
    // forward on the object; the choke point must ignore it.
    const grown: Topic = { ...seeded, description: "B".repeat(2000) };
    await upsertTopic(sm, grown);

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-1")!;
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));
    expect(stored.rewrite_length_floor).not.toBe(seeded.rewrite_length_floor);

    setRewriteModel(sm);
    queueTopicRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "topic-1")).toBe(false);
  });

  it("Person: grown description recomputes the floor above the new length; ceremony no longer flags it", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ description: "A".repeat(100) }));
    const seeded = sm.getHuman().people.find((p) => p.id === "person-1")!;
    expect(seeded.rewrite_length_floor).toBe(computeRewriteLengthFloor(100));

    const grown: Person = { ...seeded, description: "B".repeat(2000) };
    await upsertPerson(sm, grown);

    const stored = sm.getHuman().people.find((p) => p.id === "person-1")!;
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));
    expect(stored.rewrite_length_floor).not.toBe(seeded.rewrite_length_floor);

    setRewriteModel(sm);
    queuePersonRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "person-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. Oracle — the CLI/MCP surface: resolveTopicPatchCandidate/
//    resolvePersonPatchCandidate + applyCorrectionToHuman (the exact path
//    updateEntity's self-drain and Processor's live-drain both use for an
//    `ei update topic`/`ei update person` merge patch).
// ---------------------------------------------------------------------------
describe("rewrite_length_floor choke point — CLI/MCP surface (resolve*PatchCandidate + applyCorrectionToHuman)", () => {
  it("Topic: a description-changing merge patch recomputes the floor above the new length; ceremony no longer flags it", async () => {
    const sm = await newState();
    sm.human_topic_upsert(makeTopic({ description: "A".repeat(100) }));
    const seeded = sm.getHuman().topics.find((t) => t.id === "topic-1")!;
    expect(seeded.rewrite_length_floor).toBe(computeRewriteLengthFloor(100));

    const human: HumanEntity = sm.getHuman();
    const correction: CorrectionRecord = {
      op: "patch",
      entity_type: "topic",
      id: "topic-1",
      patch: { description: "C".repeat(2000) },
      timestamp: NOW,
    };
    await applyCorrectionToHuman(human, correction);

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-1")!;
    expect(stored.description).toBe("C".repeat(2000));
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queueTopicRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "topic-1")).toBe(false);
  });

  it("Person: a description-changing merge patch recomputes the floor above the new length; ceremony no longer flags it", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ description: "A".repeat(100) }));
    const seeded = sm.getHuman().people.find((p) => p.id === "person-1")!;
    expect(seeded.rewrite_length_floor).toBe(computeRewriteLengthFloor(100));

    const human: HumanEntity = sm.getHuman();
    const correction: CorrectionRecord = {
      op: "patch",
      entity_type: "person",
      id: "person-1",
      patch: { description: "C".repeat(2000) },
      timestamp: NOW,
    };
    await applyCorrectionToHuman(human, correction);

    const stored = sm.getHuman().people.find((p) => p.id === "person-1")!;
    expect(stored.description).toBe("C".repeat(2000));
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queuePersonRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "person-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. Regression — extraction's clear-if-grew rule (handleTopicUpdate /
//    handlePersonUpdate). The single most important regression risk in this
//    change: proving the choke point's own default (recompute-on-change)
//    does NOT silently override extraction's explicit `null` (clear) when
//    the description has genuinely grown past the stored floor.
// ---------------------------------------------------------------------------
describe("extraction's clear-if-grew rule survives the choke point refactor (handleTopicUpdate/handlePersonUpdate)", () => {
  it("Topic: description grown past the floor clears it to undefined; ceremony flags it", async () => {
    const sm = await newState();
    sm.human_topic_upsert(makeTopic({ id: "topic-grow", description: "A".repeat(1000) }));
    const seeded = sm.getHuman().topics.find((t) => t.id === "topic-grow")!;
    const oldFloor = computeRewriteLengthFloor(1000);
    expect(seeded.rewrite_length_floor).toBe(oldFloor);

    const request = makeRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        isNewItem: false,
        existingItemId: "topic-grow",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
      },
    });
    const response = makeResponse(request, { description: "B".repeat(5000) });
    await handlers[LLMNextStep.HandleTopicUpdate](response, sm);

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-grow")!;
    expect(stored.description).toBe("B".repeat(5000));
    expect(stored.rewrite_length_floor).toBeUndefined();

    setRewriteModel(sm);
    queueTopicRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "topic-grow")).toBe(true);
  });

  it("Person: description grown past the floor clears it to undefined; ceremony flags it", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ id: "person-grow", description: "A".repeat(1200) }));
    const seeded = sm.getHuman().people.find((p) => p.id === "person-grow")!;
    const oldFloor = computeRewriteLengthFloor(1200);
    expect(seeded.rewrite_length_floor).toBe(oldFloor);

    const request = makeRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        isNewItem: false,
        existingItemId: "person-grow",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
        candidateName: "Floor Test Person",
      },
    });
    const response = makeResponse(request, { description: "B".repeat(5000) });
    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const stored = sm.getHuman().people.find((p) => p.id === "person-grow")!;
    expect(stored.description).toBe("B".repeat(5000));
    expect(stored.rewrite_length_floor).toBeUndefined();

    setRewriteModel(sm);
    queuePersonRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "person-grow")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T1 (Beta review, P0 / I1) — extraction must OMIT floorOverride (not pass
// explicit `null`) when there is no stored floor to grow past: a brand-new
// record, or an existing record that is already floorless. Passing `null`
// there forces `undefined` immediately, bypassing the choke point's own
// new-record/changed-description default and re-flagging the record for an
// immediate ceremony rewrite scan it never needed. Falsifiable oracle
// (Beta's own): persisted floor must equal computeRewriteLengthFloor(2000)
// and the record must NOT be enqueued for rewrite.
// ---------------------------------------------------------------------------
describe("extraction defaults to a fresh floor when there is no existing floor to grow past (Beta's T1 / I1 fix)", () => {
  it("Topic: a brand-new extracted record gets a floor above its own length, not undefined", async () => {
    const sm = await newState();
    const request = makeRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        isNewItem: true,
        personaId: "persona-x",
        personaDisplayName: "Persona X",
        candidateCategory: "Interest",
      },
    });
    const response = makeResponse(request, {
      name: "Brand New Topic",
      description: "N".repeat(2000),
      category: "Interest",
      sentiment: 0.3,
      exposure_desired: 0.5,
    });
    await handlers[LLMNextStep.HandleTopicUpdate](response, sm);

    const stored = sm.getHuman().topics.find((t) => t.name === "Brand New Topic")!;
    expect(stored).toBeDefined();
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queueTopicRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, stored.id)).toBe(false);
  });

  it("Topic: an existing but already-floorless record that changes gets a fresh floor, not undefined", async () => {
    const sm = await newState();
    // floorOverride=null forces an explicit clear on seed, simulating a
    // record extraction already marked pending-review (no floor yet).
    sm.human_topic_upsert(makeTopic({ id: "topic-floorless", description: "A".repeat(900) }), null);
    const seeded = sm.getHuman().topics.find((t) => t.id === "topic-floorless")!;
    expect(seeded.rewrite_length_floor).toBeUndefined();

    const request = makeRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        isNewItem: false,
        existingItemId: "topic-floorless",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
      },
    });
    const response = makeResponse(request, { description: "B".repeat(2000) });
    await handlers[LLMNextStep.HandleTopicUpdate](response, sm);

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-floorless")!;
    expect(stored.description).toBe("B".repeat(2000));
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queueTopicRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "topic-floorless")).toBe(false);
  });

  it("Person: a brand-new extracted record gets a floor above its own length, not undefined", async () => {
    const sm = await newState();
    const request = makeRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        isNewItem: true,
        personaId: "persona-x",
        personaDisplayName: "Persona X",
        candidateName: "Brand New Person",
        candidateRelationship: "Friend",
      },
    });
    const response = makeResponse(request, {
      description: "N".repeat(2000),
      sentiment: 0.3,
      relationship: "Friend",
      exposure_desired: 0.5,
      identifiers: [{ type: "Full Name", value: "Brand New Person", is_primary: true }],
    });
    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const stored = sm.getHuman().people.find((p) => p.name === "Brand New Person")!;
    expect(stored).toBeDefined();
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queuePersonRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, stored.id)).toBe(false);
  });

  it("Person: an existing but already-floorless record that changes gets a fresh floor, not undefined", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ id: "person-floorless", description: "A".repeat(1100) }), undefined, null);
    const seeded = sm.getHuman().people.find((p) => p.id === "person-floorless")!;
    expect(seeded.rewrite_length_floor).toBeUndefined();

    const request = makeRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        isNewItem: false,
        existingItemId: "person-floorless",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
        candidateName: "Floor Test Person",
      },
    });
    const response = makeResponse(request, { description: "B".repeat(2000) });
    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const stored = sm.getHuman().people.find((p) => p.id === "person-floorless")!;
    expect(stored.description).toBe("B".repeat(2000));
    expect(stored.rewrite_length_floor).toBe(computeRewriteLengthFloor(2000));

    setRewriteModel(sm);
    queuePersonRewritePhase(sm);
    expect(isQueuedForRewriteScan(sm, "person-floorless")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Regression — extraction's preserve-if-shrank rule: a description that
//    shrank but is still under the stored floor must leave that floor
//    byte-identical, not recompute it from the (now shorter) new length.
// ---------------------------------------------------------------------------
describe("extraction's preserve-if-shrank rule survives the choke point refactor", () => {
  it("Topic: description shrunk but still under the floor preserves the exact stored value", async () => {
    const sm = await newState();
    sm.human_topic_upsert(makeTopic({ id: "topic-shrink", description: "A".repeat(1000) }));
    const seeded = sm.getHuman().topics.find((t) => t.id === "topic-shrink")!;
    const oldFloor = computeRewriteLengthFloor(1000);
    expect(seeded.rewrite_length_floor).toBe(oldFloor);

    const request = makeRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        isNewItem: false,
        existingItemId: "topic-shrink",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
      },
    });
    // Shrunk, but still well under oldFloor (1100).
    const response = makeResponse(request, { description: "B".repeat(500) });
    await handlers[LLMNextStep.HandleTopicUpdate](response, sm);

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-shrink")!;
    expect(stored.description).toBe("B".repeat(500));
    expect(stored.rewrite_length_floor).toBe(oldFloor);
  });

  it("Person: description shrunk but still under the floor preserves the exact stored value", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ id: "person-shrink", description: "A".repeat(1200) }));
    const seeded = sm.getHuman().people.find((p) => p.id === "person-shrink")!;
    const oldFloor = computeRewriteLengthFloor(1200);
    expect(seeded.rewrite_length_floor).toBe(oldFloor);

    const request = makeRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        isNewItem: false,
        existingItemId: "person-shrink",
        personaId: "persona-x",
        personaDisplayName: "Persona X",
        candidateName: "Floor Test Person",
      },
    });
    const response = makeResponse(request, { description: "B".repeat(600) });
    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const stored = sm.getHuman().people.find((p) => p.id === "person-shrink")!;
    expect(stored.description).toBe("B".repeat(600));
    expect(stored.rewrite_length_floor).toBe(oldFloor);
  });
});

// ---------------------------------------------------------------------------
// 5. Guard rail — an unrelated-field-only write (heartbeat.ts's own
//    `{...found, last_ei_asked: now}` shape, called directly through
//    human_topic_upsert/human_person_upsert with no override) must NOT heal
//    a floor that is currently undefined. Protects against a future "always
//    recompute on write" regression defeating extraction's clear rule.
// ---------------------------------------------------------------------------
describe("an unrelated-field-only write never heals a cleared floor", () => {
  it("Topic: heartbeat-shaped write with no override leaves an undefined floor undefined", async () => {
    const sm = await newState();
    // floorOverride=null forces the clear on first insert too, simulating
    // "just cleared by extraction" state.
    sm.human_topic_upsert(makeTopic({ id: "topic-heartbeat", description: "A".repeat(2000) }), null);
    const found = sm.getHuman().topics.find((t) => t.id === "topic-heartbeat")!;
    expect(found.rewrite_length_floor).toBeUndefined();

    const now = "2026-02-01T00:00:00.000Z";
    sm.human_topic_upsert({ ...found, last_ei_asked: now });

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-heartbeat")!;
    expect(stored.last_ei_asked).toBe(now);
    expect(stored.description).toBe(found.description);
    expect(stored.rewrite_length_floor).toBeUndefined();
  });

  it("Person: heartbeat-shaped write with no override leaves an undefined floor undefined", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ id: "person-heartbeat", description: "A".repeat(2000) }), undefined, null);
    const found = sm.getHuman().people.find((p) => p.id === "person-heartbeat")!;
    expect(found.rewrite_length_floor).toBeUndefined();

    const now = "2026-02-01T00:00:00.000Z";
    sm.human_person_upsert({ ...found, last_ei_asked: now });

    const stored = sm.getHuman().people.find((p) => p.id === "person-heartbeat")!;
    expect(stored.last_ei_asked).toBe(now);
    expect(stored.description).toBe(found.description);
    expect(stored.rewrite_length_floor).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// T2 (Beta review, P1) — the existing guard rail above only proves an
// unrelated-field write doesn't HEAL an undefined floor. It can't
// distinguish "preserves whatever is stored" from an erroneous "always
// clears/recomputes" that happens to look right on undefined. Use a
// deliberately non-formula number (999 is not computeRewriteLengthFloor of
// any length) so only byte-identical preservation passes.
// ---------------------------------------------------------------------------
describe("an unrelated-field-only write preserves an arbitrary existing numeric floor exactly (Beta's T2)", () => {
  it("Topic: heartbeat-shaped write with no override preserves a deliberately non-formula floor byte-identically", async () => {
    const sm = await newState();
    sm.human_topic_upsert(makeTopic({ id: "topic-heartbeat-num", description: "A".repeat(2000) }), 999);
    const found = sm.getHuman().topics.find((t) => t.id === "topic-heartbeat-num")!;
    expect(found.rewrite_length_floor).toBe(999);

    const now = "2026-02-01T00:00:00.000Z";
    sm.human_topic_upsert({ ...found, last_ei_asked: now });

    const stored = sm.getHuman().topics.find((t) => t.id === "topic-heartbeat-num")!;
    expect(stored.last_ei_asked).toBe(now);
    expect(stored.description).toBe(found.description);
    expect(stored.rewrite_length_floor).toBe(999);
  });

  it("Person: heartbeat-shaped write with no override preserves a deliberately non-formula floor byte-identically", async () => {
    const sm = await newState();
    sm.human_person_upsert(makePerson({ id: "person-heartbeat-num", description: "A".repeat(2000) }), undefined, 999);
    const found = sm.getHuman().people.find((p) => p.id === "person-heartbeat-num")!;
    expect(found.rewrite_length_floor).toBe(999);

    const now = "2026-02-01T00:00:00.000Z";
    sm.human_person_upsert({ ...found, last_ei_asked: now });

    const stored = sm.getHuman().people.find((p) => p.id === "person-heartbeat-num")!;
    expect(stored.last_ei_asked).toBe(now);
    expect(stored.description).toBe(found.description);
    expect(stored.rewrite_length_floor).toBe(999);
  });
});

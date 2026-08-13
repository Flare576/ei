import { describe, it, expect, beforeEach, vi } from "vitest";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as tests/unit/core/state-manager.test.ts; the R3/AT3
// tests below exercise the corrections pipeline (applyCorrectionToPersonas),
// not the schema library.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});
import { PersonaState } from "../../../../src/core/state/index.js";
import { applyCorrectionToPersonas } from "../../../../src/core/corrections.js";
import type {
  PersonaEntity,
  PersonaObservation,
  EmergentSignal,
  StorageState,
} from "../../../../src/core/types.js";

// Bolt: persona-emergence-signals-003 (PersonaObservation/EmergentSignal schema and state).
// R1/AT1: create/persist/read-back through the state module's own API, with a
// signal's evidence_ids resolving against an observation's id (never its
// message_id/quote_id).
// R3/AT3: a generic full-record Persona correction cannot touch observations
// or signals — exercised against every existing write path that can perform
// one, not just PersonaState's own replace()/update().

describe("PersonaState — observations and signals (Bolt 003)", () => {
  let state: PersonaState;

  const makePersona = (name: string, id?: string): PersonaEntity => ({
    id: id ?? `${name.toLowerCase()}-id`,
    display_name: name,
    entity: "system",
    aliases: [name],
    short_description: `${name} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  });

  const makeObservationInput = (
    overrides: Partial<Omit<PersonaObservation, "id">> = {}
  ): Omit<PersonaObservation, "id"> => ({
    subject_person_id: "person-1",
    subject_persona_id: "witness-id",
    observer_kind: "other_persona",
    observer_persona_id: "beta-id",
    message_id: "message-1",
    quote_id: "quote-1",
    observed_at: "2026-08-11T00:00:00.000Z",
    dimension: "behavior",
    direction: "novel",
    claim: "Consistently terse conversational tone.",
    extraction_confidence: 0.8,
    ...overrides,
  });

  const makeSignal = (
    overrides: Partial<Omit<EmergentSignal, "id">> = {}
  ): Omit<EmergentSignal, "id"> => ({
    subject_persona_id: "witness-id",
    claim: "Consistently terse conversational tone.",
    dimension: "behavior",
    status: "candidate",
    evidence_ids: [],
    first_observed_at: "2026-08-11T00:00:00.000Z",
    last_observed_at: "2026-08-11T00:00:00.000Z",
    observer_kinds: ["other_persona"],
    recurrence_count: 1,
    supersedes_signal_id: "prior-dismissed-signal-id",
    last_surfaced_at: null,
    reviewed_by: { actor: "human:flare576", timestamp: "2026-08-11T01:00:00.000Z" },
    dismissed_by: { actor: "beta-id", timestamp: "2026-08-11T02:00:00.000Z" },
    ...overrides,
  });

  beforeEach(() => {
    state = new PersonaState();
  });

  describe("R1/AT1 — observation and signal creation, persistence, and read-back", () => {
    it("mints a stable observation id and persists it at observations", () => {
      const persona = makePersona("Witness");
      state.add(persona);

      const observation = state.observation_add(persona.id, makeObservationInput());

      expect(observation).not.toBeNull();
      expect(typeof observation!.id).toBe("string");
      expect(observation!.id.length).toBeGreaterThan(0);
      expect(state.observations_get(persona.id)).toEqual([observation]);
    });

    it("promotes an observation to a persona-lens EmergentSignal whose evidence_ids resolves against the observation's id, never its message_id/quote_id", () => {
      const persona = makePersona("Witness");
      state.add(persona);
      const observation = state.observation_add(persona.id, makeObservationInput())!;

      const signalInput = makeSignal({ evidence_ids: [observation.id] });
      const added = state.signal_add(persona.id, "persona", signalInput);

      expect(added).not.toBeNull();
      expect(typeof added!.id).toBe("string");
      expect(added!.id.length).toBeGreaterThan(0);
      const signals = state.signals_get(persona.id);
      expect(signals.persona).toEqual([added]);
      expect(signals.agent).toEqual([]);
      expect(signals.persona[0].evidence_ids).toContain(observation.id);
      expect(signals.persona[0].evidence_ids).not.toContain(observation.message_id);
      expect(signals.persona[0].evidence_ids).not.toContain(observation.quote_id);
    });

    it("persists an agent-lens signal at signals.agent, distinct from signals.persona, with every D3 audit field intact", () => {
      const persona = makePersona("Witness");
      state.add(persona);
      const observation = state.observation_add(
        persona.id,
        makeObservationInput({ dimension: "behavior", claim: "Verified test-writing discipline observed in a CD2+ transcript." })
      )!;

      const signalInput = makeSignal({
        evidence_ids: [observation.id],
        claim: observation.claim,
        status: "reviewed",
        reviewed_by: { actor: "human:flare576", timestamp: "2026-08-11T03:00:00.000Z" },
        dismissed_by: undefined,
        supersedes_signal_id: undefined,
        last_surfaced_at: "2026-08-10T12:00:00.000Z",
      });
      const added = state.signal_add(persona.id, "agent", signalInput);

      expect(added).not.toBeNull();
      const signals = state.signals_get(persona.id);
      expect(signals.agent).toEqual([added]);
      expect(signals.persona).toEqual([]);
      expect(signals.agent[0].reviewed_by).toEqual({ actor: "human:flare576", timestamp: "2026-08-11T03:00:00.000Z" });
      expect(signals.agent[0].dismissed_by).toBeUndefined();
      expect(signals.agent[0].last_surfaced_at).toBe("2026-08-10T12:00:00.000Z");
    });

    it("observation_add/signal_add are silent no-ops for a persona that does not exist; observations_get/signals_get default to empty collections", () => {
      expect(state.observation_add("no-such-persona", makeObservationInput())).toBeNull();
      expect(state.signal_add("no-such-persona", "persona", makeSignal())).toBeNull();
      expect(state.observations_get("no-such-persona")).toEqual([]);
      expect(state.signals_get("no-such-persona")).toEqual({ persona: [], agent: [] });
    });


    it("a brand-new persona starts with empty observations and signals collections", () => {
      const persona = makePersona("Fresh");
      state.add(persona);

      expect(state.observations_get(persona.id)).toEqual([]);
      expect(state.signals_get(persona.id)).toEqual({ persona: [], agent: [] });
    });
  });

  describe("R3/AT3 — a generic full-record Persona correction cannot touch observations or signals", () => {
    const populate = (personaId: string) => {
      const observation = state.observation_add(personaId, makeObservationInput())!;
      const personaSignal = makeSignal({ evidence_ids: [observation.id] });
      const agentSignal = makeSignal({ evidence_ids: [observation.id], subject_persona_id: personaId, claim: "Agent claim" });
      state.signal_add(personaId, "persona", personaSignal);
      state.signal_add(personaId, "agent", agentSignal);
      return {
        observations: state.observations_get(personaId),
        signals: state.signals_get(personaId),
      };
    };

    it("PersonaState.update() (a patch op) changes the entity but leaves observations/signals byte-for-byte unchanged", () => {
      const persona = makePersona("Populated");
      state.add(persona);
      const before = populate(persona.id);

      const patched = state.update(persona.id, { short_description: "Patched via update()" });

      expect(patched).toBe(true);
      expect(state.getById(persona.id)?.short_description).toBe("Patched via update()");
      expect(state.observations_get(persona.id)).toEqual(before.observations);
      expect(state.signals_get(persona.id)).toEqual(before.signals);
    });

    it("PersonaState.replace() (a full-record replace op) swaps the entity wholesale but leaves observations/signals byte-for-byte unchanged", () => {
      const persona = makePersona("Populated");
      state.add(persona);
      const before = populate(persona.id);

      const replacement = makePersona("Replaced", persona.id);
      const replaced = state.replace(persona.id, replacement);

      expect(replaced).toBe(true);
      expect(state.getById(persona.id)?.display_name).toBe("Replaced");
      expect(state.observations_get(persona.id)).toEqual(before.observations);
      expect(state.signals_get(persona.id)).toEqual(before.signals);
    });

    it("applyCorrectionToPersonas — the corrections-queue's own upsert write path — replaces the entity but leaves populated observations/signals untouched (D2 holds under the existing write path, not just by convention)", async () => {
      const persona = makePersona("QueuedPopulated");
      const observation: PersonaObservation = { id: "observation-1", ...makeObservationInput() };
      const personaSignal: EmergentSignal = { id: "signal-1", ...makeSignal({ evidence_ids: [observation.id] }) };
      const personas: StorageState["personas"] = {
        [persona.id]: {
          entity: persona,
          messages: [],
          observations: [observation],
          signals: { persona: [personaSignal], agent: [] },
        },
      };

      await applyCorrectionToPersonas(personas, {
        op: "upsert",
        entity_type: "persona",
        id: persona.id,
        record: { ...persona, short_description: "Replaced wholesale via corrections queue" },
        timestamp: "2026-08-11T04:00:00.000Z",
      });

      expect(personas[persona.id].entity.short_description).toBe("Replaced wholesale via corrections queue");
      expect(personas[persona.id].observations).toEqual([observation]);
      expect(personas[persona.id].signals).toEqual({ persona: [personaSignal], agent: [] });
    });

    it("applyCorrectionToPersonas — the corrections-queue's own patch write path — merges the entity but leaves populated observations/signals untouched", async () => {
      const persona = makePersona("QueuedPatched");
      const observation: PersonaObservation = { id: "observation-2", ...makeObservationInput() };
      const agentSignal: EmergentSignal = { id: "signal-2", ...makeSignal({ evidence_ids: [observation.id] }) };
      const personas: StorageState["personas"] = {
        [persona.id]: {
          entity: persona,
          messages: [],
          observations: [observation],
          signals: { persona: [], agent: [agentSignal] },
        },
      };

      await applyCorrectionToPersonas(personas, {
        op: "patch",
        entity_type: "persona",
        id: persona.id,
        patch: { short_description: "Patched via corrections queue" },
        timestamp: "2026-08-11T05:00:00.000Z",
      });

      expect(personas[persona.id].entity.short_description).toBe("Patched via corrections queue");
      expect(personas[persona.id].observations).toEqual([observation]);
      expect(personas[persona.id].signals).toEqual({ persona: [], agent: [agentSignal] });
    });
  });

  describe("R4/AT4 — signal_add validates evidence_ids against the persona's own observations, and deep-copies at both write and read boundaries", () => {
    it("rejects a message_id, a quote_id, an unknown string, and another persona's own observation id as evidence, leaving both buckets unchanged", () => {
      const persona = makePersona("Witness");
      const otherPersona = makePersona("Other", "other-id");
      state.add(persona);
      state.add(otherPersona);

      const observation = state.observation_add(persona.id, makeObservationInput())!;
      const otherObservation = state.observation_add(otherPersona.id, makeObservationInput())!;

      const invalidEvidenceIds = [
        observation.message_id,
        observation.quote_id!,
        "unknown-evidence-id",
        otherObservation.id,
      ];

      for (const evidenceId of invalidEvidenceIds) {
        const rejected = state.signal_add(persona.id, "persona", makeSignal({ evidence_ids: [evidenceId] }));
        expect(rejected).toBeNull();
      }

      expect(state.signals_get(persona.id)).toEqual({ persona: [], agent: [] });
      expect(state.observations_get(persona.id)).toEqual([observation]);
    });

    it("accepts a valid signal, then is immune to later mutation of the caller's original input object or of a signals_get()-returned value", () => {
      const persona = makePersona("Witness");
      state.add(persona);
      const observation = state.observation_add(persona.id, makeObservationInput())!;

      const input = makeSignal({ evidence_ids: [observation.id] });
      const added = state.signal_add(persona.id, "persona", input);
      expect(added).not.toBeNull();
      const expectedClaim = added!.claim;
      const expectedEvidenceIds = [...added!.evidence_ids];
      const expectedObserverKinds = [...added!.observer_kinds];

      // Mutate the caller's original input object after the write landed.
      input.claim = "mutated after write";
      input.evidence_ids.push("injected-id");
      input.observer_kinds.push("human");

      // Mutate a value obtained from signals_get().
      const readBack = state.signals_get(persona.id);
      readBack.persona[0].claim = "mutated via signals_get";
      readBack.persona[0].evidence_ids.push("injected-via-read");
      readBack.persona[0].observer_kinds.push("human");

      const persisted = state.signals_get(persona.id);
      expect(persisted.persona[0].claim).toBe(expectedClaim);
      expect(persisted.persona[0].evidence_ids).toEqual(expectedEvidenceIds);
      expect(persisted.persona[0].observer_kinds).toEqual(expectedObserverKinds);
    });
  });
});

// =============================================================================
// Bolt: persona-emergence-signals-004 (Observation→Signal reducer pipeline).
// Update/Reduce (D4/D9, step 3) and Validate's write primitive (D5, step 4)
// — promotion arithmetic is a state-transition behavior of the Bolt 003
// schema, so it lands in this same file per §4.8/§4.17's own test-coverage
// note, as new sibling describe blocks rather than a new file.
// =============================================================================

describe("PersonaState.signal_reduce — Update/Reduce promotion arithmetic (Bolt 004, D4/D9, AT5/AT8)", () => {
  let state: PersonaState;
  const SUBJECT_ID = "witness-id";

  const persona = (): PersonaEntity => ({
    id: SUBJECT_ID,
    display_name: "Witness",
    entity: "system",
    aliases: ["Witness"],
    short_description: "Witness description",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  });

  function addObservation(overrides: Partial<Omit<PersonaObservation, "id">>): PersonaObservation {
    return state.observation_add(SUBJECT_ID, {
      subject_person_id: "person-1",
      subject_persona_id: SUBJECT_ID,
      observer_kind: "human",
      message_id: `message-${crypto.randomUUID()}`,
      observed_at: "2026-08-11T00:00:00.000Z",
      dimension: "behavior",
      direction: "novel",
      claim: "Consistently terse conversational tone.",
      extraction_confidence: 0.8,
      ...overrides,
    })!;
  }

  beforeEach(() => {
    state = new PersonaState();
    state.add(persona());
  });

  it("AT5(a)/AT8(a): five same-context mentions from one observer do NOT promote to recurring", () => {
    const first = addObservation({ observed_at: "2026-08-11T01:00:00.000Z" });
    const created = state.signal_reduce(SUBJECT_ID, "persona", first, "new")!;
    expect(created.outcome).toBe("created");
    let signalId = created.signal.id;

    for (let i = 0; i < 4; i++) {
      const obs = addObservation({ observed_at: `2026-08-11T0${2 + i}:00:00.000Z` });
      const result = state.signal_reduce(SUBJECT_ID, "persona", obs, signalId)!;
      expect(result.outcome).toBe("attached");
      signalId = result.signal.id;
    }

    const finalSignal = state.signals_get(SUBJECT_ID).persona.find(s => s.id === signalId)!;
    expect(finalSignal.status).toBe("candidate");
    expect(finalSignal.recurrence_count).toBe(1);
    expect(finalSignal.evidence_ids).toHaveLength(5);
  });

  it("AT5(b)/AT8(b): two independent-context mentions promote a behavior/voice claim to recurring", () => {
    const first = addObservation({ observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    const created = state.signal_reduce(SUBJECT_ID, "persona", first, "new")!;
    const second = addObservation({ observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-08-05T00:00:00.000Z" });
    const attached = state.signal_reduce(SUBJECT_ID, "persona", second, created.signal.id)!;

    expect(attached.outcome).toBe("attached");
    expect(attached.signal.status).toBe("recurring");
    expect(attached.signal.recurrence_count).toBe(2);
  });

  it("AT5(e)/AT8(e): the SAME two-independent-observer evidence set promotes a behavior claim but leaves an identity claim at candidate", () => {
    const behaviorFirst = addObservation({ dimension: "behavior", claim: "Behavior claim.", observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    const behaviorCreated = state.signal_reduce(SUBJECT_ID, "persona", behaviorFirst, "new")!;
    const behaviorSecond = addObservation({ dimension: "behavior", claim: "Behavior claim.", observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-08-05T00:00:00.000Z" });
    const behaviorAttached = state.signal_reduce(SUBJECT_ID, "persona", behaviorSecond, behaviorCreated.signal.id)!;

    const identityFirst = addObservation({ dimension: "identity", claim: "Identity claim.", observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    const identityCreated = state.signal_reduce(SUBJECT_ID, "persona", identityFirst, "new")!;
    const identitySecond = addObservation({ dimension: "identity", claim: "Identity claim.", observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-08-05T00:00:00.000Z" });
    const identityAttached = state.signal_reduce(SUBJECT_ID, "persona", identitySecond, identityCreated.signal.id)!;

    expect(behaviorAttached.signal.status).toBe("recurring");
    expect(identityAttached.signal.status).toBe("candidate");
  });

  it("AT-R16 #1 (reinforcing evidence): a same-context observation attached to an already-recurring signal leaves recurrence_count/status unchanged", () => {
    const a = addObservation({ observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    const created = state.signal_reduce(SUBJECT_ID, "persona", a, "new")!;
    const b = addObservation({ observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-08-05T00:00:00.000Z" });
    const recurring = state.signal_reduce(SUBJECT_ID, "persona", b, created.signal.id)!;
    expect(recurring.signal.status).toBe("recurring");
    expect(recurring.signal.recurrence_count).toBe(2);

    // A third observation restating the claim from the SAME context as `b` — no new independence.
    const reinforcing = addObservation({ observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-08-05T12:00:00.000Z" });
    const reinforced = state.signal_reduce(SUBJECT_ID, "persona", reinforcing, recurring.signal.id)!;
    expect(reinforced.outcome).toBe("attached");
    expect(reinforced.signal.status).toBe("recurring");
    expect(reinforced.signal.recurrence_count).toBe(2);
    expect(reinforced.signal.evidence_ids).toHaveLength(3);
  });

  it("AT-R16 #3 (self-report alone): a single subject_self observation with no corroborating observer stays at candidate", () => {
    const selfReport = addObservation({ observer_kind: "subject_self", observed_at: "2026-08-01T00:00:00.000Z" });
    const created = state.signal_reduce(SUBJECT_ID, "persona", selfReport, "new")!;
    expect(created.outcome).toBe("created");
    expect(created.signal.status).toBe("candidate");
    expect(created.signal.recurrence_count).toBe(1);
  });

  it("AT-R16 #5 (contradictory evidence): a direction:'challenges' observation is recorded as its own new evidence entry without overwriting the prior claim", () => {
    const original = addObservation({ direction: "novel", observed_at: "2026-08-01T00:00:00.000Z" });
    const created = state.signal_reduce(SUBJECT_ID, "persona", original, "new")!;
    const originalClaim = created.signal.claim;

    const challenge = addObservation({ direction: "challenges", observed_at: "2026-08-05T00:00:00.000Z", observer_kind: "other_persona", observer_persona_id: "beta-id" });
    const afterChallenge = state.signal_reduce(SUBJECT_ID, "persona", challenge, created.signal.id)!;

    expect(afterChallenge.outcome).toBe("attached");
    expect(afterChallenge.signal.claim).toBe(originalClaim);
    expect(afterChallenge.signal.evidence_ids).toContain(original.id);
    expect(afterChallenge.signal.evidence_ids).toContain(challenge.id);
    expect(afterChallenge.signal.evidence_ids).toHaveLength(2);
  });

  it("AT5(c): a dismissed signal with a verbatim-replay follow-up (same claim, same context) stays dismissed — no new signal created", () => {
    const dismissed = state.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID,
      claim: "Consistently terse conversational tone.",
      dimension: "behavior",
      status: "dismissed",
      evidence_ids: [],
      first_observed_at: "2026-08-01T00:00:00.000Z",
      last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"],
      recurrence_count: 1,
    })!;
    const priorEvidence = addObservation({ observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    // Attach the prior evidence directly onto the dismissed signal's own
    // record (simulating it already having this context on file) via a
    // fresh signal_add-equivalent write — signal_reduce itself never
    // writes to a dismissed signal, so this fixture step models history
    // that predates dismissal.
    dismissed.evidence_ids.push(priorEvidence.id);

    const replay = addObservation({ observer_kind: "human", observed_at: "2026-08-01T18:00:00.000Z" });
    const result = state.signal_reduce(SUBJECT_ID, "persona", replay, "new")!;

    expect(result.outcome).toBe("stayed_dismissed");
    expect(result.signal.id).toBe(dismissed.id);
    const stillDismissed = state.signals_get(SUBJECT_ID).persona.find(s => s.id === dismissed.id)!;
    expect(stillDismissed.status).toBe("dismissed");
    expect(stillDismissed.evidence_ids).not.toContain(replay.id);
  });

  it("AT5(d): a dismissed signal with a materially-new-context follow-up reopens as a new candidate citing the dismissed signal, which itself becomes superseded", () => {
    const dismissed = state.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID,
      claim: "Consistently terse conversational tone.",
      dimension: "behavior",
      status: "dismissed",
      evidence_ids: [],
      first_observed_at: "2026-08-01T00:00:00.000Z",
      last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"],
      recurrence_count: 1,
    })!;
    const priorEvidence = addObservation({ observer_kind: "human", observed_at: "2026-08-01T00:00:00.000Z" });
    dismissed.evidence_ids.push(priorEvidence.id);

    const newContext = addObservation({ observer_kind: "other_persona", observer_persona_id: "beta-id", observed_at: "2026-09-15T00:00:00.000Z" });
    const result = state.signal_reduce(SUBJECT_ID, "persona", newContext, "new")!;

    expect(result.outcome).toBe("reopened");
    expect(result.supersededSignalId).toBe(dismissed.id);
    expect(result.signal.id).not.toBe(dismissed.id);
    expect(result.signal.status).toBe("candidate");
    expect(result.signal.supersedes_signal_id).toBe(dismissed.id);
    expect(result.signal.evidence_ids).toEqual([newContext.id]);

    const afterReopen = state.signals_get(SUBJECT_ID).persona.find(s => s.id === dismissed.id)!;
    expect(afterReopen.status).toBe("superseded");
    // The reopened dismissed signal is never mutated beyond status — its
    // own id and evidence trail survive so the supersession is traceable.
    expect(afterReopen.id).toBe(dismissed.id);
    expect(afterReopen.evidence_ids).toEqual([priorEvidence.id]);
  });

  it("rejects (null) when matchDecision names a dismissed/reviewed/superseded signal's id — never silently attaches to a closed signal", () => {
    const dismissed = state.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "X", dimension: "behavior", status: "dismissed",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const observation = addObservation({});
    expect(state.signal_reduce(SUBJECT_ID, "persona", observation, dismissed.id)).toBeNull();
  });

  it("is a silent no-op (null) for a persona that doesn't exist", () => {
    const orphanObservation: PersonaObservation = { id: "orphan", subject_person_id: "p", subject_persona_id: "nope", observer_kind: "human", message_id: "m", observed_at: "2026-08-01T00:00:00.000Z", dimension: "behavior", direction: "novel", claim: "x", extraction_confidence: 0.5 };
    expect(state.signal_reduce("no-such-persona", "persona", orphanObservation, "new")).toBeNull();
  });
});

describe("PersonaState.signal_merge — Validate's write primitive (Bolt 004, D5)", () => {
  let state: PersonaState;
  const SUBJECT_ID = "witness-id";

  beforeEach(() => {
    state = new PersonaState();
    state.add({
      id: SUBJECT_ID, display_name: "Witness", entity: "system", aliases: ["Witness"],
      short_description: "d", traits: [], topics: [], is_paused: false, is_archived: false,
      is_static: false, last_updated: new Date().toISOString(),
    });
  });

  function addSignal(overrides: Partial<Omit<EmergentSignal, "id">> = {}): EmergentSignal {
    return state.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID,
      claim: "A claim.",
      dimension: "behavior",
      status: "candidate",
      evidence_ids: [],
      first_observed_at: "2026-08-01T00:00:00.000Z",
      last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"],
      recurrence_count: 1,
      ...overrides,
    })!;
  }

  it("merges evidence_ids/observer_kinds and widens the observed_at range, then drops the merged-away signal", () => {
    const obs1 = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "human",
      message_id: "m1", observed_at: "2026-08-05T00:00:00.000Z", dimension: "behavior",
      direction: "novel", claim: "A claim.", extraction_confidence: 0.8,
    })!;
    const obs2 = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "other_persona", observer_persona_id: "beta-id",
      message_id: "m2", observed_at: "2026-08-01T00:00:00.000Z", dimension: "behavior",
      direction: "novel", claim: "A claim.", extraction_confidence: 0.8,
    })!;
    const keep = addSignal({ evidence_ids: [obs1.id], first_observed_at: "2026-08-05T00:00:00.000Z", last_observed_at: "2026-08-05T00:00:00.000Z", observer_kinds: ["human"] });
    const merge = addSignal({ evidence_ids: [obs2.id], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-10T00:00:00.000Z", observer_kinds: ["other_persona"] });

    const result = state.signal_merge(SUBJECT_ID, "persona", keep.id, merge.id);

    expect(result).not.toBeNull();
    expect(result!.evidence_ids.sort()).toEqual([obs1.id, obs2.id].sort());
    expect(result!.observer_kinds.sort()).toEqual(["human", "other_persona"]);
    expect(result!.first_observed_at).toBe("2026-08-01T00:00:00.000Z");
    expect(result!.last_observed_at).toBe("2026-08-10T00:00:00.000Z");

    const remaining = state.signals_get(SUBJECT_ID).persona;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).toBe(keep.id);
  });

  it("promotes the surviving candidate signal when the merged evidence clears the independence bar", () => {
    const obs1 = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "human",
      message_id: "m1", observed_at: "2026-08-05T00:00:00.000Z", dimension: "voice",
      direction: "novel", claim: "A claim.", extraction_confidence: 0.8,
    })!;
    const obs2 = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "other_persona", observer_persona_id: "beta-id",
      message_id: "m2", observed_at: "2026-09-01T00:00:00.000Z", dimension: "voice",
      direction: "novel", claim: "A claim.", extraction_confidence: 0.8,
    })!;
    const keep = addSignal({ dimension: "voice", evidence_ids: [obs1.id] });
    const merge = addSignal({ dimension: "voice", evidence_ids: [obs2.id] });
    const result = state.signal_merge(SUBJECT_ID, "persona", keep.id, merge.id)!;
    expect(result.status).toBe("recurring");
  });

  it("evidence referencing an observation that no longer resolves is silently excluded from the independence count (never promotes on unresolvable evidence)", () => {
    const keep = addSignal({ dimension: "voice", evidence_ids: [] });
    const merge = addSignal({ dimension: "voice", evidence_ids: [] });
    const result = state.signal_merge(SUBJECT_ID, "persona", keep.id, merge.id)!;
    expect(result.status).toBe("candidate");
  });

  it("refuses (null, no mutation) when either id names a dismissed signal", () => {
    const candidate = addSignal();
    const dismissed = addSignal({ status: "dismissed" });
    const before = state.signals_get(SUBJECT_ID).persona;

    expect(state.signal_merge(SUBJECT_ID, "persona", candidate.id, dismissed.id)).toBeNull();
    expect(state.signal_merge(SUBJECT_ID, "persona", dismissed.id, candidate.id)).toBeNull();
    expect(state.signals_get(SUBJECT_ID).persona).toEqual(before);
  });

  it("refuses (null) for an unknown id or identical keep/merge ids", () => {
    const candidate = addSignal();
    expect(state.signal_merge(SUBJECT_ID, "persona", candidate.id, "no-such-id")).toBeNull();
    expect(state.signal_merge(SUBJECT_ID, "persona", candidate.id, candidate.id)).toBeNull();
  });

  it("ReviewBolt004 P1: refuses (null, no mutation) a cross-dimension merge — a behavior claim's evidence can never be laundered into an identity signal's (lower) threshold, and the identity claim is never silently destroyed", () => {
    const behaviorKeep = addSignal({ dimension: "behavior", claim: "Terse tone." });
    const identityMerge = addSignal({ dimension: "identity", claim: "Deeply values precision." });
    const before = state.signals_get(SUBJECT_ID).persona;

    const result = state.signal_merge(SUBJECT_ID, "persona", behaviorKeep.id, identityMerge.id);

    expect(result).toBeNull();
    expect(state.signals_get(SUBJECT_ID).persona).toEqual(before);
    expect(state.signals_get(SUBJECT_ID).persona.find(s => s.id === identityMerge.id)).toBeDefined();
  });

  it("D13/R8/AT8(d): refuses a cross-dimension merge in the OTHER direction too — evidence, recurrence_count, and status are unchanged on both signals either way", () => {
    const obsA = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "human",
      message_id: "m-a", observed_at: "2026-08-01T00:00:00.000Z", dimension: "identity",
      direction: "novel", claim: "Deeply values precision.", extraction_confidence: 0.8,
    })!;
    const obsB = state.observation_add(SUBJECT_ID, {
      subject_person_id: "p", subject_persona_id: SUBJECT_ID, observer_kind: "human",
      message_id: "m-b", observed_at: "2026-08-01T00:00:00.000Z", dimension: "behavior",
      direction: "novel", claim: "Terse tone.", extraction_confidence: 0.8,
    })!;
    const identityKeep = addSignal({ dimension: "identity", claim: "Deeply values precision.", evidence_ids: [obsA.id], recurrence_count: 3 });
    const behaviorMerge = addSignal({ dimension: "behavior", claim: "Terse tone.", evidence_ids: [obsB.id], recurrence_count: 2 });
    const before = state.signals_get(SUBJECT_ID).persona;

    const result = state.signal_merge(SUBJECT_ID, "persona", identityKeep.id, behaviorMerge.id);

    expect(result).toBeNull();
    expect(state.signals_get(SUBJECT_ID).persona).toEqual(before);
    const keepAfter = state.signals_get(SUBJECT_ID).persona.find(s => s.id === identityKeep.id)!;
    const mergeAfter = state.signals_get(SUBJECT_ID).persona.find(s => s.id === behaviorMerge.id)!;
    expect(keepAfter.evidence_ids).toEqual([obsA.id]);
    expect(keepAfter.recurrence_count).toBe(3);
    expect(keepAfter.status).toBe("candidate");
    expect(mergeAfter.evidence_ids).toEqual([obsB.id]);
    expect(mergeAfter.recurrence_count).toBe(2);
    expect(mergeAfter.status).toBe("candidate");
  });


  it("is a silent no-op (null) for a persona that doesn't exist", () => {
    expect(state.signal_merge("no-such-persona", "persona", "a", "b")).toBeNull();
  });
});

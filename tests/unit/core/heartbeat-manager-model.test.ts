import { describe, it, expect, vi } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import {
  getModelForPersona,
  getOneshotModel,
  assembleHeartbeatSignalCandidates,
  queueEiHeartbeat,
  queueHeartbeatCheck,
} from "../../../src/core/heartbeat-manager.js";
import { handleEiHeartbeat } from "../../../src/core/handlers/heartbeat.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import { LLMNextStep, ContextStatus } from "../../../src/core/types.js";
import type { PersonaEntity, StorageState, EmergentSignal, LLMResponse, Message } from "../../../src/core/types.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop
// (same shim as tests/unit/core/state-manager.test.ts) -- this file
// exercises heartbeat-manager/StateManager, not the schema library.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

const GUID = "11111111-1111-1111-1111-111111111111";
const CONV_GUID = "22222222-2222-2222-2222-222222222222";

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "p1",
    display_name: "Persona One",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

async function makeStateManager(): Promise<StateManager> {
  const sm = new StateManager();
  const storage = createMockStorage();
  vi.mocked(storage.load).mockResolvedValue(null);
  await sm.initialize(storage);
  return sm;
}

describe("getModelForPersona", () => {
  it("persona.model wins over settings.conversation_model", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1", model: "Persona:override" }));
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm, "p1")).toBe("Persona:override");
  });

  it("falls back to settings.conversation_model when persona.model unset", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm, "p1")).toBe(CONV_GUID);
  });

  it("with no personaId, returns settings.conversation_model directly", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, conversation_model: CONV_GUID } });

    expect(getModelForPersona(sm)).toBe(CONV_GUID);
  });

  it("backward-read: old-shape state (only default_model set, pre-migration) still resolves via migrated conversation_model", async () => {
    // Simulate a pre-migration backup/sync-pull restore: only `default_model` on disk.
    const sm = new StateManager();
    await sm.initialize(createMockStorage()); // fresh load, no saved data

    const restoredState: StorageState = createDefaultTestState();
    restoredState.human.settings = { default_model: GUID };
    restoredState.personas = {
      p1: {
        entity: makePersona({ id: "p1" }),
        messages: [],
      } as unknown as StorageState["personas"][string],
    };

    sm.restoreFromState(restoredState);

    // runMigrations() (invoked by restoreFromState) backfills conversation_model
    // from the legacy default_model before any read site ever sees settings.
    expect(sm.getHuman().settings?.conversation_model).toBe(GUID);
    expect(getModelForPersona(sm, "p1")).toBe(GUID);
    expect(getModelForPersona(sm)).toBe(GUID);
  });
});

describe("getOneshotModel", () => {
  it("oneshot_model wins over settings.conversation_model", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, oneshot_model: "Oneshot:special", conversation_model: CONV_GUID },
    });

    expect(getOneshotModel(sm)).toBe("Oneshot:special");
  });

  it("falls back to settings.conversation_model when oneshot_model unset", async () => {
    const sm = await makeStateManager();
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, oneshot_model: undefined, conversation_model: CONV_GUID } });

    expect(getOneshotModel(sm)).toBe(CONV_GUID);
  });

  it("backward-read: old-shape state (only default_model set) still resolves a usable oneshot model", async () => {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());

    const restoredState: StorageState = createDefaultTestState();
    restoredState.human.settings = { default_model: GUID };
    sm.restoreFromState(restoredState);

    expect(getOneshotModel(sm)).toBe(GUID);
  });
});

function makeSignalInput(overrides: Partial<Omit<EmergentSignal, "id">> = {}): Omit<EmergentSignal, "id"> {
  return {
    subject_persona_id: "p1",
    claim: "Consistently terse in the mornings.",
    dimension: "behavior",
    status: "candidate",
    evidence_ids: [],
    first_observed_at: "2026-08-01T00:00:00.000Z",
    last_observed_at: "2026-08-01T00:00:00.000Z",
    observer_kinds: ["human"],
    recurrence_count: 1,
    ...overrides,
  };
}

describe("assembleHeartbeatSignalCandidates (Bolt 005, D2/D4, R2/AT2)", () => {
  it("stamps last_surfaced_at on inclusion, then excludes the same signal from the very next assembly with no new evidence", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    // identity/recurrence_count: 2 -- inside the D6 gentle-surface band, since
    // this describe block exercises cooldown/resurfacing, not the band itself.
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    try {
      const first = assembleHeartbeatSignalCandidates(sm, "p1");
      expect(first.map((s) => s.id)).toEqual([added.id]);
      expect(sm.signals_get("p1").persona[0].last_surfaced_at).toBe("2026-08-11T00:00:00.000Z");

      vi.setSystemTime(new Date("2026-08-11T01:00:00.000Z"));
      const second = assembleHeartbeatSignalCandidates(sm, "p1");
      expect(second).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("re-includes the signal once last_observed_at moves past last_surfaced_at (new evidence arrived)", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    const obsA = sm.observation_add("p1", {
      subject_person_id: "person-1",
      subject_persona_id: "p1",
      observer_kind: "human",
      message_id: "message-a",
      observed_at: "2026-08-01T00:00:00.000Z",
      dimension: "identity",
      direction: "novel",
      claim: "Consistently values directness.",
      extraction_confidence: 0.8,
    })!;
    const obsB = sm.observation_add("p1", {
      subject_person_id: "person-1",
      subject_persona_id: "p1",
      observer_kind: "human",
      message_id: "message-b",
      observed_at: "2026-08-11T00:00:00.000Z",
      dimension: "identity",
      direction: "confirms",
      claim: "Consistently values directness.",
      extraction_confidence: 0.8,
    })!;
    // Two independent evidence contexts (2026-08-01, 2026-08-11) up front so
    // the signal is already inside the D6 gentle-surface band before the
    // first assembly -- identity's own promotion threshold is 3, so this
    // stays "candidate".
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({
        dimension: "identity",
        recurrence_count: 2,
        evidence_ids: [obsA.id, obsB.id],
        first_observed_at: "2026-08-01T00:00:00.000Z",
        last_observed_at: "2026-08-11T00:00:00.000Z",
      })
    )!;

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-11T00:00:00.000Z"));
    try {
      assembleHeartbeatSignalCandidates(sm, "p1"); // surfaces + stamps last_surfaced_at

      vi.setSystemTime(new Date("2026-08-11T01:00:00.000Z"));
      expect(assembleHeartbeatSignalCandidates(sm, "p1")).toEqual([]); // still in cooldown

      // New reinforcing evidence arrives in the SAME context as obsB (same
      // witness, same day) -- grows evidence_ids and moves last_observed_at
      // forward without changing the independent-context count, so
      // recurrence_count stays 2 and status stays "candidate" (D9's
      // "reinforcing evidence -> no signal change"; identity's own
      // promotion threshold is 3).
      const observation = sm.observation_add("p1", {
        subject_person_id: "person-1",
        subject_persona_id: "p1",
        observer_kind: "human",
        message_id: "message-c",
        observed_at: "2026-08-11T02:00:00.000Z",
        dimension: "identity",
        direction: "confirms",
        claim: "Consistently values directness.",
        extraction_confidence: 0.8,
      })!;
      sm.signal_reduce("p1", "persona", observation, added.id);
      expect(sm.signals_get("p1").persona[0].recurrence_count).toBe(2);
      expect(sm.signals_get("p1").persona[0].status).toBe("candidate");

      vi.setSystemTime(new Date("2026-08-11T03:00:00.000Z"));
      const third = assembleHeartbeatSignalCandidates(sm, "p1");
      expect(third.map((s) => s.id)).toEqual([added.id]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("assembleHeartbeatSignalCandidates (Bolt 005, D6, R4/AT4)", () => {
  it("excludes and does not stamp a raw one-observation candidate (recurrence_count === 1)", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "behavior", recurrence_count: 1 })
    )!;

    const result = assembleHeartbeatSignalCandidates(sm, "p1");

    expect(result).toEqual([]);
    expect(sm.signals_get("p1").persona[0].last_surfaced_at).toBeUndefined();
  });

  it("returns and stamps an identity-dimension candidate inside the gentle-surface band (recurrence_count === 2)", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    const result = assembleHeartbeatSignalCandidates(sm, "p1");

    expect(result.map((s) => s.id)).toEqual([added.id]);
    expect(sm.signals_get("p1").persona[0].last_surfaced_at).toBeDefined();
  });

  it("excludes a recurring signal regardless of recurrence_count", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", status: "recurring", recurrence_count: 5 })
    )!;

    const result = assembleHeartbeatSignalCandidates(sm, "p1");

    expect(result).toEqual([]);
  });

  it("excludes equality-boundary candidates in every dimension and leaves them unstamped", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    const identity = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 3 })
    )!;
    const behavior = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "behavior", recurrence_count: 2 })
    )!;
    const voice = sm.signal_add(
      "p1",
      "agent",
      makeSignalInput({ dimension: "voice", recurrence_count: 2 })
    )!;

    expect(assembleHeartbeatSignalCandidates(sm, "p1")).toEqual([]);
    const signals = sm.signals_get("p1");
    expect(signals.persona.find((signal) => signal.id === identity.id)?.last_surfaced_at).toBeUndefined();
    expect(signals.persona.find((signal) => signal.id === behavior.id)?.last_surfaced_at).toBeUndefined();
    expect(signals.agent.find((signal) => signal.id === voice.id)?.last_surfaced_at).toBeUndefined();
  });
});

// =============================================================================
// bolt-persona-emergence-signals-011 -- Ei Heartbeat Signal Candidate Producer
// =============================================================================

/** A recent human->persona message so `p1` is never picked up by
 * `queueEiHeartbeat`'s own "Inactive Persona" item (daysSince < 3) --
 * keeps these fixtures isolated to the Signal item type under test. */
function makeRecentHumanMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: "hi",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: ContextStatus.Default,
  };
}

describe("queueEiHeartbeat -- signal candidate producer (Bolt 011, R1/AT1)", () => {
  it("AT1: an eligible signal with zero ordinary items still enqueues a HandleEiHeartbeat request whose prompt contains the signal's id", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.messages_append("p1", makeRecentHumanMessage("msg-recent"));
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    const human = sm.getHuman();
    // facts/people/topics/pending-updates all empty by construction of
    // makeStateManager's default human/persona fixtures (AT1's own setup).
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);

    const activeItems = sm.queue_getAllActiveItems();
    expect(activeItems).toHaveLength(1);
    expect(activeItems[0].next_step).toBe(LLMNextStep.HandleEiHeartbeat);
    expect(`${activeItems[0].system}${activeItems[0].user}`).toContain(added.id);
  });
});

describe("handleEiHeartbeat -- signal choice end-to-end (Bolt 011, R2/AT2)", () => {
  it("AT2: selecting the enqueued signal's id with a my_response delivers the message exactly once", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "ei", display_name: "Ei", is_static: true }));
    sm.persona_add(makePersona({ id: "p1" }));
    sm.messages_append("p1", makeRecentHumanMessage("msg-recent"));
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    const human = sm.getHuman();
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);

    const request = sm.queue_claimHighest()!;
    expect(request.next_step).toBe(LLMNextStep.HandleEiHeartbeat);

    const beforeCount = sm.messages_get("ei").length;
    const response: LLMResponse = {
      request,
      success: true,
      content: null,
      parsed: {
        should_respond: true,
        id: added.id,
        my_response: "I noticed something about p1 -- want to talk about it?",
      },
    };

    handleEiHeartbeat(response, sm);

    const afterMessages = sm.messages_get("ei");
    expect(afterMessages).toHaveLength(beforeCount + 1);
    expect(afterMessages.at(-1)?.content).toBe(
      "I noticed something about p1 -- want to talk about it?"
    );
  });
});

describe("cross-surface cooldown-race resolution (Bolt 011, D3, R3/AT3)", () => {
  it("AT3: p1's own heartbeat check assembles first -- last_surfaced_at stamped once, Ei's heartbeat gets nothing to offer", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.messages_append("p1", makeRecentHumanMessage("msg-recent"));
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    // Same cycle: p1's own heartbeat check assembles first -- it stamps
    // and consumes the signal's cooldown.
    await queueHeartbeatCheck(sm, "p1", false);
    // ...then Ei's heartbeat assembles second, over every persona
    // including p1.
    const human = sm.getHuman();
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);

    // Stamped exactly once, by the first assembly to run.
    expect(sm.signals_get("p1").persona[0].last_surfaced_at).toBeDefined();

    const items = sm.queue_getAllActiveItems();
    const checkItem = items.find((i) => i.next_step === LLMNextStep.HandleHeartbeatCheck);
    const eiItem = items.find((i) => i.next_step === LLMNextStep.HandleEiHeartbeat);

    // Offered to the surface that ran first (p1's own heartbeat check)...
    expect(checkItem).toBeDefined();
    expect(`${checkItem!.system}${checkItem!.user}`).toContain(added.claim);
    // ...and excluded from the surface that ran second in the same cycle:
    // with the signal as the only possible item, Ei's heartbeat has
    // nothing left to offer and never enqueues at all -- not offered to
    // both.
    expect(eiItem).toBeUndefined();
  });

  it("AT3 (reversed): Ei's heartbeat assembles first -- last_surfaced_at stamped once, p1's own heartbeat check gets nothing to offer", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.messages_append("p1", makeRecentHumanMessage("msg-recent"));
    const added = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;

    // Same cycle, opposite order: Ei's heartbeat assembles first...
    const human = sm.getHuman();
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);
    // ...then p1's own heartbeat check assembles second.
    await queueHeartbeatCheck(sm, "p1", false);

    expect(sm.signals_get("p1").persona[0].last_surfaced_at).toBeDefined();

    const items = sm.queue_getAllActiveItems();
    const eiItem = items.find((i) => i.next_step === LLMNextStep.HandleEiHeartbeat);
    const checkItem = items.find((i) => i.next_step === LLMNextStep.HandleHeartbeatCheck);

    // Offered to the surface that ran first (Ei's heartbeat)...
    expect(eiItem).toBeDefined();
    expect(`${eiItem!.system}${eiItem!.user}`).toContain(added.id);
    // ...p1's own heartbeat check (running second) still enqueues
    // unconditionally (it has no "zero items" short-circuit), but its
    // Signals section must exclude the already-surfaced signal, not
    // re-offer it.
    expect(checkItem).toBeDefined();
    expect(`${checkItem!.system}${checkItem!.user}`).not.toContain(added.claim);
  });
});

describe("queueEiHeartbeat -- gentle-surface eligibility not widened (Bolt 011, R4/AT4)", () => {
  it("AT4: a recurrence_count:1 candidate never appears; an identity-dimension recurrence_count:2 candidate does", async () => {
    const sm = await makeStateManager();
    sm.persona_add(makePersona({ id: "p1" }));
    sm.messages_append("p1", makeRecentHumanMessage("msg-recent"));
    const belowFloor = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "behavior", recurrence_count: 1 })
    )!;

    const human = sm.getHuman();
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);

    // Below Bolt 005's own gentle-surface floor -- no eligible item at all,
    // so queueEiHeartbeat has nothing to enqueue yet.
    expect(sm.queue_getAllActiveItems()).toHaveLength(0);

    const eligible = sm.signal_add(
      "p1",
      "persona",
      makeSignalInput({ dimension: "identity", recurrence_count: 2 })
    )!;
    await queueEiHeartbeat(sm, human, [], false, 28800000, undefined);

    const items = sm.queue_getAllActiveItems();
    expect(items).toHaveLength(1);
    const text = `${items[0].system}${items[0].user}`;
    expect(text).not.toContain(belowFloor.id);
    expect(text).toContain(eligible.id);
  });
});


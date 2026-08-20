import { describe, it, expect, beforeEach, vi } from "vitest";
import { importOmpSessions } from "../../../../src/integrations/omp/importer.js";
import type { OmpSession, OmpTranscriptRecord } from "../../../../src/integrations/omp/types.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import { LLMNextStep, type PersonaEntity, type Person, type LLMResponse } from "../../../../src/core/types.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import { classifyObservationLens } from "../../../../src/core/utils/persona-signal-lens.js";
import { handlers } from "../../../../src/core/handlers/index.js";
import { resolveCanonicalAgent } from "../../../../src/core/personas/opencode-agent.js";
import { parseMessageId } from "../../../../src/core/utils/message-id.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as tests/unit/core/handlers/extraction.test.ts and
// tests/unit/core/state-manager.test.ts. Real `StateManager` reaches Zod
// via entity-schemas.ts.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

function makeTestPersona(id: string, displayName: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: displayName,
    entity: "system",
    aliases: [displayName],
    short_description: `${displayName} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
}

function makeLinkedPerson(id: string, name: string, personaId: string, overrides: Partial<Person> = {}): Person {
  return {
    id,
    name,
    description: `${name}'s description`,
    relationship: "AI Persona",
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    validated_date: "",
    identifiers: [
      { type: "Ei Persona", value: personaId },
      { type: "Nickname", value: name, is_primary: true },
    ],
    ...overrides,
  };
}

function makeSession(agentId: string | undefined, systemPrompt: string | undefined, content: string): OmpSession {
  return {
    path: "/fake/root/AgentTranscript.jsonl",
    provenance: {
      harness: "omp",
      mode: "delegated",
      agent_id: agentId,
      agent_definition_ref: agentId ? `omp:${agentId}` : undefined,
      definition_revision: systemPrompt ? "sha256:aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990000" : undefined,
    },
    messages: [{ id: "m1", role: "assistant", content, timestamp: "2026-08-01T00:01:00.000Z" }],
    firstMessageAt: "2026-08-01T00:01:00.000Z",
    lastMessageAt: "2026-08-01T00:01:00.000Z",
  };
}

function makeFakeReader(record: OmpTranscriptRecord, session: OmpSession | null) {
  return {
    listTranscripts: async () => [record],
    readTranscript: async () => session,
  };
}

function scanRequestsFor(sm: StateManager) {
  return sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalScan);
}

describe("importOmpSessions", () => {
  let sm: StateManager;
  const RECORD: OmpTranscriptRecord = { path: "/fake/root/AgentTranscript.jsonl", cd: 2, label: "AgentTranscript" };

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
  });

  describe("R3/AT3 — provenance is sourced correctly, missing provenance fails closed", () => {
    beforeEach(() => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));
    });

    it("a complete session_init (agent + systemPrompt) produces a correctly-provenanced Agent-lens observation", async () => {
      const session = makeSession("backend-engineer", "You are backend-engineer.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(1);
      expect(result.transcriptsProcessed).toBe(1);

      const requests = scanRequestsFor(sm);
      expect(requests).toHaveLength(1);
      const data = requests[0].data as Record<string, unknown>;
      expect(data.subjectPersonaId).toBe("backend-engineer-persona");
      expect(data.subjectPersonId).toBe("backend-engineer-person");

      const classification = classifyObservationLens(data.agentProvenance as Parameters<typeof classifyObservationLens>[0]);
      expect(classification.lens).toBe("agent");
      if (classification.lens === "agent") {
        expect(classification.provenance.harness).toBe("omp");
        expect(classification.provenance.agent_id).toBe("backend-engineer");
        expect(classification.provenance.agent_definition_ref).toBe("omp:backend-engineer");
        expect(classification.provenance.mode).toBe("delegated");
      }
    });

    it("a transcript missing session_init.agent produces zero queued Agent-lens scans — no subject can be resolved without inference", async () => {
      const session = makeSession(undefined, "You are someone.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(0);
      expect(result.transcriptsProcessed).toBe(0);
      expect(result.personasCreated).toEqual([]);
      expect(scanRequestsFor(sm)).toHaveLength(0);
    });

    it("a transcript missing session_init.systemPrompt queues a scan, but its incomplete provenance classifies as needs_agent_provenance, never agent", async () => {
      const session = makeSession("backend-engineer", undefined, "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(1);
      const requests = scanRequestsFor(sm);
      expect(requests).toHaveLength(1);
      const data = requests[0].data as Record<string, unknown>;

      const classification = classifyObservationLens(data.agentProvenance as Parameters<typeof classifyObservationLens>[0]);
      expect(classification.lens).toBe("needs_agent_provenance");
    });

    it("creates the subject persona via ensureAgentPersona when it doesn't already exist", async () => {
      const freshSm = new StateManager();
      await freshSm.initialize(createMockStorage());
      const session = makeSession("Beta", "You are Beta.", "reviewed a PR");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: freshSm, reader });

      // No Person is linked to the freshly-created "Beta" persona yet, so
      // R7 discipline correctly skips queuing a scan — this test only
      // asserts persona creation itself; the link-based scan assertion is
      // covered by the other cases above.
      expect(result.personasCreated).toEqual(["Beta"]);
      expect(freshSm.persona_getByName("Beta")).not.toBeNull();
      expect(result.scansQueued).toBe(0);
    });
  });

  describe("R7 discipline — link cardinality", () => {
    it("skips queuing when the resolved subject persona has no linked Person record yet", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      const session = makeSession("backend-engineer", "You are backend-engineer.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(0);
      expect(scanRequestsFor(sm)).toHaveLength(0);
    });

    it("skips queuing when the resolved subject persona is linked to more than one Person record", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person-a", "A", "backend-engineer-persona"));
      sm.getHuman().people.push(makeLinkedPerson("backend-engineer-person-b", "B", "backend-engineer-persona"));

      const session = makeSession("backend-engineer", "You are backend-engineer.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(0);
      expect(scanRequestsFor(sm)).toHaveLength(0);
    });
  });

  describe("R2 — malformed transcripts never crash the importer", () => {
    it("a transcript readTranscript resolves to null (malformed) produces zero scans and is NOT checkpointed (I4: never checkpointed before queueing)", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));

      const reader = makeFakeReader(RECORD, null);
      const result = await importOmpSessions({ stateManager: sm, reader });

      expect(result.scansQueued).toBe(0);
      expect(result.transcriptsProcessed).toBe(0);
      // Stint holistic review Bucket 1, finding I4 (2026-08-11): a
      // malformed transcript never reaches the queue call, so it must
      // never be checkpointed — it stays eligible for retry, same as any
      // other otherwise-failed-before-queue record.
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD.path]).toBeUndefined();
    });
  });

  describe("R4/AT4 — a second import run is idempotent", () => {
    it("running importOmpSessions twice against the same fixture queues zero duplicate scans on the second run", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));

      const session = makeSession("backend-engineer", "You are backend-engineer.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const first = await importOmpSessions({ stateManager: sm, reader });
      expect(first.scansQueued).toBe(1);
      expect(scanRequestsFor(sm)).toHaveLength(1);

      const second = await importOmpSessions({ stateManager: sm, reader });
      expect(second.scansQueued).toBe(0);
      expect(second.transcriptsProcessed).toBe(0);
      expect(scanRequestsFor(sm)).toHaveLength(1); // still exactly one — no duplicate
    });
  });

  describe("message-locator round-trip: two distinct transcripts sharing a filename and a colliding native id (2026-08-19 fix)", () => {
    it("produces two distinct, individually persisted message ids -- never a collision from truncating to basename", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));

      const recordA: OmpTranscriptRecord = { path: "/fake/root/a/Worker.jsonl", cd: 3, label: "Worker" };
      const recordB: OmpTranscriptRecord = { path: "/fake/root/b/Worker.jsonl", cd: 3, label: "Worker" };
      const sessionA: OmpSession = {
        path: recordA.path,
        provenance: { harness: "omp", mode: "delegated", agent_id: "backend-engineer", agent_definition_ref: "omp:backend-engineer" },
        // Same native message id ("m1") as sessionB, deliberately -- the
        // pre-fix basename-only session key would have made these two
        // transcripts qualify to the identical omp:<machine>:Worker.jsonl:m1 id.
        messages: [{ id: "m1", role: "assistant", content: "content from transcript A", timestamp: "2026-08-01T00:01:00.000Z" }],
        firstMessageAt: "2026-08-01T00:01:00.000Z",
        lastMessageAt: "2026-08-01T00:01:00.000Z",
      };
      const sessionB: OmpSession = {
        path: recordB.path,
        provenance: { harness: "omp", mode: "delegated", agent_id: "backend-engineer", agent_definition_ref: "omp:backend-engineer" },
        messages: [{ id: "m1", role: "assistant", content: "content from transcript B", timestamp: "2026-08-01T00:02:00.000Z" }],
        firstMessageAt: "2026-08-01T00:02:00.000Z",
        lastMessageAt: "2026-08-01T00:02:00.000Z",
      };
      const sessionsByPath = new Map<string, OmpSession>([[recordA.path, sessionA], [recordB.path, sessionB]]);
      const reader = {
        listTranscripts: async () => [recordA, recordB],
        readTranscript: async (path: string) => sessionsByPath.get(path) ?? null,
      };

      const result = await importOmpSessions({ stateManager: sm, reader });
      expect(result.transcriptsProcessed).toBe(2);
      expect(result.scansQueued).toBe(2);

      const persisted = sm.messages_get("backend-engineer-persona");
      expect(persisted).toHaveLength(2);

      const msgA = persisted.find(m => m.content === "content from transcript A")!;
      const msgB = persisted.find(m => m.content === "content from transcript B")!;
      expect(msgA).toBeDefined();
      expect(msgB).toBeDefined();

      // The closure oracle itself: distinct qualified ids for genuinely
      // distinct source events that shared a filename and a colliding
      // native id -- each round-tripping back through parseMessageId to
      // its own full transcript path, never the pre-fix basename that
      // would have made them identical. The session segment is
      // percent-encoded on the wire (S1 fix, since a real transcript path
      // can legally contain a colon on POSIX/macOS) -- check the decoded
      // round-trip property, not the raw string shape.
      expect(msgA.id).not.toBe(msgB.id);
      expect(parseMessageId(msgA.id).session).toBe(recordA.path);
      expect(parseMessageId(msgB.id).session).toBe(recordB.path);
      expect(parseMessageId(msgA.id).nativeId).toBe("m1");
      expect(parseMessageId(msgB.id).nativeId).toBe("m1");
    });
  });

  describe("D7/R6/AT6 — a complete OMP import produces a real, durable observation end to end through the actual queued-response handler", () => {
    it("persists the transcript's message into the subject Persona's state before queuing, so a matching Scan/Extract response lands exactly one observation and one agent-lens Match request", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));

      const quote = "wrote thorough tests during the review";
      const session = makeSession("backend-engineer", "You are backend-engineer.", quote);
      const reader = makeFakeReader(RECORD, session);

      const result = await importOmpSessions({ stateManager: sm, reader });
      expect(result.scansQueued).toBe(1);

      // D7 (Beta review I1): the transcript's message is actually
      // persisted into the subject Persona's own state — not merely
      // converted in importer-local memory that the handler can never see.
      const persisted = sm.messages_get("backend-engineer-persona");
      expect(persisted).toHaveLength(1);
      expect(persisted[0].content).toBe(quote);
      expect(persisted[0].id).toMatch(/^omp:/);

      const requests = scanRequestsFor(sm);
      expect(requests).toHaveLength(1);
      const scanRequest = requests[0];

      const response: LLMResponse = {
        request: scanRequest,
        success: true,
        content: JSON.stringify({ observations: [{ quote_text: quote }] }),
        parsed: {
          observations: [
            {
              quote_text: quote,
              claim: "Wrote thorough tests during the review.",
              dimension: "behavior",
              direction: "novel",
              extraction_confidence: 0.9,
              observer_kind: "human",
            },
          ],
        },
      };

      // Landed via a real handlePersonaSignalScan call, not a fixture that
      // stops at the queue.
      await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

      const observations = sm.observations_get("backend-engineer-persona");
      expect(observations).toHaveLength(1);
      expect(observations[0].message_id).toBe(persisted[0].id);
      expect(observations[0].subject_person_id).toBe("backend-engineer-person");

      // Stint holistic review Bucket 1, finding I1 (2026-08-11): R3/AT3's
      // "correctly-provenanced Agent-lens observation" is verified through
      // actual durable persistence here, not merely classification — all
      // five derived provenance fields must survive onto the record the
      // Scan handler writes.
      expect(observations[0].harness).toBe("omp");
      expect(observations[0].agent_id).toBe("backend-engineer");
      expect(observations[0].agent_definition_ref).toBe("omp:backend-engineer");
      expect(observations[0].definition_revision).toBe("sha256:aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990000");
      expect(observations[0].mode).toBe("delegated");

      const matchRequests = sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
      expect(matchRequests).toHaveLength(1);
      expect(matchRequests[0].data.lens).toBe("agent");
    });
  });

  describe("S6 — complete and incomplete OMP provenance at the linked Ei ingress", () => {
    function makeScanResponse(request: LLMResponse["request"], quote: string): LLMResponse {
      return {
        request,
        success: true,
        content: JSON.stringify({ observations: [{ quote_text: quote }] }),
        parsed: {
          observations: [{
            quote_text: quote,
            claim: "Ei's operating contract is grounded in observed work.",
            dimension: "behavior",
            direction: "novel",
            extraction_confidence: 0.9,
            observer_kind: "human",
          }],
        },
      };
    }

    it("a linked Ei subject with complete OMP provenance persists one fully-provenanced observation and queues one Agent Match", async () => {
      sm.persona_add(makeTestPersona("ei", "Ei"));
      sm.human_person_upsert(makeLinkedPerson("ei-person", "Ei", "ei"));
      const quote = "Ei's operating contract is grounded in observed work";
      const session = makeSession("ei", "You are Ei.", quote);

      await importOmpSessions({ stateManager: sm, reader: makeFakeReader(RECORD, session) });
      const [scanRequest] = scanRequestsFor(sm);
      expect(scanRequest).toBeDefined();
      await handlers[LLMNextStep.HandlePersonaSignalScan](makeScanResponse(scanRequest, quote), sm);

      const observations = sm.observations_get("ei");
      expect(observations).toHaveLength(1);
      expect(observations[0]).toMatchObject({
        harness: "omp",
        agent_id: "ei",
        agent_definition_ref: "omp:ei",
        definition_revision: "sha256:aaaabbbbccccddddeeeeffff00001111222233334444555566667777888899990000",
        mode: "delegated",
      });
      const matchRequests = sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
      expect(matchRequests).toHaveLength(1);
      expect(matchRequests[0].data.lens).toBe("agent");
    });

    it("a linked Ei subject with a missing system prompt persists neither observation nor Agent Match after a valid draft", async () => {
      sm.persona_add(makeTestPersona("ei", "Ei"));
      sm.human_person_upsert(makeLinkedPerson("ei-person", "Ei", "ei"));
      const quote = "Ei's operating contract is grounded in observed work";
      const session = makeSession("ei", undefined, quote);

      await importOmpSessions({ stateManager: sm, reader: makeFakeReader(RECORD, session) });
      const [scanRequest] = scanRequestsFor(sm);
      expect(scanRequest).toBeDefined();
      await handlers[LLMNextStep.HandlePersonaSignalScan](makeScanResponse(scanRequest, quote), sm);

      expect(sm.observations_get("ei")).toEqual([]);
      expect(sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalMatch)).toEqual([]);
    });
  });

  describe("D8/R7/AT7 — a later record's failure never replays an earlier, already-queued record", () => {
    it("checkpoints the first record durably before the second's read rejects; a retry does not re-queue the first, and re-attempts the second", async () => {
      const RECORD_A: OmpTranscriptRecord = { path: "/fake/root/AgentOne.jsonl", cd: 2, label: "AgentOne" };
      const RECORD_B: OmpTranscriptRecord = { path: "/fake/root/AgentTwo.jsonl", cd: 2, label: "AgentTwo" };

      sm.persona_add(makeTestPersona("agent-one-persona", "Agent One"));
      sm.human_person_upsert(makeLinkedPerson("agent-one-person", "Agent One Bot", "agent-one-persona"));
      sm.persona_add(makeTestPersona("agent-two-persona", "Agent Two"));
      sm.human_person_upsert(makeLinkedPerson("agent-two-person", "Agent Two Bot", "agent-two-persona"));

      const sessionA = makeSession("agent-one", "sys1", "record A content");
      const sessionB = makeSession("agent-two", "sys2", "record B content");

      let recordBAttempts = 0;
      const reader = {
        listTranscripts: async () => [RECORD_A, RECORD_B],
        readTranscript: async (filePath: string): Promise<OmpSession | null> => {
          if (filePath === RECORD_A.path) return sessionA;
          if (filePath === RECORD_B.path) {
            recordBAttempts++;
            if (recordBAttempts === 1) throw new Error("simulated transient read failure");
            return sessionB;
          }
          return null;
        },
      };

      const first = await importOmpSessions({ stateManager: sm, reader });
      expect(first.transcriptsProcessed).toBe(1);
      expect(first.scansQueued).toBe(1);

      // D8: record A is checkpointed immediately (a durable per-record
      // write), even though record B's read subsequently threw mid-batch —
      // never held in memory until the whole loop finishes.
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD_A.path]).toBeDefined();
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD_B.path]).toBeUndefined();

      let requestsA = scanRequestsFor(sm).filter((r) => (r.data as Record<string, unknown>).subjectPersonaId === "agent-one-persona");
      expect(requestsA).toHaveLength(1);

      const second = await importOmpSessions({ stateManager: sm, reader });
      expect(recordBAttempts).toBe(2); // record B remained eligible and was retried
      expect(second.transcriptsProcessed).toBe(1);
      expect(second.scansQueued).toBe(1);

      requestsA = scanRequestsFor(sm).filter((r) => (r.data as Record<string, unknown>).subjectPersonaId === "agent-one-persona");
      expect(requestsA).toHaveLength(1); // still exactly one — record A was never replayed

      const requestsB = scanRequestsFor(sm).filter((r) => (r.data as Record<string, unknown>).subjectPersonaId === "agent-two-persona");
      expect(requestsB).toHaveLength(1);
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD_B.path]).toBeDefined();
    });
  });

  describe("I4 (Stint holistic review Bucket 1, 2026-08-11) — a zero-link transcript remains eligible for retry once its Person link is added", () => {
    it("importing a zero-link transcript queues nothing and is not checkpointed; adding the link and re-running queues exactly one Scan request", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      // No linked Person record yet — R7 discipline blocks queueing.

      const session = makeSession("backend-engineer", "You are backend-engineer.", "wrote thorough tests");
      const reader = makeFakeReader(RECORD, session);

      const first = await importOmpSessions({ stateManager: sm, reader });
      expect(first.scansQueued).toBe(0);
      expect(first.transcriptsProcessed).toBe(0);
      expect(scanRequestsFor(sm)).toHaveLength(0);
      // I4: never checkpointed before queueing — the record stays
      // eligible for retry rather than being permanently excluded.
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD.path]).toBeUndefined();

      // The blocker resolves: a Person record is now linked to the subject.
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));

      const second = await importOmpSessions({ stateManager: sm, reader });
      expect(second.scansQueued).toBe(1);
      expect(second.transcriptsProcessed).toBe(1);
      expect(scanRequestsFor(sm)).toHaveLength(1);
      expect(sm.getHuman().settings?.omp?.processed_sessions?.[RECORD.path]).toBeDefined();
    });
  });

  describe("D10/R8/AT8(b) — control-character transcript content is stripped before it reaches console output or a persisted persona identity", () => {
    const CONTROL = "\u0007\u001b"; // BEL + ESC (C0)
    const controlCharPattern = /[\u0000-\u001F\u007F-\u009F]/;

    it("a poisoned session_init.agent value never creates a poisoned PersonaEntity, and no control byte reaches console output", async () => {
      const poisonedAgent = `backend${CONTROL}engineer`;
      const poisonedRecord: OmpTranscriptRecord = { path: `/fake/root/${CONTROL}Poisoned${CONTROL}.jsonl`, cd: 2, label: "Poisoned" };
      const session = makeSession(poisonedAgent, "You are the agent.", "did some work");
      const reader = makeFakeReader(poisonedRecord, session);

      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

      try {
        const result = await importOmpSessions({ stateManager: sm, reader });

        // No Person is linked yet, so R7 discipline skips queuing a scan —
        // this test isolates D10 alone; the persona is still created.
        expect(result.scansQueued).toBe(0);
        expect(result.personasCreated).toHaveLength(1);

        for (const spy of [logSpy, warnSpy, debugSpy]) {
          for (const call of spy.mock.calls) {
            for (const arg of call) {
              if (typeof arg === "string") expect(controlCharPattern.test(arg)).toBe(false);
            }
          }
        }

        const cleanAgent = poisonedAgent.replace(/[\u0000-\u001F\u007F-\u009F]/g, "");
        const { canonical } = resolveCanonicalAgent(cleanAgent);
        const created = sm.persona_getByName(canonical);
        expect(created).not.toBeNull();
        expect(controlCharPattern.test(created!.display_name)).toBe(false);
        for (const alias of created!.aliases ?? []) {
          expect(controlCharPattern.test(alias)).toBe(false);
        }
      } finally {
        logSpy.mockRestore();
        warnSpy.mockRestore();
        debugSpy.mockRestore();
      }
    });

    it("strips control characters from the transcript path before it reaches console.warn output", async () => {
      sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
      sm.human_person_upsert(makeLinkedPerson("backend-engineer-person-a", "A", "backend-engineer-persona"));
      sm.getHuman().people.push(makeLinkedPerson("backend-engineer-person-b", "B", "backend-engineer-persona"));

      const poisonedPathRecord: OmpTranscriptRecord = {
        path: `/fake/root/${CONTROL}Poisoned${CONTROL}Transcript.jsonl`,
        cd: 2,
        label: "Poisoned",
      };
      const session = makeSession("backend-engineer", "You are backend-engineer.", "did some work");
      const reader = makeFakeReader(poisonedPathRecord, session);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const result = await importOmpSessions({ stateManager: sm, reader });
        expect(result.scansQueued).toBe(0); // R7: 2 linked people is ambiguous, skipped

        expect(warnSpy).toHaveBeenCalledTimes(1);
        const [warnedMessage] = warnSpy.mock.calls[0];
        expect(controlCharPattern.test(warnedMessage as string)).toBe(false);
        expect(warnedMessage).toContain("Backend Engineer");
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

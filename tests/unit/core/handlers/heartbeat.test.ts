import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type LLMRequestState,
  type LLMResponse,
  type LLMRequest,
  type HumanEntity,
  type PersonaEntity,
  type Message,
  type EmergentSignal,
  type PersonaSignalCollections,
} from "../../../../src/core/types.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import type { EiHeartbeatResult } from "../../../../src/prompts/heartbeat/types.js";

import { handleEiHeartbeat } from "../../../../src/core/handlers/heartbeat.js";

// Fixture conventions (mocked StateManager/request/response) reused from the
// deleted tests/unit/core/handlers/reflection.test.ts per Spec §4.10.

interface MockHeartbeatStateManager {
  getHuman: () => HumanEntity;
  persona_getAll: () => PersonaEntity[];
  persona_update: (personaId: string, update: Partial<PersonaEntity>) => void;
  queue_clearPersonaResponses: (personaId: string, nextStep: LLMNextStep) => void;
  messages_append: (personaId: string, message: Message) => boolean;
  human_fact_upsert: (fact: HumanEntity["facts"][number]) => void;
  human_person_upsert: (person: HumanEntity["people"][number]) => void;
  human_topic_upsert: (topic: HumanEntity["topics"][number]) => void;
  signals_get: (personaId: string) => PersonaSignalCollections;
  _human: HumanEntity;
  _personas: Record<string, PersonaEntity>;
  _signals: Record<string, PersonaSignalCollections>;
  _messages: Message[];
}

function createMockStateManager(): MockHeartbeatStateManager {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
  };

  const personas: Record<string, PersonaEntity> = {};
  const signals: Record<string, PersonaSignalCollections> = {};
  const messages: Message[] = [];

  return {
    getHuman: vi.fn(() => human),
    persona_getAll: vi.fn(() => Object.values(personas)),
    persona_update: vi.fn(),
    queue_clearPersonaResponses: vi.fn(),
    messages_append: vi.fn((_personaId: string, message: Message) => {
      messages.push(message);
      return true;
    }),
    human_fact_upsert: vi.fn(),
    human_person_upsert: vi.fn(),
    human_topic_upsert: vi.fn(),
    signals_get: vi.fn((personaId: string) => signals[personaId] ?? { persona: [], agent: [] }),

    _human: human,
    _personas: personas,
    _signals: signals,
    _messages: messages,
  };
}

function createMockRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    id: "test-id",
    created_at: new Date().toISOString(),
    attempts: 0,
    state: "pending" as LLMRequestState,
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleEiHeartbeat,
    data: {},
    ...overrides,
  };
}

function createMockResponse(
  request: LLMRequest,
  parsed: EiHeartbeatResult,
  success = true
): LLMResponse {
  return {
    request,
    success,
    content: success ? JSON.stringify(parsed) : null,
    parsed: success ? parsed : undefined,
    error: success ? undefined : "Test error",
  };
}

function seedPersona(
  state: MockHeartbeatStateManager,
  overrides?: Partial<PersonaEntity>
): PersonaEntity {
  const persona: PersonaEntity = {
    id: "persona-1",
    display_name: "Beta",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
  state._personas[persona.id] = persona;
  return persona;
}

function seedSignal(
  state: MockHeartbeatStateManager,
  personaId: string,
  overrides?: Partial<EmergentSignal>
): EmergentSignal {
  const signal: EmergentSignal = {
    id: "signal-1",
    subject_persona_id: personaId,
    claim: "Beta leans into calculated chaos under pressure.",
    dimension: "behavior",
    status: "recurring",
    evidence_ids: ["obs-1"],
    first_observed_at: new Date().toISOString(),
    last_observed_at: new Date().toISOString(),
    observer_kinds: ["human"],
    recurrence_count: 2,
    ...overrides,
  };
  const existing = state._signals[personaId] ?? { persona: [], agent: [] };
  existing.persona.push(signal);
  state._signals[personaId] = existing;
  return signal;
}

describe("handleEiHeartbeat", () => {
  let state: MockHeartbeatStateManager;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  // R1/AT1 (Spec §4.10, D2) — TDD bug-reproduction: the Ei heartbeat prompt
  // (ei.ts:120-126) permits a should_respond=true response with no `id` for
  // a Temporal Anchor, but the handler's `!result.should_respond || !result.id`
  // guard (heartbeat.ts:59-62) silently drops it — my_response is never sent.
  describe("R1/AT1: ID-less Temporal Anchor response", () => {
    it("sends the my_response message instead of silently dropping it when should_respond=true and no id is provided", () => {
      const request = createMockRequest();
      const response = createMockResponse(request, {
        should_respond: true,
        my_response: "Hey, I've been thinking about you — how did that interview go?",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).toHaveBeenCalledTimes(1);
      const [personaId, message] = vi.mocked(state.messages_append).mock.calls[0];
      expect(personaId).toBe("ei");
      expect(message.content).toBe("Hey, I've been thinking about you — how did that interview go?");
    });
  });

  // R2/AT2 (Spec §4.10, D1) — extends crossFind/handleEiHeartbeat to accept
  // and act on a signal choice, mirroring AT1's "not dropped" assertion.
  describe("R2/AT2: signal choice with a resolvable ID", () => {
    it("sends the my_response message when the chosen id resolves to a signal via crossFind", () => {
      seedPersona(state);
      const signal = seedSignal(state, "persona-1");

      const request = createMockRequest({ data: { offeredIds: [signal.id] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: signal.id,
        my_response: "I noticed you've been leaning into chaos again — want to talk about it?",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).toHaveBeenCalledTimes(1);
      const [personaId, message] = vi.mocked(state.messages_append).mock.calls[0];
      expect(personaId).toBe("ei");
      expect(message.content).toBe("I noticed you've been leaning into chaos again — want to talk about it?");
    });
  });

  // R3/AT3 (Spec §4.10, D4/D5/D6) — Beta's Bolt-006 code review (I1/I4/I5,
  // 2026-08-11): the ID-less Temporal-Anchor log preview must strip C0/C1/OSC
  // control characters while storing the raw message; a present id of "",
  // null, or false must not be treated as an anchor; and a malformed
  // my_response must fail before last_heartbeat is stamped or the queued
  // response is cleared.
  describe("R3/AT3: malformed heartbeat responses fail safely", () => {
    it("(a) strips C0/C1/OSC control characters from the ID-less Temporal-Anchor log preview while the stored message keeps the raw content", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const rawResponse = "Hey\x1b[31m there\x07 \u2014 how are you?";

      const request = createMockRequest();
      const response = createMockResponse(request, {
        should_respond: true,
        my_response: rawResponse,
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).toHaveBeenCalledTimes(1);
      const [personaId, message] = vi.mocked(state.messages_append).mock.calls[0];
      expect(personaId).toBe("ei");
      expect(message.content).toBe(rawResponse);

      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b[31m");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(rawResponse);
      expect(logged).toContain("Hey");
      expect(logged).toContain("there");

      logSpy.mockRestore();
    });

    it.each([
      ["empty string", ""],
      ["null", null],
      ["false", false],
    ])("(b) does not treat a present id of %s as an anchor \u2014 resolution fails closed with no outreach sent", (_label, malformedId) => {
      const request = createMockRequest();
      const response = createMockResponse(request, {
        should_respond: true,
        id: malformedId as unknown as string,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).not.toHaveBeenCalled();
    });

    it.each([
      ["number", 42],
      ["object", { not: "a string" }],
      ["empty string", ""],
    ])("(c) fails a non-string or empty my_response (%s) before last_heartbeat is stamped or the queued response is cleared", (_label, malformedResponse) => {
      const request = createMockRequest();
      const response = createMockResponse(request, {
        should_respond: true,
        my_response: malformedResponse as unknown as string,
      });

      expect(() => handleEiHeartbeat(response, state as unknown as StateManager)).toThrow(
        /Malformed my_response/
      );

      expect(state.persona_update).not.toHaveBeenCalled();
      expect(state.queue_clearPersonaResponses).not.toHaveBeenCalled();
      expect(state.messages_append).not.toHaveBeenCalled();
    });
  });

  // R4/AT4 (Spec §4.10, D7) — Beta's Bolt-006 code review (I6, 2026-08-11):
  // the resolved-item "Sending message" log (newly reachable via a signal
  // choice) must strip C0/C1/OSC control characters, matching R3(a)'s
  // guarantee for the Temporal-Anchor log, while the stored message keeps
  // the raw content.
  describe("R4/AT4: resolved-item log never carries executable terminal controls", () => {
    it("strips C0/C1/OSC control characters from the resolved-item log preview while the stored message keeps the raw content", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      seedPersona(state);
      const signal = seedSignal(state, "persona-1");
      const rawResponse = "Hey\x1b[31m there\x07 \u2014 want to talk about it?";

      const request = createMockRequest({ data: { offeredIds: [signal.id] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: signal.id,
        my_response: rawResponse,
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).toHaveBeenCalledTimes(1);
      const [personaId, message] = vi.mocked(state.messages_append).mock.calls[0];
      expect(personaId).toBe("ei");
      expect(message.content).toBe(rawResponse);

      const logged = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b[31m");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(rawResponse);
      expect(logged).toContain("Hey");
      expect(logged).toContain("there");

      logSpy.mockRestore();
    });
  });

  // R5/AT5 (Bolt 011, D5/D7; materiality ruling
  // bolt-011-ei-signal-choice-authorization-and-log-sanitization,
  // 2026-08-11): the queued request's own offeredIds snapshot is the sole
  // authorization boundary for a chosen id -- crossFind resolves any known
  // fact/person/topic/signal id globally, with no notion of which ids this
  // specific request actually offered. A model response naming a real but
  // non-offered id must cause no outreach and no mutation; the legitimate
  // offered-id path must still work; no control character from a selected
  // id may reach a terminal log.
  describe("R5/AT5: unauthorized or hostile id resolution is rejected before crossFind and before mutation", () => {
    it("(a) a real, non-offered fact id causes no outreach and leaves validated_date unchanged", () => {
      const fact: HumanEntity["facts"][number] = {
        id: "fact-1",
        name: "Favorite color",
        description: "Blue",
        sentiment: 0,
        last_updated: new Date().toISOString(),
        validated_date: "",
      };
      state._human.facts.push(fact);

      const request = createMockRequest({ data: { offeredIds: ["some-other-id"] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: fact.id,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.persona_update).not.toHaveBeenCalled();
      expect(state.queue_clearPersonaResponses).not.toHaveBeenCalled();
      expect(state.messages_append).not.toHaveBeenCalled();
      expect(state.human_fact_upsert).not.toHaveBeenCalled();
      expect(fact.validated_date).toBe("");
    });

    it("(a) a real, non-offered person id causes no outreach and no last_ei_asked mutation", () => {
      const person: HumanEntity["people"][number] = {
        id: "person-1",
        name: "Alex",
        description: "A friend",
        sentiment: 0,
        last_updated: new Date().toISOString(),
        relationship: "Friend",
        exposure_current: 0,
        exposure_desired: 1,
        last_ei_asked: null,
      };
      state._human.people.push(person);

      const request = createMockRequest({ data: { offeredIds: ["some-other-id"] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: person.id,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.persona_update).not.toHaveBeenCalled();
      expect(state.queue_clearPersonaResponses).not.toHaveBeenCalled();
      expect(state.messages_append).not.toHaveBeenCalled();
      expect(state.human_person_upsert).not.toHaveBeenCalled();
      expect(person.last_ei_asked).toBeNull();
    });

    it("(a) a real, non-offered topic id causes no outreach and no last_ei_asked mutation", () => {
      const topic: HumanEntity["topics"][number] = {
        id: "topic-1",
        name: "Woodworking",
        description: "A hobby",
        sentiment: 0,
        last_updated: new Date().toISOString(),
        exposure_current: 0,
        exposure_desired: 1,
        last_ei_asked: null,
      };
      state._human.topics.push(topic);

      const request = createMockRequest({ data: { offeredIds: ["some-other-id"] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: topic.id,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.persona_update).not.toHaveBeenCalled();
      expect(state.queue_clearPersonaResponses).not.toHaveBeenCalled();
      expect(state.messages_append).not.toHaveBeenCalled();
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
      expect(topic.last_ei_asked).toBeNull();
    });

    it("(b) an offered persona-lens signal id still resolves and sends exactly one message -- the authorization check doesn't break the legitimate path", () => {
      seedPersona(state);
      const signal = seedSignal(state, "persona-1");

      const request = createMockRequest({ data: { offeredIds: [signal.id] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: signal.id,
        my_response: "I noticed you've been leaning into chaos again — want to talk about it?",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).toHaveBeenCalledTimes(1);
      const [personaId, message] = vi.mocked(state.messages_append).mock.calls[0];
      expect(personaId).toBe("ei");
      expect(message.content).toBe("I noticed you've been leaning into chaos again — want to talk about it?");
    });

    it("(d) an unauthorized id containing C0/C1/OSC control characters never reaches console.log/console.warn unstripped", () => {
      const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hostileId = "sig\x1b-1\x07";

      const request = createMockRequest({ data: { offeredIds: ["some-other-id"] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: hostileId,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).not.toHaveBeenCalled();

      const logged = [...logSpy.mock.calls, ...warnSpy.mock.calls]
        .map((call) => call.join(" "))
        .join("\n");
      expect(logged).not.toContain("\x1b");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(hostileId);
      expect(logged).toContain("sig-1");

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("(d) an offered id containing C0/C1/OSC control characters that resolves to no known item never reaches console.warn unstripped", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hostileId = "sig\x1b-2\x07";

      const request = createMockRequest({ data: { offeredIds: [hostileId] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: hostileId,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      expect(state.messages_append).not.toHaveBeenCalled();

      const logged = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(hostileId);
      expect(logged).toContain("sig-2");

      warnSpy.mockRestore();
    });

    it("(d) an offered id containing control characters that resolves to an unexpected item type never reaches console.warn unstripped", () => {
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const hostileId = "quote\x1b-3\x07";
      state._human.quotes.push({
        id: hostileId,
        message_id: null,
        data_item_ids: [],
        text: "A quote",
        speaker: "human",
        timestamp: new Date().toISOString(),
      } as unknown as HumanEntity["quotes"][number]);

      const request = createMockRequest({ data: { offeredIds: [hostileId] } });
      const response = createMockResponse(request, {
        should_respond: true,
        id: hostileId,
        my_response: "Should never be sent.",
      });

      handleEiHeartbeat(response, state as unknown as StateManager);

      const logged = warnSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(logged).not.toContain("\x1b");
      expect(logged).not.toContain("\x07");
      expect(logged).not.toContain(hostileId);
      expect(logged).toContain("quote-3");

      warnSpy.mockRestore();
    });
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  RoomMode,
  ContextStatus,

  type LLMRequestState,
  type LLMResponse,
  type LLMRequest,
  type Message,
  type HumanEntity,
  type PersonaEntity,
  type Fact,
  type Topic,
  type Person,
  type Quote,
  type RoomMessage,
  type RoomEntity,
  type PersonaObservation,
  type EmergentSignal,
} from "../../../../src/core/types.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import { filterQuotesByPersonaGroupVisibility } from "../../../../src/core/group-visibility.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import { classifyObservationLens, type AgentProvenance } from "../../../../src/core/utils/persona-signal-lens.js";
import { resolvePersonaLinkedPeople } from "../../../../src/core/utils/identifier-utils.js";
import type * as OrchestratorsModule from "../../../../src/core/orchestrators/index.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as tests/unit/core/state-manager.test.ts and
// tests/unit/core/state/persona-signals.test.ts. This file's own module
// graph (via human-matching.ts → corrections.ts → entity-schemas.ts)
// reaches the real Zod schema module even though this file mocks
// orchestrators/embedding-service, so the same interop guard is needed
// here too.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});


// We need to test handlers in isolation, so we import them directly
// and mock their dependencies

// Mock the orchestrators module
vi.mock("../../../../src/core/orchestrators/index.js", async (importOriginal) => {
  const actual = await importOriginal<OrchestratorsModule>();
  return {
    ...actual,
    orchestratePersonaGeneration: vi.fn(),
    queueTopicMatch: vi.fn().mockResolvedValue(undefined),
    queuePersonUpdate: vi.fn().mockReturnValue(1),
    queueTopicValidate: vi.fn().mockResolvedValue(undefined),
  };
});

// `embed` delegates to a reconfigurable module-scoped impl so individual tests can
// control the returned vector (and thus cosine similarity). Reset to the constant-vector
// default before every test by the file-level beforeEach below.
let mockEmbedImpl: (text: string) => Promise<number[]> = async () => new Array(384).fill(0.1);
vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn((text: string) => mockEmbedImpl(text)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getTopicEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getPersonEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  // Mirrors the real cosineSimilarity — pure math, deterministic for the unit vectors below.
  cosineSimilarity: (a: number[], b: number[]): number => {
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dot / magnitude;
  },
}));



import { handlers } from "../../../../src/core/handlers/index.js";
import { queueTopicMatch, queuePersonUpdate, queueTargetedTopicUpdate } from "../../../../src/core/orchestrators/index.js";

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
  };

  const personas: Record<string, PersonaEntity> = {};
  const messages: Record<string, Message[]> = {};
  const roomMessages: Record<string, RoomMessage[]> = {};
  const rooms: Record<string, RoomEntity> = {};

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => {
      const idx = human.facts.findIndex(f => f.id === fact.id);
      if (idx >= 0) human.facts[idx] = fact;
      else human.facts.push(fact);
    }),
    human_topic_upsert: vi.fn((topic: Topic) => {
      const idx = human.topics.findIndex(t => t.id === topic.id);
      if (idx >= 0) human.topics[idx] = topic;
      else human.topics.push(topic);
    }),
    human_person_upsert: vi.fn((person: Person) => {
      const idx = human.people.findIndex(p => p.id === person.id);
      if (idx >= 0) human.people[idx] = person;
      else human.people.push(person);
    }),
    human_quote_add: vi.fn((quote: Quote) => human.quotes.push(quote)),
    human_quote_update: vi.fn((id: string, updates: Partial<Quote>) => {
      const index = human.quotes.findIndex(quote => quote.id === id);
      if (index >= 0) human.quotes[index] = { ...human.quotes[index], ...updates };
    }),
    human_quote_getForMessage: vi.fn((messageId: string) =>
      human.quotes.filter(quote => quote.message_id === messageId)
    ),
    human_quote_remove: vi.fn((id: string) => {
      const index = human.quotes.findIndex(quote => quote.id === id);
      if (index >= 0) human.quotes.splice(index, 1);
      return index >= 0;
    }),
    persona_getById: vi.fn((id: string) => Object.values(personas).find(p => p.id === id) ?? null),
    persona_getByName: vi.fn((name: string) => Object.values(personas).find(p => p.display_name === name || p.aliases?.includes(name)) ?? null),
    persona_getAll: vi.fn(() => Object.values(personas)),
    persona_add: vi.fn((entity: PersonaEntity) => { personas[entity.id] = entity; }),
    persona_update: vi.fn(),
    messages_get: vi.fn((id: string) => messages[id] ?? []),
    getRoomMessages: vi.fn((roomId: string) => roomMessages[roomId] ?? []),
    getRoom: vi.fn((roomId: string) => rooms[roomId]),
    messages_append: vi.fn(),
    messages_markPendingAsRead: vi.fn(),
    messages_markExtracted: vi.fn().mockReturnValue(1),
    queue_enqueue: vi.fn(),

    _human: human,
    _personas: personas,
    _messages: messages,
    _roomMessages: roomMessages,
    _rooms: rooms,
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
    next_step: LLMNextStep.HandleFactFind,
    data: {
      personaId: "ei",
        channelDisplayName: "Ei",
      messages_context: [],
      messages_analyze: [],
    },
    ...overrides,
  };
}

function createMockResponse(
  request: LLMRequest,
  parsed: unknown,
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

// Restore the constant-vector embedding for every test so the ~15 embed-dependent
// tests below keep the default, regardless of per-test overrides in other blocks.
beforeEach(() => {
  mockEmbedImpl = async () => new Array(384).fill(0.1);
});

describe("Extraction Handlers - Step 1 (Scan)", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  describe("handleFactFind", () => {
    it("upserts fact with empty description", async () => {
      // Pre-seed human with a built-in fact that has empty description
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "2", role: "human", content: "My name is Jeremy Scherer", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Jeremy Scherer", evidence: "User said 'My name is Jeremy Scherer'" }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      const upsertedFact = (state.human_fact_upsert as any).mock.calls[0][0];
      expect(upsertedFact.description).toBe("Jeremy Scherer");
      expect(upsertedFact.last_changed_by).toBe("ei");
      // Evidence is NOT stored in the fact
      expect(upsertedFact.evidence).toBeUndefined();
    });

    it("skips fact with existing description", async () => {
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "John Doe",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: { personaId: "ei", personaDisplayName: "Ei", messages_context: [], messages_analyze: [] },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Jeremy Scherer", evidence: "..." }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("handles missing facts array gracefully", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
      });

      const response = createMockResponse(request, {});

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("calls markMessagesExtracted with flag 'f'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
          message_ids_to_mark: ["msg-1"],
        },
      });

      const response = createMockResponse(request, { facts: [] });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      expect(state.messages_markExtracted).toHaveBeenCalledWith("ei", ["msg-1"], "f");
    });
  });

    it("skips fact with non-built-in name (BUILT_IN_FACT_NAMES validation)", async () => {
      // The human has a built-in fact BUT the LLM returns a fabricated name
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: { personaId: "ei", personaDisplayName: "Ei", messages_context: [], messages_analyze: [] },
      });

      const response = createMockResponse(request, {
        // LLM hallucinated a fact name not in BUILT_IN_FACT_NAMES
        facts: [{ name: "Favorite Color", value: "Blue", evidence: "User mentioned blue" }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      // 'Favorite Color' is NOT a built-in fact → skip
      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("skips fact not present in human state (existingFact lookup returns undefined)", async () => {
      // Human has NO facts at all — even if name is valid built-in, nothing to upsert
      // (human.facts.find() returns undefined)
      expect(state._human.facts).toHaveLength(0);

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: { personaId: "ei", personaDisplayName: "Ei", messages_context: [], messages_analyze: [] },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Birthday", value: "March 3rd", evidence: "User mentioned their birthday" }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      // existingFact is undefined → skip (seeding should have added it first)
      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });
  describe("handleHumanTopicScan", () => {
    it("calls markMessagesExtracted with flag 't'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTopicScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
          message_ids_to_mark: ["msg-1"],
        },
      });

      const response = createMockResponse(request, { topics: [] });

      await handlers.handleHumanTopicScan(response, state as any);

      expect(state.messages_markExtracted).toHaveBeenCalledWith("ei", ["msg-1"], "t");
    });

    it("queues item match for each detected topic", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTopicScan,
        data: {
          personaId: "ei",
        channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        topics: [
          { name: "AI research", description: "Artificial intelligence", category: "Interest", reason: "User mentioned AI" },
          { name: "Photography", description: "Taking photos", category: "Interest", reason: "User mentioned photography" },
        ],
      });

      await handlers.handleHumanTopicScan(response, state as any);

      expect(queueTopicMatch).toHaveBeenCalledTimes(2);
      expect(queueTopicMatch).toHaveBeenCalledWith(
        expect.objectContaining({ name: "AI research" }),
        expect.any(Object),
        state,
        undefined
      );
    });
    // Tested by Beta — 2026-07-15
    it("forwards the extraction model to Topic Match", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTopicScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
          extraction_model: "extraction-guid",
        },
      });
      const response = createMockResponse(request, {
        topics: [{ name: "AI research", description: "Artificial intelligence", category: "Interest", reason: "User mentioned AI" }],
      });
      // The test double implements the StateManager members exercised by this handler.
      const stateManager = state as unknown as StateManager;

      await handlers.handleHumanTopicScan(response, stateManager);

      expect(queueTopicMatch).toHaveBeenCalledWith(
        expect.objectContaining({ name: "AI research" }),
        expect.any(Object),
        state,
        "extraction-guid"
      );
    });
  });

  describe("handleEventScan", () => {
    it("queues topic match for each detected event with category forced to 'Event'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleEventScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        events: [
          { name: "The Night We Debugged Beta", description: "We fixed a gnarly CPU issue", reason: "3 hours of debugging" },
        ],
      });

      await handlers[LLMNextStep.HandleEventScan](response, state as any);

      expect(queueTopicMatch).toHaveBeenCalledTimes(1);
      expect(queueTopicMatch).toHaveBeenCalledWith(
        expect.objectContaining({ name: "The Night We Debugged Beta", category: "Event" }),
        expect.any(Object),
        state,
        undefined
      );
    });
    // Tested by Beta — 2026-07-15
    it("forwards the extraction model to Topic Match", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleEventScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
          extraction_model: "extraction-guid",
        },
      });
      const response = createMockResponse(request, {
        events: [{ name: "The Night We Debugged Beta", description: "We fixed a gnarly CPU issue", reason: "3 hours of debugging" }],
      });
      // The test double implements the StateManager members exercised by this handler.
      const stateManager = state as unknown as StateManager;

      await handlers[LLMNextStep.HandleEventScan](response, stateManager);

      expect(queueTopicMatch).toHaveBeenCalledWith(
        expect.objectContaining({ name: "The Night We Debugged Beta", category: "Event" }),
        expect.any(Object),
        state,
        "extraction-guid"
      );
    });

    it("calls markMessagesExtracted with flag 'e'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleEventScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
          message_ids_to_mark: ["msg-1"],
        },
      });

      const response = createMockResponse(request, { events: [] });

      await handlers[LLMNextStep.HandleEventScan](response, state as any);

      expect(state.messages_markExtracted).toHaveBeenCalledWith("ei", ["msg-1"], "e");
    });

    it("handles empty events array gracefully", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleEventScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, { events: [] });

      await handlers[LLMNextStep.HandleEventScan](response, state as any);

      expect(queueTopicMatch).not.toHaveBeenCalled();
    });
  });

  describe("handleHumanPersonScan", () => {
    it("calls markMessagesExtracted with flag 'p'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanPersonScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
          message_ids_to_mark: ["msg-1"],
        },
      });

      const response = createMockResponse(request, { people: [] });

      await handlers.handleHumanPersonScan(response, state as any);

      expect(state.messages_markExtracted).toHaveBeenCalledWith("ei", ["msg-1"], "p");
    });

    it("queues item match for each detected person", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanPersonScan,
        data: {
          personaId: "ei",
        channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        people: [
          { name: "Alice", description: "A friend", relationship: "friend", reason: "User mentioned Alice" },
        ],
      });

      await handlers.handleHumanPersonScan(response, state as any);

      expect(queuePersonUpdate).toHaveBeenCalledTimes(1);
      expect(queuePersonUpdate).toHaveBeenCalledWith(
        { matched_guid: null },
        expect.objectContaining({ candidateName: "Alice" }),
        state
      );
    });

    // Regression: handleHumanPersonScan never read `extraction_model` off
    // response.request.data at all (unlike handleHumanTopicScan/handleEventScan,
    // which do read it but from a `data` that queueTopicScan/queueEventSummary
    // never actually populated). Both bugs left queuePersonUpdate's queued item
    // with `model: undefined`, which state.queue_enqueue silently defaults to
    // the CONVERSATION model instead of the configured extraction model.
    it("threads extraction_model from request data into queuePersonUpdate", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanPersonScan,
        data: {
          personaId: "ei",
          channelDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
          extraction_model: "extraction-guid",
        },
      });

      const response = createMockResponse(request, {
        people: [
          { name: "Bob", description: "A coworker", relationship: "coworker", reason: "User mentioned Bob" },
        ],
      });

      await handlers.handleHumanPersonScan(response, state as unknown as StateManager);

      expect(queuePersonUpdate).toHaveBeenCalledWith(
        { matched_guid: null },
        expect.objectContaining({ candidateName: "Bob", extraction_model: "extraction-guid" }),
        state
      );
    });
  });
});

describe("handleHumanPersonScan — confidence-gated matching", () => {
  let state = createMockStateManager();

  // Orthogonal 384-dim unit vectors: cosineSimilarity(V, V) = 1.0 (>= any threshold),
  // cosineSimilarity(V, ORTHOGONAL) = 0 (< any threshold).
  const V = Array.from({ length: 384 }, (_, i) => (i === 0 ? 1 : 0));
  const ORTHOGONAL = Array.from({ length: 384 }, (_, i) => (i === 1 ? 1 : 0));
  // Third orthogonal unit vector for multi-match "none above threshold" cases:
  // cosineSimilarity(W, V) = cosineSimilarity(W, ORTHOGONAL) = 0.
  const W = Array.from({ length: 384 }, (_, i) => (i === 2 ? 1 : 0));

  function makePerson(overrides: Partial<Person>): Person {
    return {
      id: "seed-1",
      name: "Seed",
      description: "seeded person",
      relationship: "Coworker",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: "2026-01-01T00:00:00Z",
      identifiers: [],
      ...overrides,
    };
  }

  async function runScan(candidate: {
    name: string;
    description?: string;
    relationship?: string;
    identifiers?: Array<{ type: string; value: string; is_primary?: boolean }>;
  }): Promise<void> {
    const request = createMockRequest({
      next_step: LLMNextStep.HandleHumanPersonScan,
      data: {
        personaId: "ei",
        channelDisplayName: "Ei",
        messages_context: [],
        messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
      },
    });
    const response = createMockResponse(request, { people: [candidate] });
    // Mock state manager is a partial StateManager built for these handler tests.
    await handlers.handleHumanPersonScan(response, state as unknown as StateManager);
  }

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("STRONG exact-name match merges even when the embedding disagrees (cosine not consulted)", async () => {
    state._human.people.push(makePerson({
      id: "jeff-strong",
      name: "Jeff Kirk",
      relationship: "Coworker",
      embedding: V,
      identifiers: [{ type: "Full Name", value: "Jeff Kirk", is_primary: true }],
    }));
    mockEmbedImpl = async () => ORTHOGONAL; // would fail a cosine gate if it were consulted

    await runScan({ name: "Jeff Kirk", description: "unrelated", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledTimes(1);
    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "jeff-strong" },
      expect.objectContaining({ candidateName: "Jeff Kirk" }),
      state,
    );
  });

  it("WEAK first-name match with HIGH cosine merges into the existing record", async () => {
    state._human.people.push(makePerson({ id: "jeff-weak-hi", name: "Jeff Kirk", relationship: "Coworker", embedding: V }));
    mockEmbedImpl = async () => V; // cosine 1.0 >= 0.75

    await runScan({ name: "Jeff", description: "a coworker", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "jeff-weak-hi" },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
  });

  it("WEAK first-name match with LOW cosine creates a NEW record (core regression)", async () => {
    state._human.people.push(makePerson({ id: "jeff-weak-lo", name: "Jeff Kirk", relationship: "Coworker", embedding: V }));
    mockEmbedImpl = async () => ORTHOGONAL; // cosine 0 < 0.75

    await runScan({ name: "Jeff", description: "a different Jeff", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
  });

  it("WEAK match against a person with NO embedding creates a NEW record", async () => {
    state._human.people.push(makePerson({ id: "jeff-noembed", name: "Jeff Kirk", relationship: "Coworker" })); // no embedding

    await runScan({ name: "Jeff", description: "a coworker", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
  });

  it("unnamed placeholder (sole non-singleton relationship) with LOW cosine creates a NEW record", async () => {
    state._human.people.push(makePerson({ id: "unknown-cow", name: "Unknown", relationship: "Coworker", embedding: V }));
    mockEmbedImpl = async () => ORTHOGONAL; // cosine 0 < 0.80

    await runScan({ name: "Marcus", description: "a new coworker", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Marcus" }),
      state,
    );
  });

  it("unnamed placeholder (sole non-singleton relationship) with HIGH cosine merges (placeholder named)", async () => {
    state._human.people.push(makePerson({ id: "unknown-cow", name: "Unknown", relationship: "Coworker", embedding: V }));
    mockEmbedImpl = async () => V; // cosine 1.0 >= 0.80

    await runScan({ name: "Marcus", description: "the coworker", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "unknown-cow" },
      expect.objectContaining({ candidateName: "Marcus" }),
      state,
    );
  });

  it("SINGLETON relationship sole match merges directly, bypassing cosine", async () => {
    state._human.people.push(makePerson({ id: "wife-rec", name: "Unknown", relationship: "wife", embedding: V }));
    mockEmbedImpl = async () => ORTHOGONAL; // would fail the placeholder gate if cosine were consulted

    await runScan({ name: "Borfinda", description: "the user's wife", relationship: "wife" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "wife-rec" },
      expect.objectContaining({ candidateName: "Borfinda" }),
      state,
    );
  });

  // ── #78 C1: corroboration gate on scan-extracted identifiers ────────────────

  it("C1: a shared identifier with NO name-token overlap does NOT bind (weak → cosine fails → new record)", async () => {
    // Marcus owns @mcodes. A scan finds "Priya" also carrying @mcodes (cross-attribution
    // signature). No name token is shared, so the identifier hit is WEAK and must clear the
    // cosine gate — which it can't (orthogonal) — so Priya becomes a NEW record.
    state._human.people.push(makePerson({
      id: "marcus-id",
      name: "Marcus Chen",
      relationship: "Coworker",
      embedding: V,
      identifiers: [{ type: "GitHub", value: "@mcodes", is_primary: true }],
    }));
    mockEmbedImpl = async () => ORTHOGONAL; // cosine 0 < 0.75

    await runScan({
      name: "Priya",
      description: "QA lead",
      relationship: "Coworker",
      identifiers: [{ type: "GitHub", value: "@mcodes" }],
    });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Priya" }),
      state,
    );
  });

  it("C1: a shared identifier WITH a corroborating name token binds directly (cosine not consulted)", async () => {
    // Same @mcodes hit, but the candidate name "Marcus" shares a token with "Marcus Chen",
    // so the identifier match is STRONG and merges without ever consulting the embedding.
    state._human.people.push(makePerson({
      id: "marcus-id",
      name: "Marcus Chen",
      relationship: "Coworker",
      embedding: V,
      identifiers: [{ type: "GitHub", value: "@mcodes", is_primary: true }],
    }));
    mockEmbedImpl = async () => ORTHOGONAL; // would fail the cosine gate if it were consulted

    await runScan({
      name: "Marcus",
      relationship: "Coworker",
      identifiers: [{ type: "GitHub", value: "@mcodes" }],
    });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "marcus-id" },
      expect.objectContaining({ candidateName: "Marcus" }),
      state,
    );
  });

  // ── Multi-match resolution by cosine ────────────────────────────────────────

  it("multi-match: cosine picks the best candidate above threshold", async () => {
    // "Jeff" first-name-matches both records (matches.length === 2 → multi-match cosine).
    state._human.people.push(makePerson({ id: "jeff-kirk", name: "Jeff Kirk", relationship: "Coworker", embedding: V }));
    state._human.people.push(makePerson({ id: "jeff-bezos", name: "Jeff Bezos", relationship: "Coworker", embedding: ORTHOGONAL }));
    mockEmbedImpl = async () => V; // cosine 1.0 to jeff-kirk, 0 to jeff-bezos

    await runScan({ name: "Jeff", description: "the coworker I pair with", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "jeff-kirk" },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
  });

  it("multi-match: none above threshold creates a NEW record", async () => {
    state._human.people.push(makePerson({ id: "jeff-kirk", name: "Jeff Kirk", relationship: "Coworker", embedding: V }));
    state._human.people.push(makePerson({ id: "jeff-bezos", name: "Jeff Bezos", relationship: "Coworker", embedding: ORTHOGONAL }));
    mockEmbedImpl = async () => W; // cosine 0 to both matches

    await runScan({ name: "Jeff", description: "a third, unrelated Jeff", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
  });

  it("multi-match: embedding failure creates a NEW record and modifies neither existing record (#78)", async () => {
    state._human.people.push(makePerson({ id: "jeff-kirk", name: "Jeff Kirk", relationship: "Coworker", embedding: V }));
    state._human.people.push(makePerson({ id: "jeff-bezos", name: "Jeff Bezos", relationship: "Coworker", embedding: ORTHOGONAL }));
    const before = JSON.stringify(state._human.people);
    mockEmbedImpl = async () => { throw new Error("embedding service down"); };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await runScan({ name: "Jeff", description: "an ambiguous Jeff", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledTimes(1);
    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Jeff" }),
      state,
    );
    expect(JSON.stringify(state._human.people)).toBe(before);
    expect(warn).toHaveBeenCalled(); // degradation stays visible
    warn.mockRestore();
  });

  // ── #78 M1 (deferred): unnamed placeholder without an embedding cannot promote ──

  it("M1 (deferred #78): a sole placeholder with NO embedding forks a new record instead of promoting", async () => {
    // Pins the intentional deferred behavior documented at handler L306: confirmMatchByCosine
    // returns null when the placeholder has no embedding, so it cannot be confirmed/promoted.
    state._human.people.push(makePerson({ id: "unknown-cow", name: "Unknown", relationship: "Coworker" })); // no embedding

    await runScan({ name: "Marcus", description: "a coworker", relationship: "Coworker" });

    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: null },
      expect.objectContaining({ candidateName: "Marcus" }),
      state,
    );
  });
});

describe("Extraction Handlers - Step 3 (Update) - interested_personas", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  describe("handleTopicUpdate", () => {
    it("sets interested_personas to [personaId] for new topics", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          existingItemId: undefined,
          candidateCategory: "Interest",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "New Topic",
        description: "A brand new topic",
        sentiment: 0.5,
        exposure_desired: 0.5,
        exposure_impact: "medium",
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
      const upsertedTopic = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upsertedTopic.interested_personas).toEqual(["persona-1"]);
    });

    it("merges personaId into existing interested_personas (unique)", async () => {
      state._human.topics.push({
        id: "existing-topic",
        name: "Existing Topic",
        description: "Already exists",
        sentiment: 0.3,
        exposure_current: 0.5,
        exposure_desired: 0.5,
        last_updated: "",
        interested_personas: ["persona-2", "persona-3"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-topic",
          candidateCategory: "Interest",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Existing Topic",
        description: "Updated description",
        sentiment: 0.5,
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledTimes(1);
      const upsertedTopic = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upsertedTopic.interested_personas).toContain("persona-1");
      expect(upsertedTopic.interested_personas).toContain("persona-2");
      expect(upsertedTopic.interested_personas).toContain("persona-3");
      expect(upsertedTopic.interested_personas).toHaveLength(3);
    });

    it("does not duplicate personaId if already in interested_personas", async () => {
      state._human.topics.push({
        id: "existing-topic",
        name: "Existing Topic",
        description: "Already exists",
        sentiment: 0.3,
        exposure_current: 0.5,
        exposure_desired: 0.5,
        last_updated: "",
        interested_personas: ["persona-1", "persona-2"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-topic",
          candidateCategory: "Interest",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Existing Topic",
        description: "Updated",
        sentiment: 0.5,
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      const upsertedTopic = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upsertedTopic.interested_personas).toEqual(["persona-1", "persona-2"]);
    });

    it("sets sources on new topic from context", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          existingItemId: undefined,
          candidateCategory: "Interest",
          sources: ["opencode:ses_abc123"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "New Topic",
        description: "A brand new topic",
        sentiment: 0.5,
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      const upsertedTopic = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upsertedTopic.sources).toEqual(["opencode:ses_abc123"]);
    });

    it("accumulates sources on existing topic (grow-only union, deduped)", async () => {
      state._human.topics.push({
        id: "existing-topic",
        name: "Existing Topic",
        description: "Already exists",
        sentiment: 0.3,
        exposure_current: 0.5,
        exposure_desired: 0.5,
        last_updated: "",
        interested_personas: [],
        sources: ["opencode:ses_abc123", "cursor:composer-1"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-topic",
          candidateCategory: "Interest",
          sources: ["opencode:ses_abc123", "opencode:ses_new456"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Existing Topic",
        description: "Updated",
        sentiment: 0.5,
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      const upsertedTopic = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upsertedTopic.sources).toContain("opencode:ses_abc123");
      expect(upsertedTopic.sources).toContain("cursor:composer-1");
      expect(upsertedTopic.sources).toContain("opencode:ses_new456");
      expect(upsertedTopic.sources).toHaveLength(3);
    });
  });

  describe("handleTopicUpdate — partial model responses (Haiku omission patterns)", () => {
    const existingTopic: Topic = {
      id: "existing-topic",
      name: "CloudFormation Deployment",
      description: "Existing description",
      sentiment: 0.7,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: "",
      interested_personas: [],
    };

    beforeEach(() => {
      state._human.topics.push({ ...existingTopic });
    });

    it("uses existing name when model omits name on update", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-topic", candidateCategory: "Project" },
      });
      const response = createMockResponse(request, { description: "Updated description", sentiment: 0.8 });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      const upserted = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upserted.name).toBe("CloudFormation Deployment");
      expect(upserted.description).toBe("Updated description");
    });

    it("uses existing sentiment when model omits sentiment on update", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-topic", candidateCategory: "Project" },
      });
      const response = createMockResponse(request, { description: "Updated description" });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      const upserted = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upserted.sentiment).toBe(0.7);
    });

    it("uses existing description when model returns boolean true for description", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-topic", candidateCategory: "Project" },
      });
      const response = createMockResponse(request, { description: true, sentiment: 0.8 });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      const upserted = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upserted.description).toBe("Existing description");
    });

    it("skips update (no upsert) when existing topic has no description and model omits it", async () => {
      state._human.topics[0].description = "";
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-topic", candidateCategory: "Project" },
      });
      const response = createMockResponse(request, { sentiment: 0.8 });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      expect(state.human_topic_upsert).not.toHaveBeenCalled();
    });

    it("uses candidateName as final fallback for new topic when model omits name", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateName: "Slack Experiments", candidateDescription: "Sending Slack messages via MCP", candidateCategory: "Event" },
      });
      const response = createMockResponse(request, { description: "First time using Slack MCP to post as Jeremy", sentiment: 0.8 });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      const upserted = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upserted.name).toBe("Slack Experiments");
    });

    it("uses candidateDescription as fallback for new topic when model omits description", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateName: "Slack Experiments", candidateDescription: "Candidate description from scan", candidateCategory: "Event" },
      });
      const response = createMockResponse(request, { name: "Slack Experiments", sentiment: 0.8 });
      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);
      const upserted = (state.human_topic_upsert as any).mock.calls[0][0];
      expect(upserted.description).toBe("Candidate description from scan");
    });

    it("throws for new topic when name and description are unresolvable", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateCategory: "Event" },
      });
      const response = createMockResponse(request, { sentiment: 0.8 });
      await expect(handlers[LLMNextStep.HandleTopicUpdate](response, state as any)).rejects.toThrow("Cannot create new topic");
    });
  });

  describe("handlePersonUpdate", () => {
    it("sets interested_personas to [personaId] for new people", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          existingItemId: undefined,
          candidateName: "New Person",
          candidateRelationship: "friend",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "New Person",
        description: "A new person in user's life",
        sentiment: 0.7,
        relationship: "friend",
        exposure_desired: 0.5,
        exposure_impact: "medium",
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      expect(state.human_person_upsert).toHaveBeenCalledTimes(1);
      const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upsertedPerson.interested_personas).toEqual(["persona-1"]);
    });

    it("merges personaId into existing interested_personas (unique)", async () => {
      state._human.people.push({
        id: "existing-person",
        name: "Existing Person",
        description: "Already known",
        relationship: "colleague",
        sentiment: 0.5,
        exposure_current: 0.4,
        exposure_desired: 0.4,
        last_updated: "",
        interested_personas: ["persona-2"],
        identifiers: [],
        validated_date: "",
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-person",
          candidateRelationship: "colleague",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Existing Person",
        description: "Updated description",
        sentiment: 0.6,
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upsertedPerson.interested_personas).toContain("persona-1");
      expect(upsertedPerson.interested_personas).toContain("persona-2");
      expect(upsertedPerson.interested_personas).toHaveLength(2);
    });

    it("sets sources on new person from context", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          existingItemId: undefined,
          candidateName: "New Person",
          candidateRelationship: "friend",
          sources: ["cursor:composer-abc"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "New Person",
        description: "Someone new",
        sentiment: 0.5,
        relationship: "friend",
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upsertedPerson.sources).toEqual(["cursor:composer-abc"]);
    });

    it("accumulates sources on existing person (grow-only union, deduped)", async () => {
      state._human.people.push({
        id: "existing-person",
        name: "Existing Person",
        description: "Already known",
        relationship: "colleague",
        sentiment: 0.5,
        exposure_current: 0.4,
        exposure_desired: 0.4,
        last_updated: "",
        interested_personas: [],
        identifiers: [],
        sources: ["claudecode:uuid-1"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-person",
          candidateRelationship: "colleague",
          sources: ["claudecode:uuid-1", "opencode:ses_xyz"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Existing Person",
        description: "Updated",
        sentiment: 0.6,
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upsertedPerson.sources).toContain("claudecode:uuid-1");
      expect(upsertedPerson.sources).toContain("opencode:ses_xyz");
      expect(upsertedPerson.sources).toHaveLength(2);
    });
  });

  describe("handlePersonUpdate — partial model responses (Haiku omission patterns)", () => {
    const existingPerson: Person = {
      id: "existing-person",
      name: "David",
      description: "Existing description of David",
      sentiment: 0.75,
      relationship: "Coworker",
      exposure_current: 0.6,
      exposure_desired: 0.5,
      last_updated: "",
      interested_personas: [],
      identifiers: [{ type: "Full Name", value: "David Moody" }],
    };

    beforeEach(() => {
      state._human.people.push({ ...existingPerson });
    });

    it("uses existing description when model omits description on update", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-person", candidateName: "David", candidateRelationship: "Coworker" },
      });
      const response = createMockResponse(request, { sentiment: 0.8 });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.description).toBe("Existing description of David");
    });

    it("uses existing sentiment when model omits sentiment on update", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-person", candidateName: "David", candidateRelationship: "Coworker" },
      });
      const response = createMockResponse(request, { description: "Updated description" });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.sentiment).toBe(0.75);
    });

    it("uses existing description when model returns boolean true for description", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-person", candidateName: "David", candidateRelationship: "Coworker" },
      });
      const response = createMockResponse(request, { description: true, sentiment: 0.8 });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.description).toBe("Existing description of David");
    });

    it("skips update (no upsert) when existing person has no description and model omits it", async () => {
      state._human.people[0].description = "";
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: false, existingItemId: "existing-person", candidateName: "David", candidateRelationship: "Coworker" },
      });
      const response = createMockResponse(request, { sentiment: 0.8 });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      expect(state.human_person_upsert).not.toHaveBeenCalled();
    });

    it("uses candidateDescription as fallback for new person when model omits description", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateName: "Alice", candidateDescription: "Candidate description from scan", candidateRelationship: "Friend" },
      });
      const response = createMockResponse(request, { sentiment: 0.5 });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.description).toBe("Candidate description from scan");
    });

    it("defaults sentiment to 0 for new person when model omits it", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateName: "Alice", candidateDescription: "A new person", candidateRelationship: "Friend" },
      });
      const response = createMockResponse(request, { description: "A new person I met" });
      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.sentiment).toBe(0);
    });

    it("throws for new person when description is unresolvable", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "Sisyphus", isNewItem: true, candidateName: "Alice", candidateRelationship: "Friend" },
      });
      const response = createMockResponse(request, { sentiment: 0.5 });
      await expect(handlers[LLMNextStep.HandlePersonUpdate](response, state as any)).rejects.toThrow("Cannot create new person");
    });
  });

  describe("handlePersonUpdate — identifier type normalization", () => {
    function makePersonUpdateRequest(isNewItem: boolean, existingItemId?: string) {
      return createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem,
          existingItemId,
          candidateName: "Someone",
          candidateRelationship: "friend",
          messages_context: [],
          messages_analyze: [],
        },
      });
    }

    it("normalizes lowercase type to canonical built-in on new person", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "nickname", value: "Flare", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Nickname", value: "Flare" })
      );
    });

    it("normalizes underscored type to canonical built-in on new person", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "full_name", value: "Jeremy Scherer", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Full Name", value: "Jeremy Scherer" })
      );
    });

    it("normalizes uppercase type to canonical built-in on new person", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "EMAIL", value: "test@example.com", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Email", value: "test@example.com" })
      );
    });

    it("normalizes type in identifiers_to_add on existing person update", async () => {
      state._human.people.push({
        id: "existing-person",
        name: "Someone",
        description: "Known",
        relationship: "friend",
        sentiment: 0,
        exposure_current: 0,
        exposure_desired: 0.5,
        last_updated: "",
        identifiers: [{ type: "Nickname", value: "Someone", is_primary: true }],
        interested_personas: [],
        validated_date: "",
      });

      const request = makePersonUpdateRequest(false, "existing-person");
      const response = createMockResponse(request, {
        description: "Updated",
        sentiment: 0,
        identifiers_to_add: [{ type: "full_name", value: "Someone Real" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Full Name", value: "Someone Real" })
      );
    });

    it("fallback auto-identifier uses 'Full Name' for names with spaces", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          candidateName: "Jeremy Scherer",
          candidateRelationship: "friend",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Full Name", value: "Jeremy Scherer", is_primary: true })
      );
    });

    it("fallback auto-identifier uses 'Nickname' for single-word names", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          candidateName: "Flare",
          candidateRelationship: "friend",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Nickname", value: "Flare", is_primary: true })
      );
    });

    it("preserves unknown custom type when no match exists", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "sehimu_thinara", value: "SomeValue" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "sehimu_thinara", value: "SomeValue" })
      );
    });
  });

  describe("handlePersonUpdate — Ei Persona identifier gets Nickname companion", () => {
    const EI_PERSONA_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

    beforeEach(() => {
      state.persona_add({
        id: EI_PERSONA_ID,
        display_name: "Beta",
        aliases: [],
        short_description: "test persona",
        long_description: "",
        traits: [],
        topics: [],
        group_primary: null,
      } as any);
    });

    it("injects Nickname with display_name when Ei Persona identifier is primary on new person", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          candidateName: EI_PERSONA_ID,
          candidateRelationship: "AI Persona",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "An AI persona",
        sentiment: 0,
        relationship: "AI Persona",
        identifiers: [{ type: "Ei Persona", value: EI_PERSONA_ID, is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.name).toBe("Beta");
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Nickname", value: "Beta", is_primary: true })
      );
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Ei Persona", value: EI_PERSONA_ID })
      );
      const eiPersonaEntry = upserted.identifiers.find((i: any) => i.type === "Ei Persona");
      expect(eiPersonaEntry?.is_primary).toBeFalsy();
    });

    it("injects Nickname when Ei Persona added via identifiers_to_add on existing person", async () => {
      state._human.people.push({
        id: "existing-persona-person",
        name: "Unknown",
        description: "An AI persona",
        relationship: "AI Persona",
        sentiment: 0,
        exposure_current: 0,
        exposure_desired: 0.5,
        last_updated: "",
        identifiers: [],
        interested_personas: [],
        validated_date: "",
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: false,
          existingItemId: "existing-persona-person",
          candidateName: "Unknown",
          candidateRelationship: "AI Persona",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "Updated",
        sentiment: 0,
        identifiers_to_add: [{ type: "Ei Persona", value: EI_PERSONA_ID, is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.name).toBe("Beta");
      expect(upserted.identifiers).toContainEqual(
        expect.objectContaining({ type: "Nickname", value: "Beta", is_primary: true })
      );
    });

    it("does not duplicate Nickname if already present", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          candidateName: "Beta",
          candidateRelationship: "AI Persona",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "An AI persona",
        sentiment: 0,
        relationship: "AI Persona",
        identifiers: [
          { type: "Nickname", value: "Beta", is_primary: true },
          { type: "Ei Persona", value: EI_PERSONA_ID },
        ],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      const nicknames = upserted.identifiers.filter((i: any) => i.type === "Nickname" && i.value === "Beta");
      expect(nicknames).toHaveLength(1);
    });

    it("leaves identifiers unchanged when no Ei Persona identifier present", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem: true,
          candidateName: "Alice",
          candidateRelationship: "Friend",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, {
        description: "A friend",
        sentiment: 0,
        identifiers: [{ type: "Nickname", value: "Alice", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toHaveLength(1);
      expect(upserted.identifiers[0]).toMatchObject({ type: "Nickname", value: "Alice" });
    });
  });

  describe("handlePersonUpdate — learned_on preservation", () => {
    it("sets learned_on on new person", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "TestPersona", isNewItem: true, candidateName: "New Person", candidateRelationship: "friend", messages_context: [], messages_analyze: [] },
      });
      await handlers[LLMNextStep.HandlePersonUpdate](createMockResponse(request, { description: "A person", sentiment: 0 }), state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.learned_on).toBeDefined();
    });

    it("preserves learned_on from existing person on update", async () => {
      const ORIGINAL_DATE = "2024-01-01T00:00:00.000Z";
      state._human.people.push({
        id: "existing-person", name: "Someone", description: "Known", relationship: "friend",
        sentiment: 0, exposure_current: 0, exposure_desired: 0.5, last_updated: "",
        learned_on: ORIGINAL_DATE, identifiers: [], interested_personas: [], validated_date: "",
      });
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: { personaId: "persona-1", personaDisplayName: "TestPersona", isNewItem: false, existingItemId: "existing-person", candidateRelationship: "friend", messages_context: [], messages_analyze: [] },
      });
      await handlers[LLMNextStep.HandlePersonUpdate](createMockResponse(request, { description: "Updated", sentiment: 0 }), state as any);
      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.learned_on).toBe(ORIGINAL_DATE);
    });
  });

  describe("handlePersonUpdate — Ei Persona identifier rules", () => {
    const PERSONA_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    function makePersonUpdateRequest(isNewItem: boolean, existingItemId?: string) {
      return createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          isNewItem,
          existingItemId,
          candidateName: "Someone",
          candidateRelationship: "friend",
          messages_context: [],
          messages_analyze: [],
        },
      });
    }

    it("Rule 1: keeps a valid UUID value for Ei Persona unchanged", async () => {
      state._personas[PERSONA_UUID] = { id: PERSONA_UUID, display_name: "Sisyphus", aliases: [] } as any;
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: PERSONA_UUID, is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_UUID }));
    });

    it("Rule 3: resolves display name to UUID when persona is found", async () => {
      state._personas[PERSONA_UUID] = { id: PERSONA_UUID, display_name: "Sisyphus", aliases: ["Sisy"] } as any;
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "Sisyphus", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_UUID }));
    });

    it("Rule 3: resolves alias to UUID when persona is found by alias", async () => {
      state._personas[PERSONA_UUID] = { id: PERSONA_UUID, display_name: "Sisyphus", aliases: ["Sisy"] } as any;
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "Sisy", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_UUID }));
    });

    it("Rule 3: reclassifies unresolvable Ei Persona value as Nickname", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "GhostPersona", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Nickname", value: "GhostPersona" }));
    });

    it("Rule 3: reclassified Nickname becomes the person's name when primary", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "Sisy", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Nickname", value: "Sisy", is_primary: true }));
    });

    it("normalizes 'AI Persona' to 'Ei Persona' when UUID is valid", async () => {
      state._personas[PERSONA_UUID] = { id: PERSONA_UUID, display_name: "Sisyphus", aliases: [] } as any;
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "AI Persona", value: PERSONA_UUID, is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_UUID }));
    });

    it("normalizes 'AI Persona' display name to UUID when persona is found", async () => {
      state._personas[PERSONA_UUID] = { id: PERSONA_UUID, display_name: "Sisyphus", aliases: [] } as any;
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "AI Persona", value: "Sisyphus", is_primary: true }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_UUID }));
    });

    it("keeps unresolvable 'AI Persona' as AI Persona (not Nickname)", async () => {
      const request = makePersonUpdateRequest(true);
      const response = createMockResponse(request, {
        description: "A person",
        sentiment: 0,
        identifiers: [{ type: "AI Persona", value: "UnknownBot" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
      expect(upserted.identifiers).not.toContainEqual(expect.objectContaining({ type: "Nickname" }));
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "AI Persona", value: "UnknownBot" }));
    });

    it("Rule 3: applies to identifiers_to_add on existing person updates", async () => {
      state._human.people.push({
        id: "existing-person",
        name: "Someone",
        description: "Known",
        relationship: "friend",
        sentiment: 0,
        exposure_current: 0,
        exposure_desired: 0.5,
        last_updated: "",
        identifiers: [{ type: "Nickname", value: "Someone", is_primary: true }],
        interested_personas: [],
        validated_date: "",
      });

      const request = makePersonUpdateRequest(false, "existing-person");
      const response = createMockResponse(request, {
        description: "Updated",
        sentiment: 0,
        identifiers_to_add: [{ type: "Ei Persona", value: "NoSuchPersona" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      const upserted = (state.human_person_upsert as any).mock.calls[0][0];
      expect(upserted.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
      expect(upserted.identifiers).toContainEqual(expect.objectContaining({ type: "Nickname", value: "NoSuchPersona" }));
    });
  });

  describe("handleFactFind - interested_personas", () => {
    it("merges personaId into existing fact's interested_personas", async () => {
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
        interested_personas: ["persona-2"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Test User", evidence: "..." }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledTimes(1);
      const upsertedFact = (state.human_fact_upsert as any).mock.calls[0][0];
      expect(upsertedFact.interested_personas).toContain("persona-1");
      expect(upsertedFact.interested_personas).toContain("persona-2");
    });

    it("creates interested_personas array if existing fact has none", async () => {
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
        interested_personas: undefined,
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Test User", evidence: "..." }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      const upsertedFact = (state.human_fact_upsert as any).mock.calls[0][0];
      expect(upsertedFact.interested_personas).toEqual(["persona-1"]);
    });
  });

  describe("handleFactFind - sources", () => {
    it("accumulates sources on existing fact (grow-only union, deduped)", async () => {
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
        sources: ["opencode:ses_abc123"],
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          sources: ["opencode:ses_abc123", "cursor:composer-1"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Test User", evidence: "..." }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      const upsertedFact = (state.human_fact_upsert as any).mock.calls[0][0];
      expect(upsertedFact.sources).toContain("opencode:ses_abc123");
      expect(upsertedFact.sources).toContain("cursor:composer-1");
      expect(upsertedFact.sources).toHaveLength(2);
    });

    it("sets sources on fact when existing fact has none", async () => {
      state._human.facts.push({
        id: "fact-1",
        name: "Full Name",
        description: "",
        sentiment: 0,
        validated_date: "",
        last_updated: "",
        sources: undefined,
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "persona-1",
          channelDisplayName: "TestPersona",
          sources: ["claudecode:uuid-xyz"],
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        facts: [{ name: "Full Name", value: "Test User", evidence: "..." }],
      });

      await handlers[LLMNextStep.HandleFactFind](response, state as any);

      const upsertedFact = (state.human_fact_upsert as any).mock.calls[0][0];
      expect(upsertedFact.sources).toEqual(["claudecode:uuid-xyz"]);
    });
  });
});

// =============================================================================
// PARTIAL RESPONSE CONTRACT TESTS
//
// Every handler that writes description/sentiment to a human data item must:
//   1. Accept a partial result (any subset of fields) without throwing
//   2. Fall back to existing record values when model omits fields
//   3. Produce a valid upsert OR a clean no-op — never a retry storm
//
// To add a new update handler to this contract: add an entry to UPDATE_HANDLERS.
// The list is intentionally explicit — adding a handler here is a commitment
// that it implements the fallback contract.
// =============================================================================

describe("Human data update handler — partial response contract", () => {
  type UpdateHandlerSpec = {
    step: LLMNextStep;
    label: string;
    existingRecord: Topic | Person;
    seedState: (state: ReturnType<typeof createMockStateManager>, record: Topic | Person) => void;
    makeRequest: (state: ReturnType<typeof createMockStateManager>, record: Topic | Person) => LLMRequest;
    getUpsertMock: (state: ReturnType<typeof createMockStateManager>) => ReturnType<typeof vi.fn>;
    partialCases: Array<{
      label: string;
      result: Record<string, unknown>;
      expectUpsert: boolean;
      assertUpserted?: (upserted: any) => void;
    }>;
  };

  const existingTopic: Topic = {
    id: "contract-topic",
    name: "Ei Platform Architecture",
    description: "Existing topic description",
    sentiment: 0.6,
    exposure_current: 0.4,
    exposure_desired: 0.5,
    last_updated: "",
    interested_personas: [],
  };

  const existingPerson: Person = {
    id: "contract-person",
    name: "David",
    description: "Existing person description",
    sentiment: 0.75,
    relationship: "Coworker",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: "",
    interested_personas: [],
    identifiers: [{ type: "Full Name", value: "David Moody" }],
  };

  const UPDATE_HANDLERS: UpdateHandlerSpec[] = [
    {
      step: LLMNextStep.HandleTopicUpdate,
      label: "handleTopicUpdate",
      existingRecord: existingTopic,
      seedState: (state, record) => { state._human.topics.push({ ...(record as Topic) }); },
      makeRequest: (_state, record) => createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "Sisyphus",
          isNewItem: false,
          existingItemId: record.id,
          candidateCategory: "Project",
          candidateName: (record as Topic).name,
          candidateDescription: (record as Topic).description,
        },
      }),
      getUpsertMock: (state) => state.human_topic_upsert as ReturnType<typeof vi.fn>,
      partialCases: [
        {
          label: "description only — uses existing name and sentiment",
          result: { description: "Updated description" },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.name).toBe("Ei Platform Architecture");
            expect(u.description).toBe("Updated description");
            expect(u.sentiment).toBe(0.6);
          },
        },
        {
          label: "sentiment only — uses existing name and description",
          result: { sentiment: 0.9 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.name).toBe("Ei Platform Architecture");
            expect(u.description).toBe("Existing topic description");
            expect(u.sentiment).toBe(0.9);
          },
        },
        {
          label: "description + sentiment, no name — uses existing name",
          result: { description: "New description", sentiment: 0.8 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.name).toBe("Ei Platform Architecture");
          },
        },
        {
          label: "boolean description — uses existing description",
          result: { description: true, sentiment: 0.7 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.description).toBe("Existing topic description");
          },
        },
      ],
    },
    {
      step: LLMNextStep.HandlePersonUpdate,
      label: "handlePersonUpdate",
      existingRecord: existingPerson,
      seedState: (state, record) => { state._human.people.push({ ...(record as Person) }); },
      makeRequest: (_state, record) => createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          channelDisplayName: "Sisyphus",
          isNewItem: false,
          existingItemId: record.id,
          candidateName: (record as Person).name,
          candidateDescription: (record as Person).description,
          candidateRelationship: (record as Person).relationship,
        },
      }),
      getUpsertMock: (state) => state.human_person_upsert as ReturnType<typeof vi.fn>,
      partialCases: [
        {
          label: "description only — uses existing sentiment",
          result: { description: "Updated description" },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.description).toBe("Updated description");
            expect(u.sentiment).toBe(0.75);
          },
        },
        {
          label: "sentiment only — uses existing description",
          result: { sentiment: 0.9 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.description).toBe("Existing person description");
            expect(u.sentiment).toBe(0.9);
          },
        },
        {
          label: "boolean description — uses existing description",
          result: { description: true, sentiment: 0.8 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.description).toBe("Existing person description");
          },
        },
        {
          label: "description + sentiment — both written",
          result: { description: "New description", sentiment: 0.5 },
          expectUpsert: true,
          assertUpserted: (u) => {
            expect(u.description).toBe("New description");
            expect(u.sentiment).toBe(0.5);
          },
        },
      ],
    },
  ];

  for (const spec of UPDATE_HANDLERS) {
    describe(spec.label, () => {
      let state: ReturnType<typeof createMockStateManager>;

      beforeEach(() => {
        state = createMockStateManager();
        vi.clearAllMocks();
        spec.seedState(state, spec.existingRecord);
      });

      for (const tc of spec.partialCases) {
        it(tc.label, async () => {
          const request = spec.makeRequest(state, spec.existingRecord);
          const response = createMockResponse(request, tc.result);

          await expect(
            handlers[spec.step](response, state as any)
          ).resolves.not.toThrow();

          const mock = spec.getUpsertMock(state);
          if (tc.expectUpsert) {
            expect(mock).toHaveBeenCalledTimes(1);
            if (tc.assertUpserted) {
              tc.assertUpserted(mock.mock.calls[0][0]);
            }
          } else {
            expect(mock).not.toHaveBeenCalled();
          }
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Channel & Speaker Attribution
//
// These tests guard the specific bug fixed in:
//   - handleHumanTopicScan / handleEventScan: channelDisplayName reconstruction
//   - queueTopicUpdate: personaDisplayName mapping added to stored request data
//
// Root cause: quotes were created with channel=undefined because personaDisplayName
// was stored by queueTopicUpdate but handleTopicUpdate was receiving channelDisplayName
// from a ...context spread that did NOT include personaDisplayName.
// ─────────────────────────────────────────────────────────────────────────────

describe("Channel and speaker attribution on quotes", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  // Helper: seed a message for a persona so validateAndStoreQuotes can anchor the quote
  function seedMessage(personaId: string, id: string, role: "human" | "system", content: string): Message {
    const msg: Message = {
      id,
      role,
      content,
      timestamp: new Date().toISOString(),
      read: true,
      context_status: "default" as const,
    };
    (state._messages as Record<string, Message[]>)[personaId] = [
      ...((state._messages as Record<string, Message[]>)[personaId] ?? []),
      msg,
    ];
    return msg;
  }
  function seedPersona(
    id: string,
    displayName: string,
    groupPrimary: string | null = "Engineering",
  ): PersonaEntity {
    const persona: PersonaEntity = {
      id,
      display_name: displayName,
      entity: "system",
      group_primary: groupPrimary,
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
    };
    state._personas[id] = persona;
    return persona;
  }

  function seedTopic(id: string): Topic {
    const topic: Topic = {
      id,
      name: "Quote matching target",
      description: "A topic used to verify quote persistence.",
      sentiment: 0,
      category: "Technical",
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
    };
    state._human.topics.push(topic);
    return topic;
  }

  async function captureTopicQuote(
    quoteText: string,
    options: {
      existingItemId?: string;
      roomId?: string;
      personaId?: string;
      personaDisplayName?: string;
    } = {},
  ): Promise<void> {
    const personaId = options.personaId ?? "persona-1";
    const personaDisplayName = options.personaDisplayName ?? "Sisyphus";
    const candidateName = "Quote matching target";
    const candidateDescription = "A topic used to verify quote persistence.";
    const request = createMockRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        personaId,
        personaDisplayName,
        ...(options.roomId ? { roomId: options.roomId } : {}),
        isNewItem: !options.existingItemId,
        ...(options.existingItemId ? { existingItemId: options.existingItemId } : {}),
        candidateName,
        candidateDescription,
        candidateCategory: "Technical",
        messages_context: [],
        messages_analyze: [],
      },
    });
    const response = createMockResponse(request, {
      name: candidateName,
      description: candidateDescription,
      category: "Technical",
      sentiment: 0.5,
      exposure_desired: 0.5,
      quotes: [{ text: quoteText, reason: "quote matcher regression" }],
    });

    await handlers[LLMNextStep.HandleTopicUpdate](response, state as unknown as StateManager);
  }

  function getAddedQuote(): Quote {
    expect(state.human_quote_add).toHaveBeenCalledTimes(1);
    return state.human_quote_add.mock.calls[0][0] as Quote;
  }

  function expectRawSpan(
    quote: { start?: number | null; end?: number | null; text?: string },
    msgText: string,
    expected: { start: number; end: number; text: string },
  ): void {
    expect(quote.start).toBe(expected.start);
    expect(quote.end).toBe(expected.end);
    expect(quote.text).toBe(expected.text);
    expect(quote.text).toBe(msgText.slice(quote.start!, quote.end!));
  }

  // validateAndStoreQuotes is deliberately private, so these cases exercise its
  // two-level behavior through the public topic-update handler rather than adding
  // a test-only export.
  describe("two-level quote matcher regressions (T1, through handler seam)", () => {
    const cases: Array<{
      name: string;
      message: string;
      candidate: string;
      expected: { start: number; end: number; text: string } | null;
    }> = [
      {
        name: "normalizes curly quotes for a one-word Level 1 match",
        message: "The “word” remains",
        candidate: '"word"',
        expected: { start: 4, end: 10, text: "“word”" },
      },
      {
        name: "uses Level 2 for an ASCII candidate against a Unicode ellipsis",
        message: "thinking… and then the conclusion",
        candidate: "thinking... and then",
        expected: { start: 0, end: 18, text: "thinking… and then" },
      },
      {
        name: "does not let a one-word fallback candidate match",
        message: "thinking… continues",
        candidate: "thinking...",
        expected: null,
      },
      {
        name: "maps a Markdown-normalized match back to the candidate raw span",
        message: "prefix **bold** then exact quote",
        candidate: "then exact quote",
        expected: { start: 16, end: 32, text: "then exact quote" },
      },
    ];

    for (const testCase of cases) {
      it(testCase.name, async () => {
        const msgText = testCase.message;
        seedMessage("persona-1", "matcher-case", "human", msgText);

        await captureTopicQuote(testCase.candidate);

        if (testCase.expected === null) {
          expect(state.human_quote_add).not.toHaveBeenCalled();
          return;
        }

        expectRawSpan(getAddedQuote(), msgText, testCase.expected);
      });
    }
  });

  describe("quote validation scope (primacy/scope regression)", () => {
    it("handleTopicUpdate anchors a quote to the message actually analyzed, not an earlier duplicate elsewhere in persona history", async () => {
      const phrase = "does the pope shit in his hat";
      seedMessage("persona-1", "old-occurrence", "human", `unrelated aside: ${phrase}`);
      const newMsg = seedMessage("persona-1", "new-occurrence", "human", `on topic: ${phrase}`);

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",
          isNewItem: true,
          candidateName: "Quote matching target",
          candidateDescription: "A topic used to verify quote persistence.",
          candidateCategory: "Technical",
          message_ids_to_mark: [newMsg.id],
        },
      });
      const response = createMockResponse(request, {
        name: "Quote matching target",
        description: "A topic used to verify quote persistence.",
        category: "Technical",
        sentiment: 0.5,
        exposure_desired: 0.5,
        quotes: [{ text: phrase, reason: "quote matcher regression" }],
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as unknown as StateManager);

      const quote = getAddedQuote();
      expect(quote.message_id).toBe(newMsg.id);
    });

    it("handlePersonUpdate anchors a quote to the message actually analyzed, not an earlier duplicate elsewhere in persona history", async () => {
      const phrase = "does the pope shit in his hat";
      seedMessage("persona-1", "old-occurrence-person", "human", `unrelated aside: ${phrase}`);
      const newMsg = seedMessage("persona-1", "new-occurrence-person", "human", `on topic: ${phrase}`);

      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",
          isNewItem: true,
          candidateName: "David",
          candidateDescription: "A great collaborator",
          candidateRelationship: "Coworker",
          message_ids_to_mark: [newMsg.id],
        },
      });
      const response = createMockResponse(request, {
        description: "A thoughtful and effective collaborator",
        sentiment: 0.8,
        relationship: "Coworker",
        exposure_desired: 0.5,
        identifiers: [{ type: "Full Name", value: "David", is_primary: true }],
        quotes: [{ text: phrase, reason: "quote matcher regression" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as unknown as StateManager);

      const quote = getAddedQuote();
      expect(quote.message_id).toBe(newMsg.id);
    });

    it("queueTargetedTopicUpdate threads roomId through so a targeted room-topic capture resolves real room messages, not the bogus room.persona_ids.join('|') persona key", async () => {
      const phrase = "does the pope shit in his hat";
      const roomMsg: RoomMessage = {
        id: "room-occurrence",
        parent_id: null,
        role: "persona",
        persona_id: "persona-1",
        content: `on topic: ${phrase}`,
        timestamp: "2020-01-02T00:00:00.000Z",
        read: true,
        context_status: "default" as RoomMessage["context_status"],
      };
      state._roomMessages["room-1"] = [roomMsg];
      state._rooms["room-1"] = {
        id: "room-1",
        display_name: "Test Room",
        entity: "room",
        mode: RoomMode.FreeForAll,
        persona_ids: ["persona-1"],
        active_node_id: null,
        is_archived: false,
        created_at: new Date().toISOString(),
        last_updated: new Date().toISOString(),
        messages: [],
      };
      seedPersona("persona-1", "Sisyphus", "Engineering");
      const topic = seedTopic("topic-room-targeted");

      const queued = queueTargetedTopicUpdate(topic.id, "persona-1", state as unknown as StateManager, "room-1");
      expect(queued).toBeGreaterThan(0);
      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      const enqueuedRequest = state.queue_enqueue.mock.calls[0][0] as LLMRequest;

      // Orchestrator-level fix: roomId must be forwarded so the handler resolves room messages,
      // not the bogus room.persona_ids.join("|") composite persona key (which resolves to zero
      // messages and silently drops every proposed quote).
      expect(enqueuedRequest.data.roomId).toBe("room-1");

      const response = createMockResponse(enqueuedRequest, {
        quotes: [{ text: phrase, reason: "quote matcher regression" }],
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as unknown as StateManager);

      const quote = getAddedQuote();
      expect(quote.message_id).toBe(roomMsg.id);
    });
  });

  describe("handleTopicUpdate — quote channel/speaker", () => {
    it("sets channel to personaDisplayName on extracted quotes", async () => {
      const msgText = "I love working with TypeScript";
      seedMessage("persona-1", "msg-1", "human", msgText);

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",   // ← as queueTopicUpdate now stores it
          isNewItem: true,
          candidateName: "TypeScript",
          candidateDescription: "Strongly typed JS",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "TypeScript",
        description: "Strongly typed JavaScript superset",
        sentiment: 0.8,
        exposure_desired: 0.5,
        quotes: [{ text: "I love working with TypeScript", reason: "direct statement" }],
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      expect(state.human_quote_add).toHaveBeenCalledTimes(1);
      const quote = (state.human_quote_add as ReturnType<typeof vi.fn>).mock.calls[0][0] as Quote;
      expect(quote.channel).toBe("Sisyphus");
      expectRawSpan(quote, msgText, { start: 0, end: msgText.length, text: msgText });
    });

    it("sets speaker=human for human-role message quotes", async () => {
      const msgText = "I love working with TypeScript";
      seedMessage("persona-1", "msg-2", "human", msgText);

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",
          isNewItem: true,
          candidateName: "TypeScript",
          candidateDescription: "Strongly typed JS",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "TypeScript",
        description: "Strongly typed JavaScript superset",
        sentiment: 0.8,
        exposure_desired: 0.5,
        quotes: [{ text: "I love working with TypeScript", reason: "direct statement" }],
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      const quote = (state.human_quote_add as ReturnType<typeof vi.fn>).mock.calls[0][0] as Quote;
      expect(quote.speaker).toBe("human");
      expectRawSpan(quote, msgText, { start: 0, end: msgText.length, text: msgText });
    });

    it("sets speaker=channelDisplayName for non-human-role message quotes", async () => {
      const msgText = "This pattern is worth noting";
      seedMessage("persona-1", "msg-3", "system", msgText);

      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",
          isNewItem: true,
          candidateName: "Patterns",
          candidateDescription: "Design patterns",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Patterns",
        description: "Design patterns in software",
        sentiment: 0.6,
        exposure_desired: 0.5,
        quotes: [{ text: "This pattern is worth noting", reason: "insight" }],
      });

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      const quote = (state.human_quote_add as ReturnType<typeof vi.fn>).mock.calls[0][0] as Quote;
      expect(quote.speaker).toBe("Sisyphus");
      expect(quote.channel).toBe("Sisyphus");
      expectRawSpan(quote, msgText, { start: 0, end: msgText.length, text: msgText });
    });

    it("warns and produces no quote when a candidate misses a real message", async () => {
      const msgText = "This real message contains unrelated evidence only.";
      seedMessage("persona-1", "msg-unmatched", "human", msgText);
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

      try {
        const request = createMockRequest({
          next_step: LLMNextStep.HandleTopicUpdate,
          data: {
            personaId: "persona-1",
            personaDisplayName: "Sisyphus",
            isNewItem: true,
            candidateName: "TypeScript",
            candidateDescription: "Strongly typed JS",
            candidateCategory: "Technical",
            messages_context: [],
            messages_analyze: [],
          },
        });

        const response = createMockResponse(request, {
          name: "TypeScript",
          description: "Strongly typed JavaScript superset",
          sentiment: 0.8,
          exposure_desired: 0.5,
          quotes: [{ text: "hallucinated quote that isnt in any message", reason: "test" }],
        });

        await handlers[LLMNextStep.HandleTopicUpdate](response, state as unknown as StateManager);

        expect(state.human_quote_add).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(
          'Quote not found in messages (both levels), skipping: "hallucinated quote that isnt in any message"'
        ));
      } finally {
        warnSpy.mockRestore();
      }
    });
  });

  describe("handlePersonUpdate — quote channel", () => {
    it("sets channel to personaDisplayName on extracted quotes", async () => {
      const msgText = "David is a great collaborator";
      seedMessage("persona-1", "msg-4", "human", msgText);

      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Sisyphus",   // ← as queuePersonUpdate stores it
          isNewItem: true,
          candidateName: "David",
          candidateDescription: "A great collaborator",
          candidateRelationship: "Coworker",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        description: "A thoughtful and effective collaborator",
        sentiment: 0.8,
        relationship: "Coworker",
        exposure_desired: 0.5,
        identifiers: [{ type: "Full Name", value: "David", is_primary: true }],
        quotes: [{ text: "David is a great collaborator", reason: "direct praise" }],
      });

      await handlers[LLMNextStep.HandlePersonUpdate](response, state as any);

      expect(state.human_quote_add).toHaveBeenCalledTimes(1);
      const quote = (state.human_quote_add as ReturnType<typeof vi.fn>).mock.calls[0][0] as Quote;
      expect(quote.channel).toBe("Sisyphus");
      expectRawSpan(quote, msgText, { start: 0, end: msgText.length, text: msgText });
    });
  });

  describe("handleTopicUpdate quote persistence regressions (T2)", () => {
    it("persists normalized-exact raw provenance and topic metadata", async () => {
      const msgText = "The “release plan” is ready";
      const message = seedMessage("persona-1", "msg-normalized", "human", msgText);
      seedPersona("persona-1", "Sisyphus", "Engineering");
      const topic = seedTopic("topic-normalized");

      await captureTopicQuote('The "release plan" is ready', { existingItemId: topic.id });

      const quote = getAddedQuote();
      expectRawSpan(quote, msgText, { start: 0, end: 27, text: msgText });
      expect(quote.message_id).toBe(message.id);
      expect(quote.data_item_ids).toEqual([topic.id]);
      expect(quote.persona_groups).toEqual(["Engineering"]);
    });

    it("persists fallback raw provenance and topic metadata", async () => {
      const msgText = "thinking… and then the conclusion";
      const message = seedMessage("persona-1", "msg-fallback", "human", msgText);
      seedPersona("persona-1", "Sisyphus", "Engineering");
      const topic = seedTopic("topic-fallback");

      await captureTopicQuote("thinking... and then", { existingItemId: topic.id });

      const quote = getAddedQuote();
      expectRawSpan(quote, msgText, { start: 0, end: 18, text: "thinking… and then" });
      expect(quote.message_id).toBe(message.id);
      expect(quote.data_item_ids).toEqual([topic.id]);
      expect(quote.persona_groups).toEqual(["Engineering"]);
    });
  });

  // Beta C1: quote persona_groups tagging must match the pattern
  // handleTopicUpdate/handlePersonUpdate already use for the Topic's/Person's
  // own persona_groups — every room participant's group_primary, not just the
  // primary persona who happened to run this extraction pass. Two personas in
  // the same room already see every message in it, so a quote captured from a
  // multi-persona room must be visible to every one of them.
  describe("quote persona_groups reflect the full room roster, not just the primary persona (Beta C1)", () => {
    it("tags a newly created quote with every room participant's persona group", async () => {
      const msgText = "The room agreed the migration plan was solid";
      const roomMessage: RoomMessage = {
        id: "room-msg-multi-groups",
        parent_id: null,
        role: "persona",
        persona_id: "persona-eng",
        content: msgText,
        timestamp: new Date().toISOString(),
        read: true,
        context_status: "default" as RoomMessage["context_status"],
      };
      state._roomMessages["room-multi-groups"] = [roomMessage];
      seedPersona("persona-eng", "Engineer Bot", "Engineering");
      seedPersona("persona-res", "Research Bot", "Research");
      const topic = seedTopic("topic-multi-room-groups");

      await captureTopicQuote("migration plan was solid", {
        existingItemId: topic.id,
        roomId: "room-multi-groups",
        personaId: "persona-eng|persona-res",
      });

      // Both room participants' groups are present — not just persona-eng, the
      // one this extraction call happened to be primary for.
      const quote = getAddedQuote();
      expect(quote.persona_groups).toEqual(["Engineering", "Research"]);
    });
  });

  describe("overlapping quote merge (T3)", () => {
    it("updates the existing quote with the raw union span and deduplicated metadata", async () => {
      const msgText = "The durable architecture protects people.";
      const message = seedMessage("persona-1", "msg-merge", "human", msgText);
      seedPersona("persona-1", "Sisyphus", "Research");
      const topic = seedTopic("topic-merge");
      const existingQuote: Quote = {
        id: "quote-existing",
        message_id: message.id,
        data_item_ids: ["topic-existing"],
        persona_groups: ["Existing Group"],
        text: msgText.slice(0, 24),
        speaker: "human",
        channel: "Prior channel",
        timestamp: message.timestamp,
        start: 0,
        end: 24,
        created_at: new Date().toISOString(),
        created_by: "extraction",
        embedding: [0.1, 0.2],
      };
      state._human.quotes.push(existingQuote);

      await captureTopicQuote("architecture protects", { existingItemId: topic.id });

      expect(state.human_quote_add).not.toHaveBeenCalled();
      expect(state.human_quote_update).toHaveBeenCalledTimes(1);
      const [quoteId, updates] = state.human_quote_update.mock.calls[0] as [
        string,
        Partial<Quote>,
      ];
      expect(quoteId).toBe(existingQuote.id);
      expectRawSpan(updates, msgText, {
        start: 0,
        end: 33,
        text: "The durable architecture protects",
      });
      expect(updates.data_item_ids).toEqual(["topic-existing", topic.id]);
      expect(updates.persona_groups).toEqual(["Existing Group", "Research"]);
      expect(new Set(updates.data_item_ids).size).toBe(updates.data_item_ids?.length);
      expect(new Set(updates.persona_groups).size).toBe(updates.persona_groups?.length);

      const mergedQuote = state._human.quotes.find(quote => quote.id === existingQuote.id);
      expect(mergedQuote).toBeDefined();
      expectRawSpan(mergedQuote!, msgText, {
        start: 0,
        end: 33,
        text: "The durable architecture protects",
      });
    });

    it("N-way (3+): a single extraction absorbs every overlapping quote on the message, not just the first (ADR-030)", async () => {
      // Precomputed word offsets (verified with node, not hand-counted):
      // alpha[0,5) bravo[6,11) charlie[12,19) delta[20,25) echo[26,30)
      // foxtrot[31,38) golf[39,43) hotel[44,49). Length 49.
      //
      // Beta C1: persona_groups on `left`/`mid`/`right` below are each a
      // REALISTIC two-persona room roster (not an arbitrary single-word label
      // standing in for "whichever persona happened to run that extraction"),
      // deliberately overlapping across rooms — Research is shared by `left`
      // and this call's own room; Engineering is shared by `mid` and `right` —
      // so the union this test asserts has to actually dedupe, not merely
      // concatenate four lists. That union is only safe to trust because every
      // quote's persona_groups is now tagged with its own FULL room roster at
      // creation time; the oracle assertions at the end confirm every real
      // participant of every contributing room can still see the survivor.
      const msgText = "alpha bravo charlie delta echo foxtrot golf hotel";
      const roomMessage: RoomMessage = {
        id: "room-msg-merge-nway",
        parent_id: null,
        role: "persona",
        persona_id: "persona-cur-a",
        content: msgText,
        timestamp: new Date().toISOString(),
        read: true,
        context_status: "default" as RoomMessage["context_status"],
      };
      state._roomMessages["room-nway"] = [roomMessage];
      seedPersona("persona-cur-a", "Designer Bot", "Design");
      seedPersona("persona-cur-b", "Researcher Bot", "Research");
      const topic = seedTopic("topic-merge-nway");
      const left: Quote = {
        id: "quote-left",
        message_id: roomMessage.id,
        data_item_ids: ["topic-left"],
        persona_groups: ["Product", "Research"], // room-left's own two-persona roster
        text: "alpha bravo",
        speaker: "human",
        channel: "Prior channel",
        timestamp: roomMessage.timestamp,
        start: 0,
        end: 11,
        created_at: new Date().toISOString(),
        created_by: "extraction",
        embedding: [0.1, 0.2],
      };
      const mid: Quote = {
        id: "quote-mid",
        message_id: roomMessage.id,
        data_item_ids: ["topic-mid"],
        persona_groups: ["Research", "Engineering"], // room-mid's own two-persona roster
        text: "delta",
        speaker: "human",
        channel: "Prior channel",
        timestamp: roomMessage.timestamp,
        start: 20,
        end: 25,
        created_at: new Date().toISOString(),
        created_by: "extraction",
        embedding: [0.3, 0.4],
      };
      const right: Quote = {
        id: "quote-right",
        message_id: roomMessage.id,
        data_item_ids: ["topic-right"],
        persona_groups: ["Engineering", "Support"], // room-right's own two-persona roster
        text: "foxtrot golf hotel",
        speaker: "human",
        channel: "Prior channel",
        timestamp: roomMessage.timestamp,
        start: 31,
        end: 49,
        created_at: new Date().toISOString(),
        created_by: "extraction",
        embedding: [0.5, 0.6],
      };
      state._human.quotes.push(left, mid, right);

      await captureTopicQuote("bravo charlie delta echo foxtrot", {
        existingItemId: topic.id,
        roomId: "room-nway",
        personaId: "persona-cur-a|persona-cur-b",
      });

      // The Array.find() defect this closes: with three overlapping
      // quotes, the old code absorbed only the first and left the other
      // two still overlapping. Here all three are absorbed into ONE
      // surviving record and nothing new is inserted.
      expect(state.human_quote_add).not.toHaveBeenCalled();
      expect(state.human_quote_update).toHaveBeenCalledTimes(1);
      const [quoteId, updates] = state.human_quote_update.mock.calls[0] as [
        string,
        Partial<Quote>,
      ];
      expect(quoteId).toBe(left.id);
      expectRawSpan(updates, msgText, { start: 0, end: 49, text: msgText });
      expect(updates.data_item_ids).toEqual(["topic-left", topic.id, "topic-mid", "topic-right"]);
      // Union of four room rosters (survivor, this call's own room, then each
      // absorbed quote's room) with Research and Engineering deduped exactly
      // once each, first-seen order preserved.
      expect(updates.persona_groups).toEqual(["Product", "Research", "Design", "Engineering", "Support"]);
      expect(new Set(updates.data_item_ids).size).toBe(updates.data_item_ids?.length);
      expect(new Set(updates.persona_groups).size).toBe(updates.persona_groups?.length);

      // Both non-survivor quotes were actually removed, not merely
      // orphaned by an update that widened only the first match.
      expect(state.human_quote_remove).toHaveBeenCalledTimes(2);
      expect(state.human_quote_remove.mock.calls.map(call => call[0]).sort()).toEqual(["quote-mid", "quote-right"]);

      expect(state._human.quotes).toHaveLength(1);
      const mergedQuote = state._human.quotes.find(quote => quote.id === left.id);
      expect(mergedQuote).toBeDefined();
      expectRawSpan(mergedQuote!, msgText, { start: 0, end: 49, text: msgText });
      // Provenance invariant, explicit: the merged text is still exactly
      // the source slice for its widened span.
      expect(mergedQuote!.text).toBe(msgText.slice(mergedQuote!.start!, mergedQuote!.end!));

      // Beta C1 oracle: this is the check that actually resolves the finding —
      // not "did the union compute the right array" (already asserted above)
      // but "can every persona who was actually a participant of one of the
      // four contributing rooms still see the merged quote". Each of these
      // was a real room participant for the quote whose group(s) they hold;
      // the union only ever adds groups, so nobody who could see their own
      // room's quote before the merge loses visibility into the survivor.
      const roomParticipantGroups: Record<string, string> = {
        "persona-cur-a": "Design",
        "persona-cur-b": "Research",
        "persona-left-a": "Product",
        "persona-left-b": "Research",
        "persona-mid-a": "Research",
        "persona-mid-b": "Engineering",
        "persona-right-a": "Engineering",
        "persona-right-b": "Support",
      };
      for (const [id, group_primary] of Object.entries(roomParticipantGroups)) {
        const visible = filterQuotesByPersonaGroupVisibility([mergedQuote!], { id, group_primary });
        expect(visible.length, `${id} (group ${group_primary}) should see the merged quote`).toBe(1);
      }

      // Conversely, a persona from a group that was never in any of the four
      // rooms must NOT see the merged quote — the union isn't a free-for-all.
      const outsider = { id: "persona-outsider", group_primary: "Legal" };
      expect(filterQuotesByPersonaGroupVisibility([mergedQuote!], outsider)).toHaveLength(0);
    });
  });

  describe("duplicate occurrence selection (T4)", () => {
    it("anchors an exact candidate to its first raw occurrence", async () => {
      const msgText = "Start exact phrase middle exact phrase finish";
      seedMessage("persona-1", "msg-duplicate", "human", msgText);
      const topic = seedTopic("topic-duplicate");

      await captureTopicQuote("exact phrase", { existingItemId: topic.id });

      expectRawSpan(getAddedQuote(), msgText, {
        start: 6,
        end: 18,
        text: "exact phrase",
      });
    });
  });

  describe("room quote route (T5)", () => {
    it("normalizes a room message before persisting its raw provenance", async () => {
      const msgText = "A room-specific insight lands here";
      const roomMessage: RoomMessage = {
        id: "room-msg-1",
        parent_id: null,
        role: "persona",
        persona_id: "room-speaker",
        content: msgText,
        timestamp: new Date().toISOString(),
        read: true,
        context_status: "default" as RoomMessage["context_status"],
      };
      state._roomMessages["room-1"] = [roomMessage];
      seedPersona("persona-1", "Sisyphus", "Engineering");
      seedPersona("room-speaker", "Room Speaker", "General");
      const topic = seedTopic("topic-room");

      await captureTopicQuote("room-specific insight", {
        existingItemId: topic.id,
        roomId: "room-1",
      });

      const quote = getAddedQuote();
      expectRawSpan(quote, msgText, {
        start: 2,
        end: 23,
        text: "room-specific insight",
      });
      expect(quote.message_id).toBe(roomMessage.id);
      expect(quote.speaker).toBe("Room Speaker");
      expect(quote.channel).toBe("Sisyphus");
      expect(quote.data_item_ids).toEqual([topic.id]);
      expect(quote.persona_groups).toEqual(["Engineering"]);
      expect(state.getRoomMessages).toHaveBeenCalledWith("room-1");
      expect(state.messages_get).not.toHaveBeenCalled();
    });
  });

  describe("handleHumanTopicScan — channel reconstruction from personaDisplayName", () => {
    it("runs without error when request data uses personaDisplayName (not channelDisplayName)", async () => {
      // Before the fix, handlers used raw request data cast as ExtractionContext,
      // leaving channelDisplayName undefined. This test ensures the handler
      // executes successfully with the production request data shape.
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTopicScan,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Ei",          // ← production shape from queueTopicScan
          analyze_from_timestamp: null,
          extraction_flag: "t",
          message_ids_to_mark: [],
        },
      });

      const response = createMockResponse(request, {
        topics: [],  // No topics detected — exercises the early-return path
      });

      await expect(
        handlers[LLMNextStep.HandleHumanTopicScan](response, state as any)
      ).resolves.not.toThrow();
    });
  });

  describe("handleEventScan — channel reconstruction from personaDisplayName", () => {
    it("runs without error when request data uses personaDisplayName (not channelDisplayName)", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleEventScan,
        data: {
          personaId: "persona-1",
          personaDisplayName: "Ei",          // ← production shape from queueEventScan
          extraction_flag: "e",
          message_ids_to_mark: [],
        },
      });

      const response = createMockResponse(request, {
        events: [],  // No events — exercises the early-return path
      });

      await expect(
        handlers[LLMNextStep.HandleEventScan](response, state as any)
      ).resolves.not.toThrow();
    });
  });
});

// ---------------------------------------------------------------------------
// Beta Final re-review (2026-08-07) — C1: the prior N-way merge test above
// (`overlapping quote merge (T3)`) was proven non-falsifying. It hand-wrote
// `persona_groups` literals for its "room participants" and queried
// visibility with plain `{id, group_primary}` objects instead of real
// PersonaEntity records, and one of its seeded groups ("Research") was
// already present on a hand-written quote BEFORE the merge ran — so the
// assertion passed identically whether the primary-only bug was present or
// fixed. This block replaces that proxy with the review's required oracle:
// real, persisted PersonaEntity records queried through a real StateManager;
// a room roster built the way room-extraction.ts actually builds it
// (`room.persona_ids.join("|")`); both handleTopicUpdate and
// handlePersonUpdate exercised end to end; and a group (Design) that never
// appears anywhere except via the full-roster tagging this test defends, so
// primary-only tagging necessarily fails the visibility assertions below.
// (Legacy pre-fix quote rows with an incomplete roster are an explicit,
// separately-owned policy question — out of scope here.)
// ---------------------------------------------------------------------------
describe("Beta C1 final re-review — merge visibility from a real room roster, not hand-written labels", () => {
  it("every genuine room participant can see an overlap-merged quote created via handleTopicUpdate + handlePersonUpdate; an outsider cannot", async () => {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());

    // Real, persisted PersonaEntity records — three distinct groups, none of
    // which the test ever hand-attaches to a quote. `personaEng` is first in
    // the room roster, so it is the ONLY group the old primary-only code
    // (pre-7bc2a163) would ever tag a quote with.
    const personaEng: PersonaEntity = {
      id: "persona-c1-eng", display_name: "Engineer Bot", entity: "system",
      group_primary: "Engineering", traits: [], topics: [],
      is_paused: false, is_archived: false, is_static: false,
      last_updated: new Date().toISOString(),
    };
    const personaRes: PersonaEntity = {
      id: "persona-c1-res", display_name: "Researcher Bot", entity: "system",
      group_primary: "Research", traits: [], topics: [],
      is_paused: false, is_archived: false, is_static: false,
      last_updated: new Date().toISOString(),
    };
    const personaDes: PersonaEntity = {
      id: "persona-c1-des", display_name: "Designer Bot", entity: "system",
      group_primary: "Design", traits: [], topics: [],
      is_paused: false, is_archived: false, is_static: false,
      last_updated: new Date().toISOString(),
    };
    const outsider: PersonaEntity = {
      id: "persona-c1-outsider", display_name: "Legal Bot", entity: "system",
      group_primary: "Legal", traits: [], topics: [],
      is_paused: false, is_archived: false, is_static: false,
      last_updated: new Date().toISOString(),
    };
    sm.persona_add(personaEng);
    sm.persona_add(personaRes);
    sm.persona_add(personaDes);
    sm.persona_add(outsider);

    // A real RoomEntity, created through the production addRoom() API — not a
    // hand-built literal — with the three real personas above as its roster.
    // `outsider` is never part of this or any room.
    const room = sm.addRoom({
      display_name: "C1 real-room regression",
      mode: RoomMode.FreeForAll,
      persona_ids: [personaEng.id, personaRes.id, personaDes.id],
      initial_message: "Room opened.",
    });

    // Precomputed word offsets (verified with node, not hand-counted):
    // alpha[0,5) bravo[6,11) charlie[12,19) delta[20,25) echo[26,30)
    // foxtrot[31,38) golf[39,43) hotel[44,49). Length 49.
    const msgText = "alpha bravo charlie delta echo foxtrot golf hotel";
    const roomMessage: RoomMessage = {
      id: "room-msg-c1-real",
      parent_id: null,
      role: "persona",
      persona_id: personaEng.id,
      content: msgText,
      timestamp: new Date().toISOString(),
      read: true,
      context_status: "default" as RoomMessage["context_status"],
    };
    sm.appendRoomMessage(room.id, roomMessage);

    // The exact convention room-extraction.ts uses for both scan targets
    // (queueRoomTopicScan/queueRoomPersonScan): `room.persona_ids.join("|")`,
    // not a synthetic array the test invents.
    const personaId = room.persona_ids.join("|");

    // First contributing quote, through the real handleTopicUpdate entry
    // point: candidate text "bravo charlie" -> [6,19).
    const topicRequest = createMockRequest({
      next_step: LLMNextStep.HandleTopicUpdate,
      data: {
        roomId: room.id,
        personaId,
        personaDisplayName: "C1 Real Room",
        isNewItem: true,
        candidateName: "Migration plan",
        candidateDescription: "The room's migration plan discussion.",
        candidateCategory: "Technical",
      },
    });
    const topicResponse = createMockResponse(topicRequest, {
      name: "Migration plan",
      description: "The room's migration plan discussion.",
      category: "Technical",
      sentiment: 0.5,
      exposure_desired: 0.5,
      quotes: [{ text: "bravo charlie", reason: "topic quote" }],
    });
    await handlers[LLMNextStep.HandleTopicUpdate](topicResponse, sm);

    expect(sm.getHuman().quotes).toHaveLength(1);
    const createdQuoteId = sm.getHuman().quotes[0].id;

    // Second contributing quote, through the real handlePersonUpdate entry
    // point, overlapping the first: candidate text "charlie delta echo" ->
    // [12,30). This is the merge — validateAndStoreQuotes absorbs the first
    // quote and widens it to [6,30) rather than inserting a second record.
    const personRequest = createMockRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        roomId: room.id,
        personaId,
        personaDisplayName: "C1 Real Room",
        isNewItem: true,
        candidateName: "David",
        candidateDescription: "A collaborator mentioned in the room.",
        candidateRelationship: "Coworker",
      },
    });
    const personResponse = createMockResponse(personRequest, {
      description: "A collaborator mentioned in the room discussion.",
      sentiment: 0.5,
      relationship: "Coworker",
      exposure_desired: 0.5,
      identifiers: [{ type: "Full Name", value: "David", is_primary: true }],
      quotes: [{ text: "charlie delta echo", reason: "person quote" }],
    });
    await handlers[LLMNextStep.HandlePersonUpdate](personResponse, sm);

    // Exactly one quote survives the merge — the second capture absorbed
    // into the first, not added alongside it.
    const quotes = sm.getHuman().quotes;
    expect(quotes).toHaveLength(1);
    const survivor = quotes.find(q => q.id === createdQuoteId);
    expect(survivor).toBeDefined();
    expect(survivor!.start).toBe(6);
    expect(survivor!.end).toBe(30);
    expect(survivor!.text).toBe(msgText.slice(6, 30));

    // The falsifying assertion: under the current (fixed) code, the merged
    // quote's persona_groups carries every real room participant's group —
    // Engineering (the primary/first persona_ids entry), Research, and
    // Design, in first-seen order. Under the pre-7bc2a163 primary-only code,
    // this list would be exactly ["Engineering"] no matter how many times
    // the room's quotes are captured or merged, so Research- and
    // Design-only personas would fail the visibility checks below.
    expect(survivor!.persona_groups).toEqual(["Engineering", "Research", "Design"]);

    // Real production predicate, real persisted PersonaEntity records fetched
    // back through the StateManager — not synthetic {id, group_primary}
    // literals — for every genuine participant of the contributing room.
    for (const participant of [personaEng, personaRes, personaDes]) {
      const stored = sm.persona_getById(participant.id);
      expect(stored).not.toBeNull();
      const visible = filterQuotesByPersonaGroupVisibility(quotes, stored!);
      expect(
        visible.map(q => q.id),
        `${stored!.display_name} (group ${stored!.group_primary}) was a genuine room participant and must see the merged quote`
      ).toContain(createdQuoteId);
    }

    // An outsider who was never in this (or any) contributing room must not
    // see it — the union is a real room-witness set, not a free-for-all.
    const storedOutsider = sm.persona_getById(outsider.id);
    expect(storedOutsider).not.toBeNull();
    expect(filterQuotesByPersonaGroupVisibility(quotes, storedOutsider!)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// IRQ-4 / ADR-006 / ADR-010 — write-time one-to-one Person<->Persona guard,
// LLM extraction ingress point. Uses a REAL StateManager (not the mock
// above) so this exercises the actual guardPersonaLinks call inside
// StateManager.human_person_upsert, not merely what handlePersonUpdate
// itself passes to a mocked upsert.
// ---------------------------------------------------------------------------
describe("handlePersonUpdate — persona-link cardinality guard (real StateManager)", () => {
  const PERSONA_A = "11111111-1111-4111-8111-111111111111";
  const PERSONA_B = "22222222-2222-4222-8222-222222222222";

  let sm: StateManager;

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add({
      id: "ei",
      display_name: "Ei",
      entity: "system",
      aliases: ["Ei", "ei"],
      short_description: "",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
    });
  });

  function makePersonUpdateRequest(overrides: Partial<Record<string, unknown>> = {}) {
    return createMockRequest({
      next_step: LLMNextStep.HandlePersonUpdate,
      data: {
        personaId: "persona-1",
        channelDisplayName: "TestPersona",
        isNewItem: true,
        candidateName: "Someone",
        candidateRelationship: "friend",
        messages_context: [],
        messages_analyze: [],
        ...overrides,
      },
    });
  }

  it("a new LLM result with two Ei Persona links keeps neither, but the rest of the write (description) still applies, and a report reaches the ei thread", async () => {
    const request = makePersonUpdateRequest();
    const response = createMockResponse(request, {
      description: "A person with two claimed links",
      sentiment: 0,
      identifiers: [
        { type: "Ei Persona", value: PERSONA_A },
        { type: "Ei Persona", value: PERSONA_B },
        { type: "Nickname", value: "Someone", is_primary: true },
      ],
    });

    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const person = sm.getHuman().people[0];
    expect(person.description).toBe("A person with two claimed links");
    expect(person.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
    expect(person.identifiers).toContainEqual(expect.objectContaining({ type: "Nickname", value: "Someone" }));

    const reports = sm.messages_get("ei");
    expect(reports).toHaveLength(1);
    expect(reports[0].content).toContain(PERSONA_A);
    expect(reports[0].content).toContain(PERSONA_B);
  });

  it("an existing-result identifiers_to_add path introducing a second link keeps the established one and refuses only the new arrival, with the description edit still applying", async () => {
    sm.human_person_upsert({
      id: "existing-person",
      name: "Someone",
      description: "Old description",
      relationship: "friend",
      sentiment: 0,
      exposure_current: 0,
      exposure_desired: 0.5,
      last_updated: "",
      identifiers: [{ type: "Ei Persona", value: PERSONA_A }],
      interested_personas: [],
      validated_date: "",
    });

    const request = makePersonUpdateRequest({ isNewItem: false, existingItemId: "existing-person" });
    const response = createMockResponse(request, {
      description: "Updated description",
      sentiment: 0,
      identifiers_to_add: [{ type: "Ei Persona", value: PERSONA_B }],
    });

    await handlers[LLMNextStep.HandlePersonUpdate](response, sm);

    const person = sm.getHuman().people.find((p) => p.id === "existing-person")!;
    expect(person.description).toBe("Updated description");
    expect(person.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_A }));
    expect(person.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_B }));
  });

  it("two candidates sharing a Persona link (B-many): the later write's link is refused, the earlier Person keeps its link", async () => {
    const firstRequest = makePersonUpdateRequest({ candidateName: "Alice" });
    await handlers[LLMNextStep.HandlePersonUpdate](
      createMockResponse(firstRequest, {
        description: "Alice's bio",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: PERSONA_A }, { type: "Nickname", value: "Alice", is_primary: true }],
      }),
      sm
    );

    const secondRequest = makePersonUpdateRequest({ candidateName: "Bob" });
    await handlers[LLMNextStep.HandlePersonUpdate](
      createMockResponse(secondRequest, {
        description: "Bob's bio",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: PERSONA_A }, { type: "Nickname", value: "Bob", is_primary: true }],
      }),
      sm
    );

    const people = sm.getHuman().people;
    const alice = people.find((p) => p.name === "Alice")!;
    const bob = people.find((p) => p.name === "Bob")!;
    expect(alice.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: PERSONA_A }));
    expect(bob.identifiers).not.toContainEqual(expect.objectContaining({ type: "Ei Persona" }));
  });

  it("a reserved 'ei' value is never treated as a linkable target, so two People can both carry it without refusal", async () => {
    const first = makePersonUpdateRequest({ candidateName: "Alice" });
    await handlers[LLMNextStep.HandlePersonUpdate](
      createMockResponse(first, {
        description: "Alice's bio",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "ei" }, { type: "Nickname", value: "Alice", is_primary: true }],
      }),
      sm
    );
    const second = makePersonUpdateRequest({ candidateName: "Bob" });
    await handlers[LLMNextStep.HandlePersonUpdate](
      createMockResponse(second, {
        description: "Bob's bio",
        sentiment: 0,
        identifiers: [{ type: "Ei Persona", value: "ei" }, { type: "Nickname", value: "Bob", is_primary: true }],
      }),
      sm
    );

    // Not looked up by name: ensureEiPersonaHasNickname (an unrelated,
    // pre-existing behavior) injects "Ei" as the primary Nickname whenever
    // an Ei Persona identifier resolves to a real Persona, which outranks
    // each candidate's own nickname for primacy — both People end up
    // sharing that display name, which is exactly why this test can't key
    // off `.name` and instead asserts against the full People array.
    expect(sm.getHuman().people).toHaveLength(2);
    for (const person of sm.getHuman().people) {
      expect(person.identifiers).toContainEqual(expect.objectContaining({ type: "Ei Persona", value: "ei" }));
    }
    expect(sm.messages_get("ei")).toHaveLength(0);
  });
});

// =============================================================================
// Bolt: persona-emergence-signals-004 (Observation→Signal reducer pipeline)
//
// D1-D9 / R1-R7 / AT1-AT7. Uses a REAL StateManager throughout (not the
// mocked-orchestrators helper above) — the pipeline's own orchestrator
// functions (`queuePersonaSignalScan`/`Match`/`Validate`) are exercised for
// real via `sm.queue_enqueue`, and handlers are invoked directly from the
// real `handlers` map, mirroring the existing "real StateManager" pattern
// above (`handlePersonUpdate — persona-link cardinality guard`).
// =============================================================================

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

function seedChannelMessage(sm: StateManager, channelPersonaId: string, content: string, timestamp = "2026-08-11T00:00:00.000Z"): Message {
  const message: Message = {
    id: `msg-${crypto.randomUUID()}`,
    role: "human",
    content,
    timestamp,
    read: true,
    context_status: ContextStatus.Default,
  };
  sm.messages_append(channelPersonaId, message);
  return message;
}

function makeScanRequest(overrides: Partial<Record<string, unknown>> = {}): LLMRequest {
  return createMockRequest({
    next_step: LLMNextStep.HandlePersonaSignalScan,
    priority: LLMPriority.Low,
    data: {
      personaId: "channel-persona",
      ...overrides,
    },
  });
}

describe("D2/§4.3 branch point — handleHumanPersonScan routes a Persona-linked match into the signal pipeline", () => {
  let sm: StateManager;
  const CHANNEL_ID = "channel-persona";
  const SUBJECT_ID = "sisyphus-id";

  beforeEach(async () => {
    vi.clearAllMocks();
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona("ei", "Ei"));
    sm.persona_add(makeTestPersona(CHANNEL_ID, "Prometheus"));
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
  });

  function makePersonScanRequest(overrides: Partial<Record<string, unknown>> = {}) {
    return createMockRequest({
      next_step: LLMNextStep.HandleHumanPersonScan,
      data: {
        personaId: CHANNEL_ID,
        personaDisplayName: "Prometheus",
        messages_context: [],
        messages_analyze: [],
        ...overrides,
      },
    });
  }

  it("R3/AT1: a Persona-linked existing match is routed to HandlePersonaSignalScan, never queuePersonUpdate — Person.description stays byte-identical", async () => {
    sm.human_person_upsert(makeLinkedPerson("sisyphus-person", "Sisyphus", SUBJECT_ID, { description: "Original description, unchanged." }));
    const message = seedChannelMessage(sm, CHANNEL_ID, "Sisyphus wrote great tests today, very thorough.");

    const request = makePersonScanRequest();
    const response = createMockResponse(request, {
      people: [{ name: "Sisyphus", description: "wrote great tests", relationship: "AI Persona", confidence: 5, reason: "explicit mention" }],
    });

    await handlers[LLMNextStep.HandleHumanPersonScan](response, sm);

    // No generic full-record Person update happened.
    const person = sm.getHuman().people.find(p => p.id === "sisyphus-person")!;
    expect(person.description).toBe("Original description, unchanged.");

    // Instead, exactly one Scan/Extract request was queued for the pipeline.
    const active = sm.queue_getAllActiveItems();
    const scanRequests = active.filter(r => r.next_step === LLMNextStep.HandlePersonaSignalScan);
    expect(scanRequests).toHaveLength(1);
    expect(scanRequests[0].data.subjectPersonaId).toBe(SUBJECT_ID);
    expect(scanRequests[0].data.subjectPersonId).toBe("sisyphus-person");
    expect(active.some(r => r.next_step === LLMNextStep.HandlePersonUpdate)).toBe(false);
    void message;
  });

  it("AT-R16 #9 (ordinary-Person regression): a non-Persona-linked match is completely unaffected — still routes through queuePersonUpdate", async () => {
    sm.human_person_upsert({
      id: "regular-person",
      name: "Alice",
      description: "A friend",
      relationship: "Friend",
      sentiment: 0.5,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
      validated_date: "",
      identifiers: [{ type: "Nickname", value: "Alice", is_primary: true }],
    });
    seedChannelMessage(sm, CHANNEL_ID, "Alice is doing great these days.");

    const request = makePersonScanRequest();
    const response = createMockResponse(request, {
      people: [{ name: "Alice", description: "doing great", relationship: "Friend", confidence: 5, reason: "explicit mention" }],
    });

    await handlers[LLMNextStep.HandleHumanPersonScan](response, sm);

    // queuePersonUpdate is mocked at module scope in this file (see the
    // vi.mock(".../orchestrators/index.js") block above) -- it never
    // touches sm's real queue, so the routing assertion has to be against
    // the mock's own call record, exactly like every other queuePersonUpdate
    // assertion in this file (e.g. the confidence-gated matching describe
    // block below). Checking sm.queue_getAllActiveItems() for
    // HandlePersonUpdate here can never pass -- that was this test's actual
    // defect, not a routing regression in handleHumanPersonScan itself.
    expect(queuePersonUpdate).toHaveBeenCalledTimes(1);
    expect(queuePersonUpdate).toHaveBeenCalledWith(
      { matched_guid: "regular-person" },
      expect.objectContaining({ candidateName: "Alice" }),
      sm
    );

    const active = sm.queue_getAllActiveItems();
    expect(active.some(r => r.next_step === LLMNextStep.HandlePersonaSignalScan)).toBe(false);
  });

  it("R4/AT4: a Persona linked to two Person records soft-alerts and skips — no signal pipeline queued, no update to either record, Ei is warned", async () => {
    sm.human_person_upsert(makeLinkedPerson("sisyphus-person-a", "Sisyphus", SUBJECT_ID, { description: "First record" }));
    // Seeded directly (bypassing human_person_upsert's write-time
    // guardPersonaLinks, which would otherwise refuse this second,
    // competing link) — simulates pre-existing bad data from before the
    // guard existed, exactly the ADR-006/ADR-010 case this resolver must
    // detect at READ time rather than silently repairing or picking one.
    sm.getHuman().people.push(makeLinkedPerson("sisyphus-person-b", "Sisyphus B", SUBJECT_ID, { description: "Second record" }));
    seedChannelMessage(sm, CHANNEL_ID, "Sisyphus wrote great tests today.");

    const request = makePersonScanRequest();
    const response = createMockResponse(request, {
      people: [{ name: "Sisyphus", description: "wrote great tests", relationship: "AI Persona", confidence: 5, reason: "explicit mention" }],
    });

    await handlers[LLMNextStep.HandleHumanPersonScan](response, sm);

    const active = sm.queue_getAllActiveItems();
    expect(active.some(r => r.next_step === LLMNextStep.HandlePersonaSignalScan)).toBe(false);
    expect(active.some(r => r.next_step === LLMNextStep.HandlePersonUpdate)).toBe(false);

    const first = sm.getHuman().people.find(p => p.id === "sisyphus-person-a")!;
    const second = sm.getHuman().people.find(p => p.id === "sisyphus-person-b")!;
    expect(first.description).toBe("First record");
    expect(second.description).toBe("Second record");

    const eiMessages = sm.messages_get("ei");
    expect(eiMessages).toHaveLength(1);
    expect(eiMessages[0].content).toContain("Sisyphus");
    expect(eiMessages[0].content).toContain("multiple person records");
  });
});

describe("resolvePersonaLinkedPeople — read-time enumerate-all (Bolt 004, D8)", () => {
  it("returns an empty array when no Person record links to the persona", () => {
    const people: Person[] = [];
    expect(resolvePersonaLinkedPeople("some-persona", people)).toEqual([]);
  });

  it("returns exactly one match for a well-formed single link", () => {
    const linked = makeLinkedPerson("p1", "Sisyphus", "sisyphus-id");
    const other = makeLinkedPerson("p2", "Beta", "beta-id");
    expect(resolvePersonaLinkedPeople("sisyphus-id", [linked, other])).toEqual([linked]);
  });

  it("enumerates ALL matches rather than returning the first — the multiplicity case", () => {
    const a = makeLinkedPerson("p1", "Sisyphus A", "sisyphus-id");
    const b = makeLinkedPerson("p2", "Sisyphus B", "sisyphus-id");
    const unrelated = makeLinkedPerson("p3", "Beta", "beta-id");
    const result = resolvePersonaLinkedPeople("sisyphus-id", [a, b, unrelated]);
    expect(result).toHaveLength(2);
    expect(result).toEqual(expect.arrayContaining([a, b]));
  });

  it("matches the general Ei Persona type predicate, including the reserved 'ei' value (unlike the write-time guard)", () => {
    const eiRecord = makeLinkedPerson("ei-person", "Ei", "ei");
    expect(resolvePersonaLinkedPeople("ei", [eiRecord])).toEqual([eiRecord]);
  });

  it("is case-insensitive on the identifier type (legacy lowercase 'ei persona')", () => {
    const legacy = makeLinkedPerson("p1", "Sisyphus", "sisyphus-id", { identifiers: [{ type: "ei persona", value: "sisyphus-id" }] });
    expect(resolvePersonaLinkedPeople("sisyphus-id", [legacy])).toEqual([legacy]);
  });
});

describe("classifyObservationLens — dual-lens classification (Bolt 004, D6/R2/AT2, revised 2026-08-19)", () => {
  const completeProvenance: AgentProvenance = {
    harness: "omp",
    agent_id: "sub-agent-1",
    agent_definition_ref: "sisyphus-execute",
    definition_revision: "sha256:aaaa",
    mode: "delegated",
  };

  it("AT2 positive: complete, verified provenance produces an Agent-lens classification", () => {
    const result = classifyObservationLens(completeProvenance);
    expect(result.lens).toBe("agent");
  });

  // 2026-08-19 ruling: the prior version of this suite had a dedicated
  // "Ei's own persona produces zero Agent-lens classifications" test.
  // That's gone by construction now, not merely untested — the function
  // no longer accepts a persona argument at all, so there is no longer any
  // way to even attempt a persona-specific gate here. AT2 positive above
  // already proves complete provenance alone is sufficient for Agent lens.

  it("no provenance at all (ordinary in-Ei conversation) classifies as Persona lens", () => {
    expect(classifyObservationLens(undefined).lens).toBe("persona");
  });

  it.each([
    ["deleted", "harness", undefined],
    ["empty", "harness", ""],
    ["non-string", "harness", 7],
    ["deleted", "agent_id", undefined],
    ["empty", "agent_id", ""],
    ["non-string", "agent_id", 7],
    ["deleted", "agent_definition_ref", undefined],
    ["empty", "agent_definition_ref", ""],
    ["non-string", "agent_definition_ref", 7],
    ["deleted", "definition_revision", undefined],
    ["empty", "definition_revision", ""],
    ["non-string", "definition_revision", 7],
    ["deleted", "mode", undefined],
    ["empty", "mode", ""],
    ["non-string", "mode", 7],
  ] as const)("classifies %s required provenance %s as needs_agent_provenance", (condition, field, value) => {
    const provenance: Record<string, unknown> = { ...completeProvenance };
    if (condition === "deleted") {
      delete provenance[field];
    } else {
      provenance[field] = value;
    }
    expect(classifyObservationLens(provenance)).toEqual({ lens: "needs_agent_provenance" });
  });

  it("classifies null provenance as Persona lens", () => {
    expect(classifyObservationLens(null)).toEqual({ lens: "persona" });
  });

  it("AT-R16 #7 (intentional Agent definition revision): two provenance objects for the same agent_id with different definition_revision hashes both classify as Agent lens independently — no drift flag, no cross-revision comparison", () => {
    const revisionOne = classifyObservationLens(completeProvenance);
    const revisionTwo = classifyObservationLens({ ...completeProvenance, definition_revision: "sha256:bbbb" });
    expect(revisionOne.lens).toBe("agent");
    expect(revisionTwo.lens).toBe("agent");
    expect(revisionOne.lens === "agent" && revisionOne.provenance.definition_revision).toBe("sha256:aaaa");
    expect(revisionTwo.lens === "agent" && revisionTwo.provenance.definition_revision).toBe("sha256:bbbb");
  });
});

describe("handlePersonaSignalScan — Scan/Extract (Bolt 004, D1/D6/D7)", () => {
  let sm: StateManager;
  const CHANNEL_ID = "prometheus-id";
  const SUBJECT_ID = "sisyphus-id";
  const BETA_ID = "beta-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona("ei", "Ei"));
    sm.persona_add(makeTestPersona(CHANNEL_ID, "Prometheus"));
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
    sm.persona_add(makeTestPersona(BETA_ID, "Beta"));
    sm.human_person_upsert(makeLinkedPerson("sisyphus-person", "Sisyphus", SUBJECT_ID));
  });

  it("D7/R3/AT3 worked fixture: a message in Prometheus's own session relaying Beta's observation about Sisyphus resolves observer_persona_id to Beta, never Prometheus", async () => {
    const message = seedChannelMessage(sm, CHANNEL_ID, "Beta called out that Sisyphus wrote great tests during the review.");
    const request = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: SUBJECT_ID,
      subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [message.id],
    });
    const response = createMockResponse(request, {
      observations: [{
        quote_text: "Sisyphus wrote great tests during the review",
        claim: "Sisyphus wrote great tests during the review.",
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: 0.9,
        observer_kind: "other_persona",
        observer_persona_id: BETA_ID,
      }],
    });

    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

    const observations = sm.observations_get(SUBJECT_ID);
    expect(observations).toHaveLength(1);
    expect(observations[0].observer_kind).toBe("other_persona");
    expect(observations[0].observer_persona_id).toBe(BETA_ID);
    expect(observations[0].observer_persona_id).not.toBe(CHANNEL_ID);
    expect(observations[0].subject_person_id).toBe("sisyphus-person");
    expect(observations[0].subject_persona_id).toBe(SUBJECT_ID);
    expect(observations[0].message_id).toBe(message.id);

    // AT-R16 #4 (cross-persona-witness evidence): drive the observation
    // through Match (as "new", since no prior signal exists) and confirm
    // the resulting SIGNAL — not just the observation — carries
    // "other_persona" in its own observer_kinds.
    const matchQueued = sm.queue_getAllActiveItems().find(r => r.next_step === LLMNextStep.HandlePersonaSignalMatch)!;
    expect(matchQueued).toBeDefined();
    const matchResponse = createMockResponse(matchQueued, { matched_guid: "new" });
    await handlers[LLMNextStep.HandlePersonaSignalMatch](matchResponse, sm);

    const signals = sm.signals_get(SUBJECT_ID);
    expect(signals.persona).toHaveLength(1);
    expect(signals.persona[0].observer_kinds).toContain("other_persona");
  });

  it("drops a draft whose quote_text cannot be resolved to any analyzed message, without throwing", async () => {
    const message = seedChannelMessage(sm, CHANNEL_ID, "Something unrelated happened today.");
    const request = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: SUBJECT_ID,
      subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [message.id],
    });
    const response = createMockResponse(request, {
      observations: [{
        quote_text: "This exact phrase never appeared anywhere",
        claim: "A hallucinated claim",
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: 0.9,
        observer_kind: "human",
      }],
    });

    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("D6: a claim with complete Agent provenance against a non-Ei subject queues Match against the agent lens", async () => {
    const message = seedChannelMessage(sm, CHANNEL_ID, "Verified test-writing discipline observed in a CD2+ transcript.");
    const request = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: SUBJECT_ID,
      subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [message.id],
      agentProvenance: { harness: "omp", agent_id: "sub-1", agent_definition_ref: "sisyphus-execute", definition_revision: "sha256:aaaa", mode: "delegated" },
    });
    const response = createMockResponse(request, {
      observations: [{
        quote_text: "Verified test-writing discipline observed in a CD2+ transcript",
        claim: "Verified test-writing discipline observed in a CD2+ transcript.",
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: 0.9,
        observer_kind: "human",
      }],
    });

    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

    const matchRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
    expect(matchRequests).toHaveLength(1);
    expect(matchRequests[0].data.lens).toBe("agent");
  });

  it("2026-08-19 ruling: complete provenance against Ei's own persona now produces an Agent-lens signal — classification never gates on which persona a claim names, only on provenance completeness", async () => {
    sm.human_person_upsert(makeLinkedPerson("ei-person", "Ei", "ei"));
    const message = seedChannelMessage(sm, CHANNEL_ID, "Verified test-writing discipline observed in a CD2+ transcript.");
    const request = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: "ei",
      subjectPersonId: "ei-person",
      message_ids_to_mark: [message.id],
      agentProvenance: { harness: "omp", agent_id: "sub-1", agent_definition_ref: "ei-core", definition_revision: "sha256:aaaa", mode: "delegated" },
    });
    const response = createMockResponse(request, {
      observations: [{
        quote_text: "Verified test-writing discipline observed in a CD2+ transcript",
        claim: "Verified test-writing discipline observed in a CD2+ transcript.",
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: 0.9,
        observer_kind: "human",
      }],
    });

    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

    const matchRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalMatch);
    expect(matchRequests).toHaveLength(1);
    expect(matchRequests[0].data.lens).toBe("agent");
  });

  it("2026-08-20: strips control bytes from an unresolvable claim before console.debug logging (reducer-diagnostics-log-raw-model-controlled-data)", async () => {
    const message = seedChannelMessage(sm, CHANNEL_ID, "Something unrelated happened today.");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    try {
      const request = makeScanRequest({
        personaId: CHANNEL_ID,
        subjectPersonaId: SUBJECT_ID,
        subjectPersonId: "sisyphus-person",
        message_ids_to_mark: [message.id],
      });
      const maliciousClaim = "Escape\x1b[31mANSI\x1b[0m and BEL\x07 bytes in a claim";
      const response = createMockResponse(request, {
        observations: [{
          quote_text: "This exact phrase never appeared anywhere",
          claim: maliciousClaim,
          dimension: "behavior",
          direction: "novel",
          extraction_confidence: 0.9,
          observer_kind: "human",
        }],
      });

      await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

      expect(debugSpy).toHaveBeenCalled();
      for (const call of debugSpy.mock.calls) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      debugSpy.mockRestore();
    }
  });

  it("2026-08-20: strips control bytes from a claim logged on the incomplete-provenance branch (reducer-diagnostics-log-raw-model-controlled-data)", async () => {
    const message = seedChannelMessage(sm, CHANNEL_ID, "Verified test-writing discipline observed in a transcript.");
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    try {
      const request = makeScanRequest({
        personaId: CHANNEL_ID,
        subjectPersonaId: SUBJECT_ID,
        subjectPersonId: "sisyphus-person",
        message_ids_to_mark: [message.id],
        agentProvenance: { harness: "omp" },
      });
      const maliciousClaim = "Escape\x1b[31mANSI\x1b[0m claim";
      const response = createMockResponse(request, {
        observations: [{
          quote_text: "Verified test-writing discipline observed in a transcript",
          claim: maliciousClaim,
          dimension: "behavior",
          direction: "novel",
          extraction_confidence: 0.9,
          observer_kind: "human",
        }],
      });

      await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);

      expect(debugSpy).toHaveBeenCalled();
      for (const call of debugSpy.mock.calls) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      debugSpy.mockRestore();
    }
  });
});

describe("handlePersonaSignalMatch / handlePersonaSignalValidate — Match, Update/Reduce, Validate (Bolt 004, D3/D4/D5)", () => {
  let sm: StateManager;
  const SUBJECT_ID = "sisyphus-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
  });

  function seedObservation(overrides: Partial<Omit<PersonaObservation, "id">> = {}): PersonaObservation {
    return sm.observation_add(SUBJECT_ID, {
      subject_person_id: "sisyphus-person",
      subject_persona_id: SUBJECT_ID,
      observer_kind: "human",
      message_id: "msg-1",
      observed_at: "2026-08-11T00:00:00.000Z",
      dimension: "behavior",
      direction: "novel",
      claim: "Consistently terse conversational tone.",
      extraction_confidence: 0.8,
      ...overrides,
    })!;
  }

  it("matched_guid resolves to an existing open signal — attaches evidence via signal_reduce, then always queues Validate", async () => {
    const existing = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID,
      claim: "Consistently terse conversational tone.",
      dimension: "behavior",
      status: "candidate",
      evidence_ids: [],
      first_observed_at: "2026-08-10T00:00:00.000Z",
      last_observed_at: "2026-08-10T00:00:00.000Z",
      observer_kinds: ["human"],
      recurrence_count: 1,
    })!;
    const observation = seedObservation();

    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalMatch,
      data: { subjectPersonaId: SUBJECT_ID, observationId: observation.id, lens: "persona" },
    });
    const response = createMockResponse(request, { matched_guid: existing.id });

    await handlers[LLMNextStep.HandlePersonaSignalMatch](response, sm);

    const signals = sm.signals_get(SUBJECT_ID);
    expect(signals.persona).toHaveLength(1);
    expect(signals.persona[0].evidence_ids).toContain(observation.id);

    const validateRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalValidate);
    expect(validateRequests).toHaveLength(1);
    expect(validateRequests[0].data.personaId).toBe(SUBJECT_ID);
    expect(validateRequests[0].data.lens).toBe("persona");
  });

  it("D11: a matched_guid outside the open list (e.g. a dismissed signal's id) is a no-op — never silently attached AND never coerced into 'new'", async () => {
    const dismissed = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID,
      claim: "An old, dismissed claim.",
      dimension: "behavior",
      status: "dismissed",
      evidence_ids: [],
      first_observed_at: "2026-08-01T00:00:00.000Z",
      last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"],
      recurrence_count: 1,
    })!;
    const observation = seedObservation({ claim: "A genuinely unrelated new claim." });

    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalMatch,
      data: { subjectPersonaId: SUBJECT_ID, observationId: observation.id, lens: "persona" },
    });
    const response = createMockResponse(request, { matched_guid: dismissed.id });

    await handlers[LLMNextStep.HandlePersonaSignalMatch](response, sm);

    const signals = sm.signals_get(SUBJECT_ID);
    // The dismissed signal itself is untouched...
    const stillDismissed = signals.persona.find(s => s.id === dismissed.id)!;
    expect(stillDismissed.status).toBe("dismissed");
    expect(stillDismissed.evidence_ids).toEqual([]);
    // ...and, per D11, an unresolved (non-"new") matched_guid is a no-op
    // rather than being coerced into "new": no candidate was minted for
    // the observation, and no Validate request was queued.
    expect(signals.persona).toHaveLength(1);
    const validateRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalValidate);
    expect(validateRequests).toHaveLength(0);
  });


  it("D12: a merges array naming a dismissed (non-open) signal voids the WHOLE batch — the sibling well-formed merge is never applied either", async () => {
    const keep = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Terse tone.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const dup = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Terse conversational tone.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-02T00:00:00.000Z", last_observed_at: "2026-08-02T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const dismissed = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Some dismissed claim.", dimension: "behavior", status: "dismissed",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;

    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    // A well-formed keep/dup merge sits alongside an entry naming the
    // dismissed signal. D12: the dismissed entry isn't "one of two open
    // same-lens signals", so the ENTIRE batch is voided before either
    // entry is applied — dup survives exactly like keep and dismissed.
    const response = createMockResponse(request, {
      merges: [
        { keep_id: keep.id, merge_id: dup.id },
        { keep_id: keep.id, merge_id: dismissed.id },
      ],
    });

    await handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm);

    const signals = sm.signals_get(SUBJECT_ID);
    expect(signals.persona.find(s => s.id === keep.id)).toBeDefined();
    const survivingDup = signals.persona.find(s => s.id === dup.id)!;
    expect(survivingDup).toBeDefined();
    expect(survivingDup.evidence_ids).toEqual([]);
    const survivingDismissed = signals.persona.find(s => s.id === dismissed.id)!;
    expect(survivingDismissed.status).toBe("dismissed");
    expect(survivingDismissed.evidence_ids).toEqual([]);
  });


  it("an empty merges list is a clean no-op", async () => {
    const only = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Solo claim.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    const response = createMockResponse(request, { merges: [] });

    await handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm);
    expect(sm.signals_get(SUBJECT_ID).persona).toEqual([only]);
  });
});

describe("AT6/AT-R17 — the full four-step pipeline, exactly three LLM calls, lens separation held through Match", () => {
  let sm: StateManager;
  const CHANNEL_ID = "prometheus-id";
  const SUBJECT_ID = "sisyphus-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona("ei", "Ei"));
    sm.persona_add(makeTestPersona(CHANNEL_ID, "Prometheus"));
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
    sm.human_person_upsert(makeLinkedPerson("sisyphus-person", "Sisyphus", SUBJECT_ID));
  });

  /** Runs Scan → Match → Validate for one drafted observation, taking each
   * queued request off the (real) queue before invoking its handler — so
   * a stray leftover item can never be mistaken for a NEW one queued by a
   * later step, and every "exactly one request queued" assertion below is
   * checking a single step's own output in isolation. */
  async function runOneClaimThroughPipeline(
    scanObservation: { quote_text: string; claim: string; dimension: string; direction: string },
    matchDecision: string | "new",
    validateResult: { merges: Array<{ keep_id: string; merge_id: string }> } = { merges: [] },
    lens?: "persona" | "agent",
    agentProvenance?: Record<string, string>
  ): Promise<{ matchQueued: LLMRequest; validateQueued: LLMRequest }> {
    const message = seedChannelMessage(sm, CHANNEL_ID, scanObservation.quote_text, new Date().toISOString());
    const scanRequest = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: SUBJECT_ID,
      subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [message.id],
      agentProvenance,
    });
    const scanResponse = createMockResponse(scanRequest, {
      observations: [{
        quote_text: scanObservation.quote_text,
        claim: scanObservation.claim,
        dimension: scanObservation.dimension,
        direction: scanObservation.direction,
        extraction_confidence: 0.9,
        observer_kind: "human",
      }],
    });

    const beforeScan = sm.queue_getAllActiveItems().map(r => r.id);
    await handlers[LLMNextStep.HandlePersonaSignalScan](scanResponse, sm);
    const afterScan = sm.queue_getAllActiveItems().filter(r => !beforeScan.includes(r.id));
    const matchQueued = afterScan.find(r => r.next_step === LLMNextStep.HandlePersonaSignalMatch)!;
    expect(matchQueued).toBeDefined();
    if (lens) expect(matchQueued.data.lens).toBe(lens);
    sm.queue_deleteItems([matchQueued.id]);

    const matchResponse = createMockResponse(matchQueued, { matched_guid: matchDecision });
    const beforeMatch = sm.queue_getAllActiveItems().map(r => r.id);
    await handlers[LLMNextStep.HandlePersonaSignalMatch](matchResponse, sm);
    const afterMatch = sm.queue_getAllActiveItems().filter(r => !beforeMatch.includes(r.id));
    // Update/Reduce is the sole deterministic step: it queued NOTHING of
    // its own. Exactly one new request appears — Validate.
    expect(afterMatch).toHaveLength(1);
    const validateQueued = afterMatch[0];
    expect(validateQueued.next_step).toBe(LLMNextStep.HandlePersonaSignalValidate);
    sm.queue_deleteItems([validateQueued.id]);

    const validateResponse = createMockResponse(validateQueued, validateResult);
    await handlers[LLMNextStep.HandlePersonaSignalValidate](validateResponse, sm);

    return { matchQueued, validateQueued };
  }

  it("case 1: a Persona-lens claim restating an existing Persona-lens candidate — Match returns its id, Update/Reduce attaches evidence rather than duplicating", async () => {
    const existing = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Consistently terse conversational tone.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;

    await runOneClaimThroughPipeline(
      { quote_text: "Sisyphus was terse again today", claim: "Consistently terse conversational tone, restated.", dimension: "behavior", direction: "confirms" },
      existing.id,
      { merges: [] },
      "persona"
    );

    const signals = sm.signals_get(SUBJECT_ID);
    expect(signals.persona).toHaveLength(1);
    expect(signals.persona[0].id).toBe(existing.id);
    expect(signals.persona[0].evidence_ids).toHaveLength(1);
  });

  it("case 2: a genuinely new, unrelated Persona-lens claim — Match returns 'new', Update/Reduce creates a distinct candidate; the dismissed fixture stays untouched", async () => {
    const dismissed = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "An old dismissed claim.", dimension: "behavior", status: "dismissed",
      evidence_ids: [], first_observed_at: "2026-07-01T00:00:00.000Z", last_observed_at: "2026-07-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;

    await runOneClaimThroughPipeline(
      { quote_text: "Sisyphus picked up a totally new habit of writing changelogs", claim: "Writes detailed changelogs unprompted.", dimension: "behavior", direction: "novel" },
      "new",
      { merges: [] },
      "persona"
    );

    const signals = sm.signals_get(SUBJECT_ID);
    const stillDismissed = signals.persona.find(s => s.id === dismissed.id)!;
    expect(stillDismissed.status).toBe("dismissed");
    expect(stillDismissed.evidence_ids).toEqual([]);
    expect(signals.persona.some(s => s.status === "candidate" && s.claim === "Writes detailed changelogs unprompted.")).toBe(true);
  });

  it("case 3: an Agent-lens claim restating an existing Agent-lens candidate — Match's shown list never includes the Persona-lens signal", async () => {
    const personaSignal = sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim: "Consistently terse conversational tone.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const agentSignal = sm.signal_add(SUBJECT_ID, "agent", {
      subject_persona_id: SUBJECT_ID, claim: "Verified test-writing discipline observed in a CD2+ transcript.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;

    const { matchQueued } = await runOneClaimThroughPipeline(
      { quote_text: "Verified test-writing discipline observed again in a CD2+ transcript", claim: "Verified test-writing discipline, restated.", dimension: "behavior", direction: "confirms" },
      agentSignal.id,
      { merges: [] },
      "agent",
      { harness: "omp", agent_id: "sub-1", agent_definition_ref: "sisyphus-execute", definition_revision: "sha256:aaaa", mode: "delegated" }
    );

    // D3: the Match prompt's own closed list was built from ONLY the
    // agent-lens bucket — the persona-lens signal's claim text never
    // appears in the system prompt shown to this Match call.
    expect(matchQueued.system).toContain(agentSignal.claim);
    expect(matchQueued.system).not.toContain(personaSignal.claim);

    const signals = sm.signals_get(SUBJECT_ID);
    expect(signals.agent).toHaveLength(1);
    expect(signals.agent[0].id).toBe(agentSignal.id);
    expect(signals.persona).toHaveLength(1);
    expect(signals.persona[0].id).toBe(personaSignal.id);
    expect(signals.persona[0].evidence_ids).toEqual([]);
  });
});

// =============================================================================
// Bolt 004 — review-driven hardening (ReviewBolt004 findings, post-yield).
// P0: Scan must validate enum/scalar fields and other_persona attribution
// before persisting. P1: Match must reject malformed matched_guid rather
// than defaulting to "new". P1: Validate must never let one malformed
// merge entry abort the well-formed entries around it.
// =============================================================================

describe("handlePersonaSignalScan — draft validation (ReviewBolt004 P0)", () => {
  let sm: StateManager;
  const CHANNEL_ID = "prometheus-id";
  const SUBJECT_ID = "sisyphus-id";
  const BETA_ID = "beta-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona("ei", "Ei"));
    sm.persona_add(makeTestPersona(CHANNEL_ID, "Prometheus"));
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
    sm.persona_add(makeTestPersona(BETA_ID, "Beta"));
    sm.human_person_upsert(makeLinkedPerson("sisyphus-person", "Sisyphus", SUBJECT_ID));
  });

  function scanWithOneObservation(observation: Record<string, unknown>) {
    const message = seedChannelMessage(sm, CHANNEL_ID, observation.quote_text as string);
    const request = makeScanRequest({
      personaId: CHANNEL_ID,
      subjectPersonaId: SUBJECT_ID,
      subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [message.id],
    });
    return createMockResponse(request, { observations: [observation] });
  }

  it("drops a draft with an invalid dimension rather than persisting a corrupted observation", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "not-a-real-dimension",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft with an invalid direction", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "sideways",
      extraction_confidence: 0.9,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft with an invalid observer_kind", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "ghost",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft with a non-numeric or non-finite extraction_confidence", async () => {
    for (const badConfidence of ["high", null, NaN, Infinity]) {
      const response = scanWithOneObservation({
        quote_text: "Sisyphus did a thing",
        claim: "Sisyphus did a thing.",
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: badConfidence,
        observer_kind: "human",
      });
      await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    }
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops an other_persona draft with a missing observer_persona_id — cannot manufacture an anonymous witness", async () => {
    const response = scanWithOneObservation({
      quote_text: "Someone said Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "other_persona",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops an other_persona draft whose observer_persona_id does not resolve to any real persona — a forged witness never becomes independent-context evidence", async () => {
    const response = scanWithOneObservation({
      quote_text: "Someone said Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "other_persona",
      observer_persona_id: "totally-made-up-persona-id",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops an other_persona draft whose observer_persona_id resolves to an ARCHIVED persona", async () => {
    sm.persona_add(makeTestPersona("archived-id", "Retired", { is_archived: true }));
    const response = scanWithOneObservation({
      quote_text: "Someone said Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "other_persona",
      observer_persona_id: "archived-id",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops an other_persona draft whose observer_persona_id equals the SUBJECT itself — self-testimony can never masquerade as another witness", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus said Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "other_persona",
      observer_persona_id: SUBJECT_ID,
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("accepts a well-formed other_persona draft whose observer_persona_id resolves to a real, active, non-subject persona", async () => {
    const response = scanWithOneObservation({
      quote_text: "Beta said Sisyphus did a thing",
      claim: "Sisyphus did a thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "other_persona",
      observer_persona_id: BETA_ID,
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    const observations = sm.observations_get(SUBJECT_ID);
    expect(observations).toHaveLength(1);
    expect(observations[0].observer_persona_id).toBe(BETA_ID);
  });

  // Second review pass (ReviewBolt004 C1): the array-element itself, and
  // the claim/quote_text fields, were unvalidated.
  it("drops a null entry in the observations array without throwing, and still processes a well-formed sibling", async () => {
    seedChannelMessage(sm, CHANNEL_ID, "Sisyphus did a thing worth noting");
    const request = makeScanRequest({
      personaId: CHANNEL_ID, subjectPersonaId: SUBJECT_ID, subjectPersonId: "sisyphus-person",
      message_ids_to_mark: sm.messages_get(CHANNEL_ID).map(m => m.id),
    });
    const response = createMockResponse(request, {
      observations: [
        null,
        { quote_text: "Sisyphus did a thing worth noting", claim: "Sisyphus did a thing worth noting.", dimension: "behavior", direction: "novel", extraction_confidence: 0.9, observer_kind: "human" },
      ],
    });
    await expect(handlers[LLMNextStep.HandlePersonaSignalScan](response, sm)).resolves.not.toThrow();
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(1);
  });

  it("R8/AT8(a): an invalid draft creates no observation and queues no Match request, while a valid sibling in the same array queues exactly one", async () => {
    seedChannelMessage(sm, CHANNEL_ID, "Sisyphus did a thing worth noting");
    const request = makeScanRequest({
      personaId: CHANNEL_ID, subjectPersonaId: SUBJECT_ID, subjectPersonId: "sisyphus-person",
      message_ids_to_mark: sm.messages_get(CHANNEL_ID).map(m => m.id),
    });
    const response = createMockResponse(request, {
      observations: [
        { quote_text: "Sisyphus did a thing worth noting", claim: "Sisyphus did a thing worth noting.", dimension: "not-a-real-dimension", direction: "novel", extraction_confidence: 0.9, observer_kind: "human" },
        { quote_text: "Sisyphus did a thing worth noting", claim: "Sisyphus did a thing worth noting.", dimension: "behavior", direction: "novel", extraction_confidence: 0.9, observer_kind: "human" },
      ],
    });

    const beforeQueue = sm.queue_getAllActiveItems().map(r => r.id);
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    const queuedMatchRequests = sm.queue_getAllActiveItems().filter(r => !beforeQueue.includes(r.id) && r.next_step === LLMNextStep.HandlePersonaSignalMatch);

    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(1);
    expect(queuedMatchRequests).toHaveLength(1);
  });


  it("drops entries that are not objects at all (a bare string, a number) in the same array", async () => {
    const request = makeScanRequest({
      personaId: CHANNEL_ID, subjectPersonaId: SUBJECT_ID, subjectPersonId: "sisyphus-person",
      message_ids_to_mark: [],
    });
    const response = createMockResponse(request, { observations: ["not-an-object", 42, ["also", "not"]] });
    await expect(handlers[LLMNextStep.HandlePersonaSignalScan](response, sm)).resolves.not.toThrow();
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft whose claim is not a string (e.g. an object) — never persists a non-string claim that would crash claimsMatch downstream", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a specific thing",
      claim: { nested: "not a string" },
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft whose claim is an empty string", async () => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a specific thing",
      claim: "",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("drops a draft whose quote_text is not a string (e.g. a number) rather than letting it silently fail quote-matching for the wrong reason", async () => {
    const response = scanWithOneObservation({
      quote_text: 7,
      claim: "Sisyphus did a specific thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: 0.9,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it.each([-0.01, 1.01, -5, 100])("drops a draft whose extraction_confidence (%s) is finite but outside the 0.0-1.0 range", async (badConfidence) => {
    const response = scanWithOneObservation({
      quote_text: "Sisyphus did a specific thing",
      claim: "Sisyphus did a specific thing.",
      dimension: "behavior",
      direction: "novel",
      extraction_confidence: badConfidence,
      observer_kind: "human",
    });
    await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(0);
  });

  it("accepts extraction_confidence at the exact 0.0 and 1.0 boundaries", async () => {
    for (const boundary of [0, 1]) {
      const response = scanWithOneObservation({
        quote_text: `Sisyphus did thing number ${boundary}`,
        claim: `Sisyphus did thing number ${boundary}.`,
        dimension: "behavior",
        direction: "novel",
        extraction_confidence: boundary,
        observer_kind: "human",
      });
      await handlers[LLMNextStep.HandlePersonaSignalScan](response, sm);
    }
    expect(sm.observations_get(SUBJECT_ID)).toHaveLength(2);
  });
});

describe("handlePersonaSignalMatch — D11/R8/AT8(b): malformed or non-resolving matched_guid is a no-op, never coerced to 'new'", () => {
  let sm: StateManager;
  const SUBJECT_ID = "sisyphus-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
  });

  function seedObservation(): PersonaObservation {
    return sm.observation_add(SUBJECT_ID, {
      subject_person_id: "sisyphus-person", subject_persona_id: SUBJECT_ID, observer_kind: "human",
      message_id: "msg-1", observed_at: "2026-08-11T00:00:00.000Z", dimension: "behavior",
      direction: "novel", claim: "A claim.", extraction_confidence: 0.8,
    })!;
  }

  it.each([
    ["an empty object (missing matched_guid entirely)", {}],
    ["an explicit null matched_guid — AT8(b)'s named case", { matched_guid: null }],
    ["a number", { matched_guid: 123 }],
    ["an empty string", { matched_guid: "" }],
    ["an array", { matched_guid: ["not-a-string"] }],
  ])("creates no candidate and queues no Validate request (never throws) when the parsed response is %s", async (_label, parsed) => {
    const observation = seedObservation();
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalMatch,
      data: { subjectPersonaId: SUBJECT_ID, observationId: observation.id, lens: "persona" },
    });
    const response = createMockResponse(request, parsed);

    expect(() => handlers[LLMNextStep.HandlePersonaSignalMatch](response, sm)).not.toThrow();
    // No durable side effect from the rejected, malformed response, and
    // no follow-on Validate request queued (D11).
    expect(sm.signals_get(SUBJECT_ID).persona).toHaveLength(0);
    const validateRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalValidate);
    expect(validateRequests).toHaveLength(0);
  });

  it("still accepts the literal 'new' string, and queues Validate", async () => {
    const observation = seedObservation();
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalMatch,
      data: { subjectPersonaId: SUBJECT_ID, observationId: observation.id, lens: "persona" },
    });
    const response = createMockResponse(request, { matched_guid: "new" });
    expect(() => handlers[LLMNextStep.HandlePersonaSignalMatch](response, sm)).not.toThrow();
    expect(sm.signals_get(SUBJECT_ID).persona).toHaveLength(1);
    const validateRequests = sm.queue_getAllActiveItems().filter(r => r.next_step === LLMNextStep.HandlePersonaSignalValidate);
    expect(validateRequests).toHaveLength(1);
  });

  it("2026-08-20: strips control bytes from a matched_guid absent from the open list before console.warn logging (reducer-diagnostics-log-raw-model-controlled-data)", () => {
    const observation = seedObservation();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonaSignalMatch,
        data: { subjectPersonaId: SUBJECT_ID, observationId: observation.id, lens: "persona" },
      });
      const maliciousGuid = "\x1b[31mFAKE-GUID\x1b[0m\x07";
      const response = createMockResponse(request, { matched_guid: maliciousGuid });

      handlers[LLMNextStep.HandlePersonaSignalMatch](response, sm);

      expect(warnSpy).toHaveBeenCalled();
      for (const call of warnSpy.mock.calls) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      warnSpy.mockRestore();
    }
  });
});


describe("handlePersonaSignalValidate — D12/R8/AT8(c): a single malformed/non-resolving merge entry voids the WHOLE batch", () => {
  let sm: StateManager;
  const SUBJECT_ID = "sisyphus-id";

  beforeEach(async () => {
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    sm.persona_add(makeTestPersona(SUBJECT_ID, "Sisyphus"));
  });

  function addOpenSignal(claim: string, overrides: Partial<Parameters<StateManager["signal_add"]>[2]> = {}) {
    return sm.signal_add(SUBJECT_ID, "persona", {
      subject_persona_id: SUBJECT_ID, claim, dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
      ...overrides,
    })!;
  }

  it("AT8(c): a valid-then-malformed merges array leaves BOTH original signals unchanged — no partial apply, no retry over a state-changing attempt", async () => {
    const keep = addOpenSignal("Terse tone.");
    const dup = addOpenSignal("Terse conversational tone.");

    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    // The well-formed keep/dup pair comes FIRST — proving that a
    // malformed sibling AFTER it still voids the whole batch, rather
    // than the earlier valid entry having already mutated state before
    // the scan reaches the bad one.
    const response = createMockResponse(request, { merges: [{ keep_id: keep.id, merge_id: dup.id }, null] });

    expect(() => handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm)).not.toThrow();

    const signals = sm.signals_get(SUBJECT_ID).persona;
    expect(signals.find(s => s.id === keep.id)).toBeDefined();
    const survivingDup = signals.find(s => s.id === dup.id);
    expect(survivingDup).toBeDefined();
    expect(survivingDup!.evidence_ids).toEqual([]);
  });

  it("drops the whole batch when an entry has a missing/empty keep_id or merge_id", async () => {
    const solo = addOpenSignal("Solo claim.");
    const other = addOpenSignal("Other claim.");
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    const response = createMockResponse(request, {
      merges: [
        { keep_id: solo.id, merge_id: other.id },
        { keep_id: "", merge_id: solo.id },
        { keep_id: solo.id },
        "not-an-object",
      ],
    });

    expect(() => handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm)).not.toThrow();
    expect(sm.signals_get(SUBJECT_ID).persona).toHaveLength(2);
  });

  it("drops the whole batch when an entry names a signal id that doesn't resolve to any currently-open same-lens signal", async () => {
    const keep = addOpenSignal("Terse tone.");
    const dup = addOpenSignal("Terse conversational tone.");
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    const response = createMockResponse(request, {
      merges: [
        { keep_id: keep.id, merge_id: dup.id },
        { keep_id: keep.id, merge_id: "totally-made-up-signal-id" },
      ],
    });

    expect(() => handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm)).not.toThrow();
    const signals = sm.signals_get(SUBJECT_ID).persona;
    expect(signals.find(s => s.id === dup.id)).toBeDefined();
  });

  it("drops the whole batch when an entry names a signal from the WRONG lens", async () => {
    const keep = addOpenSignal("Terse tone.");
    const dup = addOpenSignal("Terse conversational tone.");
    const agentSignal = sm.signal_add(SUBJECT_ID, "agent", {
      subject_persona_id: SUBJECT_ID, claim: "Agent-lens claim.", dimension: "behavior", status: "candidate",
      evidence_ids: [], first_observed_at: "2026-08-01T00:00:00.000Z", last_observed_at: "2026-08-01T00:00:00.000Z",
      observer_kinds: ["human"], recurrence_count: 1,
    })!;
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    const response = createMockResponse(request, {
      merges: [
        { keep_id: keep.id, merge_id: dup.id },
        { keep_id: keep.id, merge_id: agentSignal.id },
      ],
    });

    expect(() => handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm)).not.toThrow();
    expect(sm.signals_get(SUBJECT_ID).persona.find(s => s.id === dup.id)).toBeDefined();
    expect(sm.signals_get(SUBJECT_ID).agent.find(s => s.id === agentSignal.id)).toBeDefined();
  });

  it("a fully well-formed batch (no malformed siblings) still applies every merge", async () => {
    const keepA = addOpenSignal("Terse tone.");
    const dupA = addOpenSignal("Terse conversational tone.");
    const keepB = addOpenSignal("Writes detailed changelogs.");
    const dupB = addOpenSignal("Writes very detailed changelogs unprompted.");
    const request = createMockRequest({
      next_step: LLMNextStep.HandlePersonaSignalValidate,
      data: { personaId: SUBJECT_ID, lens: "persona" },
    });
    const response = createMockResponse(request, {
      merges: [
        { keep_id: keepA.id, merge_id: dupA.id },
        { keep_id: keepB.id, merge_id: dupB.id },
      ],
    });

    await handlers[LLMNextStep.HandlePersonaSignalValidate](response, sm);

    const signals = sm.signals_get(SUBJECT_ID).persona;
    expect(signals.find(s => s.id === dupA.id)).toBeUndefined();
    expect(signals.find(s => s.id === dupB.id)).toBeUndefined();
    expect(signals.find(s => s.id === keepA.id)).toBeDefined();
    expect(signals.find(s => s.id === keepB.id)).toBeDefined();
  });
});

describe("handleTopicMatch — control-char sanitization in log lines (reducer-diagnostics-log-raw-model-controlled-data)", () => {
  it("strips control bytes from an unresolved matched_guid before console.warn logging", () => {
    const state = createMockStateManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicMatch,
        data: {
          personaId: "ei",
          personaDisplayName: "Ei",
          candidateName: "Patterns",
          candidateDescription: "Design patterns",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const maliciousGuid = "\x1b[31mFAKE\x1b[0m\x07";
      const response = createMockResponse(request, { matched_guid: maliciousGuid });

      handlers[LLMNextStep.HandleTopicMatch](response, state as unknown as StateManager);

      expect(warnSpy).toHaveBeenCalled();
      for (const call of [...warnSpy.mock.calls, ...logSpy.mock.calls]) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it("strips control bytes from a resolved matched_guid before the final console.log summary", () => {
    const state = createMockStateManager();
    const maliciousGuid = "\x1b[31mTOPIC-ID\x1b[0m\x07";
    state._human.topics.push({
      id: maliciousGuid,
      name: "Patterns",
      description: "Design patterns",
      sentiment: 0.5,
      last_updated: new Date().toISOString(),
      exposure_current: 0.5,
      exposure_desired: 0.5,
      category: "Technical",
    } as Topic);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicMatch,
        data: {
          personaId: "ei",
          personaDisplayName: "Ei",
          candidateName: "Patterns",
          candidateDescription: "Design patterns",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, { matched_guid: maliciousGuid });

      handlers[LLMNextStep.HandleTopicMatch](response, state as unknown as StateManager);

      expect(logSpy).toHaveBeenCalled();
      for (const call of logSpy.mock.calls) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      logSpy.mockRestore();
    }
  });

  it("strips control bytes from a poisoned candidateName (originating from the earlier Scan/Extract LLM output) before the final console.log summary", () => {
    const state = createMockStateManager();
    const maliciousCandidateName = "Patterns\x1b[31mRED\x1b[0m\x07";
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    try {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleTopicMatch,
        data: {
          personaId: "ei",
          personaDisplayName: "Ei",
          candidateName: maliciousCandidateName,
          candidateDescription: "Design patterns",
          candidateCategory: "Technical",
          messages_context: [],
          messages_analyze: [],
        },
      });
      const response = createMockResponse(request, { matched_guid: "new" });

      handlers[LLMNextStep.HandleTopicMatch](response, state as unknown as StateManager);

      expect(logSpy).toHaveBeenCalled();
      for (const call of logSpy.mock.calls) {
        expect(call.join(" ")).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      }
    } finally {
      logSpy.mockRestore();
    }
  });
});



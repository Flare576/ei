import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,

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
} from "../../../../src/core/types.js";
import type { StateManager } from "../../../../src/core/state-manager.js";

// We need to test handlers in isolation, so we import them directly
// and mock their dependencies

// Mock the orchestrators module
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonUpdate: vi.fn().mockReturnValue(1),
  queueTopicValidate: vi.fn().mockResolvedValue(undefined),
}));

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
import { queueTopicMatch, queuePersonUpdate } from "../../../../src/core/orchestrators/index.js";

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
    human_quote_update: vi.fn(),
    human_quote_getForMessage: vi.fn(() => []),
    persona_getById: vi.fn((id: string) => Object.values(personas).find(p => p.id === id) ?? null),
    persona_getByName: vi.fn((name: string) => Object.values(personas).find(p => p.display_name === name || p.aliases?.includes(name)) ?? null),
    persona_getAll: vi.fn(() => Object.values(personas)),
    persona_add: vi.fn((entity: PersonaEntity) => { personas[entity.id] = entity; }),
    persona_update: vi.fn(),
    messages_get: vi.fn((id: string) => messages[id] ?? []),
    messages_append: vi.fn(),
    messages_markPendingAsRead: vi.fn(),
    messages_markExtracted: vi.fn().mockReturnValue(1),
    queue_enqueue: vi.fn(),

    _human: human,
    _personas: personas,
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

  describe("handleTopicUpdate — quote channel/speaker", () => {
    it("sets channel to personaDisplayName on extracted quotes", async () => {
      seedMessage("persona-1", "msg-1", "human", "I love working with TypeScript");

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
    });

    it("sets speaker=human for human-role message quotes", async () => {
      seedMessage("persona-1", "msg-2", "human", "I love working with TypeScript");

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
    });

    it("sets speaker=channelDisplayName for non-human-role message quotes", async () => {
      seedMessage("persona-1", "msg-3", "system", "This pattern is worth noting");

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
    });

    it("produces no quotes when quote text is not found in messages", async () => {
      // No messages seeded — quote cannot be anchored
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

      await handlers[LLMNextStep.HandleTopicUpdate](response, state as any);

      expect(state.human_quote_add).not.toHaveBeenCalled();
    });
  });

  describe("handlePersonUpdate — quote channel", () => {
    it("sets channel to personaDisplayName on extracted quotes", async () => {
      seedMessage("persona-1", "msg-4", "human", "David is a great collaborator");

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

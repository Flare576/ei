import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,

  type LLMResponse,
  type LLMRequest,
  type Message,
  type HumanEntity,
  type PersonaEntity,
  type Fact,
  type Topic,
  type Person,
} from "../../../../src/core/types.js";

// We need to test handlers in isolation, so we import them directly
// and mock their dependencies

// Mock the orchestrators module
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueItemMatch: vi.fn().mockResolvedValue(1),
  queueItemUpdate: vi.fn(),
}));

vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
}));



import { handlers } from "../../../../src/core/handlers/index.js";
import { queueItemMatch, queueItemUpdate } from "../../../../src/core/orchestrators/index.js";

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  const personas: Record<string, PersonaEntity> = {};
  const messages: Record<string, Message[]> = {};

  return {
    getHuman: vi.fn(() => human),
    setHuman: vi.fn((h: HumanEntity) => Object.assign(human, h)),
    human_fact_upsert: vi.fn((fact: Fact) => human.facts.push(fact)),
    human_topic_upsert: vi.fn((topic: Topic) => human.topics.push(topic)),
    human_person_upsert: vi.fn((person: Person) => human.people.push(person)),
    persona_getById: vi.fn((id: string) => Object.values(personas).find(p => p.id === id) ?? null),
    persona_getByName: vi.fn((name: string) => Object.values(personas).find(p => p.display_name === name || p.aliases?.includes(name)) ?? null),
    persona_add: vi.fn((entity: PersonaEntity) => { personas[entity.id] = entity; }),
    persona_update: vi.fn(),
    messages_get: vi.fn((id: string) => messages[id] ?? []),
    messages_append: vi.fn(),
    messages_markPendingAsRead: vi.fn(),
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
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: "system",
    user: "user",
    next_step: LLMNextStep.HandleFactFind,
    data: {
      personaId: "ei",
        personaDisplayName: "Ei",
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
          personaDisplayName: "Ei",
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
    it("queues item match for each detected topic", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTopicScan,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        topics: [
          { type_of_topic: "Technology", value_of_topic: "AI research" },
          { type_of_topic: "Hobbies", value_of_topic: "Photography" },
        ],
      });

      await handlers.handleHumanTopicScan(response, state as any);

      expect(queueItemMatch).toHaveBeenCalledTimes(2);
      expect(queueItemMatch).toHaveBeenCalledWith(
        "topic",
        expect.objectContaining({ type_of_topic: "Technology" }),
        expect.any(Object),
        state,
        undefined
      );
    });
  });

  describe("handleHumanPersonScan", () => {
    it("queues item match for each detected person", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanPersonScan,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        people: [
          { name_of_person: "Alice", type_of_person: "friend" },
        ],
      });

      await handlers.handleHumanPersonScan(response, state as any);

      expect(queueItemMatch).toHaveBeenCalledTimes(1);
      expect(queueItemMatch).toHaveBeenCalledWith(
        "person",
        expect.objectContaining({ name_of_person: "Alice" }),
        expect.any(Object),
        state,
        undefined
      );
    });
  });
});

describe("Extraction Handlers - Step 2 (Match)", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  describe("handleHumanItemMatch", () => {
    it("queues item update with match result", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemMatch,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          itemName: "Birthday",
          itemValue: "January 15th",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        name: "Birthday",
      });

      await handlers.handleHumanItemMatch(response, state as any);

      expect(queueItemUpdate).toHaveBeenCalledTimes(1);
      expect(queueItemUpdate).toHaveBeenCalledWith(
        "fact",
        expect.objectContaining({ name: "Birthday" }),
        expect.objectContaining({
          personaId: "ei",
        personaDisplayName: "Ei",
          itemName: "Birthday",
          itemValue: "January 15th",
        }),
        state
      );
    });

    it("queues item update for new item (Not Found)", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemMatch,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "trait",
          itemName: "Curiosity",
          itemValue: "Loves to learn new things",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, {
        name: "Not Found",
      });

      await handlers.handleHumanItemMatch(response, state as any);

      expect(queueItemUpdate).toHaveBeenCalledWith(
        "trait",
        expect.objectContaining({ name: "Not Found" }),
        expect.any(Object),
        state
      );
    });

    it("handles missing parsed result", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemMatch,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          itemName: "Test",
          itemValue: "Value",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, null);
      response.parsed = undefined;

      await handlers.handleHumanItemMatch(response, state as any);

      expect(queueItemUpdate).not.toHaveBeenCalled();
    });
  });
});

describe("Extraction Handlers - Step 3 (Update)", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    // Add Ei persona so isEi check passes
    state._personas["ei"] = {
      id: "ei",
      display_name: "Ei",
      entity: "system",
      aliases: ["ei"],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
      last_activity: new Date().toISOString(),
    };
    vi.clearAllMocks();
  });

  describe("handleHumanItemUpdate", () => {
    it("creates new fact when isNewItem=true", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          isNewItem: true,
          existingItemId: undefined,
        },
      });

      const response = createMockResponse(request, {
        name: "Birthday",
        description: "User's birthday is January 15th",
        sentiment: 0.8,
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Birthday",
          description: "User's birthday is January 15th",
          sentiment: 0.8,
          learned_by: "ei",
        })
      );
    });

    it("updates existing fact when isNewItem=false", async () => {
      const existingId = "existing-fact-id";
      state._human.facts.push({
        id: existingId,
        name: "Birthday",
        description: "Old description",
        sentiment: 0.5,
          validated_date: new Date().toISOString(),
        last_updated: new Date().toISOString(),
      });

      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          isNewItem: false,
          existingItemId: existingId,
        },
      });

      const response = createMockResponse(request, {
        name: "Birthday",
        description: "Updated description",
        sentiment: 0.9,
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_fact_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          id: existingId,
          name: "Birthday",
          description: "Updated description",
          // learned_by should NOT be set for updates
        })
      );
      
      const calledWith = state.human_fact_upsert.mock.calls[0][0];
      expect(calledWith.learned_by).toBeUndefined();
    });


    it("creates new topic with exposure_impact calculation", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "topic",
          isNewItem: true,
        },
      });

      const response = createMockResponse(request, {
        name: "AI Research",
        description: "Interested in artificial intelligence",
        sentiment: 0.9,
        exposure_impact: "high",
        exposure_desired: 0.8,
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_topic_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "AI Research",
          exposure_current: 0.9, // "high" maps to 0.9
          exposure_desired: 0.8,
        })
      );
    });

    it("maps exposure_impact values correctly", async () => {
      const testCases = [
        { impact: "high", expected: 0.9 },
        { impact: "medium", expected: 0.6 },
        { impact: "low", expected: 0.3 },
        { impact: "none", expected: 0.1 },
        { impact: undefined, expected: 0.5 }, // default
      ];

      for (const { impact, expected } of testCases) {
        state = createMockStateManager();
        state._personas["ei"] = {
          id: "ei",
          display_name: "Ei",
          entity: "system",
          aliases: ["ei"],
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: new Date().toISOString(),
          last_activity: new Date().toISOString(),
        };

        const request = createMockRequest({
          next_step: LLMNextStep.HandleHumanItemUpdate,
          data: {
            personaId: "ei",
        personaDisplayName: "Ei",
            candidateType: "topic",
            isNewItem: true,
          },
        });

        const response = createMockResponse(request, {
          name: "Test Topic",
          description: "Test",
          sentiment: 0,
          exposure_impact: impact,
          exposure_desired: 0.5,
        });

        await handlers.handleHumanItemUpdate(response, state as any);

        const calledWith = state.human_topic_upsert.mock.calls[0][0];
        expect(calledWith.exposure_current).toBe(expected);
      }
    });

    it("creates new person with relationship", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "person",
          isNewItem: true,
        },
      });

      const response = createMockResponse(request, {
        name: "Alice",
        description: "Close friend from college",
        sentiment: 0.9,
        relationship: "friend",
        exposure_impact: "medium",
        exposure_desired: 0.7,
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_person_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Alice",
          relationship: "friend",
          exposure_current: 0.6, // "medium" maps to 0.6
        })
      );
    });

    it("does nothing when result is empty", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          isNewItem: true,
        },
      });

      const response = createMockResponse(request, {});

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });

    it("does nothing when required fields missing", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "fact",
          isNewItem: true,
        },
      });

      // Missing description and sentiment
      const response = createMockResponse(request, {
        name: "Test",
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_fact_upsert).not.toHaveBeenCalled();
    });
  });
});





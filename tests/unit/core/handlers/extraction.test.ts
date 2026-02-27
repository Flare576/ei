import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  ValidationLevel,

  type LLMResponse,
  type LLMRequest,
  type Message,
  type HumanEntity,
  type PersonaEntity,
  type Fact,
  type Trait,
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



import { handlers } from "../../../../src/core/handlers/index.js";
import { queueItemMatch, queueItemUpdate } from "../../../../src/core/orchestrators/index.js";

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    traits: [],
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
    human_trait_upsert: vi.fn((trait: Trait) => human.traits.push(trait)),
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
    next_step: LLMNextStep.HandleHumanFactScan,
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

  describe("handleHumanFactScan", () => {
    it("queues item match for each detected fact", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanFactScan,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          messages_context: [{ id: "1", role: "human", content: "context", timestamp: "", read: true, context_status: "default" }],
          messages_analyze: [{ id: "2", role: "human", content: "analyze", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        facts: [
          { type_of_fact: "Birthday", value_of_fact: "January 15th", reason: "User stated their birthday" },
          { type_of_fact: "Location", value_of_fact: "San Francisco", reason: "User mentioned living there" },
        ],
      });

      await handlers.handleHumanFactScan(response, state as any);

      expect(queueItemMatch).toHaveBeenCalledTimes(2);
      expect(queueItemMatch).toHaveBeenCalledWith(
        "fact",
        expect.objectContaining({ type_of_fact: "Birthday" }),
        expect.objectContaining({ personaId: "ei",
        personaDisplayName: "Ei" }),
        state
      );
    });

    it("does nothing when no facts detected", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanFactScan,
      });

      const response = createMockResponse(request, { facts: [] });

      await handlers.handleHumanFactScan(response, state as any);

      expect(queueItemMatch).not.toHaveBeenCalled();
    });

    it("handles missing facts array gracefully", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanFactScan,
      });

      const response = createMockResponse(request, {});

      await handlers.handleHumanFactScan(response, state as any);

      expect(queueItemMatch).not.toHaveBeenCalled();
    });
  });

  describe("handleHumanTraitScan", () => {
    it("queues item match for each detected trait", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTraitScan,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", content: "test", timestamp: "", read: true, context_status: "default" }],
        },
      });

      const response = createMockResponse(request, {
        traits: [
          { type_of_trait: "Introversion", value_of_trait: "Prefers quiet time", reason: "User mentioned" },
        ],
      });

      await handlers.handleHumanTraitScan(response, state as any);

      expect(queueItemMatch).toHaveBeenCalledTimes(1);
      expect(queueItemMatch).toHaveBeenCalledWith(
        "trait",
        expect.objectContaining({ type_of_trait: "Introversion" }),
        expect.any(Object),
        state
      );
    });

    it("does nothing when no traits detected", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanTraitScan,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [],
        },
      });

      const response = createMockResponse(request, { traits: [] });

      await handlers.handleHumanTraitScan(response, state as any);

      expect(queueItemMatch).not.toHaveBeenCalled();
    });
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
        state
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
        state
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
          validated: ValidationLevel.None,
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
          validated: ValidationLevel.None,
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

    it("creates new trait with strength", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: {
          personaId: "ei",
        personaDisplayName: "Ei",
          candidateType: "trait",
          isNewItem: true,
        },
      });

      const response = createMockResponse(request, {
        name: "Curiosity",
        description: "Always eager to learn",
        sentiment: 0.7,
        strength: 0.8,
      });

      await handlers.handleHumanItemUpdate(response, state as any);

      expect(state.human_trait_upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Curiosity",
          strength: 0.8,
        })
      );
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





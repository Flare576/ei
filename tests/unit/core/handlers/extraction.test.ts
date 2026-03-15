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
} from "../../../../src/core/types.js";

// We need to test handlers in isolation, so we import them directly
// and mock their dependencies

// Mock the orchestrators module
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonMatch: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
}));



import { handlers } from "../../../../src/core/handlers/index.js";
import { queueTopicMatch, queuePersonMatch } from "../../../../src/core/orchestrators/index.js";

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

    it("calls markMessagesExtracted with flag 'f'", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "ei",
          personaDisplayName: "Ei",
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
          personaDisplayName: "Ei",
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
        personaDisplayName: "Ei",
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
          personaDisplayName: "Ei",
          messages_context: [],
          messages_analyze: [{ id: "1", role: "human", verbal_response: "test", timestamp: "", read: true, context_status: "default" }],
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
          personaDisplayName: "Ei",
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
          personaDisplayName: "Ei",
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
          personaDisplayName: "Ei",
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
        personaDisplayName: "Ei",
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

      expect(queuePersonMatch).toHaveBeenCalledTimes(1);
      expect(queuePersonMatch).toHaveBeenCalledWith(
        expect.objectContaining({ name: "Alice" }),
        expect.any(Object),
        state,
        undefined
      );
    });
  });
});




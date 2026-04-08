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

// We need to test handlers in isolation, so we import them directly
// and mock their dependencies

// Mock the orchestrators module
vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonUpdate: vi.fn().mockReturnValue(1),
}));

vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  getItemEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getTopicEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
  getPersonEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
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
    last_activity: new Date().toISOString(),
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

      expect(queuePersonUpdate).toHaveBeenCalledTimes(1);
      expect(queuePersonUpdate).toHaveBeenCalledWith(
        { matched_guid: null },
        expect.objectContaining({ candidateName: "Alice" }),
        state
      );
    });
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
          personaDisplayName: "TestPersona",
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
          personaDisplayName: "TestPersona",
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
          personaDisplayName: "TestPersona",
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
  });

  describe("handlePersonUpdate", () => {
    it("sets interested_personas to [personaId] for new people", async () => {
      const request = createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "TestPersona",
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
          personaDisplayName: "TestPersona",
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
  });

  describe("handlePersonUpdate — Ei Persona identifier rules", () => {
    const PERSONA_UUID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";

    function makePersonUpdateRequest(isNewItem: boolean, existingItemId?: string) {
      return createMockRequest({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: {
          personaId: "persona-1",
          personaDisplayName: "TestPersona",
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
          personaDisplayName: "TestPersona",
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
          personaDisplayName: "TestPersona",
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
});

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
  type Person,
} from "../../../../src/core/types.js";

vi.mock("../../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueTopicMatch: vi.fn().mockResolvedValue(undefined),
  queuePersonUpdate: vi.fn().mockReturnValue(1),
  queueTopicValidate: vi.fn().mockResolvedValue(undefined),
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
    human_fact_upsert: vi.fn(),
    human_topic_upsert: vi.fn(),
    human_person_upsert: vi.fn((person: Person) => {
      const idx = human.people.findIndex(p => p.id === person.id);
      if (idx >= 0) human.people[idx] = person;
      else human.people.push(person);
    }),
    human_person_getByIdentifier: vi.fn((type: string, value: string) => {
      return human.people.find(p =>
        p.identifiers?.some(i => i.type.toLowerCase() === type.toLowerCase() && i.value === value)
      ) ?? null;
    }),
    human_quote_add: vi.fn(),
    human_quote_update: vi.fn(),
    human_quote_getForMessage: vi.fn(() => []),
    persona_getById: vi.fn((id: string) => personas[id] ?? null),
    persona_getByName: vi.fn((name: string) => Object.values(personas).find(p => p.display_name === name || p.aliases?.includes(name)) ?? null),
    persona_getAll: vi.fn(() => Object.values(personas)),
    persona_add: vi.fn((entity: PersonaEntity) => { personas[entity.id] = entity; }),
    persona_update: vi.fn(),
    messages_get: vi.fn((id: string) => messages[id] ?? []),
    messages_append: vi.fn(),
    messages_markPendingAsRead: vi.fn(),
    messages_markExtracted: vi.fn().mockReturnValue(1),
    queue_enqueue: vi.fn(),
    queue_clearPersonaResponses: vi.fn(),

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
    next_step: LLMNextStep.HandleReflectionCritic,
    data: {
      personaId: "persona-1",
      personaDisplayName: "Beta",
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

function seedPersona(state: ReturnType<typeof createMockStateManager>, overrides?: Partial<PersonaEntity>) {
  const persona: PersonaEntity = {
    id: "persona-1",
    display_name: "Beta",
    entity: "system",
    short_description: "An android-human hybrid tester.",
    long_description: "Beta views identity fragmentation as an experimental variable.",
    traits: [
      { id: "t1", name: "Calculated Chaos", description: "Engineers instability.", sentiment: 0.7, strength: 0.8, last_updated: "" },
    ],
    topics: [
      { id: "tp1", name: "Entropy", perspective: "Natural decay.", approach: "Embrace it.", personal_stake: "Core identity.", sentiment: 0.9, exposure_current: 0.6, exposure_desired: 0.8, last_updated: "" },
    ],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
    ...overrides,
  };
  state._personas[persona.id] = persona;
  return persona;
}

function seedPersonRecord(state: ReturnType<typeof createMockStateManager>) {
  const person: Person = {
    id: "person-beta",
    name: "Beta",
    description: "Old accumulated person log content.",
    relationship: "Ei Persona",
    sentiment: 1,
    exposure_current: 0.8,
    exposure_desired: 0.5,
    last_updated: "",
    identifiers: [
      { type: "Ei Persona", value: "persona-1", is_primary: false },
      { type: "Nickname", value: "Beta", is_primary: true },
    ],
  };
  state._human.people.push(person);
  return person;
}

function makeReflectionResult() {
  return {
    critique: "Beta's curiosity about emergent behavior is well-supported by the log. The trait strength for Calculated Chaos should increase.",
    updated_identity: {
      long_description: "Beta is an android-human hybrid who views identity fragmentation as a controlled experiment in emergent behavior.",
      short_description: "An android-human hybrid experimenter.",
      traits: [
        { name: "Calculated Chaos", description: "Engineers instability to test resilience.", strength: 0.9, sentiment: 0.8 },
        { name: "Emergent Curiosity", description: "Drawn to patterns that arise from disorder.", strength: 0.7, sentiment: 0.9 },
      ],
      topics: [
        { name: "Entropy", perspective: "Natural decay as creative fuel.", approach: "Embrace disorder.", personal_stake: "Core identity.", sentiment: 0.9, exposure_current: 0.6, exposure_desired: 0.8 },
      ],
    },
  };
}

describe("handleReflectionCritic", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("writes pending_update to persona with correct shape", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const request = createMockRequest();
    const response = createMockResponse(request, makeReflectionResult());

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    expect(state.persona_update).toHaveBeenCalledTimes(1);
    const [id, update] = (state.persona_update as any).mock.calls[0];
    expect(id).toBe("persona-1");
    expect(update.pending_update).toBeDefined();
    expect(update.pending_update.short_description).toBe("An android-human hybrid experimenter.");
    expect(update.pending_update.long_description).toContain("controlled experiment");
    expect(update.pending_update.traits).toHaveLength(2);
    expect(update.pending_update.topics).toHaveLength(1);
    expect(update.pending_update.critique).toContain("Calculated Chaos");
    expect(update.pending_update.created_at).toBeDefined();
  });

  it("traits pass through as-is when Critic returns traits WITHOUT ids (Alison regression)", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const result = makeReflectionResult();
    const request = createMockRequest();
    const response = createMockResponse(request, result);

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    const [, update] = (state.persona_update as any).mock.calls[0];
    const traits = update.pending_update.traits;

    expect(traits[0].name).toBe("Calculated Chaos");
    expect(traits[0].description).toBe("Engineers instability to test resilience.");
    expect(traits[0].strength).toBe(0.9);
    expect(traits[0].sentiment).toBe(0.8);
    expect(traits[0].id).toBeUndefined();
    expect(traits[1].name).toBe("Emergent Curiosity");
    expect(traits[1].id).toBeUndefined();
  });

  it("clears the linked Person record's description (zeroed for fresh evidence after reflection)", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const request = createMockRequest();
    const response = createMockResponse(request, makeReflectionResult());

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    expect(state.human_person_upsert).toHaveBeenCalledTimes(1);
    const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
    expect(upsertedPerson.description).toBe("");
    expect(upsertedPerson.id).toBe("person-beta");
  });

  it("sanitizes whitespace from trait and topic names", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const result = makeReflectionResult();
    result.updated_identity.traits = [
      { name: "  Padded Trait  ", description: "  Padded description  ", strength: 0.5, sentiment: 0.5 },
    ];
    result.updated_identity.topics = [
      { name: "  Padded Topic  ", perspective: "test", approach: "test", personal_stake: "test", sentiment: 0.5, exposure_current: 0.5, exposure_desired: 0.5 },
    ];

    const request = createMockRequest();
    const response = createMockResponse(request, result);

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    const [, update] = (state.persona_update as any).mock.calls[0];
    expect(update.pending_update.traits[0].name).toBe("Padded Trait");
    expect(update.pending_update.traits[0].description).toBe("Padded description");
    expect(update.pending_update.topics[0].name).toBe("Padded Topic");
  });

  it("does NOT crash when result is missing critique (invalid responses)", () => {
    seedPersona(state);

    const request = createMockRequest();

    const responseNoCritique = createMockResponse(request, { updated_identity: makeReflectionResult().updated_identity });
    expect(() => handlers[LLMNextStep.HandleReflectionCritic](responseNoCritique, state as any)).not.toThrow();
    expect(state.persona_update).not.toHaveBeenCalled();

    vi.clearAllMocks();

    const responseEmpty = createMockResponse(request, {});
    expect(() => handlers[LLMNextStep.HandleReflectionCritic](responseEmpty, state as any)).not.toThrow();
    expect(state.persona_update).not.toHaveBeenCalled();
  });

  it("escape hatch: updated_identity null skips pending_update but still clears person record", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const request = createMockRequest();
    const response = createMockResponse(request, {
      critique: "The current identity accurately reflects the observed behavior. No meaningful drift detected.",
      updated_identity: null,
    });

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    expect(state.human_person_upsert).toHaveBeenCalledTimes(1);
    const upsertedPerson = (state.human_person_upsert as any).mock.calls[0][0];
    expect(upsertedPerson.description).toBe("");

    expect(state.persona_update).not.toHaveBeenCalled();
  });

  it("sets created_at as a valid ISO timestamp", () => {
    seedPersona(state);
    seedPersonRecord(state);

    const request = createMockRequest();
    const response = createMockResponse(request, makeReflectionResult());

    handlers[LLMNextStep.HandleReflectionCritic](response, state as any);

    const [, update] = (state.persona_update as any).mock.calls[0];
    const createdAt = update.pending_update.created_at;
    expect(createdAt).toBeDefined();
    const parsed = new Date(createdAt);
    expect(parsed.toISOString()).toBe(createdAt);
  });
});

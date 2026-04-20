import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  type Message,
  type Topic,
  type HumanEntity,
  type PersonaEntity,
} from "../../../../src/core/types.js";
import {
  queueFactFind,
  queueTopicScan,
  queuePersonScan,
  queueAllScans,
  queueTopicValidate,
  queueEventSummary,
  queueTargetedPersonUpdate,
  queueTargetedTopicUpdate,
  VALIDATE_MIN_SIMILARITY,
  type ExtractionContext,
} from "../../../../src/core/orchestrators/human-extraction.js";

vi.mock("../../../../src/prompts/human/index.js", () => ({
  buildFactFindPrompt: vi.fn().mockReturnValue({ system: "fact-find-sys", user: "fact-find-usr" }),
  buildHumanTopicScanPrompt: vi.fn().mockReturnValue({ system: "topic-sys", user: "topic-usr" }),
  buildHumanPersonScanPrompt: vi.fn().mockReturnValue({ system: "person-sys", user: "person-usr" }),
  buildEventScanPrompt: vi.fn().mockReturnValue({ system: "event-sys", user: "event-usr" }),
  buildPersonUpdatePrompt: vi.fn().mockReturnValue({ system: "person-update-sys", user: "person-update-usr" }),
  buildTopicUpdatePrompt: vi.fn().mockReturnValue({ system: "topic-update-sys", user: "topic-update-usr" }),
}));

vi.mock("../../../../src/core/handlers/utils.js", () => ({
  normalizeRoomMessages: vi.fn((msgs: unknown[]) => msgs),
  getMessageContent: vi.fn((msg: { content?: string; verbal_response?: string }) => msg.content ?? msg.verbal_response ?? ""),
  resolveMessageWindow: vi.fn((msgs: unknown[]) => msgs),
  splitMessagesByTimestamp: vi.fn(() => ({ before: [], after: [] })),
  markMessagesExtracted: vi.fn(),
  getMessageText: vi.fn((msg: { content?: string; verbal_response?: string }) => msg.content ?? msg.verbal_response ?? ""),
}));

vi.mock("../../../../src/prompts/ceremony/dedup.js", () => ({
  buildValidatePrompt: vi.fn().mockReturnValue({ system: "validate-sys", user: "validate-usr" }),
}));

const mockFindTopK = vi.fn();
vi.mock("../../../../src/core/embedding-service.js", () => ({
  getEmbeddingService: () => ({
    embed: vi.fn().mockResolvedValue(new Array(384).fill(0.1)),
  }),
  findTopK: (...args: unknown[]) => mockFindTopK(...args),
  getTopicEmbeddingText: ({ name, description }: { name: string; description?: string }) =>
    `${name}: ${description ?? ""}`,
}));

import {
  buildFactFindPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
} from "../../../../src/prompts/human/index.js";
import { buildValidatePrompt } from "../../../../src/prompts/ceremony/dedup.js";

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [
      { id: "f1", name: "Birthday", description: "January 15th", sentiment: 0.5, validated_date: "", last_updated: "" },
      { id: "f2", name: "Full Name", description: "", sentiment: 0, validated_date: "", last_updated: "" },
    ],
    traits: [
      { id: "t1", name: "Curiosity", description: "Loves learning", sentiment: 0.7, last_updated: "" },
    ],
    topics: [
      { id: "top1", name: "AI", description: "Artificial Intelligence", sentiment: 0.8, exposure_current: 0.5, exposure_desired: 0.7, last_updated: "" },
    ],
    people: [
      { id: "p1", name: "Alice", description: "Best friend", relationship: "friend", sentiment: 0.9, exposure_current: 0.6, exposure_desired: 0.8, last_updated: "", identifiers: [], validated_date: "" },
    ],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  const personas: PersonaEntity[] = [
    {
      id: "ei",
      display_name: "Ei",
      entity: "system",
      aliases: ["ei", "Ei"],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: "",
      last_activity: "",
    },
    {
      id: "friend-id",
      display_name: "Friend",
      entity: "system",
      aliases: ["friend", "Friend"],
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: "",
      last_activity: "",
    },
  ];

  return {
    getHuman: vi.fn(() => human),
    persona_getAll: vi.fn(() => personas),
    persona_getById: vi.fn((id: string) => personas.find(p => p.id === id) ?? null),
    queue_enqueue: vi.fn(),
    messages_markExtracted: vi.fn(),
    messages_getUnextracted: vi.fn().mockReturnValue([
      { id: "unextracted-1", role: "human", verbal_response: "test", timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), read: true, context_status: "default" },
    ]),
    messages_get: vi.fn().mockReturnValue([]),
    _human: human,
    _personas: personas,
  };
}

function createMessage(id: string, content: string, role: "human" | "system" = "human"): Message {
  return {
    id,
    role,
    content,
    timestamp: new Date().toISOString(),
    read: true,
    context_status: "default" as any,
  };
}

describe("Scan Orchestrators (Step 1)", () => {
  let state: ReturnType<typeof createMockStateManager>;
  let context: ExtractionContext;

  beforeEach(() => {
    state = createMockStateManager();
    context = {
      personaId: "ei",
      personaDisplayName: "Ei",
      messages_context: [createMessage("1", "Earlier message")],
      messages_analyze: [createMessage("2", "Recent message to analyze")],
    };
    vi.clearAllMocks();
  });

  describe("queueFactFind", () => {
    it("enqueues fact find request with missing fact names", () => {
      queueFactFind(context, state as any);

      expect(buildFactFindPrompt).toHaveBeenCalledWith({
        persona_name: "Ei",
        missing_fact_names: ["Full Name"],
        messages_context: context.messages_context,
        messages_analyze: context.messages_analyze,
      });

      expect(state.queue_enqueue).toHaveBeenCalledWith({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        system: "fact-find-sys",
        user: "fact-find-usr",
        next_step: LLMNextStep.HandleFactFind,
        data: {
          personaId: "ei",
          personaDisplayName: "Ei",
          analyze_from_timestamp: context.messages_analyze[0].timestamp,
          extraction_flag: undefined,
          message_ids_to_mark: ["2"],
        },
      });
    });

    it("returns 0 when all facts have descriptions", () => {
      // Set all facts to have descriptions
      state._human.facts.forEach((f: any) => { f.description = "some value"; });

      const result = queueFactFind(context, state as any);

      expect(result).toBe(0);
      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });
  });


  describe("queueTopicScan", () => {
    it("enqueues topic scan request with correct data", () => {
      queueTopicScan(context, state as any);

      expect(buildHumanTopicScanPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_name: "Ei",
          messages_context: context.messages_context,
          messages_analyze: context.messages_analyze,
        })
      );

      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          next_step: LLMNextStep.HandleHumanTopicScan,
        })
      );
    });
  });

  describe("queuePersonScan", () => {
    it("enqueues person scan request with known persona names", () => {
      queuePersonScan(context, state as any);

      expect(buildHumanPersonScanPrompt).toHaveBeenCalledWith(
        expect.objectContaining({
          persona_name: "Ei",
          messages_context: context.messages_context,
          messages_analyze: context.messages_analyze,
        })
      );

      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          next_step: LLMNextStep.HandleHumanPersonScan,
        })
      );
    });
  });

  describe("queueAllScans", () => {
    it("enqueues all four scan types", () => {
      queueAllScans(context, state as any);

      expect(state.queue_enqueue).toHaveBeenCalledTimes(4);

      const nextSteps = state.queue_enqueue.mock.calls.map((c: any) => c[0].next_step);
      expect(nextSteps).toContain(LLMNextStep.HandleFactFind);
      expect(nextSteps).toContain(LLMNextStep.HandleHumanTopicScan);
      expect(nextSteps).toContain(LLMNextStep.HandleHumanPersonScan);
      expect(nextSteps).toContain(LLMNextStep.HandleEventScan);
    });
  });
});

describe("queueTopicValidate", () => {
  function makeTopic(id: string, name: string, withEmbedding = true): Topic {
    return {
      id,
      name,
      description: `Description for ${name}`,
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: new Date().toISOString(),
      embedding: withEmbedding ? new Array(384).fill(0.1) : undefined,
    };
  }

  function makeState(existingTopics: Topic[]) {
    return {
      getHuman: vi.fn(() => ({
        topics: existingTopics,
      })),
      queue_enqueue: vi.fn(),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues HandleTopicValidate when topP(1) similarity meets threshold", async () => {
    const newTopic = makeTopic("new-id", "Machine Learning");
    const existingTopic = makeTopic("existing-id", "Artificial Intelligence");
    const state = makeState([existingTopic, newTopic]);

    mockFindTopK.mockReturnValue([{ item: existingTopic, similarity: VALIDATE_MIN_SIMILARITY }]);

    await queueTopicValidate(newTopic, state as any);

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        next_step: LLMNextStep.HandleTopicValidate,
        type: LLMRequestType.JSON,
        priority: LLMPriority.Normal,
        system: "validate-sys",
        user: "validate-usr",
        data: {
          entity_type: "topic",
          entity_ids: [existingTopic.id, newTopic.id],
        },
      })
    );
    expect(buildValidatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        established: existingTopic,
        newcomer: newTopic,
        itemType: "topic",
        similarity: VALIDATE_MIN_SIMILARITY,
      })
    );
  });

  it("does not queue when similarity is below threshold", async () => {
    const newTopic = makeTopic("new-id", "Cooking");
    const existingTopic = makeTopic("existing-id", "Baking");
    const state = makeState([existingTopic, newTopic]);

    mockFindTopK.mockReturnValue([{ item: existingTopic, similarity: VALIDATE_MIN_SIMILARITY - 0.01 }]);

    await queueTopicValidate(newTopic, state as any);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("does not queue when new topic has no embedding", async () => {
    const newTopic = makeTopic("new-id", "Hiking", false);
    const state = makeState([makeTopic("existing-id", "Outdoor Activities")]);

    await queueTopicValidate(newTopic, state as any);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
    expect(mockFindTopK).not.toHaveBeenCalled();
  });

  it("does not queue when there are no other embedded topics to compare", async () => {
    const newTopic = makeTopic("new-id", "Sailing");
    const state = makeState([newTopic]);

    await queueTopicValidate(newTopic, state as any);

    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("excludes the new topic itself from the candidate pool", async () => {
    const newTopic = makeTopic("new-id", "Jazz");
    const otherTopic = makeTopic("other-id", "Music");
    const state = makeState([newTopic, otherTopic]);

    mockFindTopK.mockReturnValue([{ item: otherTopic, similarity: 0.9 }]);

    await queueTopicValidate(newTopic, state as any);

    const candidatesPassedToFindTopK = mockFindTopK.mock.calls[0][1] as Topic[];
    expect(candidatesPassedToFindTopK.some((t: Topic) => t.id === newTopic.id)).toBe(false);
    expect(candidatesPassedToFindTopK.some((t: Topic) => t.id === otherTopic.id)).toBe(true);
  });

  it("passes extractionModel through to the queued request", async () => {
    const newTopic = makeTopic("new-id", "TypeScript");
    const existingTopic = makeTopic("existing-id", "JavaScript");
    const state = makeState([existingTopic, newTopic]);

    mockFindTopK.mockReturnValue([{ item: existingTopic, similarity: 0.9 }]);

    await queueTopicValidate(newTopic, state as any, "my-model");

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ model: "my-model" })
    );
  });
});

describe("queueEventSummary — open window guard", () => {
  const HOUR_MS = 60 * 60 * 1000;
  const GAP_HOURS = 8;

  function makeMsg(id: string, hoursAgo: number, role: "human" | "system" = "human"): Message {
    return {
      id,
      role,
      verbal_response: `msg ${id}`,
      timestamp: new Date(Date.now() - hoursAgo * HOUR_MS).toISOString(),
      read: true,
      context_status: "default" as any,
      e: false,
    };
  }

  function makeEventState(unextracted: Message[], all: Message[] = unextracted) {
    return {
      getHuman: vi.fn(() => ({
        settings: { ceremony: { event_window_hours: GAP_HOURS } },
        topics: [], facts: [], people: [], quotes: [], traits: [],
        last_updated: "", last_activity: "",
      })),
      persona_getById: vi.fn(() => ({
        id: "p1", display_name: "TestPersona", entity: "system",
        aliases: [], traits: [], topics: [],
        is_paused: false, is_archived: false, is_static: false,
        last_updated: "", last_activity: "",
      })),
      messages_getUnextracted: vi.fn(() => unextracted),
      messages_get: vi.fn(() => all),
      messages_markExtracted: vi.fn(),
      queue_enqueue: vi.fn(),
    };
  }

  beforeEach(() => vi.clearAllMocks());

  it("processes a closed window (last message > 8h ago)", () => {
    const msgs = [
      makeMsg("1", 10),
      makeMsg("2", 9),
    ];
    const state = makeEventState(msgs);

    const chunks = queueEventSummary("p1", state as any);

    expect(chunks).toBeGreaterThan(0);
    expect(state.messages_markExtracted).toHaveBeenCalled();
    expect(state.queue_enqueue).toHaveBeenCalled();
  });

  it("skips an open window (last message < 8h ago)", () => {
    const msgs = [
      makeMsg("1", 2),
      makeMsg("2", 1),
    ];
    const state = makeEventState(msgs);

    const chunks = queueEventSummary("p1", state as any);

    expect(chunks).toBe(0);
    expect(state.messages_markExtracted).not.toHaveBeenCalled();
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("processes closed windows and skips the trailing open window", () => {
    const msgs = [
      makeMsg("1", 20),
      makeMsg("2", 19),
      makeMsg("3", 2),
      makeMsg("4", 1),
    ];
    const state = makeEventState(msgs);

    const chunks = queueEventSummary("p1", state as any);

    expect(chunks).toBeGreaterThan(0);
    const markedIds: string[] = state.messages_markExtracted.mock.calls.flatMap((c: any) => c[1]);
    expect(markedIds).toContain("1");
    expect(markedIds).toContain("2");
    expect(markedIds).not.toContain("3");
    expect(markedIds).not.toContain("4");
  });

  it("processes all windows when every window is closed", () => {
    const msgs = [
      makeMsg("1", 30),
      makeMsg("2", 29),
      makeMsg("3", 10),
      makeMsg("4", 9),
    ];
    const state = makeEventState(msgs);

    queueEventSummary("p1", state as any);

    const markedIds: string[] = state.messages_markExtracted.mock.calls.flatMap((c: any) => c[1]);
    expect(markedIds).toContain("1");
    expect(markedIds).toContain("2");
    expect(markedIds).toContain("3");
    expect(markedIds).toContain("4");
  });

  it("returns 0 when there are no unextracted messages", () => {
    const state = makeEventState([]);

    const chunks = queueEventSummary("p1", state as any);

    expect(chunks).toBe(0);
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });
});

describe("queueTargetedPersonUpdate — guard conditions", () => {
  it("returns 0 and warns when person ID is not found", () => {
    const state = createMockStateManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = queueTargetedPersonUpdate("nonexistent-id", "ei", state as any);

    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Person nonexistent-id not found"));
    expect(state.queue_enqueue).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 0 and warns when persona ID is not found (non-room path)", () => {
    const state = createMockStateManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = queueTargetedPersonUpdate("p1", "nonexistent-persona", state as any);

    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Persona nonexistent-persona not found"));
    expect(state.queue_enqueue).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 0 when persona has no messages", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([]);

    const result = queueTargetedPersonUpdate("p1", "ei", state as any);

    expect(result).toBe(0);
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("enqueues work when person and persona exist with messages", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "Beta is great"),
    ]);

    const result = queueTargetedPersonUpdate("p1", "ei", state as any);

    expect(result).toBeGreaterThan(0);
    expect(state.queue_enqueue).toHaveBeenCalled();
  });
});

describe("queueTargetedTopicUpdate — guard conditions", () => {
  it("returns 0 and warns when topic ID is not found", () => {
    const state = createMockStateManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = queueTargetedTopicUpdate("nonexistent-topic", "ei", state as any);

    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Topic nonexistent-topic not found"));
    expect(state.queue_enqueue).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 0 and warns when persona ID is not found (non-room path)", () => {
    const state = createMockStateManager();
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = queueTargetedTopicUpdate("top1", "nonexistent-persona", state as any);

    expect(result).toBe(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Persona nonexistent-persona not found"));
    expect(state.queue_enqueue).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns 0 when persona has no messages", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([]);

    const result = queueTargetedTopicUpdate("top1", "ei", state as any);

    expect(result).toBe(0);
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("enqueues work when topic and persona exist with messages", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "AI is fascinating"),
    ]);

    const result = queueTargetedTopicUpdate("top1", "ei", state as any);

    expect(result).toBeGreaterThan(0);
    expect(state.queue_enqueue).toHaveBeenCalled();
  });
});



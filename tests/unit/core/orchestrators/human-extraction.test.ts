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
import type { StateManager } from "../../../../src/core/state-manager.js";
import {
  queueFactFind,
  queueTopicScan,
  queuePersonScan,
  queueAllScans,
  queueTopicValidate,
  queueEventSummary,
  queueTargetedPersonUpdate,
  queuePersonUpdate,
  queueTopicMatch,
  queueDirectTopicUpdate,
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
  buildTopicMatchPrompt: vi.fn().mockReturnValue({ system: "topic-match-sys", user: "topic-match-usr" }),
  buildTopicUpdatePrompt: vi.fn().mockReturnValue({ system: "topic-update-sys", user: "topic-update-usr" }),
}));

vi.mock("../../../../src/core/handlers/utils.js", () => ({
  normalizeRoomMessages: vi.fn((msgs: unknown[]) => msgs),
  getMessageContent: vi.fn((msg: { content?: string }) => msg.content ?? ""),
  resolveMessageWindow: vi.fn((msgs: unknown[]) => msgs),
  splitMessagesByTimestamp: vi.fn(() => ({ before: [], after: [] })),
  markMessagesExtracted: vi.fn(),
  getMessageText: vi.fn((msg: { content?: string }) => msg.content ?? ""),
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
  buildPersonUpdatePrompt,
} from "../../../../src/prompts/human/index.js";
import { buildValidatePrompt } from "../../../../src/prompts/ceremony/dedup.js";
// Real prompt builder (person-update.js is NOT mocked) — delegated to in the I1 test
// below so we can assert the forwarded identifiers reach the enqueued system prompt.
import { buildPersonUpdatePrompt as realBuildPersonUpdatePrompt } from "../../../../src/prompts/human/person-update.js";

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
    },
  ];

  return {
    getHuman: vi.fn(() => human),
    persona_getAll: vi.fn(() => personas),
    persona_getById: vi.fn((id: string) => personas.find(p => p.id === id) ?? null),
    queue_enqueue: vi.fn(),
    human_person_upsert: vi.fn(),
    messages_markExtracted: vi.fn(),
    messages_getUnextracted: vi.fn().mockReturnValue([
      { id: "unextracted-1", role: "human", content: "test", timestamp: new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(), read: true, context_status: "default" },
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
      channelDisplayName: "Ei",
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
        // With this tiny fixture (~11-token analyze batch), the chunker's content-sized budget
        // correctly excludes the earlier-context message — see extraction-chunker.test.ts for
        // the dedicated coverage of that sizing behavior.
        messages_context: [],
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
          messages_context: [],
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
          messages_context: [],
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

describe("extraction model fallback (regression: was silently using conversation_model)", () => {
  // Real bug found via manual QA: queueFactFind/queueTopicScan/queuePersonScan/
  // queueEventSummary read `options?.extraction_model` with NO fallback at all.
  // Combined with state-manager.ts's queue_enqueue() defaulting an unset
  // `model` to settings.conversation_model, any caller that didn't pass
  // `options.extraction_model` explicitly (e.g. message-manager.ts's seed
  // extraction, or any import/sync path routing through queueAllScans with
  // no options) silently burned the CONVERSATION model for extraction work
  // instead of the configured, typically-cheaper extraction_model.
  let state: any;
  let context: ExtractionContext;

  beforeEach(() => {
    state = createMockStateManager();
    state._human.settings = {
      conversation_model: "conversation-guid",
      extraction_model: "extraction-guid",
    };
    context = {
      personaId: "ei",
      channelDisplayName: "Ei",
      messages_context: [createMessage("1", "Earlier message")],
      messages_analyze: [createMessage("2", "Recent message to analyze")],
    };
    vi.clearAllMocks();
  });

  it("queueFactFind: no options.extraction_model -> falls back to settings.extraction_model, not conversation_model", () => {
    queueFactFind(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("extraction-guid");
  });

  it("queueTopicScan: no options.extraction_model -> falls back to settings.extraction_model, not conversation_model", () => {
    queueTopicScan(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("extraction-guid");
  });

  it("queuePersonScan: no options.extraction_model -> falls back to settings.extraction_model, not conversation_model", () => {
    queuePersonScan(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("extraction-guid");
  });

  it("queueEventSummary: no options.extraction_model -> falls back to settings.extraction_model, not conversation_model", () => {
    const oldMessage = createMessage("e1", "event message");
    oldMessage.timestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    state.messages_getUnextracted = vi.fn().mockReturnValue([oldMessage]);
    queueEventSummary("ei", state);
    expect(state.queue_enqueue).toHaveBeenCalled();
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("extraction-guid");
  });

  // Second half of the same bug class: queueTopicScan/queuePersonScan/queueEventSummary
  // resolve the correct model for THEIR OWN queue item (asserted above), but the
  // resolved value never made it into `data.extraction_model` — the field
  // handleHumanTopicScan/handleHumanPersonScan/handleEventScan read to thread the
  // model into the descendant queueTopicMatch/queuePersonUpdate call. `data` was
  // built by spreading `...options` (which callers rarely populate), silently
  // dropping the resolved model and leaving the descendant call with `model:
  // undefined` — which state.queue_enqueue then defaults to conversation_model.
  it("queueTopicScan: resolved model is also threaded into data.extraction_model for handleHumanTopicScan", () => {
    queueTopicScan(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.data.extraction_model).toBe("extraction-guid");
  });

  it("queuePersonScan: resolved model is also threaded into data.extraction_model for handleHumanPersonScan", () => {
    queuePersonScan(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.data.extraction_model).toBe("extraction-guid");
  });

  it("queueEventSummary: resolved model is also threaded into data.extraction_model for handleEventScan", () => {
    const oldMessage = createMessage("e1", "event message");
    oldMessage.timestamp = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    state.messages_getUnextracted = vi.fn().mockReturnValue([oldMessage]);
    queueEventSummary("ei", state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.data.extraction_model).toBe("extraction-guid");
  });

  it("queueFactFind: settings.extraction_model unset -> tail falls back to settings.conversation_model, never empty", () => {
    state._human.settings = { conversation_model: "conversation-guid" };
    queueFactFind(context, state);
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("conversation-guid");
  });

  it("queueFactFind: explicit options.extraction_model still wins over settings", () => {
    queueFactFind(context, state, { extraction_model: "explicit-override-guid" });
    const call = state.queue_enqueue.mock.calls[0][0];
    expect(call.model).toBe("explicit-override-guid");
  });
});
describe("Human-chain extraction model propagation", () => {

  // Tested by Beta — 2026-07-15
  it("queues direct Topic Match work with its supplied extraction model", async () => {
    const state = createMockStateManager();
    const context: ExtractionContext = {
      personaId: "ei",
      channelDisplayName: "Ei",
      messages_context: [],
      messages_analyze: [createMessage("m1", "Talked about AI research")],
    };
    // The test double implements the StateManager members exercised by this direct queue path.
    const stateManager = state as unknown as StateManager;

    await queueTopicMatch(
      { name: "AI research", description: "Artificial intelligence", category: "Interest", reason: "User mentioned AI" },
      context,
      stateManager,
      "extraction-guid",
    );

    const enqueued = state.queue_enqueue.mock.calls[0][0] as { model?: string };
    expect(enqueued.model).toBe("extraction-guid");
  });

  it("queues direct Person Update work with its context extraction model", () => {
    const state = createMockStateManager();
    // The test double implements the StateManager members exercised by this direct queue path.
    const stateManager = state as unknown as StateManager;

    queuePersonUpdate(
      { matched_guid: "p1" },
      {
        personaId: "ei",
        channelDisplayName: "Ei",
        messages_context: [],
        messages_analyze: [createMessage("m1", "Talked to Alice today")],
        candidateName: "Alice",
        candidateDescription: "Best friend",
        candidateRelationship: "friend",
        extraction_model: "extraction-guid",
      },
      stateManager,
    );

    const enqueued = state.queue_enqueue.mock.calls[0][0] as { model?: string };
    expect(enqueued.model).toBe("extraction-guid");
  });

  // T6 (P2): queueDirectTopicUpdate's only current caller (queueTopicValidate)
  // always passes an explicit extraction_model, so this was not a live bug —
  // but unlike every sibling queuer in this file, it had NO settings fallback
  // at all (`options?.extraction_model` with nothing after the `??`), leaving
  // it one careless future caller away from the same conversation_model collapse.
  it("queueDirectTopicUpdate: no options.extraction_model -> falls back to settings.extraction_model, not conversation_model", () => {
    const state = createMockStateManager();
    state._human.settings = {
      conversation_model: "conversation-guid",
      extraction_model: "extraction-guid",
    };
    const stateManager = state as unknown as StateManager;
    const topic: Topic = {
      id: "top1",
      name: "AI",
      description: "Artificial Intelligence",
      sentiment: 0.8,
      exposure_current: 0.5,
      exposure_desired: 0.7,
      last_updated: "",
    };
    const context: ExtractionContext = {
      personaId: "ei",
      channelDisplayName: "Ei",
      messages_context: [],
      messages_analyze: [createMessage("m1", "Talked about AI research")],
    };

    queueDirectTopicUpdate(topic, context, stateManager);

    const enqueued = state.queue_enqueue.mock.calls[0][0] as { model?: string };
    expect(enqueued.model).toBe("extraction-guid");
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

    mockFindTopK.mockReturnValue([{ item: existingTopic, similarity: 0.93 }]);

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
      content: `msg ${id}`,
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
      })),
      persona_getById: vi.fn(() => ({
        id: "p1", display_name: "TestPersona", entity: "system",
        aliases: [], traits: [], topics: [],
        is_paused: false, is_archived: false, is_static: false,
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

  it("resolves extraction model from settings.extraction_model when set (tier 2)", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "Beta is great"),
    ]);
    state._human.settings = { extraction_model: "settings-extraction-guid", conversation_model: "settings-conversation-guid" };

    queueTargetedPersonUpdate("p1", "ei", state as unknown as StateManager);

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ model: "settings-extraction-guid" })
    );
  });

  it("falls back to settings.conversation_model when extraction_model is unset at every tier — never undefined (tail)", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "Beta is great"),
    ]);
    state._human.settings = { conversation_model: "settings-conversation-guid" };

    queueTargetedPersonUpdate("p1", "ei", state as unknown as StateManager);

    const call = state.queue_enqueue.mock.calls[0]?.[0] as { model?: string } | undefined;
    expect(call?.model).toBe("settings-conversation-guid");
    expect(call?.model).not.toBeUndefined();
    expect(call?.model).not.toBe("");
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

  it("resolves extraction model from settings.extraction_model when set (tier 2)", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "AI is fascinating"),
    ]);
    state._human.settings = { extraction_model: "settings-extraction-guid", conversation_model: "settings-conversation-guid" };

    queueTargetedTopicUpdate("top1", "ei", state as unknown as StateManager);

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ model: "settings-extraction-guid" })
    );
  });

  it("falls back to settings.conversation_model when extraction_model is unset at every tier — never undefined (tail)", () => {
    const state = createMockStateManager();
    state.messages_get.mockReturnValue([
      createMessage("m1", "AI is fascinating"),
    ]);
    state._human.settings = { conversation_model: "settings-conversation-guid" };

    queueTargetedTopicUpdate("top1", "ei", state as unknown as StateManager);

    const call = state.queue_enqueue.mock.calls[0]?.[0] as { model?: string } | undefined;
    expect(call?.model).toBe("settings-conversation-guid");
    expect(call?.model).not.toBeUndefined();
    expect(call?.model).not.toBe("");
  });
});



describe("queuePersonUpdate — merge point A removed", () => {
  let state = createMockStateManager();

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("does NOT blind-upsert scan identifiers onto an existing record before the LLM pass", () => {
    // Existing person p1 (Alice) is already seeded in createMockStateManager.
    const result = queuePersonUpdate(
      { matched_guid: "p1" },
      {
        personaId: "ei",
        channelDisplayName: "Ei",
        messages_context: [],
        messages_analyze: [createMessage("m1", "Talked to Alice today")],
        candidateName: "Alice",
        candidateDescription: "Best friend",
        candidateRelationship: "friend",
        candidateIdentifiers: [{ type: "Slack", value: "newhandle" }],
      },
      // Mock state manager is a partial StateManager built for these orchestrator tests.
      state as unknown as StateManager,
    );

    // Merge point A — the blind pre-LLM union of scan identifiers onto the matched
    // record — is gone. The identifiers must reach the record only via the LLM pass.
    expect(state.human_person_upsert).not.toHaveBeenCalled();

    // The record is still queued for an update pass, flagged as an EXISTING item.
    expect(result).toBeGreaterThan(0);
    expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        next_step: LLMNextStep.HandlePersonUpdate,
        data: expect.objectContaining({ isNewItem: false, existingItemId: "p1" }),
      }),
    );
  });
});

describe("queuePersonUpdate — I1 forwards suggested identifiers into the prompt", () => {
  let state = createMockStateManager();

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("renders the validate-or-disprove block into the enqueued system prompt for an existing record", () => {
    // Delegate this single call to the REAL builder so the enqueued system text is the real
    // prompt. mockImplementationOnce reverts after the one chunk, restoring the file's stub.
    vi.mocked(buildPersonUpdatePrompt).mockImplementationOnce(realBuildPersonUpdatePrompt);

    queuePersonUpdate(
      { matched_guid: "p1" }, // Alice, seeded in createMockStateManager
      {
        personaId: "ei",
        channelDisplayName: "Ei",
        messages_context: [],
        messages_analyze: [createMessage("m1", "Talked to Alice today")],
        candidateName: "Alice",
        candidateDescription: "Best friend",
        candidateRelationship: "friend",
        candidateIdentifiers: [{ type: "Slack", value: "W1:U1" }],
      },
      state as unknown as StateManager,
    );

    expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
    const enqueued = state.queue_enqueue.mock.calls[0][0] as { system: string };
    expect(enqueued.system).toContain("scan flagged these identifiers");
    expect(enqueued.system).toContain("Slack=W1:U1");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
  ValidationLevel,
  type Message,
  type HumanEntity,
  type PersonaEntity,
} from "../../../../src/core/types.js";
import {
  queueFactScan,
  queueTraitScan,
  queueTopicScan,
  queuePersonScan,
  queueAllScans,
  queueItemMatch,
  queueItemUpdate,
  type ExtractionContext,
} from "../../../../src/core/orchestrators/human-extraction.js";

vi.mock("../../../../src/prompts/human/index.js", () => ({
  buildHumanFactScanPrompt: vi.fn().mockReturnValue({ system: "fact-sys", user: "fact-usr" }),
  buildHumanTraitScanPrompt: vi.fn().mockReturnValue({ system: "trait-sys", user: "trait-usr" }),
  buildHumanTopicScanPrompt: vi.fn().mockReturnValue({ system: "topic-sys", user: "topic-usr" }),
  buildHumanPersonScanPrompt: vi.fn().mockReturnValue({ system: "person-sys", user: "person-usr" }),
  buildHumanItemMatchPrompt: vi.fn().mockReturnValue({ system: "match-sys", user: "match-usr" }),
  buildHumanItemUpdatePrompt: vi.fn().mockReturnValue({ system: "update-sys", user: "update-usr" }),
}));

import {
  buildHumanFactScanPrompt,
  buildHumanTraitScanPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
  buildHumanItemMatchPrompt,
  buildHumanItemUpdatePrompt,
} from "../../../../src/prompts/human/index.js";

function createMockStateManager() {
  const human: HumanEntity = {
    entity: "human",
    facts: [
      { id: "f1", name: "Birthday", description: "January 15th", sentiment: 0.5, validated: ValidationLevel.None, validated_date: "", last_updated: "" },
    ],
    traits: [
      { id: "t1", name: "Curiosity", description: "Loves learning", sentiment: 0.7, last_updated: "" },
    ],
    topics: [
      { id: "top1", name: "AI", description: "Artificial Intelligence", sentiment: 0.8, exposure_current: 0.5, exposure_desired: 0.7, last_updated: "" },
    ],
    people: [
      { id: "p1", name: "Alice", description: "Best friend", relationship: "friend", sentiment: 0.9, exposure_current: 0.6, exposure_desired: 0.8, last_updated: "" },
    ],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  const personas: PersonaEntity[] = [
    {
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
    queue_enqueue: vi.fn(),
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
      personaName: "ei",
      messages_context: [createMessage("1", "Earlier message")],
      messages_analyze: [createMessage("2", "Recent message to analyze")],
    };
    vi.clearAllMocks();
  });

  describe("queueFactScan", () => {
    it("enqueues fact scan request with correct data", () => {
      queueFactScan(context, state as any);

      expect(buildHumanFactScanPrompt).toHaveBeenCalledWith({
        persona_name: "ei",
        messages_context: context.messages_context,
        messages_analyze: context.messages_analyze,
      });

      expect(state.queue_enqueue).toHaveBeenCalledWith({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Normal,
        system: "fact-sys",
        user: "fact-usr",
        next_step: LLMNextStep.HandleHumanFactScan,
        data: {
          personaName: "ei",
          messages_context: context.messages_context,
          messages_analyze: context.messages_analyze,
        },
      });
    });
  });

  describe("queueTraitScan", () => {
    it("enqueues trait scan request with correct data", () => {
      queueTraitScan(context, state as any);

      expect(buildHumanTraitScanPrompt).toHaveBeenCalledWith({
        persona_name: "ei",
        messages_context: context.messages_context,
        messages_analyze: context.messages_analyze,
      });

      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          next_step: LLMNextStep.HandleHumanTraitScan,
        })
      );
    });
  });

  describe("queueTopicScan", () => {
    it("enqueues topic scan request with correct data", () => {
      queueTopicScan(context, state as any);

      expect(buildHumanTopicScanPrompt).toHaveBeenCalledWith({
        persona_name: "ei",
        messages_context: context.messages_context,
        messages_analyze: context.messages_analyze,
      });

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

      expect(state.persona_getAll).toHaveBeenCalled();
      expect(buildHumanPersonScanPrompt).toHaveBeenCalledWith({
        persona_name: "ei",
        messages_context: context.messages_context,
        messages_analyze: context.messages_analyze,
        known_persona_names: ["ei", "Ei", "friend", "Friend"],
      });

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
      expect(nextSteps).toContain(LLMNextStep.HandleHumanFactScan);
      expect(nextSteps).toContain(LLMNextStep.HandleHumanTraitScan);
      expect(nextSteps).toContain(LLMNextStep.HandleHumanTopicScan);
      expect(nextSteps).toContain(LLMNextStep.HandleHumanPersonScan);
    });
  });
});

describe("queueItemMatch (Step 2)", () => {
  let state: ReturnType<typeof createMockStateManager>;
  let context: ExtractionContext;

  beforeEach(() => {
    state = createMockStateManager();
    context = {
      personaName: "ei",
      messages_context: [createMessage("1", "context")],
      messages_analyze: [createMessage("2", "analyze")],
    };
    vi.clearAllMocks();
  });

  it("queues fact match with all items", () => {
    const candidate = {
      type_of_fact: "Location",
      value_of_fact: "San Francisco",
      reason: "User mentioned living there",
    };

    queueItemMatch("fact", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith({
      candidate_type: "fact",
      candidate_name: "Location",
      candidate_value: "San Francisco",
      all_items: expect.arrayContaining([
        expect.objectContaining({ data_type: "fact", data_id: "f1", data_name: "Birthday" }),
        expect.objectContaining({ data_type: "trait", data_id: "t1", data_name: "Curiosity" }),
        expect.objectContaining({ data_type: "topic", data_id: "top1", data_name: "AI" }),
        expect.objectContaining({ data_type: "person", data_id: "p1", data_name: "Alice" }),
      ]),
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        next_step: LLMNextStep.HandleHumanItemMatch,
        data: expect.objectContaining({
          candidateType: "fact",
          itemName: "Location",
          itemValue: "San Francisco",
        }),
      })
    );
  });

  it("queues trait match with all items", () => {
    const candidate = {
      type_of_trait: "Introversion",
      value_of_trait: "Prefers quiet time",
      reason: "Mentioned preference",
    };

    queueItemMatch("trait", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_type: "trait",
        candidate_name: "Introversion",
        candidate_value: "Prefers quiet time",
      })
    );
  });

  it("queues topic match with all items", () => {
    const candidate = {
      type_of_topic: "Machine Learning",
      value_of_topic: "Neural networks",
      reason: "User asked about ML",
    };

    queueItemMatch("topic", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_type: "topic",
        candidate_name: "Machine Learning",
        candidate_value: "Neural networks",
      })
    );
  });

  it("queues person match with all items", () => {
    const candidate = {
      name_of_person: "Bob",
      type_of_person: "coworker",
      reason: "Mentioned Bob from work",
    };

    queueItemMatch("person", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        candidate_type: "person",
        candidate_name: "Bob",
        candidate_value: "coworker",
      })
    );
  });

  it("passes message context through to match request", () => {
    const candidate = {
      type_of_fact: "Test",
      value_of_fact: "Value",
      reason: "Test reason",
    };

    queueItemMatch("fact", candidate, context, state as any);

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          messages_context: context.messages_context,
          messages_analyze: context.messages_analyze,
          personaName: "ei",
        }),
      })
    );
  });
});

describe("queueItemUpdate (Step 3)", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("queues update for new item (null matched_guid)", () => {
    const matchResult = { matched_guid: null };
    const context = {
      personaName: "ei",
      messages_context: [createMessage("1", "context")],
      messages_analyze: [createMessage("2", "analyze")],
      itemName: "NewFact",
      itemValue: "New value",
    };

    queueItemUpdate("fact", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith({
      data_type: "fact",
      existing_item: null,
      messages_context: context.messages_context,
      messages_analyze: context.messages_analyze,
      persona_name: "ei",
      new_item_name: "NewFact",
      new_item_value: "New value",
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        next_step: LLMNextStep.HandleHumanItemUpdate,
        data: expect.objectContaining({
          isNewItem: true,
          existingItemId: undefined,
        }),
      })
    );
  });

  it("queues update for existing fact match by GUID", () => {
    const matchResult = { matched_guid: "f1" };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [createMessage("1", "analyze")],
      itemName: "Birthday",
      itemValue: "Actually January 16th",
    };

    queueItemUpdate("fact", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith({
      data_type: "fact",
      existing_item: expect.objectContaining({
        id: "f1",
        name: "Birthday",
      }),
      messages_context: [],
      messages_analyze: context.messages_analyze,
      persona_name: "ei",
      new_item_name: undefined,
      new_item_value: undefined,
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          isNewItem: false,
          existingItemId: "f1",
        }),
      })
    );
  });

  it("queues update for existing trait match by GUID", () => {
    const matchResult = { matched_guid: "t1" };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "Curiosity",
      itemValue: "Updated value",
    };

    queueItemUpdate("trait", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        data_type: "trait",
        existing_item: expect.objectContaining({ id: "t1", name: "Curiosity" }),
      })
    );
  });

  it("queues update for existing topic match by GUID", () => {
    const matchResult = { matched_guid: "top1" };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "AI",
      itemValue: "Updated AI interest",
    };

    queueItemUpdate("topic", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        existing_item: expect.objectContaining({ id: "top1", name: "AI" }),
      })
    );
  });

  it("queues update for existing person match by GUID", () => {
    const matchResult = { matched_guid: "p1" };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "Alice",
      itemValue: "Colleague",
    };

    queueItemUpdate("person", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        existing_item: expect.objectContaining({ id: "p1", name: "Alice" }),
      })
    );
  });

  it("handles match to non-existent GUID gracefully (treats as new)", () => {
    const matchResult = { matched_guid: "non-existent-guid" };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "NonExistent",
      itemValue: "Value",
    };

    queueItemUpdate("fact", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        existing_item: null,
      })
    );
  });
});

describe("Extraction Pipeline Integration", () => {
  let state: ReturnType<typeof createMockStateManager>;

  beforeEach(() => {
    state = createMockStateManager();
    vi.clearAllMocks();
  });

  it("full pipeline: scan -> match -> update chain carries context", () => {
    const context: ExtractionContext = {
      personaName: "ei",
      messages_context: [createMessage("ctx1", "Earlier conversation")],
      messages_analyze: [createMessage("analyze1", "I live in Chicago")],
    };

    queueFactScan(context, state as any);

    const scanCall = state.queue_enqueue.mock.calls[0][0];
    expect(scanCall.data.messages_context).toBe(context.messages_context);
    expect(scanCall.data.messages_analyze).toBe(context.messages_analyze);

    vi.clearAllMocks();
    const candidate = { type_of_fact: "Location", value_of_fact: "Chicago", reason: "User mentioned" };
    queueItemMatch("fact", candidate, context, state as any);

    const matchCall = state.queue_enqueue.mock.calls[0][0];
    expect(matchCall.data.messages_context).toBe(context.messages_context);
    expect(matchCall.data.messages_analyze).toBe(context.messages_analyze);

    vi.clearAllMocks();
    const matchResult = { matched_guid: null };
    const updateContext = {
      ...context,
      itemName: "Location",
      itemValue: "Chicago",
    };
    queueItemUpdate("fact", matchResult, updateContext, state as any);

    const updateCall = state.queue_enqueue.mock.calls[0][0];
    expect(updateCall.data.isNewItem).toBe(true);
  });
});

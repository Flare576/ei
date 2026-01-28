import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  LLMNextStep,
  LLMRequestType,
  LLMPriority,
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
      { id: "f1", name: "Birthday", description: "January 15th", sentiment: 0.5, confidence: 0.9, last_updated: "" },
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
        priority: LLMPriority.Low,
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

  it("queues fact match with existing facts", () => {
    const candidate = {
      type_of_fact: "Location",
      value_of_fact: "San Francisco",
      confidence: "high" as const,
      reason: "User mentioned living there",
    };

    queueItemMatch("fact", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith({
      data_type: "fact",
      item_name: "Location",
      item_value: "San Francisco",
      existing_items: [{ name: "Birthday", description: "January 15th" }],
    });

    expect(state.queue_enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        next_step: LLMNextStep.HandleHumanItemMatch,
        data: expect.objectContaining({
          dataType: "fact",
          itemName: "Location",
          itemValue: "San Francisco",
          scanConfidence: "high",
        }),
      })
    );
  });

  it("queues trait match with existing traits", () => {
    const candidate = {
      type_of_trait: "Introversion",
      value_of_trait: "Prefers quiet time",
      confidence: "medium" as const,
      reason: "Mentioned preference",
    };

    queueItemMatch("trait", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith({
      data_type: "trait",
      item_name: "Introversion",
      item_value: "Prefers quiet time",
      existing_items: [{ name: "Curiosity", description: "Loves learning" }],
    });
  });

  it("queues topic match with existing topics", () => {
    const candidate = {
      type_of_topic: "Machine Learning",
      value_of_topic: "Neural networks",
      confidence: "low" as const,
      reason: "User asked about ML",
    };

    queueItemMatch("topic", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith({
      data_type: "topic",
      item_name: "Machine Learning",
      item_value: "Neural networks",
      existing_items: [{ name: "AI", description: "Artificial Intelligence" }],
    });
  });

  it("queues person match with existing people", () => {
    const candidate = {
      name_of_person: "Bob",
      type_of_person: "coworker",
      confidence: "high" as const,
      reason: "Mentioned Bob from work",
    };

    queueItemMatch("person", candidate, context, state as any);

    expect(buildHumanItemMatchPrompt).toHaveBeenCalledWith({
      data_type: "person",
      item_name: "Bob",
      item_value: "coworker",
      existing_items: [{ name: "Alice", description: "Best friend" }],
    });
  });

  it("passes message context through to match request", () => {
    const candidate = {
      type_of_fact: "Test",
      value_of_fact: "Value",
      confidence: "high" as const,
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

  it("queues update for new item (Not Found match)", () => {
    const matchResult = { name: "Not Found", description: "No match found", confidence: "low" as const };
    const context = {
      personaName: "ei",
      messages_context: [createMessage("1", "context")],
      messages_analyze: [createMessage("2", "analyze")],
      itemName: "NewFact",
      itemValue: "New value",
      scanConfidence: "high",
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

  it("queues update for existing fact match", () => {
    const matchResult = { name: "Birthday", description: "User's birthday", confidence: "high" as const };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [createMessage("1", "analyze")],
      itemName: "Birthday",
      itemValue: "Actually January 16th",
      scanConfidence: "high",
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

  it("queues update for existing trait match", () => {
    const matchResult = { name: "Curiosity", description: "Personality trait", confidence: "high" as const };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "Curiosity",
      itemValue: "Updated value",
      scanConfidence: "medium",
    };

    queueItemUpdate("trait", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        data_type: "trait",
        existing_item: expect.objectContaining({ id: "t1", name: "Curiosity" }),
      })
    );
  });

  it("queues update for existing topic match", () => {
    const matchResult = { name: "AI", description: "Artificial intelligence", confidence: "high" as const };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "AI",
      itemValue: "Updated AI interest",
      scanConfidence: "high",
    };

    queueItemUpdate("topic", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        existing_item: expect.objectContaining({ id: "top1", name: "AI" }),
      })
    );
  });

  it("queues update for existing person match", () => {
    const matchResult = { name: "Alice", description: "Friend", confidence: "high" as const };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "Alice",
      itemValue: "Colleague",
      scanConfidence: "medium",
    };

    queueItemUpdate("person", matchResult, context, state as any);

    expect(buildHumanItemUpdatePrompt).toHaveBeenCalledWith(
      expect.objectContaining({
        existing_item: expect.objectContaining({ id: "p1", name: "Alice" }),
      })
    );
  });

  it("handles match to non-existent item gracefully (treats as new)", () => {
    const matchResult = { name: "NonExistent", description: "No match", confidence: "medium" as const };
    const context = {
      personaName: "ei",
      messages_context: [],
      messages_analyze: [],
      itemName: "NonExistent",
      itemValue: "Value",
      scanConfidence: "medium",
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
    const candidate = { type_of_fact: "Location", value_of_fact: "Chicago", confidence: "high" as const, reason: "User mentioned" };
    queueItemMatch("fact", candidate, context, state as any);

    const matchCall = state.queue_enqueue.mock.calls[0][0];
    expect(matchCall.data.messages_context).toBe(context.messages_context);
    expect(matchCall.data.messages_analyze).toBe(context.messages_analyze);

    vi.clearAllMocks();
    const matchResult = { name: "Not Found", description: "No match", confidence: "low" as const };
    const updateContext = {
      ...context,
      itemName: "Location",
      itemValue: "Chicago",
      scanConfidence: "high",
    };
    queueItemUpdate("fact", matchResult, updateContext, state as any);

    const updateCall = state.queue_enqueue.mock.calls[0][0];
    expect(updateCall.data.isNewItem).toBe(true);
  });
});

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
  queueFactFind,
  queueTopicScan,
  queuePersonScan,
  queueAllScans,
  type ExtractionContext,
} from "../../../../src/core/orchestrators/human-extraction.js";

vi.mock("../../../../src/prompts/human/index.js", () => ({
  buildFactFindPrompt: vi.fn().mockReturnValue({ system: "fact-find-sys", user: "fact-find-usr" }),
  buildHumanTopicScanPrompt: vi.fn().mockReturnValue({ system: "topic-sys", user: "topic-usr" }),
  buildHumanPersonScanPrompt: vi.fn().mockReturnValue({ system: "person-sys", user: "person-usr" }),
  buildEventScanPrompt: vi.fn().mockReturnValue({ system: "event-sys", user: "event-usr" }),
}));

import {
  buildFactFindPrompt,
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
} from "../../../../src/prompts/human/index.js";

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
      { id: "unextracted-1", role: "human", verbal_response: "test", timestamp: new Date().toISOString(), read: true, context_status: "default" },
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



import { describe, it, expect, vi } from "vitest";
import { RoomMode, LLMNextStep, LLMRequestType, LLMPriority, ContextStatus } from "../../../src/core/types.js";
import type { LLMRequest, RoomMessage } from "../../../src/core/types.js";

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  queueExpirePhase: vi.fn(),
  queueExplorePhase: vi.fn(),
  queueDescriptionCheck: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
}));

import { Processor } from "../../../src/core/processor.js";

const makeRequest = (overrides: Partial<LLMRequest> = {}): LLMRequest => ({
  id: "req-1",
  created_at: "2026-01-01T00:00:00.000Z",
  attempts: 0,
  state: "pending" as const,
  type: LLMRequestType.Raw,
  priority: LLMPriority.Room,
  system: "system prompt",
  user: "user prompt",
  next_step: LLMNextStep.HandleRoomResponse,
  model: "test:model",
  data: {
    roomId: "room-1",
    personaId: "persona-1",
    personaDisplayName: "Beta",
    parentMessageId: "parent-msg-1",
  },
  ...overrides,
});

const makeSiblingMessage = (id: string, personaId: string, content: string): RoomMessage => ({
  id,
  parent_id: "parent-msg-1",
  role: "persona",
  persona_id: personaId,
  content,
  silence_reason: undefined,
  verbal_response: undefined,
  action_response: undefined,
  timestamp: "2026-01-01T00:00:00.000Z",
  context_status: ContextStatus.Default,
  read: false,
});

function makeProcessor(roomMode: RoomMode, siblings: RoomMessage[] = []) {
  const processor = new Processor({ onQueueStateChanged: vi.fn() } as never);
  const sm = (processor as never as { stateManager: Record<string, unknown> }).stateManager;

  sm.getRoom = vi.fn(() => ({ mode: roomMode }));
  sm.getRoomChildren = vi.fn(() => siblings);
  sm.persona_getById = vi.fn((id: string) => ({ display_name: id === "persona-2" ? "Lena" : "Unknown" }));

  return processor;
}

describe("augmentRoomRequest — sibling awareness gating", () => {
  const sibling = makeSiblingMessage("msg-2", "persona-2", "I think this is a great idea!");

  it("injects sibling section for FFA rooms when siblings exist", () => {
    const processor = makeProcessor(RoomMode.FreeForAll, [sibling]);
    const request = makeRequest();
    const result = (processor as never as { augmentRoomRequest: (r: LLMRequest) => LLMRequest })
      .augmentRoomRequest(request);

    expect(result.system).toContain("Room context — this round");
    expect(result.system).toContain("Lena");
    expect(result.system).toContain("I think this is a great idea!");
  });

  it("does NOT inject sibling section for CYP rooms", () => {
    const processor = makeProcessor(RoomMode.ChooseYourPath, [sibling]);
    const request = makeRequest();
    const result = (processor as never as { augmentRoomRequest: (r: LLMRequest) => LLMRequest })
      .augmentRoomRequest(request);

    expect(result.system).toBe("system prompt");
    expect(result.system).not.toContain("Room context");
  });

  it("does NOT inject sibling section for MAP rooms", () => {
    const processor = makeProcessor(RoomMode.MessagesAgainstPersona, [sibling]);
    const request = makeRequest();
    const result = (processor as never as { augmentRoomRequest: (r: LLMRequest) => LLMRequest })
      .augmentRoomRequest(request);

    expect(result.system).toBe("system prompt");
    expect(result.system).not.toContain("Room context");
  });

  it("skips augmentation for FFA with no siblings yet", () => {
    const processor = makeProcessor(RoomMode.FreeForAll, []);
    const request = makeRequest();
    const result = (processor as never as { augmentRoomRequest: (r: LLMRequest) => LLMRequest })
      .augmentRoomRequest(request);

    expect(result.system).toBe("system prompt");
  });

  it("passes through non-room-response steps unchanged", () => {
    const processor = makeProcessor(RoomMode.FreeForAll, [sibling]);
    const request = makeRequest({ next_step: LLMNextStep.HandleRoomJudge });
    const result = (processor as never as { augmentRoomRequest: (r: LLMRequest) => LLMRequest })
      .augmentRoomRequest(request);

    expect(result.system).toBe("system prompt");
  });
});

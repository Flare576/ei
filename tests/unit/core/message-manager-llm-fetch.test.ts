import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HumanEntity, Message, PersonaEntity } from "../../../src/core/types.js";

// Mock orchestrators BEFORE importing message-manager
vi.mock("../../../src/core/orchestrators/index.js", () => ({
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  orchestratePersonaGeneration: vi.fn(),
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
}));

vi.mock("../../../src/core/format-utils.js", () => ({
  formatTimestamp: vi.fn().mockReturnValue("Thu, Mar 22, 2026, 14:04 CDT"),
  formatCurrentTime: vi.fn(),
}));

import { fetchMessagesForLLM } from "../../../src/core/message-manager.js";
import { formatTimestamp } from "../../../src/core/format-utils.js";

function makeMessage(id: string): Message {
  return {
    id,
    role: "human",
    verbal_response: "test message",
    timestamp: new Date().toISOString(),
    read: true,
    context_status: "default" as any,
  };
}

function createMockStateManager(
  persona: PersonaEntity | null,
  messages: Message[]
) {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    settings: {},
  };

  return {
    persona_getById: vi.fn(() => persona),
    getHuman: vi.fn(() => human),
    messages_get: vi.fn(() => messages),
  };
}

describe("fetchMessagesForLLM — timestamp injection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls formatTimestamp once per message when include_message_timestamps is true", () => {
    const persona: Partial<PersonaEntity> = {
      id: "p1",
      context_window_hours: 999,
      context_boundary: undefined,
      include_message_timestamps: true,
    };

    const messages = [makeMessage("m1"), makeMessage("m2")];
    const sm = createMockStateManager(persona as PersonaEntity, messages);

    const result = fetchMessagesForLLM(sm as any, "p1");

    expect(formatTimestamp).toHaveBeenCalledTimes(2);
    expect(formatTimestamp).toHaveBeenCalledWith(messages[0].timestamp);
    expect(formatTimestamp).toHaveBeenCalledWith(messages[1].timestamp);
    expect(result[0].content).toMatch(/^\[Thu, Mar 22, 2026, 14:04 CDT\] /);
  });

  it("does NOT call formatTimestamp when include_message_timestamps is false", () => {
    const persona: Partial<PersonaEntity> = {
      id: "p2",
      context_window_hours: 999,
      context_boundary: undefined,
      include_message_timestamps: false,
    };

    const messages = [makeMessage("m1"), makeMessage("m2")];
    const sm = createMockStateManager(persona as PersonaEntity, messages);

    const result = fetchMessagesForLLM(sm as any, "p2");

    expect(formatTimestamp).not.toHaveBeenCalled();
    expect(result[0].content).not.toMatch(/^\[/);
  });

  it("returns [] and does NOT call formatTimestamp when persona is not found", () => {
    const sm = createMockStateManager(null, []);

    const result = fetchMessagesForLLM(sm as any, "nonexistent");

    expect(result).toEqual([]);
    expect(formatTimestamp).not.toHaveBeenCalled();
  });
});

import { describe, expect, it, vi } from "vitest";
import { LLMNextStep, type Message, type PersonaTopic } from "../../../../src/core/types.js";
import type { StateManager } from "../../../../src/core/state-manager.js";
import {
  queuePersonaTopicRating,
  type PersonaTopicContext,
} from "../../../../src/core/orchestrators/persona-topics.js";

function createMockStateManager() {
  const messages_markPersonaExtracted = vi.fn();
  const queue_enqueue = vi.fn();

  return {
    state: {
      getHuman: vi.fn(() => ({
        settings: {
          conversation_model: "conversation-guid",
          extraction_model: "extraction-guid",
        },
      })),
      messages_markPersonaExtracted,
      queue_enqueue,
    } as unknown as StateManager,
    messages_markPersonaExtracted,
    queue_enqueue,
  };
}

const message: Message = {
  id: "message-1",
  role: "human",
  content: "Let's discuss TypeScript testing.",
  timestamp: "2026-07-15T12:00:00.000Z",
  read: true,
  context_status: "default" as Message["context_status"],
};

const topic: PersonaTopic = {
  id: "topic-1",
  name: "TypeScript",
  perspective: "Tests should protect observable behavior.",
  approach: "Use focused regression tests.",
  personal_stake: "Reliable tests make changes safer.",
  sentiment: 0.9,
  exposure_current: 0.4,
  exposure_desired: 0.8,
  last_updated: "2026-07-15T12:00:00.000Z",
};

// Tested by Beta — 2026-07-15
describe("queuePersonaTopicRating extraction model regression", () => {
  it("queues persona topic rating with the configured extraction model", () => {
    const { state, queue_enqueue } = createMockStateManager();
    const context: PersonaTopicContext = {
      personaId: "persona-1",
      personaDisplayName: "Beta",
      messages_context: [],
      messages_analyze: [message],
      topics: [topic],
    };

    queuePersonaTopicRating(context, state);

    expect(queue_enqueue).toHaveBeenCalledWith(expect.objectContaining({
      next_step: LLMNextStep.HandlePersonaTopicRating,
      model: "extraction-guid",
    }));
  });
});

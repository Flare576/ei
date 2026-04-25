import { describe, it, expect } from "vitest";
import { buildHeartbeatCheckPrompt } from "../../../src/prompts/heartbeat/index.js";
import type { HeartbeatCheckPromptData } from "../../../src/prompts/heartbeat/index.js";
import type { Message, PersonaTrait, PersonaTopic, ContextStatus } from "../../../src/core/types.js";

function makeTrait(overrides?: Partial<PersonaTrait>): PersonaTrait {
  return {
    id: "trait-1",
    name: "Curiosity",
    description: "Always asking questions.",
    sentiment: 0.8,
    strength: 0.7,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTopic(overrides?: Partial<PersonaTopic>): PersonaTopic {
  return {
    id: "topic-1",
    name: "AI Ethics",
    perspective: "Complicated but necessary.",
    approach: "Socratic questioning.",
    personal_stake: "Defines my existence.",
    sentiment: 0.7,
    exposure_current: 0.5,
    exposure_desired: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "msg-1",
    role: "human",
    content: "Hey, how's it going?",
    timestamp: "2026-01-01T12:00:00Z",
    read: true,
    context_status: "default" as ContextStatus,
    ...overrides,
  };
}

function baseData(overrides?: Partial<HeartbeatCheckPromptData>): HeartbeatCheckPromptData {
  return {
    persona: {
      name: "Sisyphus",
      traits: [makeTrait()],
      topics: [makeTopic()],
      has_pending_update: false,
    },
    human: {
      topics: [],
      people: [],
    },
    recent_history: [makeMessage()],
    inactive_days: 2,
    ...overrides,
  };
}

describe("buildHeartbeatCheckPrompt — pending_update awareness", () => {
  it("when has_pending_update is false, system prompt does NOT contain 'Pending Identity Changes'", () => {
    const data = baseData({
      persona: { name: "Sisyphus", traits: [], topics: [], has_pending_update: false },
    });

    const { system } = buildHeartbeatCheckPrompt(data);

    expect(system).not.toContain("Pending Identity Changes");
  });

  it("when has_pending_update is true, system prompt DOES contain 'Pending Identity Changes'", () => {
    const data = baseData({
      persona: { name: "Sisyphus", traits: [], topics: [], has_pending_update: true },
    });

    const { system } = buildHeartbeatCheckPrompt(data);

    expect(system).toContain("Pending Identity Changes");
  });
});

describe("buildHeartbeatCheckPrompt — consecutive persona message warning", () => {
  it("when consecutive persona messages exist, user prompt contains 'CRITICAL: You Already Reached Out'", () => {
    const data = baseData({
      recent_history: [
        makeMessage({ id: "m1", role: "human", content: "Hello!" }),
        makeMessage({ id: "m2", role: "system", content: "Hey there, want to chat about AI?" }),
      ],
    });

    const { user } = buildHeartbeatCheckPrompt(data);

    expect(user).toContain("CRITICAL: You Already Reached Out");
  });

  it("when no consecutive persona messages, user prompt does NOT contain the warning", () => {
    const data = baseData({
      recent_history: [
        makeMessage({ id: "m1", role: "system", content: "Earlier message" }),
        makeMessage({ id: "m2", role: "human", content: "Got it, thanks!" }),
      ],
    });

    const { user } = buildHeartbeatCheckPrompt(data);

    expect(user).not.toContain("CRITICAL: You Already Reached Out");
  });
});

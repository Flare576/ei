import { describe, it, expect } from "vitest";
import { buildEiHeartbeatPrompt } from "../../../src/prompts/heartbeat/index.js";
import type { EiHeartbeatPromptData, EiHeartbeatItem } from "../../../src/prompts/heartbeat/index.js";
import type { Message, ContextStatus } from "../../../src/core/types.js";

function makeMessage(overrides?: Partial<Message>): Message {
  return {
    id: "msg-1",
    role: "human",
    content: "Hey Ei!",
    timestamp: "2026-01-01T12:00:00Z",
    read: true,
    context_status: "default" as ContextStatus,
    ...overrides,
  };
}

function baseData(items: EiHeartbeatItem[] = []): EiHeartbeatPromptData {
  const history = [makeMessage()];
  return {
    items,
    recent_history: history,
    system_messages: history.filter(m => m.role === "system"),
  };
}

describe("buildEiHeartbeatPrompt — Self Reflection Alert", () => {
  it("includes Self Reflection Alert content in the system prompt when present", () => {
    const item: EiHeartbeatItem = {
      id: "ei",
      type: "Self Reflection Alert",
      critique: "Your descriptions have drifted toward event logging.",
    };

    const { system } = buildEiHeartbeatPrompt(baseData([item]));

    expect(system).toContain("Self Reflection Alert");
    expect(system).toContain("Your descriptions have drifted toward event logging.");
  });

  it("Self Reflection Alert is distinct from Persona Reflection Alert in the prompt", () => {
    const selfItem: EiHeartbeatItem = {
      id: "ei",
      type: "Self Reflection Alert",
      critique: "Ei's own identity drift.",
    };
    const otherItem: EiHeartbeatItem = {
      id: "persona-123",
      type: "Persona Reflection Alert",
      persona_name: "Sisyphus",
      critique: "Sisyphus drift detected.",
    };

    const { system } = buildEiHeartbeatPrompt(baseData([selfItem, otherItem]));

    expect(system).toContain("Self Reflection Alert");
    expect(system).toContain("Persona Reflection Alert");
    expect(system).toContain("Sisyphus");
    expect(system).toContain("Ei's own identity drift.");
    expect(system).toContain("Sisyphus drift detected.");
  });

  it("prompt includes Self Reflection Alert instructions when item is present", () => {
    const item: EiHeartbeatItem = {
      id: "ei",
      type: "Self Reflection Alert",
      critique: "Some critique.",
    };

    const { system } = buildEiHeartbeatPrompt(baseData([item]));

    expect(system).toContain("your own identity");
  });

  it("items section shows 'Nothing requires attention' when no Self Reflection Alert item is present", () => {
    const { system } = buildEiHeartbeatPrompt(baseData([]));

    expect(system).toContain("Nothing requires attention right now");
    expect(system).not.toContain("**ei** Self Reflection Alert");
  });
});

describe("buildEiHeartbeatPrompt — Persona Reflection Alert (existing behavior preserved)", () => {
  it("includes Persona Reflection Alert content for other personas", () => {
    const item: EiHeartbeatItem = {
      id: "persona-abc",
      type: "Persona Reflection Alert",
      persona_name: "DJ",
      critique: "DJ has stopped asking about music.",
    };

    const { system } = buildEiHeartbeatPrompt(baseData([item]));

    expect(system).toContain("Persona Reflection Alert");
    expect(system).toContain("DJ");
    expect(system).toContain("DJ has stopped asking about music.");
  });
});

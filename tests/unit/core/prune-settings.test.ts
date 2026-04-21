import { describe, it, expect, vi } from "vitest";
import { prunePersonaMessages } from "../../../src/core/orchestrators/ceremony.js";
import { ContextStatus } from "../../../src/core/types.js";
import type { HumanEntity, Message } from "../../../src/core/types.js";
import type { StateManager } from "../../../src/core/state-manager.js";

function makeMsg(id: string, daysOld: number, fullyExtracted = true): Message {
  const ts = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000);
  return {
    id,
    role: "human" as const,
    content: "test",
    timestamp: ts.toISOString(),
    read: true,
    context_status: ContextStatus.Default,
    f: fullyExtracted,
    t: fullyExtracted,
    p: fullyExtracted,
  };
}

function makeState(messages: Message[], settings?: HumanEntity["settings"]) {
  const removed: string[] = [];
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
    settings,
  };
  return {
    state: {
      getHuman: vi.fn(() => human),
      messages_sort: vi.fn(),
      messages_get: vi.fn(() => [...messages]),
      messages_remove: vi.fn((_: string, ids: string[]) => removed.push(...ids)),
      persona_getById: vi.fn(() => undefined),
    } as unknown as StateManager,
    removed,
  };
}

describe("prunePersonaMessages — HumanSettings overrides", () => {
  it("respects custom message_min_count: keeps at least 5 when set to 5", () => {
    // 10 messages, all old (30 days), all fully extracted
    // With min_count=5, should remove 5 (keep 5)
    const messages = Array.from({ length: 10 }, (_, i) => makeMsg(`msg-${i}`, 30));
    const { state, removed } = makeState(messages, { message_min_count: 5 });

    prunePersonaMessages("persona-1", state);

    // Should have removed exactly 5 (leaving min 5)
    expect(removed.length).toBe(5);
  });

  it("respects custom message_max_age_days: only removes messages older than 1 day", () => {
    // 300 messages: 250 old (5 days), 50 recent (0 days = just now)
    // With max_age_days=1, only the 250 old ones are eligible
    const oldMessages = Array.from({ length: 250 }, (_, i) => makeMsg(`old-${i}`, 5));
    const recentMessages = Array.from({ length: 50 }, (_, i) => makeMsg(`recent-${i}`, 0));
    const messages = [...oldMessages, ...recentMessages];
    const { state, removed } = makeState(messages, { message_max_age_days: 1 });

    prunePersonaMessages("persona-1", state);

    // All removed messages should be the old ones only
    expect(removed.every(id => id.startsWith("old-"))).toBe(true);
    // Recent messages should be untouched
    expect(removed.some(id => id.startsWith("recent-"))).toBe(false);
  });

  it("falls back to MESSAGE_MIN_COUNT=200 and MESSAGE_MAX_AGE_DAYS=14 when no settings", () => {
    // 199 messages: not enough to trigger pruning with default min=200
    const messages = Array.from({ length: 199 }, (_, i) => makeMsg(`msg-${i}`, 30));
    const { state, removed } = makeState(messages, undefined);

    prunePersonaMessages("persona-1", state);

    // With 199 messages and min=200, no pruning should occur
    expect(removed.length).toBe(0);
  });
});

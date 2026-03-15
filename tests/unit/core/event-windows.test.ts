import { describe, it, expect } from "vitest";
import { buildEventWindows } from "../../../src/core/utils/event-windows.js";
import { ContextStatus, type Message } from "../../../src/core/types.js";

function makeMessage(id: string, isoTimestamp: string): Message {
  return {
    id,
    role: "human",
    verbal_response: `message ${id}`,
    timestamp: isoTimestamp,
    read: true,
    context_status: ContextStatus.Default,
  };
}

const HOUR_MS = 60 * 60 * 1000;

describe("buildEventWindows", () => {
  it("returns a single window when all messages are close together", () => {
    const base = new Date("2024-01-01T10:00:00Z").getTime();
    const messages = [
      makeMessage("1", new Date(base).toISOString()),
      makeMessage("2", new Date(base + 1 * HOUR_MS).toISOString()),
      makeMessage("3", new Date(base + 2 * HOUR_MS).toISOString()),
    ];

    const windows = buildEventWindows(messages, 8);

    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(3);
  });

  it("returns two windows when there is an 8+ hour gap", () => {
    const base = new Date("2024-01-01T10:00:00Z").getTime();
    const messages = [
      makeMessage("1", new Date(base).toISOString()),
      makeMessage("2", new Date(base + 1 * HOUR_MS).toISOString()),
      makeMessage("3", new Date(base + 10 * HOUR_MS).toISOString()),
      makeMessage("4", new Date(base + 11 * HOUR_MS).toISOString()),
    ];

    const windows = buildEventWindows(messages, 8);

    expect(windows).toHaveLength(2);
    expect(windows[0]).toHaveLength(2);
    expect(windows[1]).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    const windows = buildEventWindows([], 8);
    expect(windows).toHaveLength(0);
  });

  it("treats a gap exactly at the threshold as a new window", () => {
    const base = new Date("2024-01-01T10:00:00Z").getTime();
    const messages = [
      makeMessage("1", new Date(base).toISOString()),
      makeMessage("2", new Date(base + 8 * HOUR_MS).toISOString()),
    ];

    const windows = buildEventWindows(messages, 8);

    expect(windows).toHaveLength(2);
    expect(windows[0][0].id).toBe("1");
    expect(windows[1][0].id).toBe("2");
  });
});

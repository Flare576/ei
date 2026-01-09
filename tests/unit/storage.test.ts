import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getRecentMessages, getLastMessageTime } from "../../src/storage.js";
import type { ConversationHistory, Message } from "../../src/types.js";

const createMessage = (
  role: "human" | "system",
  content: string,
  hoursAgo: number = 0
): Message => {
  const timestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  return {
    role,
    content,
    timestamp: timestamp.toISOString(),
  };
};

describe("getRecentMessages", () => {
  it("should return empty array for empty history", () => {
    const history: ConversationHistory = { messages: [] };

    const result = getRecentMessages(history);

    expect(result).toEqual([]);
  });

  it("should return all messages within the time window", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Message 1", 1),
        createMessage("system", "Message 2", 0.5),
        createMessage("human", "Message 3", 0),
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toHaveLength(3);
  });

  it("should filter out messages older than maxHours", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Old message", 10),
        createMessage("system", "Recent message", 1),
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Recent message");
  });

  it("should limit to maxMessages", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Message 1", 1),
        createMessage("system", "Message 2", 0.9),
        createMessage("human", "Message 3", 0.8),
        createMessage("system", "Message 4", 0.7),
        createMessage("human", "Message 5", 0.6),
      ],
    };

    const result = getRecentMessages(history, 8, 3);

    expect(result).toHaveLength(3);
    expect(result[0].content).toBe("Message 3");
    expect(result[2].content).toBe("Message 5");
  });

  it("should use default values when not provided", () => {
    const history: ConversationHistory = {
      messages: [createMessage("human", "Test", 0)],
    };

    const result = getRecentMessages(history);

    expect(result).toHaveLength(1);
  });

  it("should return most recent messages when limiting", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "First", 2),
        createMessage("system", "Second", 1),
        createMessage("human", "Third", 0),
      ],
    };

    const result = getRecentMessages(history, 8, 2);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Second");
    expect(result[1].content).toBe("Third");
  });
});

describe("getLastMessageTime", () => {
  it("should return 0 for empty history", () => {
    const history: ConversationHistory = { messages: [] };

    const result = getLastMessageTime(history);

    expect(result).toBe(0);
  });

  it("should return timestamp of last message", () => {
    const now = Date.now();
    const history: ConversationHistory = {
      messages: [
        { role: "human", content: "First", timestamp: new Date(now - 5000).toISOString() },
        { role: "system", content: "Last", timestamp: new Date(now).toISOString() },
      ],
    };

    const result = getLastMessageTime(history);

    expect(result).toBeCloseTo(now, -2);
  });

  it("should handle single message", () => {
    const now = Date.now();
    const history: ConversationHistory = {
      messages: [{ role: "human", content: "Only", timestamp: new Date(now).toISOString() }],
    };

    const result = getLastMessageTime(history);

    expect(result).toBeCloseTo(now, -2);
  });
});

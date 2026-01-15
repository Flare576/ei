import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("getUnprocessedMessages filtering logic", () => {
  const createMessageWithProcessed = (
    role: "human" | "system",
    content: string,
    concept_processed: boolean | undefined,
    hoursAgo: number = 0
  ): Message => {
    const timestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return {
      role,
      content,
      timestamp: timestamp.toISOString(),
      concept_processed,
    };
  };

  const filterUnprocessed = (
    messages: Message[],
    beforeTimestamp?: string
  ): Message[] => {
    const beforeTime = beforeTimestamp ? new Date(beforeTimestamp).getTime() : undefined;
    return messages.filter(m =>
      m.concept_processed === false &&
      (!beforeTime || new Date(m.timestamp).getTime() < beforeTime)
    );
  };

  it("should return empty array for empty messages", () => {
    const result = filterUnprocessed([]);
    expect(result).toEqual([]);
  });

  it("should return only messages with concept_processed: false", () => {
    const messages = [
      createMessageWithProcessed("human", "Processed", true, 2),
      createMessageWithProcessed("system", "Unprocessed", false, 1),
      createMessageWithProcessed("human", "Legacy (no field)", undefined, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Unprocessed");
  });

  it("should treat undefined concept_processed as processed (backward compatible)", () => {
    const messages = [
      createMessageWithProcessed("human", "Legacy message 1", undefined, 1),
      createMessageWithProcessed("human", "Legacy message 2", undefined, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toEqual([]);
  });

  it("should filter by beforeTimestamp when provided", () => {
    const now = Date.now();
    const cutoffTimestamp = new Date(now - 1.5 * 60 * 60 * 1000).toISOString();

    const messages = [
      createMessageWithProcessed("human", "Old unprocessed", false, 2),
      createMessageWithProcessed("human", "Recent unprocessed", false, 1),
      createMessageWithProcessed("human", "Very recent unprocessed", false, 0),
    ];

    const result = filterUnprocessed(messages, cutoffTimestamp);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Old unprocessed");
  });

  it("should return all unprocessed when beforeTimestamp not provided", () => {
    const messages = [
      createMessageWithProcessed("human", "Unprocessed 1", false, 2),
      createMessageWithProcessed("human", "Unprocessed 2", false, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toHaveLength(2);
  });
});

describe("markMessagesConceptProcessed mutation logic", () => {
  const createMessageWithTimestamp = (
    role: "human" | "system",
    content: string,
    concept_processed: boolean,
    timestamp: string
  ): Message => ({
    role,
    content,
    timestamp,
    concept_processed,
  });

  const markProcessed = (
    messages: Message[],
    timestamps: string[]
  ): { messages: Message[]; changed: boolean } => {
    let changed = false;
    const updated = messages.map(msg => {
      if (timestamps.includes(msg.timestamp) && !msg.concept_processed) {
        changed = true;
        return { ...msg, concept_processed: true };
      }
      return msg;
    });
    return { messages: updated, changed };
  };

  it("should mark specified messages as processed", () => {
    const ts1 = "2024-01-01T10:00:00.000Z";
    const ts2 = "2024-01-01T11:00:00.000Z";
    
    const messages = [
      createMessageWithTimestamp("human", "Message 1", false, ts1),
      createMessageWithTimestamp("human", "Message 2", false, ts2),
    ];

    const result = markProcessed(messages, [ts1]);

    expect(result.changed).toBe(true);
    expect(result.messages[0].concept_processed).toBe(true);
    expect(result.messages[1].concept_processed).toBe(false);
  });

  it("should report no change if no messages match", () => {
    const messages = [
      createMessageWithTimestamp("human", "Message", false, "2024-01-01T10:00:00.000Z"),
    ];

    const result = markProcessed(messages, ["non-existent-timestamp"]);

    expect(result.changed).toBe(false);
  });

  it("should report no change if all matching messages already processed", () => {
    const ts1 = "2024-01-01T10:00:00.000Z";
    
    const messages = [
      createMessageWithTimestamp("human", "Already processed", true, ts1),
    ];

    const result = markProcessed(messages, [ts1]);

    expect(result.changed).toBe(false);
  });

  it("should mark multiple messages at once", () => {
    const ts1 = "2024-01-01T10:00:00.000Z";
    const ts2 = "2024-01-01T11:00:00.000Z";
    const ts3 = "2024-01-01T12:00:00.000Z";
    
    const messages = [
      createMessageWithTimestamp("human", "Message 1", false, ts1),
      createMessageWithTimestamp("system", "Message 2", false, ts2),
      createMessageWithTimestamp("human", "Message 3", false, ts3),
    ];

    const result = markProcessed(messages, [ts1, ts3]);

    expect(result.messages[0].concept_processed).toBe(true);
    expect(result.messages[1].concept_processed).toBe(false);
    expect(result.messages[2].concept_processed).toBe(true);
  });
});

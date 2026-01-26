import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getRecentMessages, getLastMessageTime, findPersonaByAlias, addPersonaAlias, removePersonaAlias, listPersonas } from "../../src/storage.js";
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

  it("should stop at context clear marker", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Old message 1", 5),
        createMessage("system", "Old message 2", 4),
        { role: "system", content: "[CONTEXT_CLEARED]", timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), read: true, concept_processed: true },
        createMessage("human", "New message 1", 2),
        createMessage("system", "New message 2", 1),
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("New message 1");
    expect(result[1].content).toBe("New message 2");
  });

  it("should use most recent marker when multiple markers exist", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Ancient message", 10),
        { role: "system", content: "[CONTEXT_CLEARED]", timestamp: new Date(Date.now() - 9 * 60 * 60 * 1000).toISOString(), read: true, concept_processed: true },
        createMessage("human", "Old message", 8),
        { role: "system", content: "[CONTEXT_CLEARED]", timestamp: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(), read: true, concept_processed: true },
        createMessage("human", "New message", 2),
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("New message");
  });

  it("should return empty array when only marker exists", () => {
    const history: ConversationHistory = {
      messages: [
        { role: "system", content: "[CONTEXT_CLEARED]", timestamp: new Date().toISOString(), read: true, concept_processed: true },
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toEqual([]);
  });

  it("should work normally when no marker exists", () => {
    const history: ConversationHistory = {
      messages: [
        createMessage("human", "Message 1", 2),
        createMessage("system", "Message 2", 1),
      ],
    };

    const result = getRecentMessages(history, 8);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Message 1");
    expect(result[1].content).toBe("Message 2");
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
  const createMessageWithFlags = (
    role: "human" | "system",
    content: string,
    concept_processed: boolean | undefined,
    read: boolean | undefined,
    hoursAgo: number = 0
  ): Message => {
    const timestamp = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    return {
      role,
      content,
      timestamp: timestamp.toISOString(),
      concept_processed,
      read,
    };
  };

  const filterUnprocessed = (
    messages: Message[],
    beforeTimestamp?: string
  ): Message[] => {
    const beforeTime = beforeTimestamp ? new Date(beforeTimestamp).getTime() : undefined;
    return messages.filter(m =>
      m.concept_processed === false &&
      m.read === true &&
      (!beforeTime || new Date(m.timestamp).getTime() < beforeTime)
    );
  };

  it("should return empty array for empty messages", () => {
    const result = filterUnprocessed([]);
    expect(result).toEqual([]);
  });

  it("should return only messages with concept_processed: false AND read: true", () => {
    const messages = [
      createMessageWithFlags("human", "Processed and read", true, true, 3),
      createMessageWithFlags("human", "Unprocessed and read", false, true, 2),
      createMessageWithFlags("human", "Unprocessed but unread", false, false, 1),
      createMessageWithFlags("system", "System unprocessed and read", false, true, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toHaveLength(2);
    expect(result[0].content).toBe("Unprocessed and read");
    expect(result[1].content).toBe("System unprocessed and read");
  });

  it("should exclude unread messages even if concept_processed is false", () => {
    const messages = [
      createMessageWithFlags("human", "Unread human message", false, false, 1),
      createMessageWithFlags("system", "Unread system message", false, false, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toEqual([]);
  });

  it("should treat undefined read as unread (not eligible)", () => {
    const messages = [
      createMessageWithFlags("human", "No read field", false, undefined, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toEqual([]);
  });

  it("should filter by beforeTimestamp when provided", () => {
    const now = Date.now();
    const cutoffTimestamp = new Date(now - 1.5 * 60 * 60 * 1000).toISOString();

    const messages = [
      createMessageWithFlags("human", "Old unprocessed read", false, true, 2),
      createMessageWithFlags("human", "Recent unprocessed read", false, true, 1),
      createMessageWithFlags("human", "Very recent unprocessed read", false, true, 0),
    ];

    const result = filterUnprocessed(messages, cutoffTimestamp);

    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("Old unprocessed read");
  });

  it("should return all eligible when beforeTimestamp not provided", () => {
    const messages = [
      createMessageWithFlags("human", "Eligible 1", false, true, 2),
      createMessageWithFlags("human", "Eligible 2", false, true, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toHaveLength(2);
  });

  it("should handle mixed read states correctly", () => {
    const messages = [
      createMessageWithFlags("human", "Human read", false, true, 3),
      createMessageWithFlags("system", "System unread", false, false, 2),
      createMessageWithFlags("human", "Human unread", false, false, 1),
      createMessageWithFlags("system", "System read", false, true, 0),
    ];

    const result = filterUnprocessed(messages);

    expect(result).toHaveLength(2);
    expect(result.map(m => m.content)).toEqual(["Human read", "System read"]);
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

describe("getUnreadSystemMessageCount filtering logic", () => {
  const createMessageWithRead = (
    role: "human" | "system",
    content: string,
    read: boolean | undefined
  ): Message => ({
    role,
    content,
    timestamp: new Date().toISOString(),
    read,
  });

  const countUnreadSystem = (messages: Message[]): number => {
    return messages.filter(
      (m) => m.role === "system" && m.read === false
    ).length;
  };

  it("should return 0 for empty messages", () => {
    expect(countUnreadSystem([])).toBe(0);
  });

  it("should count only system messages with read: false", () => {
    const messages = [
      createMessageWithRead("system", "Unread system", false),
      createMessageWithRead("system", "Read system", true),
      createMessageWithRead("human", "Unread human", false),
      createMessageWithRead("system", "Another unread system", false),
    ];

    expect(countUnreadSystem(messages)).toBe(2);
  });

  it("should treat undefined read field as read (backward compat)", () => {
    const messages = [
      createMessageWithRead("system", "Old message no read field", undefined),
      createMessageWithRead("system", "New unread message", false),
    ];

    expect(countUnreadSystem(messages)).toBe(1);
  });

  it("should ignore human messages regardless of read status", () => {
    const messages = [
      createMessageWithRead("human", "Unread human 1", false),
      createMessageWithRead("human", "Unread human 2", false),
      createMessageWithRead("human", "Read human", true),
    ];

    expect(countUnreadSystem(messages)).toBe(0);
  });

  it("should return 0 when all system messages are read", () => {
    const messages = [
      createMessageWithRead("system", "Read 1", true),
      createMessageWithRead("system", "Read 2", true),
      createMessageWithRead("human", "Unread human", false),
    ];

    expect(countUnreadSystem(messages)).toBe(0);
  });
});

describe("findPersonaByAlias logic", () => {
  it("should return null when alias not found in empty list", () => {
    const personas: Array<{ name: string; aliases: string[] }> = [];
    const lower = "test".toLowerCase();
    
    let result: { personaName: string; alias: string } | null = null;
    for (const p of personas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        result = { personaName: p.name, alias: matchedAlias };
        break;
      }
    }
    
    expect(result).toBeNull();
  });

  it("should find persona by exact alias match", () => {
    const personas = [
      { name: "alice", aliases: ["al", "alice123"] },
      { name: "bob", aliases: ["bobby", "robert"] },
    ];
    const searchAlias = "bobby";
    const lower = searchAlias.toLowerCase();
    
    let result: { personaName: string; alias: string } | null = null;
    for (const p of personas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        result = { personaName: p.name, alias: matchedAlias };
        break;
      }
    }
    
    expect(result).toEqual({ personaName: "bob", alias: "bobby" });
  });

  it("should perform case-insensitive matching", () => {
    const personas = [
      { name: "alice", aliases: ["Al", "ALICE"] },
    ];
    const searchAlias = "al";
    const lower = searchAlias.toLowerCase();
    
    let result: { personaName: string; alias: string } | null = null;
    for (const p of personas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        result = { personaName: p.name, alias: matchedAlias };
        break;
      }
    }
    
    expect(result).toEqual({ personaName: "alice", alias: "Al" });
  });

  it("should return null when alias not found", () => {
    const personas = [
      { name: "alice", aliases: ["al"] },
    ];
    const searchAlias = "nonexistent";
    const lower = searchAlias.toLowerCase();
    
    let result: { personaName: string; alias: string } | null = null;
    for (const p of personas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        result = { personaName: p.name, alias: matchedAlias };
        break;
      }
    }
    
    expect(result).toBeNull();
  });

  it("should return original alias spelling from persona", () => {
    const personas = [
      { name: "alice", aliases: ["Alice the Great"] },
    ];
    const searchAlias = "alice the great";
    const lower = searchAlias.toLowerCase();
    
    let result: { personaName: string; alias: string } | null = null;
    for (const p of personas) {
      const matchedAlias = p.aliases.find(a => a.toLowerCase() === lower);
      if (matchedAlias) {
        result = { personaName: p.name, alias: matchedAlias };
        break;
      }
    }
    
    expect(result?.alias).toBe("Alice the Great");
  });
});

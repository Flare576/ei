import { describe, it, expect } from "vitest";
import { ContextStatus, Message } from "../../src/core/types.js";
import { filterMessagesForContext } from "../../src/core/processor.js";

const createMessage = (
  id: string,
  timestamp: string,
  status: ContextStatus = ContextStatus.Default
): Message => ({
  id,
  role: "human",
  content: `Message ${id}`,
  timestamp,
  read: true,
  context_status: status,
});

describe("filterMessagesForContext", () => {
  const windowHours = 8;

  describe("context_status priority", () => {
    it("should include messages with context_status='always' regardless of boundary", () => {
      const boundary = "2024-01-15T00:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-01T00:00:00Z", ContextStatus.Always),
        createMessage("2", "2024-01-10T00:00:00Z", ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.some((m) => m.id === "1")).toBe(true);
    });

    it("should exclude messages with context_status='never' regardless of boundary", () => {
      const boundary = "2024-01-01T00:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-20T00:00:00Z", ContextStatus.Never),
        createMessage("2", "2024-01-20T00:00:00Z", ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.some((m) => m.id === "1")).toBe(false);
      expect(result.some((m) => m.id === "2")).toBe(true);
    });
  });

  describe("context_boundary filtering", () => {
    it("should exclude default messages before boundary", () => {
      const boundary = "2024-01-10T00:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-01T00:00:00Z", ContextStatus.Default),
        createMessage("2", "2024-01-05T00:00:00Z", ContextStatus.Default),
        createMessage("3", "2024-01-15T00:00:00Z", ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.some((m) => m.id === "1")).toBe(false);
      expect(result.some((m) => m.id === "2")).toBe(false);
      expect(result.some((m) => m.id === "3")).toBe(true);
    });

    it("should include default messages at or after boundary", () => {
      const boundary = "2024-01-10T00:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-10T00:00:00Z", ContextStatus.Default),
        createMessage("2", "2024-01-15T00:00:00Z", ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.length).toBe(2);
    });
  });

  describe("no boundary set", () => {
    it("should include all default messages when no boundary (within window)", () => {
      const messages: Message[] = [
        createMessage("1", new Date(Date.now() - 1000 * 60 * 60).toISOString()),
        createMessage("2", new Date(Date.now() - 1000 * 60 * 30).toISOString()),
      ];

      const result = filterMessagesForContext(messages, undefined, windowHours);

      expect(result.length).toBe(2);
    });
  });

  describe("edge cases", () => {
    it("should return empty array for empty input", () => {
      const result = filterMessagesForContext([], undefined, windowHours);
      expect(result).toEqual([]);
    });

    it("should return only 'always' messages when all others are before boundary", () => {
      const boundary = "2024-12-01T00:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-01T00:00:00Z", ContextStatus.Default),
        createMessage("2", "2024-01-05T00:00:00Z", ContextStatus.Always),
        createMessage("3", "2024-01-10T00:00:00Z", ContextStatus.Never),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("2");
    });

    it("should handle boundary at exact message timestamp (inclusive)", () => {
      const boundary = "2024-01-10T12:00:00Z";
      const messages: Message[] = [
        createMessage("1", "2024-01-10T12:00:00Z", ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.length).toBe(1);
    });
  });
});

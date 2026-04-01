import { describe, it, expect } from "vitest";
import { ContextStatus, Message } from "../../src/core/types.js";
import { filterMessagesForContext } from "../../src/core/processor.js";

const ago = (hours: number): string =>
  new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();

const createMessage = (
  id: string,
  timestamp: string,
  status: ContextStatus = ContextStatus.Default
): Message => ({
  id,
  role: "human",
  verbal_response: `Message ${id}`,
  timestamp,
  read: true,
  context_status: status,
});

describe("filterMessagesForContext", () => {
  const windowHours = 8;

  describe("context_status priority", () => {
    it("includes Always messages regardless of hours window", () => {
      const messages: Message[] = [
        createMessage("always", ago(24), ContextStatus.Always),
        createMessage("default-old", ago(24), ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, undefined, windowHours);

      expect(result.map(m => m.id)).toEqual(["always"]);
    });

    it("includes Always messages regardless of context_boundary", () => {
      const boundary = ago(1);
      const messages: Message[] = [
        createMessage("always", ago(4), ContextStatus.Always),
        createMessage("default", ago(4), ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.some(m => m.id === "always")).toBe(true);
    });

    it("excludes Never messages regardless of recency", () => {
      const messages: Message[] = [
        createMessage("never", ago(1), ContextStatus.Never),
        createMessage("default", ago(1), ContextStatus.Default),
      ];

      const result = filterMessagesForContext(messages, undefined, windowHours);

      expect(result.some(m => m.id === "never")).toBe(false);
      expect(result.some(m => m.id === "default")).toBe(true);
    });
  });

  describe("hours window filtering (no boundary)", () => {
    it("includes messages within the window", () => {
      const messages: Message[] = [
        createMessage("recent", ago(1)),
        createMessage("edge", ago(7)),
      ];

      const result = filterMessagesForContext(messages, undefined, windowHours);

      expect(result.length).toBe(2);
    });

    it("excludes messages outside the window", () => {
      const messages: Message[] = [
        createMessage("recent", ago(1)),
        createMessage("old", ago(24)),
      ];

      const result = filterMessagesForContext(messages, undefined, windowHours);

      expect(result.map(m => m.id)).toEqual(["recent"]);
    });
  });

  describe("context_boundary filtering", () => {
    it("excludes messages before boundary even if within hours window", () => {
      const boundary = ago(2);
      const messages: Message[] = [
        createMessage("before-boundary", ago(3)),
        createMessage("after-boundary", ago(1)),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.map(m => m.id)).toEqual(["after-boundary"]);
    });

    it("includes messages at or after boundary when within hours window", () => {
      const boundary = ago(4);
      const messages: Message[] = [
        createMessage("at-boundary", ago(4)),
        createMessage("after-boundary", ago(1)),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.length).toBe(2);
    });
  });

  describe("hours window AND boundary both apply", () => {
    it("excludes messages outside hours window even if after boundary", () => {
      const boundary = ago(48);
      const messages: Message[] = [
        createMessage("old-but-after-boundary", ago(24)),
        createMessage("recent-and-after-boundary", ago(1)),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.map(m => m.id)).toEqual(["recent-and-after-boundary"]);
    });

    it("excludes messages before boundary even if within hours window", () => {
      const boundary = ago(2);
      const messages: Message[] = [
        createMessage("in-window-before-boundary", ago(3)),
        createMessage("in-window-after-boundary", ago(1)),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.map(m => m.id)).toEqual(["in-window-after-boundary"]);
    });

    it("includes only messages that satisfy both conditions", () => {
      const boundary = ago(3);
      const messages: Message[] = [
        createMessage("old-before-boundary", ago(24)),
        createMessage("old-after-boundary", ago(12)),
        createMessage("recent-before-boundary", ago(4)),
        createMessage("recent-after-boundary", ago(1)),
        createMessage("always-old", ago(48), ContextStatus.Always),
        createMessage("never-recent", ago(1), ContextStatus.Never),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.map(m => m.id)).toEqual(["recent-after-boundary", "always-old"]);
    });
  });

  describe("edge cases", () => {
    it("returns empty array for empty input", () => {
      const result = filterMessagesForContext([], undefined, windowHours);
      expect(result).toEqual([]);
    });

    it("handles boundary at exact message timestamp (inclusive)", () => {
      const ts = ago(2);
      const messages: Message[] = [
        createMessage("exact", ts),
      ];

      const result = filterMessagesForContext(messages, ts, windowHours);

      expect(result.length).toBe(1);
    });

    it("returns only Always messages when all others fail both filters", () => {
      const boundary = ago(1);
      const messages: Message[] = [
        createMessage("old-default", ago(24)),
        createMessage("old-always", ago(24), ContextStatus.Always),
        createMessage("old-never", ago(24), ContextStatus.Never),
      ];

      const result = filterMessagesForContext(messages, boundary, windowHours);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("old-always");
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { PersonaState } from "../../../../src/core/state/index.js";
import type { PersonaEntity, Message, ContextStatus } from "../../../../src/core/types.js";
import { ContextStatus as ContextStatusEnum } from "../../../../src/core/types.js";

describe("PersonaState", () => {
  let state: PersonaState;

  const makePersona = (name: string): PersonaEntity => ({
    entity: "system",
    aliases: [name],
    short_description: `${name} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  });

  const makeMessage = (content: string, role: "human" | "system" = "human"): Message => ({
    id: crypto.randomUUID(),
    role,
    content,
    timestamp: new Date().toISOString(),
    read: role === "human",
    context_status: ContextStatusEnum.Default,
  });

  beforeEach(() => {
    state = new PersonaState();
  });

  describe("persona CRUD", () => {
    it("starts empty", () => {
      expect(state.getAll()).toEqual([]);
    });

    it("adds a persona", () => {
      state.add("TestBot", makePersona("TestBot"));
      
      expect(state.getAll()).toHaveLength(1);
      expect(state.get("TestBot")?.aliases?.[0]).toBe("TestBot");
    });

    it("gets persona by name (case insensitive)", () => {
      state.add("TestBot", makePersona("TestBot"));
      
      expect(state.get("testbot")).not.toBeNull();
      expect(state.get("TESTBOT")).not.toBeNull();
      expect(state.get("TestBot")).not.toBeNull();
    });

    it("returns null for non-existent persona", () => {
      expect(state.get("nonexistent")).toBeNull();
    });

    it("updates persona fields", () => {
      state.add("TestBot", makePersona("TestBot"));
      
      const updated = state.update("TestBot", { short_description: "Updated description" });
      
      expect(updated).toBe(true);
      expect(state.get("TestBot")?.short_description).toBe("Updated description");
    });

    it("returns false when updating non-existent persona", () => {
      const updated = state.update("nonexistent", { short_description: "Test" });
      expect(updated).toBe(false);
    });

    it("archives persona", () => {
      state.add("TestBot", makePersona("TestBot"));
      
      const archived = state.archive("TestBot");
      
      expect(archived).toBe(true);
      expect(state.get("TestBot")?.is_archived).toBe(true);
      expect(state.get("TestBot")?.archived_at).toBeDefined();
    });

    it("unarchives persona", () => {
      state.add("TestBot", makePersona("TestBot"));
      state.archive("TestBot");
      
      const unarchived = state.unarchive("TestBot");
      
      expect(unarchived).toBe(true);
      expect(state.get("TestBot")?.is_archived).toBe(false);
      expect(state.get("TestBot")?.archived_at).toBeUndefined();
    });

    it("deletes persona", () => {
      state.add("TestBot", makePersona("TestBot"));
      
      const deleted = state.delete("TestBot");
      
      expect(deleted).toBe(true);
      expect(state.get("TestBot")).toBeNull();
      expect(state.getAll()).toHaveLength(0);
    });

    it("returns false when deleting non-existent persona", () => {
      const deleted = state.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("messages", () => {
    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
    });

    it("starts with empty message array", () => {
      expect(state.messages_get("TestBot")).toEqual([]);
    });

    it("appends messages", () => {
      state.messages_append("TestBot", makeMessage("Hello"));
      state.messages_append("TestBot", makeMessage("World"));
      
      const messages = state.messages_get("TestBot");
      
      expect(messages).toHaveLength(2);
      expect(messages[0].content).toBe("Hello");
      expect(messages[1].content).toBe("World");
    });

    it("returns empty array for non-existent persona", () => {
      expect(state.messages_get("nonexistent")).toEqual([]);
    });

    it("does not append to non-existent persona", () => {
      state.messages_append("nonexistent", makeMessage("Test"));
      expect(state.messages_get("nonexistent")).toEqual([]);
    });

    it("updates persona last_activity on message append", async () => {
      const before = state.get("TestBot")?.last_activity;
      
      await new Promise((r) => setTimeout(r, 2));
      
      state.messages_append("TestBot", makeMessage("Hello"));
      
      const after = state.get("TestBot")?.last_activity;
      expect(new Date(after ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(before ?? 0).getTime());
    });
  });

  describe("message context status", () => {
    let messageId: string;

    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
      const msg = makeMessage("Test message");
      messageId = msg.id;
      state.messages_append("TestBot", msg);
    });

    it("sets context status to Always", () => {
      const result = state.messages_setContextStatus("TestBot", messageId, ContextStatusEnum.Always);
      
      expect(result).toBe(true);
      const messages = state.messages_get("TestBot");
      expect(messages[0].context_status).toBe("always");
    });

    it("sets context status to Never", () => {
      state.messages_setContextStatus("TestBot", messageId, ContextStatusEnum.Never);
      
      const messages = state.messages_get("TestBot");
      expect(messages[0].context_status).toBe("never");
    });

    it("returns false for non-existent persona", () => {
      const result = state.messages_setContextStatus("nonexistent", messageId, ContextStatusEnum.Always);
      expect(result).toBe(false);
    });

    it("returns false for non-existent message", () => {
      const result = state.messages_setContextStatus("TestBot", "nonexistent", ContextStatusEnum.Always);
      expect(result).toBe(false);
    });
  });

  describe("context window", () => {
    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
    });

    it("starts with null context window", () => {
      expect(state.messages_getContextWindow("TestBot")).toBeNull();
    });

    it("sets and gets context window", () => {
      const start = "2024-01-01T00:00:00Z";
      const end = "2024-01-02T00:00:00Z";
      
      state.messages_setContextWindow("TestBot", start, end);
      
      const window = state.messages_getContextWindow("TestBot");
      expect(window).toEqual({ start, end });
    });

    it("returns null for non-existent persona", () => {
      expect(state.messages_getContextWindow("nonexistent")).toBeNull();
    });
  });

  describe("messages_markRead", () => {
    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
    });

    it("marks a message as read", () => {
      const msg = makeMessage("Test", "system");
      msg.read = false;
      state.messages_append("TestBot", msg);

      const result = state.messages_markRead("TestBot", msg.id);

      expect(result).toBe(true);
      expect(state.messages_get("TestBot")[0].read).toBe(true);
    });

    it("returns false for non-existent persona", () => {
      const result = state.messages_markRead("nonexistent", "some-id");
      expect(result).toBe(false);
    });

    it("returns false for non-existent message", () => {
      const result = state.messages_markRead("TestBot", "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("messages_markPendingAsRead", () => {
    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
    });

    it("marks all unread human messages as read", () => {
      const msg1 = makeMessage("First");
      msg1.read = false;
      const msg2 = makeMessage("Second");
      msg2.read = false;
      const msg3 = makeMessage("Response", "system");
      msg3.read = false;

      state.messages_append("TestBot", msg1);
      state.messages_append("TestBot", msg2);
      state.messages_append("TestBot", msg3);

      const count = state.messages_markPendingAsRead("TestBot");

      expect(count).toBe(2);
      const messages = state.messages_get("TestBot");
      expect(messages[0].read).toBe(true);
      expect(messages[1].read).toBe(true);
      expect(messages[2].read).toBe(false);
    });

    it("returns 0 when no pending human messages", () => {
      const msg = makeMessage("Already read");
      msg.read = true;
      state.messages_append("TestBot", msg);

      const count = state.messages_markPendingAsRead("TestBot");

      expect(count).toBe(0);
    });

    it("returns 0 for non-existent persona", () => {
      const count = state.messages_markPendingAsRead("nonexistent");
      expect(count).toBe(0);
    });
  });

  describe("messages_remove", () => {
    beforeEach(() => {
      state.add("TestBot", makePersona("TestBot"));
    });

    it("removes specified messages and returns them", () => {
      const msg1 = makeMessage("First");
      const msg2 = makeMessage("Second");
      const msg3 = makeMessage("Third");

      state.messages_append("TestBot", msg1);
      state.messages_append("TestBot", msg2);
      state.messages_append("TestBot", msg3);

      const removed = state.messages_remove("TestBot", [msg1.id, msg3.id]);

      expect(removed).toHaveLength(2);
      expect(removed.map(m => m.content)).toContain("First");
      expect(removed.map(m => m.content)).toContain("Third");
      expect(state.messages_get("TestBot")).toHaveLength(1);
      expect(state.messages_get("TestBot")[0].content).toBe("Second");
    });

    it("returns empty array for non-existent persona", () => {
      const removed = state.messages_remove("nonexistent", ["some-id"]);
      expect(removed).toHaveLength(0);
    });

    it("ignores non-existent message ids", () => {
      const msg = makeMessage("Keep me");
      state.messages_append("TestBot", msg);

      const removed = state.messages_remove("TestBot", ["nonexistent"]);

      expect(removed).toHaveLength(0);
      expect(state.messages_get("TestBot")).toHaveLength(1);
    });
  });

  describe("load/export", () => {
    it("exports personas to serializable format", () => {
      state.add("Bot1", makePersona("Bot1"));
      state.add("Bot2", makePersona("Bot2"));
      state.messages_append("Bot1", makeMessage("Hello"));
      
      const exported = state.export();
      
      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported["bot1"]).toBeDefined();
      expect(exported["bot1"].messages).toHaveLength(1);
    });

    it("loads personas from serialized format", () => {
      const data = {
        testbot: {
          entity: makePersona("TestBot"),
          messages: [makeMessage("Loaded message")],
        },
      };
      
      state.load(data);
      
      expect(state.getAll()).toHaveLength(1);
      expect(state.messages_get("testbot")).toHaveLength(1);
    });
  });
});

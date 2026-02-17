import { describe, it, expect, beforeEach } from "vitest";
import { PersonaState } from "../../../../src/core/state/index.js";
import type { PersonaEntity, Message, ContextStatus } from "../../../../src/core/types.js";
import { ContextStatus as ContextStatusEnum } from "../../../../src/core/types.js";

describe("PersonaState", () => {
  let state: PersonaState;

  const makePersona = (name: string, id?: string): PersonaEntity => ({
    id: id ?? `${name.toLowerCase()}-id`,
    display_name: name,
    entity: "system",
    aliases: [name],
    short_description: `${name} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
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
      state.add(makePersona("TestBot"));
      
      expect(state.getAll()).toHaveLength(1);
      expect(state.getByName("TestBot")?.aliases?.[0]).toBe("TestBot");
    });

    it("gets persona by name (case insensitive)", () => {
      state.add(makePersona("TestBot"));
      
      expect(state.getByName("testbot")).not.toBeNull();
      expect(state.getByName("TESTBOT")).not.toBeNull();
      expect(state.getByName("TestBot")).not.toBeNull();
    });

    it("returns null for non-existent persona", () => {
      expect(state.getByName("nonexistent")).toBeNull();
    });

    it("updates persona fields", () => {
      const persona = makePersona("TestBot");
      state.add(persona);
      
      const updated = state.update(persona.id, { short_description: "Updated description" });
      
      expect(updated).toBe(true);
      expect(state.getById(persona.id)?.short_description).toBe("Updated description");
    });

    it("returns false when updating non-existent persona", () => {
      const updated = state.update("nonexistent", { short_description: "Test" });
      expect(updated).toBe(false);
    });

    it("archives persona", () => {
      const persona = makePersona("TestBot");
      state.add(persona);
      
      const archived = state.archive(persona.id);
      
      expect(archived).toBe(true);
      expect(state.getById(persona.id)?.is_archived).toBe(true);
      expect(state.getById(persona.id)?.archived_at).toBeDefined();
    });

    it("unarchives persona", () => {
      const persona = makePersona("TestBot");
      state.add(persona);
      state.archive(persona.id);
      
      const unarchived = state.unarchive(persona.id);
      
      expect(unarchived).toBe(true);
      expect(state.getById(persona.id)?.is_archived).toBe(false);
      expect(state.getById(persona.id)?.archived_at).toBeUndefined();
    });

    it("deletes persona", () => {
      const persona = makePersona("TestBot");
      state.add(persona);
      
      const deleted = state.delete(persona.id);
      
      expect(deleted).toBe(true);
      expect(state.getById(persona.id)).toBeNull();
      expect(state.getAll()).toHaveLength(0);
    });

    it("returns false when deleting non-existent persona", () => {
      const deleted = state.delete("nonexistent");
      expect(deleted).toBe(false);
    });
  });

  describe("messages", () => {
    let personaId: string;
    
    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("starts with empty message array", () => {
      expect(state.messages_get(personaId)).toEqual([]);
    });

    it("appends messages", () => {
      state.messages_append(personaId, makeMessage("Hello"));
      state.messages_append(personaId, makeMessage("World"));
      
      const messages = state.messages_get(personaId);
      
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
      const before = state.getById(personaId)?.last_activity;
      
      await new Promise((r) => setTimeout(r, 2));
      
      state.messages_append(personaId, makeMessage("Hello"));
      
      const after = state.getById(personaId)?.last_activity;
      expect(new Date(after ?? 0).getTime()).toBeGreaterThanOrEqual(new Date(before ?? 0).getTime());
    });
  });

  describe("message context status", () => {
    let personaId: string;
    let messageId: string;

    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
      const msg = makeMessage("Test message");
      messageId = msg.id;
      state.messages_append(personaId, msg);
    });

    it("sets context status to Always", () => {
      const result = state.messages_setContextStatus(personaId, messageId, ContextStatusEnum.Always);
      
      expect(result).toBe(true);
      const messages = state.messages_get(personaId);
      expect(messages[0].context_status).toBe("always");
    });

    it("sets context status to Never", () => {
      state.messages_setContextStatus(personaId, messageId, ContextStatusEnum.Never);
      
      const messages = state.messages_get(personaId);
      expect(messages[0].context_status).toBe("never");
    });

    it("returns false for non-existent persona", () => {
      const result = state.messages_setContextStatus("nonexistent", messageId, ContextStatusEnum.Always);
      expect(result).toBe(false);
    });

    it("returns false for non-existent message", () => {
      const result = state.messages_setContextStatus(personaId, "nonexistent", ContextStatusEnum.Always);
      expect(result).toBe(false);
    });
  });

  describe("messages_markRead", () => {
    let personaId: string;
    
    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("marks a message as read", () => {
      const msg = makeMessage("Test", "system");
      msg.read = false;
      state.messages_append(personaId, msg);

      const result = state.messages_markRead(personaId, msg.id);

      expect(result).toBe(true);
      expect(state.messages_get(personaId)[0].read).toBe(true);
    });

    it("returns false for non-existent persona", () => {
      const result = state.messages_markRead("nonexistent", "some-id");
      expect(result).toBe(false);
    });

    it("returns false for non-existent message", () => {
      const result = state.messages_markRead(personaId, "nonexistent");
      expect(result).toBe(false);
    });
  });

  describe("messages_markPendingAsRead", () => {
    let personaId: string;
    
    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("marks all unread human messages as read", () => {
      const msg1 = makeMessage("First");
      msg1.read = false;
      const msg2 = makeMessage("Second");
      msg2.read = false;
      const msg3 = makeMessage("Response", "system");
      msg3.read = false;

      state.messages_append(personaId, msg1);
      state.messages_append(personaId, msg2);
      state.messages_append(personaId, msg3);

      const count = state.messages_markPendingAsRead(personaId);

      expect(count).toBe(2);
      const messages = state.messages_get(personaId);
      expect(messages[0].read).toBe(true);
      expect(messages[1].read).toBe(true);
      expect(messages[2].read).toBe(false);
    });

    it("returns 0 when no pending human messages", () => {
      const msg = makeMessage("Already read");
      msg.read = true;
      state.messages_append(personaId, msg);

      const count = state.messages_markPendingAsRead(personaId);

      expect(count).toBe(0);
    });

    it("returns 0 for non-existent persona", () => {
      const count = state.messages_markPendingAsRead("nonexistent");
      expect(count).toBe(0);
    });
  });

  describe("messages_remove", () => {
    let personaId: string;
    
    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("removes specified messages and returns them", () => {
      const msg1 = makeMessage("First");
      const msg2 = makeMessage("Second");
      const msg3 = makeMessage("Third");

      state.messages_append(personaId, msg1);
      state.messages_append(personaId, msg2);
      state.messages_append(personaId, msg3);

      const removed = state.messages_remove(personaId, [msg1.id, msg3.id]);

      expect(removed).toHaveLength(2);
      expect(removed.map(m => m.content)).toContain("First");
      expect(removed.map(m => m.content)).toContain("Third");
      expect(state.messages_get(personaId)).toHaveLength(1);
      expect(state.messages_get(personaId)[0].content).toBe("Second");
    });

    it("returns empty array for non-existent persona", () => {
      const removed = state.messages_remove("nonexistent", ["some-id"]);
      expect(removed).toHaveLength(0);
    });

    it("ignores non-existent message ids", () => {
      const msg = makeMessage("Keep me");
      state.messages_append(personaId, msg);

      const removed = state.messages_remove(personaId, ["nonexistent"]);

      expect(removed).toHaveLength(0);
      expect(state.messages_get(personaId)).toHaveLength(1);
    });
  });

  describe("load/export", () => {
    it("exports personas to serializable format", () => {
      const bot1 = makePersona("Bot1");
      const bot2 = makePersona("Bot2");
      state.add(bot1);
      state.add(bot2);
      state.messages_append(bot1.id, makeMessage("Hello"));
      
      const exported = state.export();
      
      expect(Object.keys(exported)).toHaveLength(2);
      expect(exported[bot1.id]).toBeDefined();
      expect(exported[bot1.id].messages).toHaveLength(1);
    });

    it("loads personas from serialized format", () => {
      const persona = makePersona("TestBot");
      const data = {
        [persona.id]: {
          entity: persona,
          messages: [makeMessage("Loaded message")],
        },
      };
      
      state.load(data);
      
      expect(state.getAll()).toHaveLength(1);
      expect(state.messages_get(persona.id)).toHaveLength(1);
    });
  });
});

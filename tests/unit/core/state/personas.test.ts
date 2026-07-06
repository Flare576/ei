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

  describe("replace", () => {
    const makeFullPersona = (id: string): PersonaEntity => ({
      ...makePersona("FullBot", id),
      aliases: ["FullBot", "Full Alias"],
      long_description: "A long description with lots of detail",
      description_embedding: [0.1, 0.2, 0.3],
      last_heartbeat: new Date().toISOString(),
      pending_update: {
        short_description: "pending short",
        long_description: "pending long",
        traits: [],
        topics: [],
        critique: "pending critique",
        created_at: new Date().toISOString(),
      },
    });

    const makeBarePersona = (id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity => ({
      id,
      display_name: "Replaced Name",
      entity: "system",
      traits: [],
      topics: [],
      is_paused: false,
      is_archived: false,
      is_static: false,
      last_updated: new Date().toISOString(),
      ...overrides,
    });

    it("returns false for a non-existent persona", () => {
      expect(state.replace("nonexistent", makeBarePersona("nonexistent"))).toBe(false);
    });

    it("fully replaces the entity: fields genuinely absent from the new entity do NOT survive from the old one", () => {
      const persona = makeFullPersona("persona-1");
      state.add(persona);

      // makeBarePersona deliberately omits aliases/long_description/
      // description_embedding/pending_update/last_heartbeat entirely (not
      // merely undefined-valued) to prove a genuine full replace, not a merge.
      const result = state.replace("persona-1", makeBarePersona("persona-1"));
      const stored = state.getById("persona-1")!;

      expect(result).toBe(true);
      expect(stored.display_name).toBe("Replaced Name");
      expect(stored.aliases).toBeUndefined();
      expect(stored.long_description).toBeUndefined();
      expect(stored.description_embedding).toBeUndefined();
      expect(stored.pending_update).toBeUndefined();
      expect(stored.last_heartbeat).toBeUndefined();
    });

    it("preserves messages untouched, same as update()", () => {
      const persona = makeFullPersona("persona-2");
      state.add(persona);
      state.messages_append("persona-2", makeMessage("hello"));

      state.replace("persona-2", makeBarePersona("persona-2"));

      expect(state.messages_get("persona-2")).toHaveLength(1);
    });

    it("sets a fresh last_updated timestamp, not the one on the incoming entity", () => {
      const persona = makeFullPersona("persona-3");
      state.add(persona);

      const staleTimestamp = "2000-01-01T00:00:00.000Z";
      state.replace("persona-3", makeBarePersona("persona-3", { last_updated: staleTimestamp }));

      expect(state.getById("persona-3")!.last_updated).not.toBe(staleTimestamp);
    });

    it("contrast with update(): on identical fixtures, update() preserves omitted fields via shallow merge while replace() drops them", () => {
      const persona = makeFullPersona("persona-4");
      state.add(persona);

      // Partial<PersonaEntity> update with only display_name set -- update()
      // must NOT touch aliases/long_description/description_embedding/pending_update.
      state.update("persona-4", { display_name: "Merged Name" });

      const stored = state.getById("persona-4")!;
      expect(stored.display_name).toBe("Merged Name");
      expect(stored.aliases).toEqual(["FullBot", "Full Alias"]);
      expect(stored.long_description).toBe("A long description with lots of detail");
      expect(stored.description_embedding).toEqual([0.1, 0.2, 0.3]);
      expect(stored.pending_update).toBeDefined();
      expect(stored.pending_update!.short_description).toBe("pending short");
      expect(stored.last_heartbeat).toBeDefined();
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

    it("updates persona last_updated on message append", async () => {
      const before = state.getById(personaId)?.last_updated;
      
      await new Promise((r) => setTimeout(r, 2));
      
      state.messages_append(personaId, makeMessage("Hello"));
      
      const after = state.getById(personaId)?.last_updated;
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

  describe("messages_getUnextracted external_filter", () => {
    let personaId: string;

    const makeMsg = (id: string, isExternal?: boolean): Message => ({
      id,
      role: "human",
      content: id,
      timestamp: new Date().toISOString(),
      read: true,
      context_status: ContextStatusEnum.Default,
      ...(isExternal ? { external: true } : {}),
    });

    beforeEach(() => {
      const persona = makePersona("FilterBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("returns all messages when external_filter is undefined", () => {
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("external-1", true));

      const result = state.messages_getUnextracted(personaId, "f", undefined, undefined);

      expect(result).toHaveLength(2);
    });

    it("returns all messages when external_filter is 'include'", () => {
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("external-1", true));

      const result = state.messages_getUnextracted(personaId, "f", undefined, "include");

      expect(result).toHaveLength(2);
    });

    it("excludes external messages when external_filter is 'exclude'", () => {
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("external-1", true));

      const result = state.messages_getUnextracted(personaId, "f", undefined, "exclude");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("regular-1");
    });

    it("returns only external messages when external_filter is 'only'", () => {
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("external-1", true));

      const result = state.messages_getUnextracted(personaId, "f", undefined, "only");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("external-1");
    });

    it("excludes already-extracted messages before applying external_filter", () => {
      const alreadyExtracted: Message = { ...makeMsg("extracted-1"), f: true };
      state.messages_append(personaId, alreadyExtracted);
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("external-1", true));

      const result = state.messages_getUnextracted(personaId, "f", undefined, "exclude");

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("regular-1");
    });

    it("returns empty array when no external messages exist with filter 'only'", () => {
      state.messages_append(personaId, makeMsg("regular-1"));
      state.messages_append(personaId, makeMsg("regular-2"));

      const result = state.messages_getUnextracted(personaId, "f", undefined, "only");

      expect(result).toHaveLength(0);
    });

    it("respects limit after external_filter is applied", () => {
      state.messages_append(personaId, makeMsg("r1"));
      state.messages_append(personaId, makeMsg("r2"));
      state.messages_append(personaId, makeMsg("r3"));
      state.messages_append(personaId, makeMsg("e1", true));

      const result = state.messages_getUnextracted(personaId, "f", 2, "exclude");

      expect(result).toHaveLength(2);
    });
  });

  describe("reference isolation — pending_update must not alias entity.traits", () => {
    it("getById returns a live reference into internal state (not a copy)", () => {
      const persona = makePersona("RefBot");
      state.add(persona);

      const ref1 = state.getById(persona.id)!;
      const ref2 = state.getById(persona.id)!;

      // Both calls return the same object identity
      expect(ref1).toBe(ref2);
    });

    it("updating pending_update.traits does not change entity.traits", () => {
      const persona: PersonaEntity = {
        ...makePersona("IsolationBot"),
        traits: [
          { id: "t1", name: "Original Trait", description: "The real one", sentiment: 0.5, strength: 0.8, last_updated: "" },
        ],
      };
      state.add(persona);

      // Simulate what handleReflectionCritic does: write pending_update with different traits
      const pendingTraits = [
        { id: "p1", name: "Proposed Trait", description: "The proposed one", sentiment: 0.7, strength: 0.9, last_updated: "" },
      ];
      state.update(persona.id, {
        pending_update: {
          short_description: "Proposed short",
          long_description: "Proposed long",
          traits: pendingTraits,
          topics: [],
          critique: "Some critique",
          created_at: new Date().toISOString(),
        },
      });

      const stored = state.getById(persona.id)!;

      // entity.traits must be the original — untouched by pending_update write
      expect(stored.traits).toHaveLength(1);
      expect(stored.traits[0].name).toBe("Original Trait");

      // pending_update.traits must have the proposed values
      expect(stored.pending_update).toBeDefined();
      expect(stored.pending_update!.traits).toHaveLength(1);
      expect(stored.pending_update!.traits[0].name).toBe("Proposed Trait");

      // The two arrays must NOT be the same reference
      expect(stored.traits).not.toBe(stored.pending_update!.traits);
    });

    it("mutating pending_update.traits[0].name after update does not affect entity.traits[0].name", () => {
      const persona: PersonaEntity = {
        ...makePersona("MutationBot"),
        traits: [
          { id: "t1", name: "Stable Name", description: "desc", sentiment: 0, strength: 0.5, last_updated: "" },
        ],
      };
      state.add(persona);

      const pendingTraits = [
        { id: "t1", name: "Stable Name", description: "desc", sentiment: 0, strength: 0.5, last_updated: "" },
      ];
      state.update(persona.id, {
        pending_update: {
          short_description: "",
          long_description: "",
          traits: pendingTraits,
          topics: [],
          critique: "",
          created_at: new Date().toISOString(),
        },
      });

      // Simulate what the UI does: mutate the returned pending_update object directly
      const stored = state.getById(persona.id)!;
      stored.pending_update!.traits[0].name = "MUTATED";

      // entity.traits[0].name must still be the original
      expect(state.getById(persona.id)!.traits[0].name).toBe("Stable Name");
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

  describe("messages_getAlways", () => {
    let personaId: string;

    const makeAlwaysMessage = (content: string, role: "human" | "system" = "system", tsOffset = 0): Message => ({
      id: crypto.randomUUID(),
      role,
      content,
      timestamp: new Date(Date.now() + tsOffset).toISOString(),
      read: true,
      context_status: ContextStatusEnum.Always,
    });

    beforeEach(() => {
      const persona = makePersona("TestBot");
      personaId = persona.id;
      state.add(persona);
    });

    it("returns empty array when no messages exist", () => {
      expect(state.messages_getAlways(personaId)).toEqual([]);
    });

    it("returns empty array for non-existent persona", () => {
      expect(state.messages_getAlways("nonexistent")).toEqual([]);
    });

    it("returns only messages with context_status Always", () => {
      state.messages_append(personaId, makeMessage("default message"));
      state.messages_append(personaId, makeAlwaysMessage("pinned message"));
      state.messages_append(personaId, { ...makeMessage("never message"), context_status: ContextStatusEnum.Never });

      const result = state.messages_getAlways(personaId);

      expect(result).toHaveLength(1);
      expect(result[0].content).toBe("pinned message");
    });

    it("returns messages sorted chronologically by timestamp", () => {
      state.messages_append(personaId, makeAlwaysMessage("third", "system", 2000));
      state.messages_append(personaId, makeAlwaysMessage("first", "system", 0));
      state.messages_append(personaId, makeAlwaysMessage("second", "system", 1000));

      const result = state.messages_getAlways(personaId);

      expect(result).toHaveLength(3);
      expect(result[0].content).toBe("first");
      expect(result[1].content).toBe("second");
      expect(result[2].content).toBe("third");
    });

    it("returns copies, not references", () => {
      state.messages_append(personaId, makeAlwaysMessage("original"));

      const result = state.messages_getAlways(personaId);
      result[0].content = "mutated";

      expect(state.messages_getAlways(personaId)[0].content).toBe("original");
    });

    it("works for both human and system role messages", () => {
      state.messages_append(personaId, makeAlwaysMessage("human says", "human"));
      state.messages_append(personaId, makeAlwaysMessage("persona says", "system"));

      const result = state.messages_getAlways(personaId);

      expect(result).toHaveLength(2);
      expect(result.map(m => m.content)).toContain("human says");
      expect(result.map(m => m.content)).toContain("persona says");
    });
  });
});

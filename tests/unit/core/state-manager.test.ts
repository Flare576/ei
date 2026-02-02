import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { LLMRequestType, LLMPriority, LLMNextStep, ContextStatus } from "../../../src/core/types.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { Fact, Trait, Topic, Person, PersonaEntity, Message } from "../../../src/core/types.js";

describe("StateManager", () => {
  let sm: StateManager;
  let storage: ReturnType<typeof createMockStorage>;

  beforeEach(async () => {
    sm = new StateManager();
    storage = createMockStorage();
    await sm.initialize(storage);
  });

  describe("initialization", () => {
    it("loads from storage if checkpoint exists", async () => {
      const testState = createDefaultTestState();
      testState.human.facts = [{ id: "f1", name: "Loaded", description: "", sentiment: 0, last_updated: "" }];
      storage._autoSaves.push(testState);
      
      const newSm = new StateManager();
      await newSm.initialize(storage);
      
      expect(newSm.getHuman().facts).toHaveLength(1);
      expect(newSm.getHuman().facts[0].name).toBe("Loaded");
    });

    it("creates default state if no checkpoint", async () => {
      const newSm = new StateManager();
      const emptyStorage = createMockStorage();
      await newSm.initialize(emptyStorage);
      
      expect(newSm.getHuman().facts).toEqual([]);
      expect(newSm.persona_getAll()).toEqual([]);
    });
  });

  describe("human entity operations", () => {
    const makeFact = (id: string, name: string): Fact => ({
      id, name, description: "", sentiment: 0, last_updated: ""
    });

    const makeTrait = (id: string, name: string): Trait => ({
      id, name, description: "", sentiment: 0, last_updated: ""
    });

    const makeTopic = (id: string, name: string): Topic => ({
      id, name, description: "", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: ""
    });

    const makePerson = (id: string, name: string): Person => ({
      id, name, description: "", relationship: "friend", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: ""
    });

    it("upserts and removes facts", () => {
      sm.human_fact_upsert(makeFact("f1", "Test"));
      expect(sm.getHuman().facts).toHaveLength(1);
      
      sm.human_fact_remove("f1");
      expect(sm.getHuman().facts).toHaveLength(0);
    });

    it("upserts and removes traits", () => {
      sm.human_trait_upsert(makeTrait("t1", "Test"));
      expect(sm.getHuman().traits).toHaveLength(1);
      
      sm.human_trait_remove("t1");
      expect(sm.getHuman().traits).toHaveLength(0);
    });

    it("upserts and removes topics", () => {
      sm.human_topic_upsert(makeTopic("top1", "Test"));
      expect(sm.getHuman().topics).toHaveLength(1);
      
      sm.human_topic_remove("top1");
      expect(sm.getHuman().topics).toHaveLength(0);
    });

    it("upserts and removes people", () => {
      sm.human_person_upsert(makePerson("p1", "Test"));
      expect(sm.getHuman().people).toHaveLength(1);
      
      sm.human_person_remove("p1");
      expect(sm.getHuman().people).toHaveLength(0);
    });
  });

  describe("persona operations", () => {
    const makePersona = (name: string): PersonaEntity => ({
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

    it("adds and retrieves personas", () => {
      sm.persona_add("Bot", makePersona("Bot"));
      
      expect(sm.persona_getAll()).toHaveLength(1);
      expect(sm.persona_get("Bot")).not.toBeNull();
    });

    it("updates persona", () => {
      sm.persona_add("Bot", makePersona("Bot"));
      sm.persona_update("Bot", { short_description: "Updated" });
      
      expect(sm.persona_get("Bot")?.short_description).toBe("Updated");
    });

    it("archives and unarchives persona", () => {
      sm.persona_add("Bot", makePersona("Bot"));
      
      sm.persona_archive("Bot");
      expect(sm.persona_get("Bot")?.is_archived).toBe(true);
      
      sm.persona_unarchive("Bot");
      expect(sm.persona_get("Bot")?.is_archived).toBe(false);
    });

    it("deletes persona", () => {
      sm.persona_add("Bot", makePersona("Bot"));
      sm.persona_delete("Bot");
      
      expect(sm.persona_get("Bot")).toBeNull();
    });
  });

  describe("message operations", () => {
    const makeMessage = (content: string): Message => ({
      id: crypto.randomUUID(),
      role: "human",
      content,
      timestamp: new Date().toISOString(),
      read: true,
      context_status: ContextStatus.Default,
    });

    beforeEach(() => {
      sm.persona_add("Bot", {
        entity: "system",
        aliases: ["Bot"],
        traits: [],
        topics: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: "",
        last_activity: "",
      });
    });

    it("appends and retrieves messages", () => {
      const msg = makeMessage("Hello");
      sm.messages_append("Bot", msg);
      
      const messages = sm.messages_get("Bot");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello");
    });

    it("sets message context status", () => {
      const msg = makeMessage("Test");
      sm.messages_append("Bot", msg);
      
      sm.messages_setContextStatus("Bot", msg.id, ContextStatus.Always);
      
      expect(sm.messages_get("Bot")[0].context_status).toBe("always");
    });

    it("sets and gets context window", () => {
      sm.messages_setContextWindow("Bot", "2024-01-01", "2024-01-02");
      
      const window = sm.messages_getContextWindow("Bot");
      expect(window).toEqual({ start: "2024-01-01", end: "2024-01-02" });
    });
  });

  describe("queue operations", () => {
    const makeRequest = () => ({
      type: LLMRequestType.Response,
      priority: LLMPriority.Normal,
      system: "Test",
      user: "Test",
      next_step: LLMNextStep.HandlePersonaResponse,
      data: {},
    });

    it("enqueues and peeks requests", () => {
      const id = sm.queue_enqueue(makeRequest());
      
      expect(id).toBeDefined();
      expect(sm.queue_length()).toBe(1);
      
      const request = sm.queue_peekHighest();
      expect(request?.id).toBe(id);
    });

    it("completes requests", () => {
      const id = sm.queue_enqueue(makeRequest());
      sm.queue_complete(id);
      
      expect(sm.queue_length()).toBe(0);
    });

    it("fails requests (increments attempts)", () => {
      const id = sm.queue_enqueue(makeRequest());
      sm.queue_fail(id, "Error");
      
      expect(sm.queue_peekHighest()?.attempts).toBe(1);
    });

    it("pauses and resumes queue", () => {
      sm.queue_enqueue(makeRequest());
      
      sm.queue_pause();
      expect(sm.queue_isPaused()).toBe(true);
      expect(sm.queue_peekHighest()).toBeNull();
      
      sm.queue_resume();
      expect(sm.queue_isPaused()).toBe(false);
      expect(sm.queue_peekHighest()).not.toBeNull();
    });
  });

  describe("checkpoint operations", () => {
    it("saves auto checkpoint", async () => {
      await sm.checkpoint_saveAuto();
      
      expect(storage.saveAutoCheckpoint).toHaveBeenCalled();
    });

    it("saves manual checkpoint", async () => {
      await sm.checkpoint_saveManual(10, "My Save");
      
      expect(storage.saveManualCheckpoint).toHaveBeenCalledWith(
        10,
        "My Save",
        expect.any(Object)
      );
    });

    it("lists checkpoints", async () => {
      storage._autoSaves.push(createDefaultTestState());
      
      const list = await sm.checkpoint_list();
      
      expect(list).toHaveLength(1);
    });

    it("deletes manual checkpoint", async () => {
      storage._manualSaves.set(10, { state: createDefaultTestState(), name: "Test" });
      
      const result = await sm.checkpoint_delete(10);
      
      expect(result).toBe(true);
    });

    it("restores checkpoint", async () => {
      const savedState = createDefaultTestState();
      savedState.human.facts = [{ id: "f1", name: "Restored", description: "", sentiment: 0, last_updated: "" }];
      storage._autoSaves.push(savedState);
      
      const restored = await sm.checkpoint_restore(0);
      
      expect(restored).toBe(true);
      expect(sm.getHuman().facts[0].name).toBe("Restored");
    });

    it("returns false when restoring non-existent checkpoint", async () => {
      const restored = await sm.checkpoint_restore(5);
      
      expect(restored).toBe(false);
    });
  });

  describe("settings operations", () => {
    it("sets and gets settings", () => {
      sm.settings_set("testKey", { value: 42 });
      
      const result = sm.settings_get<{ value: number }>("testKey");
      expect(result?.value).toBe(42);
    });

    it("returns null for non-existent setting", () => {
      const result = sm.settings_get("nonexistent");
      expect(result).toBeNull();
    });
  });
});

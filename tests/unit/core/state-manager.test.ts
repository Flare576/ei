import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { LLMRequestType, LLMPriority, LLMNextStep, ContextStatus, ValidationLevel } from "../../../src/core/types.js";
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
    it("loads from storage if data exists", async () => {
      const testState = createDefaultTestState();
      testState.human.facts = [{ 
        id: "f1", 
        name: "Loaded", 
        description: "", 
        sentiment: 0, 
        last_updated: "",
        validated: ValidationLevel.None,
        validated_date: ""
      }];
      
      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);
      
      expect(newSm.getHuman().facts).toHaveLength(1);
      expect(newSm.getHuman().facts[0].name).toBe("Loaded");
    });

    it("creates default state if no data exists", async () => {
      const newSm = new StateManager();
      const emptyStorage = createMockStorage();
      (emptyStorage.load as any).mockResolvedValue(null);
      await newSm.initialize(emptyStorage);
      
      expect(newSm.getHuman().facts).toEqual([]);
      expect(newSm.persona_getAll()).toEqual([]);
    });
  });

  describe("human entity operations", () => {
    const makeFact = (id: string, name: string): Fact => ({
      id, name, description: "", sentiment: 0, last_updated: "", validated: ValidationLevel.None, validated_date: ""
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
    const makePersona = (id: string, name: string): PersonaEntity => ({
      id,
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

    it("adds and retrieves personas", () => {
      sm.persona_add(makePersona("bot-id", "Bot"));
      
      expect(sm.persona_getAll()).toHaveLength(1);
      expect(sm.persona_getById("bot-id")).not.toBeNull();
      expect(sm.persona_getByName("Bot")).not.toBeNull();
    });

    it("updates persona", () => {
      sm.persona_add(makePersona("bot-id", "Bot"));
      sm.persona_update("bot-id", { short_description: "Updated" });
      
      expect(sm.persona_getById("bot-id")?.short_description).toBe("Updated");
    });

    it("archives and unarchives persona", () => {
      sm.persona_add(makePersona("bot-id", "Bot"));
      
      sm.persona_archive("bot-id");
      expect(sm.persona_getById("bot-id")?.is_archived).toBe(true);
      
      sm.persona_unarchive("bot-id");
      expect(sm.persona_getById("bot-id")?.is_archived).toBe(false);
    });

    it("deletes persona", () => {
      sm.persona_add(makePersona("bot-id", "Bot"));
      sm.persona_delete("bot-id");
      
      expect(sm.persona_getById("bot-id")).toBeNull();
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
      sm.persona_add({
        id: "bot-id",
        display_name: "Bot",
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
      sm.messages_append("bot-id", msg);
      
      const messages = sm.messages_get("bot-id");
      expect(messages).toHaveLength(1);
      expect(messages[0].content).toBe("Hello");
    });

    it("sets message context status", () => {
      const msg = makeMessage("Test");
      sm.messages_append("bot-id", msg);
      
      sm.messages_setContextStatus("bot-id", msg.id, ContextStatus.Always);
      
      expect(sm.messages_get("bot-id")[0].context_status).toBe("always");
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
      
      const request = sm.queue_claimHighest();
      expect(request?.id).toBe(id);
    });

    it("completes requests", () => {
      const id = sm.queue_enqueue(makeRequest());
      sm.queue_complete(id);
      
      expect(sm.queue_length()).toBe(0);
    });

    it("fails requests (increments attempts)", () => {
      const id = sm.queue_enqueue(makeRequest());
      sm.queue_fail(id);
      
      expect(sm.getStorageState().queue[0]?.attempts).toBe(1);
    });

    it("pauses and resumes queue", () => {
      sm.queue_enqueue(makeRequest());
      
      sm.queue_pause();
      expect(sm.queue_isPaused()).toBe(true);
      expect(sm.queue_claimHighest()).toBeNull();
      
      sm.queue_resume();
      expect(sm.queue_isPaused()).toBe(false);
      expect(sm.queue_claimHighest()).not.toBeNull();
    });
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { LLMRequestType, LLMPriority, LLMNextStep, ContextStatus } from "../../../src/core/types.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { Fact, Topic, Person, PersonaEntity, Message, ToolProvider, ToolDefinition } from "../../../src/core/types.js";

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
      id, name, description: "", sentiment: 0, last_updated: "", validated_date: ""
    });

    const makeTopic = (id: string, name: string): Topic => ({
      id, name, description: "", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: ""
    });

    const makePerson = (id: string, name: string): Person => ({
      id, name, description: "", relationship: "friend", sentiment: 0, exposure_current: 0.5, exposure_desired: 0.5, last_updated: ""
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

  describe("migrateInterestedPersonas", () => {
    // This migration runs on initialize(), backfilling interested_personas from learned_by + last_changed_by

    const makeTopic = (id: string, name: string, overrides: Partial<Topic> = {}): Topic => ({
      id,
      name,
      description: "",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: "",
      ...overrides,
    });

    const makeFact = (id: string, name: string, overrides: Partial<Fact> = {}): Fact => ({
      id,
      name,
      description: "",
      sentiment: 0,
      last_updated: "",
      validated_date: "",
      ...overrides,
    });

    const makePerson = (id: string, name: string, overrides: Partial<Person> = {}): Person => ({
      id,
      name,
      description: "",
      relationship: "friend",
      sentiment: 0,
      exposure_current: 0.5,
      exposure_desired: 0.5,
      last_updated: "",
      ...overrides,
    });

    it("backfills from both learned_by and last_changed_by (deduped)", async () => {
      // Use UUID-format IDs because migrateLearnedByToIds() clears non-UUID IDs before this migration runs
      const testState = createDefaultTestState();
      testState.human.topics = [
        makeTopic("t1", "Test Topic", {
          learned_by: "11111111-1111-1111-1111-111111111111",
          last_changed_by: "22222222-2222-2222-2222-222222222222",
          interested_personas: undefined,
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const topic = newSm.getHuman().topics[0];
      expect(topic.interested_personas).toEqual(["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]);
    });

    it("backfills from learned_by only when last_changed_by is null", async () => {
      // Use UUID-format IDs because migrateLearnedByToIds() clears non-UUID IDs before this migration runs
      const testState = createDefaultTestState();
      testState.human.facts = [
        makeFact("f1", "Test Fact", {
          learned_by: "11111111-1111-1111-1111-111111111111",
          last_changed_by: undefined,
          interested_personas: undefined,
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const fact = newSm.getHuman().facts[0];
      expect(fact.interested_personas).toEqual(["11111111-1111-1111-1111-111111111111"]);
    });

    it("sets empty array when neither learned_by nor last_changed_by exists", async () => {
      const testState = createDefaultTestState();
      testState.human.people = [
        makePerson("p1", "Test Person", {
          learned_by: undefined,
          last_changed_by: undefined,
          interested_personas: undefined,
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const person = newSm.getHuman().people[0];
      expect(person.interested_personas).toEqual([]);
    });

    it("deduplicates when learned_by and last_changed_by are the same persona", async () => {
      // Use UUID-format IDs because migrateLearnedByToIds() clears non-UUID IDs before this migration runs
      const testState = createDefaultTestState();
      testState.human.topics = [
        makeTopic("t1", "Same Persona", {
          learned_by: "11111111-1111-1111-1111-111111111111",
          last_changed_by: "11111111-1111-1111-1111-111111111111",
          interested_personas: undefined,
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const topic = newSm.getHuman().topics[0];
      expect(topic.interested_personas).toEqual(["11111111-1111-1111-1111-111111111111"]);
    });

    it("does NOT touch entities that already have interested_personas set", async () => {
      const testState = createDefaultTestState();
      testState.human.topics = [
        makeTopic("t1", "Already Set", {
          learned_by: "persona-1",
          last_changed_by: "persona-2",
          interested_personas: ["persona-3", "persona-4"],
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const topic = newSm.getHuman().topics[0];
      // Should remain unchanged - not backfilled from learned_by/last_changed_by
      expect(topic.interested_personas).toEqual(["persona-3", "persona-4"]);
    });

    it("handles mixed entities - some need migration, some don't", async () => {
      // Use UUID-format IDs because migrateLearnedByToIds() clears non-UUID IDs before this migration runs
      const testState = createDefaultTestState();
      testState.human.topics = [
        makeTopic("t1", "Needs Migration", {
          learned_by: "11111111-1111-1111-1111-111111111111",
          interested_personas: undefined,
        }),
        makeTopic("t2", "Already Migrated", {
          learned_by: "22222222-2222-2222-2222-222222222222",
          interested_personas: ["33333333-3333-3333-3333-333333333333"],
        }),
      ];

      const newSm = new StateManager();
      const testStorage = createMockStorage();
      (testStorage.load as any).mockResolvedValue(testState);
      await newSm.initialize(testStorage);

      const topics = newSm.getHuman().topics;
      expect(topics[0].interested_personas).toEqual(["11111111-1111-1111-1111-111111111111"]);
      expect(topics[1].interested_personas).toEqual(["33333333-3333-3333-3333-333333333333"]);
    });
  });

  describe("tools_getForPersona", () => {
    const PROVIDER_ID = "provider-1";
    const TOOL_ID_1 = "tool-1";
    const TOOL_ID_2 = "tool-2";
    const PERSONA_ID = "persona-1";

    const makeProvider = (id: string, overrides: Partial<ToolProvider> = {}): ToolProvider => ({
      id,
      name: "test_provider",
      display_name: "Test Provider",
      builtin: false,
      config: {},
      enabled: true,
      created_at: new Date().toISOString(),
      ...overrides,
    });

    const makeTool = (id: string, providerId: string, overrides: Partial<ToolDefinition> = {}): ToolDefinition => ({
      id,
      provider_id: providerId,
      name: "test_tool",
      display_name: "Test Tool",
      description: "A test tool",
      input_schema: {},
      runtime: "any",
      builtin: false,
      enabled: true,
      created_at: new Date().toISOString(),
      ...overrides,
    });

    const makePersona = (id: string, name: string, tools?: string[]): PersonaEntity => ({
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
      ...(tools !== undefined ? { tools } : {}),
    });

    it("returns empty array when persona.tools is undefined", () => {
      sm.persona_add(makePersona(PERSONA_ID, "TestBot"));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("returns empty array when persona.tools is empty array", () => {
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", []));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("filters out tools whose provider has enabled: false", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID, { enabled: false }));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("filters out tools where tool.enabled === false", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID, { enabled: false }));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("filters out runtime: 'node' tools when isTUI === false", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID, { runtime: "node" }));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("includes runtime: 'node' tools when isTUI === true", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID, { runtime: "node" }));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1]));
      const result = sm.tools_getForPersona(PERSONA_ID, true);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(TOOL_ID_1);
    });

    it("filters out stale tool IDs that no longer exist in the tools registry", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", ["stale-tool-id"]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toEqual([]);
    });

    it("merges provider.config and tool.config with tool-level config winning on collision", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID, {
        config: { apiKey: "provider-key", baseUrl: "https://provider.com" },
      }));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID, {
        config: { apiKey: "tool-key" },
      }));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toHaveLength(1);
      expect(result[0].config).toEqual({ apiKey: "tool-key", baseUrl: "https://provider.com" });
    });

    it("returns multiple tools when all filtering criteria pass", () => {
      sm.tools_addProvider(makeProvider(PROVIDER_ID));
      sm.tools_add(makeTool(TOOL_ID_1, PROVIDER_ID, { name: "tool_one" }));
      sm.tools_add(makeTool(TOOL_ID_2, PROVIDER_ID, { name: "tool_two" }));
      sm.persona_add(makePersona(PERSONA_ID, "TestBot", [TOOL_ID_1, TOOL_ID_2]));
      const result = sm.tools_getForPersona(PERSONA_ID, false);
      expect(result).toHaveLength(2);
      expect(result.map(t => t.id)).toContain(TOOL_ID_1);
      expect(result.map(t => t.id)).toContain(TOOL_ID_2);
    });
  });
});

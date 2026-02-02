import { describe, it, expect, beforeEach } from "vitest";
import { HumanState, createDefaultHumanEntity } from "../../../../src/core/state/index.js";
import type { Fact, Trait, Topic, Person } from "../../../../src/core/types.js";

describe("HumanState", () => {
  let state: HumanState;

  beforeEach(() => {
    state = new HumanState();
  });

  describe("initialization", () => {
    it("starts with default human entity", () => {
      const human = state.get();
      expect(human.entity).toBe("human");
      expect(human.facts).toEqual([]);
      expect(human.traits).toEqual([]);
      expect(human.topics).toEqual([]);
      expect(human.people).toEqual([]);
    });

    it("can load existing entity", () => {
      const custom = createDefaultHumanEntity();
      custom.facts = [{ id: "f1", name: "Test", description: "Test fact", sentiment: 0.5, last_updated: "" }];
      
      state.load(custom);
      
      expect(state.get().facts).toHaveLength(1);
      expect(state.get().facts[0].name).toBe("Test");
    });
  });

  describe("facts CRUD", () => {
    const makeFact = (id: string, name: string): Fact => ({
      id,
      name,
      description: `${name} description`,
      sentiment: 0.5,
      last_updated: new Date().toISOString(),
    });

    it("adds new fact via upsert", () => {
      const fact = makeFact("f1", "Favorite Color");
      state.fact_upsert(fact);
      
      expect(state.get().facts).toHaveLength(1);
      expect(state.get().facts[0].name).toBe("Favorite Color");
    });

    it("updates existing fact via upsert (matched by id)", () => {
      const original = makeFact("f1", "Original");
      state.fact_upsert(original);
      
      const updated = makeFact("f1", "Updated");
      state.fact_upsert(updated);
      
      expect(state.get().facts).toHaveLength(1);
      expect(state.get().facts[0].name).toBe("Updated");
    });

    it("removes fact by id", () => {
      state.fact_upsert(makeFact("f1", "ToRemove"));
      expect(state.get().facts).toHaveLength(1);
      
      const removed = state.fact_remove("f1");
      
      expect(removed).toBe(true);
      expect(state.get().facts).toHaveLength(0);
    });

    it("returns false when removing non-existent fact", () => {
      const removed = state.fact_remove("nonexistent");
      expect(removed).toBe(false);
    });

    it("updates last_updated timestamp on upsert", async () => {
      const before = state.get().last_updated;
      
      await new Promise((r) => setTimeout(r, 2));
      
      const fact = makeFact("f1", "Test");
      state.fact_upsert(fact);
      
      expect(new Date(state.get().last_updated).getTime())
        .toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });

  describe("traits CRUD", () => {
    const makeTrait = (id: string, name: string): Trait => ({
      id,
      name,
      description: `${name} description`,
      sentiment: 0.5,
      strength: 0.7,
      last_updated: new Date().toISOString(),
    });

    it("adds new trait via upsert", () => {
      state.trait_upsert(makeTrait("t1", "Curious"));
      
      expect(state.get().traits).toHaveLength(1);
      expect(state.get().traits[0].name).toBe("Curious");
    });

    it("updates existing trait via upsert", () => {
      state.trait_upsert(makeTrait("t1", "Original"));
      state.trait_upsert(makeTrait("t1", "Updated"));
      
      expect(state.get().traits).toHaveLength(1);
      expect(state.get().traits[0].name).toBe("Updated");
    });

    it("removes trait by id", () => {
      state.trait_upsert(makeTrait("t1", "ToRemove"));
      const removed = state.trait_remove("t1");
      
      expect(removed).toBe(true);
      expect(state.get().traits).toHaveLength(0);
    });
  });

  describe("topics CRUD", () => {
    const makeTopic = (id: string, name: string): Topic => ({
      id,
      name,
      description: `${name} description`,
      sentiment: 0.5,
      exposure_current: 0.3,
      exposure_desired: 0.7,
      last_updated: new Date().toISOString(),
    });

    it("adds new topic via upsert", () => {
      state.topic_upsert(makeTopic("top1", "Programming"));
      
      expect(state.get().topics).toHaveLength(1);
      expect(state.get().topics[0].name).toBe("Programming");
    });

    it("updates existing topic via upsert", () => {
      state.topic_upsert(makeTopic("top1", "Original"));
      state.topic_upsert(makeTopic("top1", "Updated"));
      
      expect(state.get().topics).toHaveLength(1);
      expect(state.get().topics[0].name).toBe("Updated");
    });

    it("removes topic by id", () => {
      state.topic_upsert(makeTopic("top1", "ToRemove"));
      const removed = state.topic_remove("top1");
      
      expect(removed).toBe(true);
      expect(state.get().topics).toHaveLength(0);
    });
  });

  describe("people CRUD", () => {
    const makePerson = (id: string, name: string): Person => ({
      id,
      name,
      description: `${name} description`,
      relationship: "friend",
      sentiment: 0.5,
      exposure_current: 0.3,
      exposure_desired: 0.7,
      last_updated: new Date().toISOString(),
    });

    it("adds new person via upsert", () => {
      state.person_upsert(makePerson("p1", "Alice"));
      
      expect(state.get().people).toHaveLength(1);
      expect(state.get().people[0].name).toBe("Alice");
    });

    it("updates existing person via upsert", () => {
      state.person_upsert(makePerson("p1", "Original"));
      state.person_upsert(makePerson("p1", "Updated"));
      
      expect(state.get().people).toHaveLength(1);
      expect(state.get().people[0].name).toBe("Updated");
    });

    it("removes person by id", () => {
      state.person_upsert(makePerson("p1", "ToRemove"));
      const removed = state.person_remove("p1");
      
      expect(removed).toBe(true);
      expect(state.get().people).toHaveLength(0);
    });
  });

  describe("set() method", () => {
    it("replaces entire entity and updates timestamp", async () => {
      const before = state.get().last_updated;
      
      await new Promise((r) => setTimeout(r, 2));
      
      const newEntity = createDefaultHumanEntity();
      newEntity.facts = [{ id: "f1", name: "Custom", description: "Test", sentiment: 0, last_updated: "" }];
      
      state.set(newEntity);
      
      expect(state.get().facts).toHaveLength(1);
      expect(new Date(state.get().last_updated).getTime())
        .toBeGreaterThanOrEqual(new Date(before).getTime());
    });
  });
});

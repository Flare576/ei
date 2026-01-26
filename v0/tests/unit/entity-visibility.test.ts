import { describe, it, expect } from "vitest";
import { filterByVisibility, GLOBAL_GROUP } from "../../src/prompts/index.js";
import type { HumanEntity, PersonaEntity, Fact, Trait, Topic, Person } from "../../src/types.js";

const createFact = (
  name: string,
  persona_groups: string[] = []
): Fact => ({
  name,
  description: `Description for ${name}`,
  sentiment: 0.0,
  confidence: 0.8,
  last_updated: new Date().toISOString(),
  persona_groups,
});

const createTrait = (
  name: string,
  persona_groups: string[] = []
): Trait => ({
  name,
  description: `Description for ${name}`,
  sentiment: 0.0,
  strength: 0.5,
  last_updated: new Date().toISOString(),
  persona_groups,
});

const createTopic = (
  name: string,
  persona_groups: string[] = []
): Topic => ({
  name,
  description: `Description for ${name}`,
  level_current: 0.5,
  level_ideal: 0.5,
  sentiment: 0.0,
  last_updated: new Date().toISOString(),
  persona_groups,
});

const createPerson = (
  name: string,
  persona_groups: string[] = []
): Person => ({
  name,
  description: `Description for ${name}`,
  relationship: "friend",
  level_current: 0.5,
  level_ideal: 0.5,
  sentiment: 0.0,
  last_updated: new Date().toISOString(),
  persona_groups,
});

const createPersonaEntity = (overrides: Partial<PersonaEntity> = {}): PersonaEntity => ({
  entity: "system",
  last_updated: null,
  traits: [],
  topics: [],
  ...overrides,
});

const createHumanEntity = (overrides: Partial<HumanEntity> = {}): HumanEntity => ({
  entity: "human",
  facts: [],
  traits: [],
  topics: [],
  people: [],
  last_updated: null,
  ceremony_config: { enabled: true, time: "09:00", timezone: undefined },
  ...overrides,
});

describe("filterByVisibility", () => {
  describe("wildcard visibility (groups_visible: ['*'])", () => {
    it("sees ALL data regardless of persona_groups", () => {
      const persona = createPersonaEntity({ groups_visible: ["*"] });
      const humanEntity = createHumanEntity({
        facts: [
          createFact("global_fact", []),
          createFact("work_fact", ["Work"]),
          createFact("personal_fact", ["Personal"]),
        ],
        traits: [
          createTrait("global_trait", []),
          createTrait("work_trait", ["Work"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(3);
      expect(filtered.traits).toHaveLength(2);
    });

    it("includes all data buckets", () => {
      const persona = createPersonaEntity({ groups_visible: ["*"] });
      const humanEntity = createHumanEntity({
        facts: [createFact("fact1")],
        traits: [createTrait("trait1")],
        topics: [createTopic("topic1")],
        people: [createPerson("person1")],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.traits).toHaveLength(1);
      expect(filtered.topics).toHaveLength(1);
      expect(filtered.people).toHaveLength(1);
    });
  });

  describe("group_primary visibility", () => {
    it("sees global data (empty persona_groups)", () => {
      const persona = createPersonaEntity({ group_primary: "Work" });
      const humanEntity = createHumanEntity({
        facts: [createFact("global_fact", [])],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.facts[0].name).toBe("global_fact");
    });

    it("sees global data (GLOBAL_GROUP in persona_groups)", () => {
      const persona = createPersonaEntity({ group_primary: "Work" });
      const humanEntity = createHumanEntity({
        facts: [createFact("global_fact", [GLOBAL_GROUP])],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
    });

    it("sees data matching its group_primary", () => {
      const persona = createPersonaEntity({ group_primary: "Work" });
      const humanEntity = createHumanEntity({
        facts: [
          createFact("work_fact", ["Work"]),
          createFact("personal_fact", ["Personal"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.facts[0].name).toBe("work_fact");
    });

    it("does not see data from other groups", () => {
      const persona = createPersonaEntity({ group_primary: "Work" });
      const humanEntity = createHumanEntity({
        facts: [createFact("personal_fact", ["Personal"])],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(0);
    });
  });

  describe("groups_visible visibility", () => {
    it("sees data from multiple groups in groups_visible", () => {
      const persona = createPersonaEntity({ groups_visible: ["Work", "Projects"] });
      const humanEntity = createHumanEntity({
        facts: [
          createFact("work_fact", ["Work"]),
          createFact("project_fact", ["Projects"]),
          createFact("personal_fact", ["Personal"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(2);
      const names = filtered.facts.map(f => f.name);
      expect(names).toContain("work_fact");
      expect(names).toContain("project_fact");
    });

    it("combines group_primary and groups_visible", () => {
      const persona = createPersonaEntity({
        group_primary: "Work",
        groups_visible: ["Projects"],
      });
      const humanEntity = createHumanEntity({
        facts: [
          createFact("work_fact", ["Work"]),
          createFact("project_fact", ["Projects"]),
          createFact("personal_fact", ["Personal"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(2);
      const names = filtered.facts.map(f => f.name);
      expect(names).toContain("work_fact");
      expect(names).toContain("project_fact");
    });
  });

  describe("no group visibility", () => {
    it("persona with no group_primary and no groups_visible sees only global data", () => {
      const persona = createPersonaEntity({});
      const humanEntity = createHumanEntity({
        facts: [
          createFact("global_fact", []),
          createFact("work_fact", ["Work"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.facts[0].name).toBe("global_fact");
    });

    it("persona with undefined group fields sees only global data", () => {
      const persona = createPersonaEntity({
        group_primary: undefined,
        groups_visible: undefined,
      });
      const humanEntity = createHumanEntity({
        facts: [
          createFact("global_fact", []),
          createFact("work_fact", ["Work"]),
        ],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.facts[0].name).toBe("global_fact");
    });
  });

  describe("edge cases", () => {
    it("handles empty human entity", () => {
      const persona = createPersonaEntity({ groups_visible: ["*"] });
      const humanEntity = createHumanEntity();

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(0);
      expect(filtered.traits).toHaveLength(0);
      expect(filtered.topics).toHaveLength(0);
      expect(filtered.people).toHaveLength(0);
    });

    it("filters all data buckets independently", () => {
      const persona = createPersonaEntity({ group_primary: "Work" });
      const humanEntity = createHumanEntity({
        facts: [createFact("work_fact", ["Work"]), createFact("personal_fact", ["Personal"])],
        traits: [createTrait("work_trait", ["Work"]), createTrait("personal_trait", ["Personal"])],
        topics: [createTopic("work_topic", ["Work"]), createTopic("personal_topic", ["Personal"])],
        people: [createPerson("work_person", ["Work"]), createPerson("personal_person", ["Personal"])],
      });

      const filtered = filterByVisibility(humanEntity, persona);

      expect(filtered.facts).toHaveLength(1);
      expect(filtered.traits).toHaveLength(1);
      expect(filtered.topics).toHaveLength(1);
      expect(filtered.people).toHaveLength(1);
      expect(filtered.facts[0].name).toBe("work_fact");
      expect(filtered.traits[0].name).toBe("work_trait");
      expect(filtered.topics[0].name).toBe("work_topic");
      expect(filtered.people[0].name).toBe("work_person");
    });
  });
});

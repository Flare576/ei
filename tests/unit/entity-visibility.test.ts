import { describe, it, expect } from "vitest";
import { getVisibleConcepts } from "../../src/prompts.js";
import { GLOBAL_GROUP } from "../../src/concept-reconciliation.js";
import type { ConceptMap, Concept } from "../../src/types.js";

const createConcept = (
  name: string,
  persona_groups: string[] = []
): Concept => ({
  name,
  description: `Description for ${name}`,
  level_current: 0.5,
  level_ideal: 0.5,
  sentiment: 0.0,
  type: "topic",
  persona_groups,
});

const createPersonaMap = (overrides: Partial<ConceptMap> = {}): ConceptMap => ({
  entity: "system",
  last_updated: null,
  concepts: [],
  ...overrides,
});

describe("getVisibleConcepts", () => {
  describe("wildcard visibility (groups_visible: ['*'])", () => {
    it("sees ALL concepts regardless of persona_groups", () => {
      const persona = createPersonaMap({ groups_visible: ["*"] });
      const concepts = [
        createConcept("Global", [GLOBAL_GROUP]),
        createConcept("Work Only", ["Work"]),
        createConcept("Personal Only", ["Personal"]),
        createConcept("Multi-Group", ["Work", "Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(4);
      expect(visible.map(c => c.name)).toEqual([
        "Global",
        "Work Only",
        "Personal Only",
        "Multi-Group",
      ]);
    });
  });

  describe("primary group visibility", () => {
    it("sees concepts in primary group", () => {
      const persona = createPersonaMap({ group_primary: "Work" });
      const concepts = [
        createConcept("Work Project", ["Work"]),
        createConcept("Personal Hobby", ["Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Work Project");
    });

    it("sees global concepts (persona_groups: ['*'])", () => {
      const persona = createPersonaMap({ group_primary: "Work" });
      const concepts = [
        createConcept("Global Interest", [GLOBAL_GROUP]),
        createConcept("Personal Secret", ["Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Global Interest");
    });

    it("does NOT see concepts from other groups", () => {
      const persona = createPersonaMap({ group_primary: "Work" });
      const concepts = [
        createConcept("Personal Secret", ["Personal"]),
        createConcept("Family Matter", ["Family"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(0);
    });
  });

  describe("additional groups_visible", () => {
    it("sees concepts from primary AND additional visible groups", () => {
      const persona = createPersonaMap({
        group_primary: "Work",
        groups_visible: ["Personal"],
      });
      const concepts = [
        createConcept("Work Project", ["Work"]),
        createConcept("Personal Hobby", ["Personal"]),
        createConcept("Family Matter", ["Family"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(2);
      expect(visible.map(c => c.name).sort()).toEqual([
        "Personal Hobby",
        "Work Project",
      ]);
    });

    it("works with multiple additional groups", () => {
      const persona = createPersonaMap({
        group_primary: "Work",
        groups_visible: ["Personal", "Family"],
      });
      const concepts = [
        createConcept("Work Project", ["Work"]),
        createConcept("Personal Hobby", ["Personal"]),
        createConcept("Family Matter", ["Family"]),
        createConcept("Secret", ["Hidden"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(3);
      expect(visible.find(c => c.name === "Secret")).toBeUndefined();
    });
  });

  describe("no groups configured", () => {
    it("sees only global concepts when no group_primary and no groups_visible", () => {
      const persona = createPersonaMap({
        group_primary: null,
        groups_visible: [],
      });
      const concepts = [
        createConcept("Global Topic", [GLOBAL_GROUP]),
        createConcept("Work Concept", ["Work"]),
        createConcept("Personal Concept", ["Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Global Topic");
    });

    it("sees only global concepts when groups fields are undefined", () => {
      const persona = createPersonaMap({});
      const concepts = [
        createConcept("Global", [GLOBAL_GROUP]),
        createConcept("Work", ["Work"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Global");
    });
  });

  describe("multi-group concepts", () => {
    it("shows concept if ANY group matches", () => {
      const persona = createPersonaMap({ group_primary: "Work" });
      const concepts = [
        createConcept("Work-Personal Overlap", ["Work", "Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Work-Personal Overlap");
    });

    it("shows concept if ANY visible group matches", () => {
      const persona = createPersonaMap({
        group_primary: "Health",
        groups_visible: ["Personal"],
      });
      const concepts = [
        createConcept("Personal-Work Overlap", ["Personal", "Work"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
    });
  });

  describe("edge cases", () => {
    it("handles empty concept list", () => {
      const persona = createPersonaMap({ group_primary: "Work" });

      const visible = getVisibleConcepts(persona, []);

      expect(visible).toHaveLength(0);
    });

    it("handles concepts with undefined persona_groups as non-global (legacy)", () => {
      const persona = createPersonaMap({ group_primary: "Work" });
      const conceptWithUndefinedGroups: Concept = {
        name: "Legacy Concept",
        description: "From before persona_groups existed",
        level_current: 0.5,
        level_ideal: 0.5,
        sentiment: 0.0,
        type: "topic",
      };

      const visible = getVisibleConcepts(persona, [conceptWithUndefinedGroups]);

      // undefined/empty is NOT global - global requires explicit ["*"]
      expect(visible).toHaveLength(0);
    });

    it("groups_visible without group_primary still works", () => {
      const persona = createPersonaMap({
        group_primary: null,
        groups_visible: ["Work"],
      });
      const concepts = [
        createConcept("Work Item", ["Work"]),
        createConcept("Personal Item", ["Personal"]),
      ];

      const visible = getVisibleConcepts(persona, concepts);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("Work Item");
    });
  });
});

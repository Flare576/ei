import { describe, it, expect, beforeEach, vi } from "vitest";
import { reconcileConceptGroups, GLOBAL_GROUP } from "../../src/concept-reconciliation.js";
import type { Concept, ConceptMap } from "../../src/types.js";

const createConcept = (
  name: string,
  overrides: Partial<Concept> = {}
): Concept => ({
  name,
  description: `Description for ${name}`,
  level_current: 0.5,
  level_ideal: 0.5,
  sentiment: 0.0,
  type: "topic",
  ...overrides,
});

const createPersonaMap = (overrides: Partial<ConceptMap> = {}): ConceptMap => ({
  entity: "system",
  last_updated: null,
  concepts: [],
  aliases: ["test-persona"],
  ...overrides,
});

describe("reconcileConceptGroups", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T12:00:00.000Z"));
  });

  describe("new concepts", () => {
    it("assigns persona_groups from persona group_primary for new concepts", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [createConcept("Work Project")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(1);
      expect(result[0].persona_groups).toEqual(["Work"]);
      expect(result[0].learned_by).toBe("test-persona");
      expect(result[0].last_updated).toBe("2025-01-15T12:00:00.000Z");
    });

    it("assigns global marker when persona has no group_primary", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [createConcept("Global Interest")];
      const persona = createPersonaMap({ group_primary: null });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(1);
      expect(result[0].persona_groups).toEqual([GLOBAL_GROUP]);
      expect(result[0].learned_by).toBe("test-persona");
    });

    it("assigns global marker when persona has undefined group_primary", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [createConcept("Global Interest")];
      const persona = createPersonaMap({});

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(1);
      expect(result[0].persona_groups).toEqual([GLOBAL_GROUP]);
    });

    it("preserves LLM-provided content fields for new concepts", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [
        createConcept("Project", {
          description: "LLM description",
          level_current: 0.8,
          level_ideal: 0.9,
          sentiment: 0.7,
        }),
      ];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].description).toBe("LLM description");
      expect(result[0].level_current).toBe(0.8);
      expect(result[0].level_ideal).toBe(0.9);
      expect(result[0].sentiment).toBe(0.7);
    });
  });

  describe("existing concepts", () => {
    it("preserves existing persona_groups and adds current persona group", () => {
      const existingConcepts: Concept[] = [
        createConcept("Shared Topic", { persona_groups: ["Work"] }),
      ];
      const llmConcepts: Concept[] = [
        createConcept("Shared Topic", { level_current: 0.9 }),
      ];
      const persona = createPersonaMap({ group_primary: "Personal" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(1);
      expect(result[0].persona_groups).toContain("Work");
      expect(result[0].persona_groups).toContain("Personal");
      expect(result[0].persona_groups).toHaveLength(2);
    });

    it("does not duplicate group when persona group already present", () => {
      const existingConcepts: Concept[] = [
        createConcept("Work Topic", { persona_groups: ["Work"] }),
      ];
      const llmConcepts: Concept[] = [createConcept("Work Topic")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].persona_groups).toEqual(["Work"]);
    });

    it("does not add group to global concepts", () => {
      const existingConcepts: Concept[] = [
        createConcept("Global Topic", { persona_groups: [GLOBAL_GROUP] }),
      ];
      const llmConcepts: Concept[] = [createConcept("Global Topic")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].persona_groups).toEqual([GLOBAL_GROUP]);
    });

    it("does not set learned_by for existing concepts", () => {
      const existingConcepts: Concept[] = [
        createConcept("Existing", { learned_by: "original-creator" }),
      ];
      const llmConcepts: Concept[] = [createConcept("Existing")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].learned_by).toBeUndefined();
    });

    it("updates last_updated for existing concepts", () => {
      const existingConcepts: Concept[] = [
        createConcept("Existing", { last_updated: "2020-01-01T00:00:00.000Z" }),
      ];
      const llmConcepts: Concept[] = [createConcept("Existing")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].last_updated).toBe("2025-01-15T12:00:00.000Z");
    });

    it("preserves LLM updates to content fields", () => {
      const existingConcepts: Concept[] = [
        createConcept("Topic", {
          description: "Old description",
          level_current: 0.3,
          sentiment: -0.5,
        }),
      ];
      const llmConcepts: Concept[] = [
        createConcept("Topic", {
          description: "Updated description",
          level_current: 0.7,
          sentiment: 0.2,
        }),
      ];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].description).toBe("Updated description");
      expect(result[0].level_current).toBe(0.7);
      expect(result[0].sentiment).toBe(0.2);
    });

    it("handles existing concept with no persona_groups", () => {
      const existingConcepts: Concept[] = [
        createConcept("Legacy Concept"),
      ];
      const llmConcepts: Concept[] = [createConcept("Legacy Concept")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].persona_groups).toEqual(["Work"]);
    });

    it("handles existing concept with undefined persona_groups", () => {
      const existingConcepts: Concept[] = [
        { ...createConcept("Legacy"), persona_groups: undefined },
      ];
      const llmConcepts: Concept[] = [createConcept("Legacy")];
      const persona = createPersonaMap({ group_primary: "Personal" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].persona_groups).toEqual(["Personal"]);
    });
  });

  describe("removed concepts", () => {
    it("does not include concepts removed by LLM", () => {
      const existingConcepts: Concept[] = [
        createConcept("Keep Me", { persona_groups: ["Work"] }),
        createConcept("Remove Me", { persona_groups: ["Work"] }),
      ];
      const llmConcepts: Concept[] = [createConcept("Keep Me")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Keep Me");
    });
  });

  describe("mixed scenarios", () => {
    it("handles mix of new, updated, and removed concepts", () => {
      const existingConcepts: Concept[] = [
        createConcept("Existing Work", { persona_groups: ["Work"] }),
        createConcept("To Remove", { persona_groups: ["Personal"] }),
      ];
      const llmConcepts: Concept[] = [
        createConcept("Existing Work", { level_current: 0.9 }),
        createConcept("Brand New"),
      ];
      const persona = createPersonaMap({ group_primary: "Personal" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(2);

      const existingUpdated = result.find((c) => c.name === "Existing Work");
      expect(existingUpdated?.persona_groups).toContain("Work");
      expect(existingUpdated?.persona_groups).toContain("Personal");
      expect(existingUpdated?.level_current).toBe(0.9);
      expect(existingUpdated?.learned_by).toBeUndefined();

      const brandNew = result.find((c) => c.name === "Brand New");
      expect(brandNew?.persona_groups).toEqual(["Personal"]);
      expect(brandNew?.learned_by).toBe("test-persona");

      const removed = result.find((c) => c.name === "To Remove");
      expect(removed).toBeUndefined();
    });

    it("accumulates groups across multiple reconciliations", () => {
      const concept = createConcept("Multi-Group Topic", {
        persona_groups: ["Work", "Personal"],
      });
      const existingConcepts: Concept[] = [concept];
      const llmConcepts: Concept[] = [createConcept("Multi-Group Topic")];
      const persona = createPersonaMap({ group_primary: "Health" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result[0].persona_groups).toContain("Work");
      expect(result[0].persona_groups).toContain("Personal");
      expect(result[0].persona_groups).toContain("Health");
      expect(result[0].persona_groups).toHaveLength(3);
    });
  });

  describe("edge cases", () => {
    it("handles empty LLM response", () => {
      const existingConcepts: Concept[] = [createConcept("Existing")];
      const llmConcepts: Concept[] = [];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(0);
    });

    it("handles empty existing concepts", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [
        createConcept("New1"),
        createConcept("New2"),
      ];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "test-persona");

      expect(result).toHaveLength(2);
      expect(result.every((c) => c.persona_groups?.includes("Work"))).toBe(true);
      expect(result.every((c) => c.learned_by === "test-persona")).toBe(true);
    });

    it("uses provided personaName as learned_by", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [createConcept("New")];
      const persona = createPersonaMap({ group_primary: "Work" });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "frodo");

      expect(result[0].learned_by).toBe("frodo");
    });

    it("uses provided personaName regardless of aliases", () => {
      const existingConcepts: Concept[] = [];
      const llmConcepts: Concept[] = [createConcept("New")];
      const persona = createPersonaMap({
        aliases: ["primary-name", "secondary-name"],
        group_primary: "Work",
      });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, persona, "gandalf");

      expect(result[0].learned_by).toBe("gandalf");
    });

    it("global persona (no group_primary) does not promote group-tagged concepts to global", () => {
      const existingConcepts: Concept[] = [
        createConcept("The One Ring", { persona_groups: ["Fellowship"] }),
      ];
      const llmConcepts: Concept[] = [
        createConcept("The One Ring", { description: "A ring of power, made of gold with elvish script" }),
      ];
      const eiPersona = createPersonaMap({ group_primary: null });

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, eiPersona, "ei");

      expect(result[0].persona_groups).toEqual(["Fellowship"]);
      expect(result[0].persona_groups).not.toContain(GLOBAL_GROUP);
    });

    it("global persona (undefined group_primary) does not promote group-tagged concepts to global", () => {
      const existingConcepts: Concept[] = [
        createConcept("Mithril", { persona_groups: ["Dwarves", "Elves"] }),
      ];
      const llmConcepts: Concept[] = [
        createConcept("Mithril", { description: "A precious metal" }),
      ];
      const eiPersona = createPersonaMap({});

      const result = reconcileConceptGroups(existingConcepts, llmConcepts, eiPersona, "ei");

      expect(result[0].persona_groups).toEqual(["Dwarves", "Elves"]);
      expect(result[0].persona_groups).not.toContain(GLOBAL_GROUP);
    });
  });
});

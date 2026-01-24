import { describe, it, expect } from "vitest";
import { getVisiblePersonas } from "../../src/prompts/index.js";
import type { PersonaEntity } from "../../src/types.js";

const createPersonaEntity = (overrides: Partial<PersonaEntity> = {}): PersonaEntity => ({
  entity: "system",
  last_updated: null,
  traits: [],
  topics: [],
  ...overrides,
});

const getVisibleNames = (visible: Array<{ name: string }>) => visible.map(p => p.name);

describe("getVisiblePersonas", () => {
  describe("ei persona (sees all)", () => {
    it("sees all other personas regardless of groups", () => {
      const eiMap = createPersonaEntity({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", entity: eiMap },
        { name: "gandalf", entity: createPersonaEntity({ group_primary: "Work" }) },
        { name: "frodo", entity: createPersonaEntity({ group_primary: "Personal" }) },
        { name: "aragorn", entity: createPersonaEntity({}) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);
      const names = getVisibleNames(visible);

      expect(visible).toHaveLength(3);
      expect(names).toContain("gandalf");
      expect(names).toContain("frodo");
      expect(names).toContain("aragorn");
    });

    it("does not include itself", () => {
      const eiMap = createPersonaEntity({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", entity: eiMap },
        { name: "gandalf", entity: createPersonaEntity({ group_primary: "Work" }) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);
      const names = getVisibleNames(visible);

      expect(names).not.toContain("ei");
    });
  });

  describe("same group personas see each other", () => {
    it("personas with same primary group see each other", () => {
      const gandalfMap = createPersonaEntity({ group_primary: "Fellowship" });
      const frodoMap = createPersonaEntity({ group_primary: "Fellowship" });
      const sauronMap = createPersonaEntity({ group_primary: "Mordor" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "gandalf", entity: gandalfMap },
        { name: "frodo", entity: frodoMap },
        { name: "sauron", entity: sauronMap },
      ];

      const gandalfVisible = getVisiblePersonas("gandalf", gandalfMap, allPersonas);
      const names = getVisibleNames(gandalfVisible);

      expect(names).toContain("frodo");
      expect(names).not.toContain("sauron");
      expect(names).not.toContain("ei");
    });
  });

  describe("different groups don't see each other", () => {
    it("personas in different primary groups are not visible", () => {
      const workMap = createPersonaEntity({ group_primary: "Work" });
      const personalMap = createPersonaEntity({ group_primary: "Personal" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "work-persona", entity: workMap },
        { name: "personal-persona", entity: personalMap },
      ];

      const workVisible = getVisiblePersonas("work-persona", workMap, allPersonas);
      const names = getVisibleNames(workVisible);

      expect(names).not.toContain("personal-persona");
    });
  });

  describe("one-way visibility via groups_visible", () => {
    it("persona with groups_visible sees personas in those groups", () => {
      const observerMap = createPersonaEntity({
        group_primary: "Observer",
        groups_visible: ["Work"],
      });
      const workerMap = createPersonaEntity({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "observer", entity: observerMap },
        { name: "worker", entity: workerMap },
      ];

      const observerVisible = getVisiblePersonas("observer", observerMap, allPersonas);
      const workerVisible = getVisiblePersonas("worker", workerMap, allPersonas);

      expect(getVisibleNames(observerVisible)).toContain("worker");
      expect(getVisibleNames(workerVisible)).not.toContain("observer");
    });

    it("visibility is not automatically symmetric", () => {
      const aMap = createPersonaEntity({
        group_primary: "GroupA",
        groups_visible: ["GroupB"],
      });
      const bMap = createPersonaEntity({ group_primary: "GroupB" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "a", entity: aMap },
        { name: "b", entity: bMap },
      ];

      const aVisible = getVisiblePersonas("a", aMap, allPersonas);
      const bVisible = getVisiblePersonas("b", bMap, allPersonas);

      expect(getVisibleNames(aVisible)).toContain("b");
      expect(getVisibleNames(bVisible)).not.toContain("a");
    });
  });

  describe("no groups = see no other personas", () => {
    it("persona with no group_primary and no groups_visible sees no one", () => {
      const lonelyMap = createPersonaEntity({
        group_primary: null,
        groups_visible: [],
      });
      const otherMap = createPersonaEntity({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "lonely", entity: lonelyMap },
        { name: "other", entity: otherMap },
      ];

      const lonelyVisible = getVisiblePersonas("lonely", lonelyMap, allPersonas);

      expect(lonelyVisible).toHaveLength(0);
    });

    it("persona with undefined group fields sees no one", () => {
      const undefinedMap = createPersonaEntity({});
      const otherMap = createPersonaEntity({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "undefined-groups", entity: undefinedMap },
        { name: "other", entity: otherMap },
      ];

      const visible = getVisiblePersonas("undefined-groups", undefinedMap, allPersonas);

      expect(visible).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty persona list", () => {
      const personaMap = createPersonaEntity({ group_primary: "Work" });

      const visible = getVisiblePersonas("test", personaMap, []);

      expect(visible).toHaveLength(0);
    });

    it("persona does not see itself", () => {
      const selfMap = createPersonaEntity({ group_primary: "Work" });
      const allPersonas = [
        { name: "self", entity: selfMap },
      ];

      const visible = getVisiblePersonas("self", selfMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("self");
      expect(visible).toHaveLength(0);
    });

    it("non-ei personas never see ei in results", () => {
      const regularMap = createPersonaEntity({ group_primary: "Work" });
      const eiMap = createPersonaEntity({ group_primary: null, groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", entity: eiMap },
        { name: "regular", entity: regularMap },
      ];

      const visible = getVisiblePersonas("regular", regularMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("ei");
    });

    it("only sees personas whose group_primary matches, not those with matching groups_visible", () => {
      const observerMap = createPersonaEntity({
        group_primary: "Work",
        groups_visible: [],
      });
      const otherObserverMap = createPersonaEntity({
        group_primary: "Personal",
        groups_visible: ["Work"],
      });
      const allPersonas = [
        { name: "ei", entity: createPersonaEntity({ groups_visible: ["*"] }) },
        { name: "observer", entity: observerMap },
        { name: "other-observer", entity: otherObserverMap },
      ];

      const visible = getVisiblePersonas("observer", observerMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("other-observer");
    });
  });

  describe("short_description inclusion", () => {
    it("includes short_description when available", () => {
      const eiMap = createPersonaEntity({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", entity: eiMap },
        { name: "gandalf", entity: createPersonaEntity({ 
          group_primary: "Work",
          short_description: "A wise wizard"
        }) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("gandalf");
      expect(visible[0].short_description).toBe("A wise wizard");
    });

    it("handles missing short_description", () => {
      const eiMap = createPersonaEntity({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", entity: eiMap },
        { name: "frodo", entity: createPersonaEntity({ group_primary: "Work" }) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("frodo");
      expect(visible[0].short_description).toBeUndefined();
    });
  });
});

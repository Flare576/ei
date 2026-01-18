import { describe, it, expect } from "vitest";
import { getVisiblePersonas } from "../../src/prompts.js";
import type { ConceptMap } from "../../src/types.js";

const createPersonaMap = (overrides: Partial<ConceptMap> = {}): ConceptMap => ({
  entity: "system",
  last_updated: null,
  concepts: [],
  ...overrides,
});

const getVisibleNames = (visible: Array<{ name: string }>) => visible.map(p => p.name);

describe("getVisiblePersonas", () => {
  describe("ei persona (sees all)", () => {
    it("sees all other personas regardless of groups", () => {
      const eiMap = createPersonaMap({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", conceptMap: eiMap },
        { name: "gandalf", conceptMap: createPersonaMap({ group_primary: "Work" }) },
        { name: "frodo", conceptMap: createPersonaMap({ group_primary: "Personal" }) },
        { name: "aragorn", conceptMap: createPersonaMap({}) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);
      const names = getVisibleNames(visible);

      expect(visible).toHaveLength(3);
      expect(names).toContain("gandalf");
      expect(names).toContain("frodo");
      expect(names).toContain("aragorn");
    });

    it("does not include itself", () => {
      const eiMap = createPersonaMap({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", conceptMap: eiMap },
        { name: "gandalf", conceptMap: createPersonaMap({ group_primary: "Work" }) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);
      const names = getVisibleNames(visible);

      expect(names).not.toContain("ei");
    });
  });

  describe("same group personas see each other", () => {
    it("personas with same primary group see each other", () => {
      const gandalfMap = createPersonaMap({ group_primary: "Fellowship" });
      const frodoMap = createPersonaMap({ group_primary: "Fellowship" });
      const sauronMap = createPersonaMap({ group_primary: "Mordor" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "gandalf", conceptMap: gandalfMap },
        { name: "frodo", conceptMap: frodoMap },
        { name: "sauron", conceptMap: sauronMap },
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
      const workMap = createPersonaMap({ group_primary: "Work" });
      const personalMap = createPersonaMap({ group_primary: "Personal" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "work-persona", conceptMap: workMap },
        { name: "personal-persona", conceptMap: personalMap },
      ];

      const workVisible = getVisiblePersonas("work-persona", workMap, allPersonas);
      const names = getVisibleNames(workVisible);

      expect(names).not.toContain("personal-persona");
    });
  });

  describe("one-way visibility via groups_visible", () => {
    it("persona with groups_visible sees personas in those groups", () => {
      const observerMap = createPersonaMap({
        group_primary: "Observer",
        groups_visible: ["Work"],
      });
      const workerMap = createPersonaMap({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "observer", conceptMap: observerMap },
        { name: "worker", conceptMap: workerMap },
      ];

      const observerVisible = getVisiblePersonas("observer", observerMap, allPersonas);
      const workerVisible = getVisiblePersonas("worker", workerMap, allPersonas);

      expect(getVisibleNames(observerVisible)).toContain("worker");
      expect(getVisibleNames(workerVisible)).not.toContain("observer");
    });

    it("visibility is not automatically symmetric", () => {
      const aMap = createPersonaMap({
        group_primary: "GroupA",
        groups_visible: ["GroupB"],
      });
      const bMap = createPersonaMap({ group_primary: "GroupB" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "a", conceptMap: aMap },
        { name: "b", conceptMap: bMap },
      ];

      const aVisible = getVisiblePersonas("a", aMap, allPersonas);
      const bVisible = getVisiblePersonas("b", bMap, allPersonas);

      expect(getVisibleNames(aVisible)).toContain("b");
      expect(getVisibleNames(bVisible)).not.toContain("a");
    });
  });

  describe("no groups = see no other personas", () => {
    it("persona with no group_primary and no groups_visible sees no one", () => {
      const lonelyMap = createPersonaMap({
        group_primary: null,
        groups_visible: [],
      });
      const otherMap = createPersonaMap({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "lonely", conceptMap: lonelyMap },
        { name: "other", conceptMap: otherMap },
      ];

      const lonelyVisible = getVisiblePersonas("lonely", lonelyMap, allPersonas);

      expect(lonelyVisible).toHaveLength(0);
    });

    it("persona with undefined group fields sees no one", () => {
      const undefinedMap = createPersonaMap({});
      const otherMap = createPersonaMap({ group_primary: "Work" });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "undefined-groups", conceptMap: undefinedMap },
        { name: "other", conceptMap: otherMap },
      ];

      const visible = getVisiblePersonas("undefined-groups", undefinedMap, allPersonas);

      expect(visible).toHaveLength(0);
    });
  });

  describe("edge cases", () => {
    it("handles empty persona list", () => {
      const personaMap = createPersonaMap({ group_primary: "Work" });

      const visible = getVisiblePersonas("test", personaMap, []);

      expect(visible).toHaveLength(0);
    });

    it("persona does not see itself", () => {
      const selfMap = createPersonaMap({ group_primary: "Work" });
      const allPersonas = [
        { name: "self", conceptMap: selfMap },
      ];

      const visible = getVisiblePersonas("self", selfMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("self");
      expect(visible).toHaveLength(0);
    });

    it("non-ei personas never see ei in results", () => {
      const regularMap = createPersonaMap({ group_primary: "Work" });
      const eiMap = createPersonaMap({ group_primary: null, groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", conceptMap: eiMap },
        { name: "regular", conceptMap: regularMap },
      ];

      const visible = getVisiblePersonas("regular", regularMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("ei");
    });

    it("only sees personas whose group_primary matches, not those with matching groups_visible", () => {
      const observerMap = createPersonaMap({
        group_primary: "Work",
        groups_visible: [],
      });
      const otherObserverMap = createPersonaMap({
        group_primary: "Personal",
        groups_visible: ["Work"],
      });
      const allPersonas = [
        { name: "ei", conceptMap: createPersonaMap({ groups_visible: ["*"] }) },
        { name: "observer", conceptMap: observerMap },
        { name: "other-observer", conceptMap: otherObserverMap },
      ];

      const visible = getVisiblePersonas("observer", observerMap, allPersonas);

      expect(getVisibleNames(visible)).not.toContain("other-observer");
    });
  });

  describe("short_description inclusion", () => {
    it("includes short_description when available", () => {
      const eiMap = createPersonaMap({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", conceptMap: eiMap },
        { name: "gandalf", conceptMap: createPersonaMap({ 
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
      const eiMap = createPersonaMap({ groups_visible: ["*"] });
      const allPersonas = [
        { name: "ei", conceptMap: eiMap },
        { name: "frodo", conceptMap: createPersonaMap({ group_primary: "Work" }) },
      ];

      const visible = getVisiblePersonas("ei", eiMap, allPersonas);

      expect(visible).toHaveLength(1);
      expect(visible[0].name).toBe("frodo");
      expect(visible[0].short_description).toBeUndefined();
    });
  });
});

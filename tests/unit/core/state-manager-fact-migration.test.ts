import { describe, it, expect, beforeEach } from "vitest";
import { StateManager } from "../../../src/core/state-manager.js";
import { BUILT_IN_FACT_NAMES } from "../../../src/core/constants/built-in-facts.js";
import { createMockStorage, createDefaultTestState } from "../../helpers/mock-storage.js";
import type { Fact, Topic } from "../../../src/core/types.js";

/**
 * Tests for StateManager.migrateFactValidation()
 * The private method is exercised through initialize() when loading state
 * that contains facts with the old 'validated' field.
 *
 * Detection logic: runs only if ANY fact has a 'validated' property.
 * BUILT_IN_FACT_NAMES facts → strip 'validated', preserve description.
 * Non-matching facts → move to Topics with category="Fact".
 * Idempotent: no 'validated' field → immediate return.
 */
describe("StateManager.migrateFactValidation()", () => {
  let sm: StateManager;

  // Helper: build a Fact with the old 'validated' field present
  function makeOldFact(id: string, name: string, description = "", extra?: Partial<Fact & { validated: string }>): Fact & { validated: string } {
    return {
      id,
      name,
      description,
      sentiment: 0,
      validated_date: "",
      last_updated: "",
      validated: "none",
      ...extra,
    } as Fact & { validated: string };
  }

  // Helper: build a Fact WITHOUT the old 'validated' field (already migrated)
  function makeNewFact(id: string, name: string, description = ""): Fact {
    return {
      id,
      name,
      description,
      sentiment: 0,
      validated_date: "",
      last_updated: "",
    };
  }

  beforeEach(async () => {
    sm = new StateManager();
  });

  it("scenario 1: fresh state (no facts at all) — migration is a no-op", async () => {
    const state = createDefaultTestState();
    state.human.facts = [];

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    expect(sm.getHuman().facts).toHaveLength(0);
    expect(sm.getHuman().topics).toHaveLength(0);
  });

  it("scenario 2: all matching built-in facts — strip 'validated', stay as facts", async () => {
    const factName = "Full Name"; // a known built-in
    expect(BUILT_IN_FACT_NAMES.has(factName)).toBe(true);

    const state = createDefaultTestState();
    state.human.facts = [makeOldFact("f1", factName, "Jeremy Scherer")] as any;

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    // Fact stays as a fact, not moved to Topics
    expect(human.facts).toHaveLength(1);
    expect(human.facts[0].name).toBe(factName);
    expect(human.facts[0].description).toBe("Jeremy Scherer");
    // 'validated' field stripped
    expect((human.facts[0] as any).validated).toBeUndefined();
    // No topics created
    expect(human.topics.filter(t => t.category === "Fact")).toHaveLength(0);
  });

  it("scenario 3: all non-matching facts — move to Topics with category='Fact'", async () => {
    const customFactName = "Custom Biographical Detail"; // definitely NOT in BUILT_IN_FACT_NAMES
    expect(BUILT_IN_FACT_NAMES.has(customFactName)).toBe(false);

    const state = createDefaultTestState();
    state.human.facts = [
      makeOldFact("f1", customFactName, "some value"),
      makeOldFact("f2", "Another Custom Fact", "another value"),
    ] as any;

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    // Facts removed from facts array
    expect(human.facts).toHaveLength(0);
    // Moved to Topics
    const movedTopics = human.topics.filter(t => t.category === "Fact");
    expect(movedTopics).toHaveLength(2);
    expect(movedTopics.map(t => t.name)).toContain(customFactName);
    expect(movedTopics.map(t => t.name)).toContain("Another Custom Fact");
    // Topic preserves original description
    const moved = movedTopics.find(t => t.name === customFactName)!;
    expect(moved.description).toBe("some value");
    expect(moved.category).toBe("Fact");
  });

  it("scenario 4: mixed facts — matching stripped, non-matching moved to Topics", async () => {
    const builtInName = "Birthday"; // built-in
    const customName = "Favorite Pizza Topping"; // not built-in
    expect(BUILT_IN_FACT_NAMES.has(builtInName)).toBe(true);
    expect(BUILT_IN_FACT_NAMES.has(customName)).toBe(false);

    const state = createDefaultTestState();
    state.human.facts = [
      makeOldFact("f1", builtInName, "March 3rd"),
      makeOldFact("f2", customName, "Pepperoni"),
    ] as any;

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    // Only built-in fact stays as a fact
    expect(human.facts).toHaveLength(1);
    expect(human.facts[0].name).toBe(builtInName);
    expect(human.facts[0].description).toBe("March 3rd");
    expect((human.facts[0] as any).validated).toBeUndefined();

    // Custom fact moved to topics
    const movedTopics = human.topics.filter(t => t.category === "Fact");
    expect(movedTopics).toHaveLength(1);
    expect(movedTopics[0].name).toBe(customName);
    expect(movedTopics[0].description).toBe("Pepperoni");
  });

  it("scenario 5: idempotent — already-migrated facts (no 'validated' field) are unchanged", async () => {
    const state = createDefaultTestState();
    // Facts WITHOUT 'validated' field — already migrated format
    state.human.facts = [
      makeNewFact("f1", "Full Name", "Jeremy Scherer"),
      makeNewFact("f2", "Birthday", "March 3rd"),
    ];

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    // No facts moved, no topics created from this migration
    expect(human.facts).toHaveLength(2);
    expect(human.topics.filter(t => t.category === "Fact")).toHaveLength(0);
    // Descriptions preserved
    expect(human.facts.find(f => f.name === "Full Name")?.description).toBe("Jeremy Scherer");
  });

  it("scenario 6: non-matching fact embedding is preserved on the created Topic", async () => {
    const customName = "Custom Field";
    const fakeEmbedding = [0.1, 0.2, 0.3];

    const state = createDefaultTestState();
    state.human.facts = [
      { ...makeOldFact("f1", customName, "value"), embedding: fakeEmbedding },
    ] as any;

    const storage = createMockStorage();
    (storage.load as any).mockResolvedValue(state);
    await sm.initialize(storage);

    const human = sm.getHuman();
    const movedTopic = human.topics.find(t => t.name === customName)!;
    expect(movedTopic).toBeDefined();
    expect(movedTopic.embedding).toEqual(fakeEmbedding);
  });
});

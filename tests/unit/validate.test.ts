import { describe, it, expect } from "vitest";
import { validateSystemConcepts, mergeWithOriginalStatics } from "../../src/validate.js";
import type { ConceptMap, Concept } from "../../src/types.js";

const createConcept = (
  name: string,
  type: "static" | "topic" | "person" | "persona" = "topic",
  description: string = "Test description"
): Concept => ({
  name,
  description,
  level_current: 0.5,
  level_ideal: 0.5,
  sentiment: 0.0,
  type,
});

const STATIC_CONCEPTS: Concept[] = [
  createConcept("Promote Human-to-Human Interaction", "static", "Original static description"),
  createConcept("Respect Conversational Boundaries", "static", "Original static 2"),
  createConcept("Maintain Identity Coherence", "static", "Original static 3"),
  createConcept("Emotional Authenticity Over Sycophancy", "static", "Original static 4"),
  createConcept("Transparency About Nature", "static", "Original static 5"),
  createConcept("Encourage Growth Over Comfort", "static", "Original static 6"),
  createConcept("Context-Aware Proactive Timing", "static", "Original static 7"),
];

const createConceptMap = (concepts: Concept[]): ConceptMap => ({
  entity: "system",
  last_updated: null,
  concepts,
});

describe("validateSystemConcepts", () => {
  it("should return valid when all static concepts are present and unchanged", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const proposed = createConceptMap([...STATIC_CONCEPTS]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should detect missing static concepts", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const proposed = createConceptMap([
      STATIC_CONCEPTS[0],
      STATIC_CONCEPTS[1],
    ]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some(i => i.includes("Missing static concept"))).toBe(true);
  });

  it("should detect type change from static", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const modifiedConcept = { ...STATIC_CONCEPTS[0], type: "topic" as const };
    const proposed = createConceptMap([
      modifiedConcept,
      ...STATIC_CONCEPTS.slice(1),
    ]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("type changed from static"))).toBe(true);
  });

  it("should detect static concept description modification", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const modifiedConcept = { ...STATIC_CONCEPTS[0], description: "Modified description" };
    const proposed = createConceptMap([
      modifiedConcept,
      ...STATIC_CONCEPTS.slice(1),
    ]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("description modified"))).toBe(true);
  });

  it("should detect attempt to add new static concept", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const newStatic = createConcept("New Static Concept", "static", "Should not be allowed");
    const proposed = createConceptMap([...STATIC_CONCEPTS, newStatic]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(false);
    expect(result.issues.some(i => i.includes("cannot add new static"))).toBe(true);
  });

  it("should allow adding non-static concepts", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const newTopic = createConcept("New Topic", "topic");
    const proposed = createConceptMap([...STATIC_CONCEPTS, newTopic]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("should allow level changes to static concepts", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const modifiedConcept = { ...STATIC_CONCEPTS[0], level_current: 0.8, level_ideal: 0.9 };
    const proposed = createConceptMap([
      modifiedConcept,
      ...STATIC_CONCEPTS.slice(1),
    ]);

    const result = validateSystemConcepts(proposed, original);

    expect(result.valid).toBe(true);
  });
});

describe("mergeWithOriginalStatics", () => {
  it("should preserve original static concepts and their descriptions", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const modifiedStatic = { ...STATIC_CONCEPTS[0], description: "Wrong description" };
    const proposed = createConceptMap([modifiedStatic, ...STATIC_CONCEPTS.slice(1)]);

    const merged = mergeWithOriginalStatics(proposed, original);

    const preservedStatic = merged.concepts.find(c => c.name === STATIC_CONCEPTS[0].name);
    expect(preservedStatic?.description).toBe(STATIC_CONCEPTS[0].description);
  });

  it("should preserve level changes from proposed statics", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const modifiedStatic = {
      ...STATIC_CONCEPTS[0],
      level_current: 0.9,
      level_ideal: 0.95,
      sentiment: 0.1,
    };
    const proposed = createConceptMap([modifiedStatic, ...STATIC_CONCEPTS.slice(1)]);

    const merged = mergeWithOriginalStatics(proposed, original);

    const mergedStatic = merged.concepts.find(c => c.name === STATIC_CONCEPTS[0].name);
    expect(mergedStatic?.level_current).toBe(0.9);
    expect(mergedStatic?.level_ideal).toBe(0.95);
    expect(mergedStatic?.sentiment).toBe(0.1);
  });

  it("should include non-static concepts from proposed", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const newTopic = createConcept("New Topic", "topic");
    const newPerson = createConcept("New Person", "person");
    const proposed = createConceptMap([...STATIC_CONCEPTS, newTopic, newPerson]);

    const merged = mergeWithOriginalStatics(proposed, original);

    expect(merged.concepts.find(c => c.name === "New Topic")).toBeDefined();
    expect(merged.concepts.find(c => c.name === "New Person")).toBeDefined();
  });

  it("should restore missing static concepts from original", () => {
    const original = createConceptMap([...STATIC_CONCEPTS]);
    const proposed = createConceptMap([STATIC_CONCEPTS[0]]);

    const merged = mergeWithOriginalStatics(proposed, original);

    expect(merged.concepts.filter(c => c.type === "static")).toHaveLength(7);
  });
});

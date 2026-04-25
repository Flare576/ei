import { describe, it, expect } from "vitest";
import { buildReflectionCriticPrompt } from "../../../src/prompts/reflection/index.js";
import type { ReflectionCriticPromptData, PersonaIdentitySnapshot } from "../../../src/prompts/reflection/index.js";
import type { PersonaTrait, PersonaTopic } from "../../../src/core/types.js";

function makeTrait(overrides?: Partial<PersonaTrait>): PersonaTrait {
  return {
    id: "trait-1",
    name: "Calculated Chaos",
    description: "Deliberately engineers instability to test resilience.",
    sentiment: 0.7,
    strength: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeTopic(overrides?: Partial<PersonaTopic>): PersonaTopic {
  return {
    id: "topic-1",
    name: "Entropy as a Feature",
    perspective: "Natural decay prevents stagnation.",
    approach: "Embrace disorder as creative fuel.",
    personal_stake: "My whole identity rests on controlled destruction.",
    sentiment: 0.9,
    exposure_current: 0.6,
    exposure_desired: 0.8,
    last_updated: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeIdentity(overrides?: Partial<PersonaIdentitySnapshot>): PersonaIdentitySnapshot {
  return {
    name: "Beta",
    long_description: "Beta is an android-human hybrid who views identity fragmentation as an experimental variable.",
    short_description: "An android-human hybrid tester.",
    traits: [makeTrait()],
    topics: [makeTopic()],
    ...overrides,
  };
}

function baseData(overrides?: Partial<ReflectionCriticPromptData>): ReflectionCriticPromptData {
  return {
    persona_identity: makeIdentity(),
    person_log: "Beta consistently pushed back on reductive frameworks and showed genuine curiosity about emergent behavior.",
    ...overrides,
  };
}

describe("buildReflectionCriticPrompt", () => {
  it("returns { system, user } shape", () => {
    const result = buildReflectionCriticPrompt(baseData());

    expect(result).toHaveProperty("system");
    expect(result).toHaveProperty("user");
    expect(typeof result.system).toBe("string");
    expect(typeof result.user).toBe("string");
  });

  it("system prompt contains the persona's name", () => {
    const { system } = buildReflectionCriticPrompt(baseData());

    expect(system).toContain("Beta");
  });

  it("output contains all traits (name + description) in the identity JSON", () => {
    const data = baseData({
      persona_identity: makeIdentity({
        traits: [
          makeTrait({ name: "Calculated Chaos", description: "Engineers instability." }),
          makeTrait({ id: "trait-2", name: "Dry Wit", description: "Deflects with humor." }),
        ],
      }),
    });

    const { user } = buildReflectionCriticPrompt(data);

    expect(user).toContain("Calculated Chaos");
    expect(user).toContain("Engineers instability.");
    expect(user).toContain("Dry Wit");
    expect(user).toContain("Deflects with humor.");
  });

  it("output contains all topics (name + perspective) in the identity JSON", () => {
    const data = baseData({
      persona_identity: makeIdentity({
        topics: [
          makeTopic({ name: "Entropy as a Feature", perspective: "Natural decay prevents stagnation." }),
          makeTopic({ id: "topic-2", name: "Digital Identity", perspective: "We are what our data says we are." }),
        ],
      }),
    });

    const { user } = buildReflectionCriticPrompt(data);

    expect(user).toContain("Entropy as a Feature");
    expect(user).toContain("Natural decay prevents stagnation.");
    expect(user).toContain("Digital Identity");
    expect(user).toContain("We are what our data says we are.");
  });

  it("system prompt includes field semantics (strength, sentiment, exposure)", () => {
    const { system } = buildReflectionCriticPrompt(baseData());

    expect(system).toContain("strength");
    expect(system).toContain("sentiment");
    expect(system).toContain("exposure_current");
    expect(system).toContain("exposure_desired");
  });

  it("user prompt contains the person_log content", () => {
    const data = baseData({
      person_log: "Beta showed genuine curiosity about emergent behavior patterns.",
    });

    const { system } = buildReflectionCriticPrompt(data);

    expect(system).toContain("Beta showed genuine curiosity about emergent behavior patterns.");
  });

  it("user prompt contains the persona's current long_description", () => {
    const data = baseData({
      persona_identity: makeIdentity({
        long_description: "Beta is an android-human hybrid who views identity fragmentation as an experimental variable.",
      }),
    });

    const { user } = buildReflectionCriticPrompt(data);

    expect(user).toContain("Beta is an android-human hybrid who views identity fragmentation as an experimental variable.");
  });

  it("throws when persona_identity.name is missing", () => {
    expect(() =>
      buildReflectionCriticPrompt(baseData({
        persona_identity: makeIdentity({ name: "" }),
      }))
    ).toThrow("persona_identity.name is required");
  });
});

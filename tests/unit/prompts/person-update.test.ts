import { describe, it, expect } from "vitest";
import { buildPersonUpdatePrompt } from "../../../src/prompts/human/person-update.js";
import type { PersonUpdatePromptData } from "../../../src/prompts/human/person-update.js";
import type { Person } from "../../../src/core/types.js";

function makeEiPersona(overrides?: Partial<Person>): Person {
  return {
    id: "person-1",
    name: "Beta",
    description: "An android-human hybrid tester.",
    relationship: "Ei Persona",
    sentiment: 1,
    exposure_current: 0.8,
    exposure_desired: 0.5,
    last_updated: "2026-01-01T00:00:00Z",
    identifiers: [
      { type: "Ei Persona", value: "21ccbf23-24e0-4f6b-8894-d8bccb8d26b5", is_primary: false },
      { type: "Nickname", value: "Beta", is_primary: true },
    ],
    ...overrides,
  };
}

function makeRegularPerson(overrides?: Partial<Person>): Person {
  return {
    id: "person-2",
    name: "Alice",
    description: "Best friend since college.",
    relationship: "Friend",
    sentiment: 0.9,
    exposure_current: 0.5,
    exposure_desired: 0.6,
    last_updated: "2026-01-01T00:00:00Z",
    identifiers: [],
    ...overrides,
  };
}

function baseData(person: Person | null, extra?: Partial<PersonUpdatePromptData>): PersonUpdatePromptData {
  return {
    existing_item: person,
    messages_context: [],
    messages_analyze: [
      { id: "m1", role: "human", content: "She pushed me to think differently.", timestamp: "2026-04-01T00:00:00Z", read: true, context_status: "default" as any },
    ],
    persona_name: "Sisyphus",
    ...extra,
  };
}

// Bolt 004 (D2, Spec §4.3): the Ei-Persona "living identity log" branch
// (add, never truncate) was removed as a prompt mode entirely. A
// Persona-linked Person record no longer reaches this prompt at all —
// `handleHumanPersonScan`'s branch point routes it into the
// Observation→Signal reducer pipeline instead. These tests now prove the
// removal: an existing_item carrying an `Ei Persona` identifier gets the
// exact same synthesis framing as any other existing record, never the
// deleted accumulate framing.
describe("buildPersonUpdatePrompt — Ei-Persona special-casing removed (D2, Bolt 004)", () => {
  it("uses the ordinary synthesis framing for an existing_item that happens to carry an Ei Persona identifier", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeEiPersona()));

    expect(system).toContain("Synthesize, don't accumulate");
    expect(system).toContain("Not exceed 3-4 sentences");
    expect(system).not.toContain("field notes");
    expect(system).not.toContain("add, never truncate");
    expect(system).not.toContain("Never remove or summarize away existing content");
  });

  it("uses synthesis framing for regular people identically", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeRegularPerson()));

    expect(system).toContain("Synthesize, don't accumulate");
    expect(system).toContain("Not exceed 3-4 sentences");
    expect(system).not.toContain("field notes");
  });

  it("uses brief bootstrap framing for new person records", () => {
    const { system } = buildPersonUpdatePrompt(baseData(null, {
      new_person_name: "Bob",
      new_person_relationship: "Coworker",
    }));

    expect(system).toContain("1-3 sentences maximum");
    expect(system).not.toContain("Synthesize, don't accumulate");
    expect(system).not.toContain("field notes");
  });

  it("a legacy-cased Ei Persona identifier (lowercase) also gets ordinary synthesis framing", () => {
    const person = makeEiPersona({
      identifiers: [
        { type: "ei persona", value: "some-uuid", is_primary: false },
        { type: "Nickname", value: "Beta", is_primary: true },
      ],
    });
    const { system } = buildPersonUpdatePrompt(baseData(person));

    expect(system).toContain("Synthesize, don't accumulate");
    expect(system).not.toContain("field notes");
  });
});


describe("buildPersonUpdatePrompt — attribution guard", () => {
  it("includes the unconditional attribution guard for an existing named record", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeRegularPerson()));
    const lower = system.toLowerCase();
    expect(lower).toContain("not inferred from proximity");
    expect(lower).toContain("do not attribute one person");
  });

  it("includes the cross-attribution negative example (Priya / Marcus)", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeRegularPerson()));
    expect(system).toContain("do NOT add @mcodes to Priya's record");
  });
});

describe("buildPersonUpdatePrompt — I1 forward-and-validate suggested identifiers", () => {
  it("renders the validate-or-disprove block for an existing record with suggested identifiers", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeRegularPerson(), {
      suggested_identifiers: [{ type: "Slack", value: "W1:U1" }],
    }));

    expect(system).toContain("scan flagged these identifiers");
    expect(system).toContain("Slack=W1:U1");
    expect(system).toContain("ONLY if the Most Recent Messages confirm");
  });

  it("omits the block for a NEW record even when suggested identifiers are present", () => {
    const { system } = buildPersonUpdatePrompt(baseData(null, {
      new_person_name: "Bob",
      new_person_relationship: "Coworker",
      suggested_identifiers: [{ type: "Slack", value: "W1:U1" }],
    }));

    expect(system).not.toContain("scan flagged these identifiers");
  });

  it("omits the block for an existing record when suggested identifiers are empty", () => {
    const { system } = buildPersonUpdatePrompt(baseData(makeRegularPerson(), {
      suggested_identifiers: [],
    }));

    expect(system).not.toContain("scan flagged these identifiers");
  });
});

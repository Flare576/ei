import { describe, it, expect } from "vitest";
import { normalizeIdentifierType } from "../../../../src/core/utils/identifier-utils.js";
import type { Person } from "../../../../src/core/types.js";

function makeState(people: Partial<Person>[] = []) {
  return {
    getHuman: () => ({ people }),
    persona_getAll: () => [],
  } as any;
}

describe("normalizeIdentifierType — built-in type matching", () => {
  it("lowercased input matches canonical built-in", () => {
    expect(normalizeIdentifierType("nickname", makeState())).toBe("Nickname");
  });

  it("uppercased input matches canonical built-in", () => {
    expect(normalizeIdentifierType("EMAIL", makeState())).toBe("Email");
  });

  it("underscored input matches canonical built-in", () => {
    expect(normalizeIdentifierType("full_name", makeState())).toBe("Full Name");
  });

  it("spaced variation matches canonical built-in", () => {
    expect(normalizeIdentifierType("ff 14", makeState())).toBe("FF14");
  });

  it("already-canonical input is returned unchanged", () => {
    expect(normalizeIdentifierType("Nickname", makeState())).toBe("Nickname");
  });

  it("mixed-case with punctuation matches canonical built-in", () => {
    expect(normalizeIdentifierType("Full-Name", makeState())).toBe("Full Name");
  });

  it("all built-in types round-trip correctly", () => {
    const builtIns = [
      "Full Name", "First Name", "Nickname", "Email",
      "GitHub", "Discord", "Roblox", "Reddit",
      "Twitter", "FF14", "Relationship", "Ei Persona",
    ];
    for (const canonical of builtIns) {
      expect(normalizeIdentifierType(canonical, makeState())).toBe(canonical);
    }
  });
});

describe("normalizeIdentifierType — custom / unknown types", () => {
  it("returns original value when no built-in or in-use match exists", () => {
    expect(normalizeIdentifierType("Slack RNP", makeState())).toBe("Slack RNP");
  });

  it("returns original value for unknown type with no strippable chars", () => {
    expect(normalizeIdentifierType("sehimu_thinara", makeState())).toBe("sehimu_thinara");
  });
});

describe("normalizeIdentifierType — in-use type matching", () => {
  it("matches a custom in-use type case-insensitively", () => {
    const state = makeState([
      { identifiers: [{ type: "Slack RNP", value: "flare576" }] },
    ]);
    expect(normalizeIdentifierType("slack rnp", state)).toBe("Slack RNP");
  });

  it("matches a custom in-use type with different punctuation", () => {
    const state = makeState([
      { identifiers: [{ type: "Slack RNP", value: "flare576" }] },
    ]);
    expect(normalizeIdentifierType("slack_rnp", state)).toBe("Slack RNP");
  });

  it("built-in takes priority over in-use type with same normalized key", () => {
    const state = makeState([
      { identifiers: [{ type: "nickname", value: "flare" }] },
    ]);
    expect(normalizeIdentifierType("NICKNAME", state)).toBe("Nickname");
  });

  it("handles people with no identifiers", () => {
    const state = makeState([
      { identifiers: [] },
      { identifiers: undefined as any },
    ]);
    expect(normalizeIdentifierType("nickname", state)).toBe("Nickname");
  });
});

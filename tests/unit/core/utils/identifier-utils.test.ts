import { describe, it, expect } from "vitest";
import { normalizeIdentifierType, isEiPersonaIdentifierType, isEiPersonaLinkIdentifier, guardPersonaLinks, removePersonaLinksToId } from "../../../../src/core/utils/identifier-utils.js";
import type { Person, PersonIdentifier } from "../../../../src/core/types.js";

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

// ---------------------------------------------------------------------------
// IRQ-4 / ADR-006 / ADR-010 — write-time one-to-one Person<->Persona guard
// ---------------------------------------------------------------------------

function makePerson(id: string, name: string, identifiers: PersonIdentifier[] = []): Person {
  return {
    id,
    name,
    description: "",
    sentiment: 0,
    last_updated: "2020-01-01T00:00:00Z",
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    identifiers,
  };
}

const PERSONA_A = "11111111-1111-4111-8111-111111111111";
const PERSONA_B = "22222222-2222-4222-8222-222222222222";

describe("isEiPersonaIdentifierType — canonical, case-insensitive but separator-sensitive predicate", () => {
  it("matches canonical Title Case", () => {
    expect(isEiPersonaIdentifierType("Ei Persona")).toBe(true);
  });
  it("matches legacy lowercase (ADR-010 clause 6)", () => {
    expect(isEiPersonaIdentifierType("ei persona")).toBe(true);
  });
  it("matches any case with surrounding whitespace", () => {
    expect(isEiPersonaIdentifierType("  EI PERSONA  ")).toBe(true);
  });
  it("rejects the underscored spelling — the separator is not flexible", () => {
    expect(isEiPersonaIdentifierType("ei_persona")).toBe(false);
  });
  it("rejects the no-separator spelling", () => {
    expect(isEiPersonaIdentifierType("eipersona")).toBe(false);
  });
  it("rejects an unrelated type", () => {
    expect(isEiPersonaIdentifierType("Nickname")).toBe(false);
  });
});

describe("isEiPersonaLinkIdentifier — reserved ei/emmet are never a linkable target", () => {
  it("a real persona id is a guardable link", () => {
    expect(isEiPersonaLinkIdentifier({ type: "Ei Persona", value: PERSONA_A })).toBe(true);
  });
  it("the reserved 'ei' value is not treated as a link", () => {
    expect(isEiPersonaLinkIdentifier({ type: "Ei Persona", value: "ei" })).toBe(false);
  });
  it("the reserved 'emmet' value is not treated as a link, even legacy-cased", () => {
    expect(isEiPersonaLinkIdentifier({ type: "ei persona", value: "emmet" })).toBe(false);
  });
});

describe("guardPersonaLinks — happy paths (no violation)", () => {
  it("a Person with no Ei Persona identifier is returned unchanged", () => {
    const candidate = makePerson("p1", "Alice", [{ type: "Nickname", value: "Ally" }]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(refusals).toEqual([]);
    expect(person).toBe(candidate);
  });

  it("a brand-new Person with exactly one link is accepted", () => {
    const candidate = makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_A }]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(refusals).toEqual([]);
    expect(person.identifiers).toEqual([{ type: "Ei Persona", value: PERSONA_A }]);
  });

  it("an unrelated edit that keeps the same single link produces no refusal", () => {
    const prior = makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_A }]);
    const candidate = { ...prior, description: "updated bio" };
    const { refusals } = guardPersonaLinks(candidate, prior, [prior]);
    expect(refusals).toEqual([]);
  });

  it("legacy-cased 'ei persona' is recognized and guarded identically to canonical casing", () => {
    const existing = makePerson("p1", "Alice", [{ type: "ei persona", value: PERSONA_A }]);
    const candidate = makePerson("p2", "Bob", [{ type: "Ei Persona", value: PERSONA_A }]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [existing, candidate]);
    expect(person.identifiers).toEqual([]);
    expect(refusals).toHaveLength(1);
  });

  it("reserved values ei/emmet never collide with each other across many People", () => {
    const p1 = makePerson("p1", "Alice", [{ type: "Ei Persona", value: "ei" }]);
    const p2 = makePerson("p2", "Bob", [{ type: "ei persona", value: "ei" }]);
    const p3 = makePerson("p3", "Carl", [{ type: "Ei Persona", value: "emmet" }]);
    expect(guardPersonaLinks(p1, undefined, [p1, p2, p3]).refusals).toEqual([]);
    expect(guardPersonaLinks(p2, undefined, [p1, p2, p3]).refusals).toEqual([]);
    expect(guardPersonaLinks(p3, undefined, [p1, p2, p3]).refusals).toEqual([]);
  });
});

describe("guardPersonaLinks — A-many (one Person, two or more links)", () => {
  it("a brand-new Person with two links at once: neither survives (no precedence, ADR-010 clause 4a)", () => {
    const candidate = makePerson("p1", "Alice", [
      { type: "Ei Persona", value: PERSONA_A },
      { type: "Ei Persona", value: PERSONA_B },
    ]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(person.identifiers).toEqual([]);
    expect(refusals).toHaveLength(2);
    expect(refusals.map((r) => r.value).sort()).toEqual([PERSONA_A, PERSONA_B].sort());
  });

  it("duplicate same-value entries on one Person are the A-many case too", () => {
    const candidate = makePerson("p1", "Alice", [
      { type: "Ei Persona", value: PERSONA_A },
      { type: "Ei Persona", value: PERSONA_A },
    ]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(person.identifiers).toEqual([]);
    expect(refusals).toHaveLength(2);
  });

  it("an existing link plus one new arrival: only the new one is refused, the established one survives", () => {
    const prior = makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_A }]);
    const candidate = makePerson("p1", "Alice", [
      { type: "Ei Persona", value: PERSONA_A },
      { type: "Ei Persona", value: PERSONA_B },
    ]);
    const { person, refusals } = guardPersonaLinks(candidate, prior, [prior]);
    expect(person.identifiers).toEqual([{ type: "Ei Persona", value: PERSONA_A }]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].value).toBe(PERSONA_B);
  });

  it("preserves every non-link identifier when dropping the offending links", () => {
    const candidate = makePerson("p1", "Alice", [
      { type: "Nickname", value: "Ally", is_primary: true },
      { type: "Ei Persona", value: PERSONA_A },
      { type: "Ei Persona", value: PERSONA_B },
    ]);
    const { person } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(person.identifiers).toEqual([{ type: "Nickname", value: "Ally", is_primary: true }]);
  });
});

describe("guardPersonaLinks — B-many (two People, one link)", () => {
  it("a second Person linking to an already-linked Persona is refused", () => {
    const existing = makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_A }]);
    const candidate = makePerson("p2", "Bob", [{ type: "Ei Persona", value: PERSONA_A }]);
    const { person, refusals } = guardPersonaLinks(candidate, undefined, [existing, candidate]);
    expect(person.identifiers).toEqual([]);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].reason).toContain(existing.id);
  });

  it("a value that names no existing Persona anywhere else is still accepted — the guard compares only against other People, not persona existence", () => {
    const candidate = makePerson("p1", "Alice", [{ type: "Ei Persona", value: "no-such-persona-id" }]);
    const { refusals } = guardPersonaLinks(candidate, undefined, [candidate]);
    expect(refusals).toEqual([]);
  });
});

describe("guardPersonaLinks — excludeIds (dedup's departing donors)", () => {
  it("inheriting a link from exactly one excluded (departing) donor is legal", () => {
    const donor = makePerson("donor", "Donor", [{ type: "Ei Persona", value: PERSONA_A }]);
    const survivor = makePerson("survivor", "Survivor", [{ type: "Ei Persona", value: PERSONA_A }]);
    const { person, refusals } = guardPersonaLinks(survivor, undefined, [donor, survivor], [donor.id]);
    expect(refusals).toEqual([]);
    expect(person.identifiers).toEqual([{ type: "Ei Persona", value: PERSONA_A }]);
  });

  it("without excludeIds, the identical inherited link is refused as a live collision with the still-present donor", () => {
    const donor = makePerson("donor", "Donor", [{ type: "Ei Persona", value: PERSONA_A }]);
    const survivor = makePerson("survivor", "Survivor", [{ type: "Ei Persona", value: PERSONA_A }]);
    const { refusals } = guardPersonaLinks(survivor, undefined, [donor, survivor]);
    expect(refusals).toHaveLength(1);
  });

  it("a union of two independently-linked donors is still refused even with both excluded — the guard never picks a winner", () => {
    const donorA = makePerson("donorA", "DonorA", [{ type: "Ei Persona", value: PERSONA_A }]);
    const donorB = makePerson("donorB", "DonorB", [{ type: "Ei Persona", value: PERSONA_B }]);
    const survivor = makePerson("survivor", "Survivor", [
      { type: "Ei Persona", value: PERSONA_A },
      { type: "Ei Persona", value: PERSONA_B },
    ]);
    const { person, refusals } = guardPersonaLinks(survivor, undefined, [donorA, donorB, survivor], [donorA.id, donorB.id]);
    expect(person.identifiers).toEqual([]);
    expect(refusals).toHaveLength(2);
  });
});

describe("removePersonaLinksToId — Persona delete forward cleanup (ADR-010 clause 5)", () => {
  it("strips a matching Ei Persona identifier from every Person, leaving other identifiers intact", () => {
    const people = [
      makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_A }, { type: "Nickname", value: "Ally" }]),
      makePerson("p2", "Bob", [{ type: "Ei Persona", value: PERSONA_B }]),
    ];
    removePersonaLinksToId(people, PERSONA_A);
    expect(people[0].identifiers).toEqual([{ type: "Nickname", value: "Ally" }]);
    expect(people[1].identifiers).toEqual([{ type: "Ei Persona", value: PERSONA_B }]);
  });

  it("is a no-op when no Person links to that persona id", () => {
    const people = [makePerson("p1", "Alice", [{ type: "Ei Persona", value: PERSONA_B }])];
    const before = JSON.parse(JSON.stringify(people));
    removePersonaLinksToId(people, PERSONA_A);
    expect(people).toEqual(before);
  });
});

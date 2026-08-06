import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    getEmbeddingService: () => ({
      embed: async () => new Array(384).fill(1),
    }),
    findTopK: (actual as Record<string, unknown>).findTopK,
  };
});

import { execute, buildEiRelationshipBlock } from "../../../src/cli/commands/personas.js";
import { resolvePersonLogLength } from "../../../src/cli/retrieval.js";
import { PERSON_LOG_REFLECTION_THRESHOLD } from "../../../src/core/orchestrators/ceremony.js";
import type { PersonaResult } from "../../../src/cli/retrieval.js";
import type { PersonaTrait, PersonaTopic, Person } from "../../../src/core/types/data-items.js";
import type { StorageState } from "../../../src/core/types/integrations.js";

// ── fixtures ────────────────────────────────────────────────────────────────

const NOW = "2026-01-01T00:00:00Z";

function makeTrait(name: string, strength: number): PersonaTrait {
  return {
    id: `trait_${name}`,
    name,
    description: `${name} description`,
    strength,
    sentiment: 0,
    last_updated: NOW,
  };
}

function makeTopic(name: string, exposure_current: number): PersonaTopic {
  return {
    id: `topic_${name}`,
    name,
    perspective: `${name} perspective`,
    approach: `${name} approach`,
    personal_stake: `${name} stake`,
    sentiment: 0,
    exposure_current,
    exposure_desired: 0.5,
    last_updated: NOW,
  };
}

function makePersonaResult(overrides: Partial<PersonaResult> = {}): PersonaResult {
  return {
    id: "persona_0",
    display_name: "TestPersona",
    base_prompt: "I am a test persona.",
    traits: [],
    topics: [],
    ...overrides,
  };
}

/** State JSON written to disk for execute() tests. Typed via JSON write, not TS cast. */
function buildStateJson(personas: { display_name: string; id?: string }[]) {
  const personasRecord: Record<string, unknown> = {};
  for (const p of personas) {
    const id = p.id ?? `persona_${p.display_name.toLowerCase().replace(/\W+/g, "_")}`;
    personasRecord[id] = {
      entity: {
        id,
        display_name: p.display_name,
        entity: "system",
        short_description: `${p.display_name} short desc`,
        long_description: `${p.display_name} base prompt`,
        model: "Local LLM:test-model",
        traits: [],
        topics: [],
        is_paused: false,
        is_archived: false,
        is_static: false,
        last_updated: NOW,
      },
      messages: [],
    };
  }
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [],
      traits: [],
      people: [],
      topics: [],
      quotes: [],
      last_updated: NOW,
    },
    personas: personasRecord,
    queue: [],
  };
}

let tempDir: string;

function writeState(personas: { display_name: string; id?: string }[]) {
  tempDir = mkdtempSync(join(tmpdir(), "ei-personas-test-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(buildStateJson(personas)));
  process.env.EI_DATA_PATH = tempDir;
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as unknown as string;
  }
  delete process.env.EI_DATA_PATH;
});

// ── buildEiRelationshipBlock ─────────────────────────────────────────────────

describe("buildEiRelationshipBlock — output structure", () => {
  it("opens with the injection marker comment on the first line", () => {
    const result = buildEiRelationshipBlock(makePersonaResult());
    expect(result.split("\n")[0]).toBe("<!-- ei-relationship-injected -->");
  });

  it("wraps content in <ei-relationship> tags", () => {
    const result = buildEiRelationshipBlock(makePersonaResult());
    const lines = result.split("\n");
    expect(lines[1]).toBe("<ei-relationship>");
    expect(lines[lines.length - 1]).toBe("</ei-relationship>");
  });

  it("includes the base_prompt content in the output", () => {
    const persona = makePersonaResult({ base_prompt: "I exist to test things." });
    expect(buildEiRelationshipBlock(persona)).toContain("I exist to test things.");
  });

  it("includes the Working Style section header", () => {
    expect(buildEiRelationshipBlock(makePersonaResult())).toContain("### Working Style");
  });

  it("includes the Shared Context section header", () => {
    expect(buildEiRelationshipBlock(makePersonaResult())).toContain("### Shared Context");
  });
});

describe("buildEiRelationshipBlock — trait filtering", () => {
  it("excludes traits with strength below 0.7", () => {
    const persona = makePersonaResult({ traits: [makeTrait("Sneaky", 0.5)] });
    const result = buildEiRelationshipBlock(persona);
    expect(result).not.toContain("Sneaky");
    expect(result).toContain("(no traits above threshold)");
  });

  it("includes traits with strength exactly 0.7 (inclusive boundary)", () => {
    const persona = makePersonaResult({ traits: [makeTrait("Boundary", 0.7)] });
    expect(buildEiRelationshipBlock(persona)).toContain("Boundary");
  });

  it("includes traits with strength above 0.7", () => {
    const persona = makePersonaResult({ traits: [makeTrait("Strong", 0.9)] });
    expect(buildEiRelationshipBlock(persona)).toContain("Strong");
  });

  it("excludes trait at 0.699 (just below boundary)", () => {
    const persona = makePersonaResult({ traits: [makeTrait("AlmostThere", 0.699)] });
    const result = buildEiRelationshipBlock(persona);
    expect(result).not.toContain("AlmostThere");
  });

  it("shows fallback text when all traits are below threshold", () => {
    const persona = makePersonaResult({
      traits: [makeTrait("Weak", 0.3), makeTrait("Weaker", 0.1)],
    });
    expect(buildEiRelationshipBlock(persona)).toContain("(no traits above threshold)");
  });

  it("shows fallback text when traits array is empty", () => {
    const persona = makePersonaResult({ traits: [] });
    expect(buildEiRelationshipBlock(persona)).toContain("(no traits above threshold)");
  });

  it("sorts qualifying traits descending by strength", () => {
    const persona = makePersonaResult({
      traits: [
        makeTrait("Copper", 0.75),   // weakest of the three → last
        makeTrait("Platinum", 0.95), // strongest → first
        makeTrait("Silver", 0.85),   // middle → second
      ],
    });
    const result = buildEiRelationshipBlock(persona);
    const platinumPos = result.indexOf("Platinum");
    const silverPos   = result.indexOf("Silver");
    const copperPos   = result.indexOf("Copper");
    expect(platinumPos).toBeLessThan(silverPos);
    expect(silverPos).toBeLessThan(copperPos);
  });

  it("formats strength as a rounded integer percentage", () => {
    const persona = makePersonaResult({ traits: [makeTrait("Precise", 0.777)] });
    // Math.round(0.777 * 100) = 78
    expect(buildEiRelationshipBlock(persona)).toContain("(78%)");
  });

  it("formats strength at exactly 0.7 as 70%", () => {
    const persona = makePersonaResult({ traits: [makeTrait("Exact", 0.7)] });
    expect(buildEiRelationshipBlock(persona)).toContain("(70%)");
  });

  it("excludes a trait with undefined strength while a 0.8 trait qualifies (undefined defaults to 0.5, not 0.7)", () => {
    const undefinedStrength = { ...makeTrait("Unset", 0.9), strength: undefined } as PersonaTrait;
    const persona = makePersonaResult({
      traits: [undefinedStrength, makeTrait("Confirmed", 0.8)],
    });
    const result = buildEiRelationshipBlock(persona);
    expect(result).not.toContain("Unset");
    expect(result).toContain("Confirmed");
  });
});

describe("buildEiRelationshipBlock — topic formatting", () => {
  it("shows fallback text when topics array is empty", () => {
    const persona = makePersonaResult({ topics: [] });
    expect(buildEiRelationshipBlock(persona)).toContain("(no topics)");
  });

  it("formats each topic as 'name: perspective — approach'", () => {
    const persona = makePersonaResult({
      topics: [makeTopic("Music", 0.8)],
    });
    const result = buildEiRelationshipBlock(persona);
    expect(result).toContain("**Music**: Music perspective — Music approach");
  });

  it("sorts topics descending by exposure_current", () => {
    const persona = makePersonaResult({
      topics: [
        makeTopic("Low", 0.2),
        makeTopic("High", 0.9),
        makeTopic("Mid", 0.5),
      ],
    });
    const result = buildEiRelationshipBlock(persona);
    const highPos = result.indexOf("High");
    const midPos = result.indexOf("Mid");
    const lowPos = result.indexOf("Low");
    expect(highPos).toBeLessThan(midPos);
    expect(midPos).toBeLessThan(lowPos);
  });

  it("does not mutate the input topics array order", () => {
    const topics = [makeTopic("B", 0.3), makeTopic("A", 0.9)];
    const persona = makePersonaResult({ topics });
    buildEiRelationshipBlock(persona);
    // original array must be untouched
    expect(topics[0].name).toBe("B");
    expect(topics[1].name).toBe("A");
  });
});

// ── execute() — BUG-1: empty result contract ─────────────────────────────────
// When no persona matches, execute() must return [] so the CLI can exit clean
// without emitting JSON. If it returned something truthy, the --format prompt
// fallthrough would previously inject "[]" into the system prompt.

describe("execute() — empty result when no persona matches", () => {
  it("returns [] when EI_DATA_PATH is unset", async () => {
    delete process.env.EI_DATA_PATH;
    const result = await execute("nonexistent", 10);
    expect(result).toEqual([]);
  });

  it("returns [] when state has no personas", async () => {
    writeState([]);
    const result = await execute("anything", 10);
    expect(result).toEqual([]);
  });

  it("returns [] when query matches no persona in either direction", async () => {
    writeState([{ display_name: "Sisyphus" }]);
    const result = await execute("zzz-no-match", 10);
    expect(result).toEqual([]);
  });
});

// ── execute() — BUG-2: bidirectional containment ─────────────────────────────
// retrievePersonas() only checks persona_name.includes(query).
// execute() adds the reverse: query.includes(persona_name).
// Without this, agent roles like "Beta — QA Goddess" miss the stored "Beta" persona.

describe("execute() — reverse containment matching (BUG-2 fix)", () => {
  it("matches when query equals the stored persona name (forward direction still works)", async () => {
    writeState([{ display_name: "Beta" }]);
    const result = await execute("Beta", 10);
    expect(result).toHaveLength(1);
    expect(result[0].display_name).toBe("Beta");
  });

  it("matches when query contains the stored persona name (reverse direction)", async () => {
    writeState([{ display_name: "Beta" }]);
    const result = await execute("Beta — QA Goddess", 10);
    expect(result).toHaveLength(1);
    expect(result[0].display_name).toBe("Beta");
  });

  it("matches case-insensitively in the reverse direction", async () => {
    writeState([{ display_name: "Sisyphus" }]);
    const result = await execute("sisyphus - ultraworker", 10);
    expect(result).toHaveLength(1);
    expect(result[0].display_name).toBe("Sisyphus");
  });

  it("matches when stored persona name is contained within a quoted agent role", async () => {
    writeState([{ display_name: "Atlas" }]);
    const result = await execute('"Atlas" - Master Orchestrator', 10);
    expect(result).toHaveLength(1);
    expect(result[0].display_name).toBe("Atlas");
  });

  it("does not reverse-match an unrelated query that happens to be short", async () => {
    // "A" would match inside almost anything — but the query here is a real name
    writeState([{ display_name: "Prometheus" }]);
    const result = await execute("Beta — QA Goddess", 10);
    // "prometheus" is not contained in "beta — qa goddess"
    expect(result).toEqual([]);
  });

  it("maps matched persona fields correctly through reverse path", async () => {
    writeState([{ display_name: "Beta" }]);
    const result = await execute("Beta — QA Goddess", 10);
    expect(result[0]).toMatchObject({
      display_name: "Beta",
      base_prompt: "Beta base prompt",
      traits: expect.any(Array),
      topics: expect.any(Array),
    });
  });
});


// ── Ei Person Log readiness notice ───────────────────────────────────────────
// The relationship block reports the linked PersonLog's size (never its
// content) so an agent whose persona is `external_reflection_only` — and
// therefore no longer gets Ei's automatic critic — still learns the log is
// worth reflecting on. See resolvePersonLogLength (src/cli/retrieval.ts)
// for the linked-record resolution and buildEiRelationshipBlock for the
// text it produces from that resolved number.

function makeStateWithPeople(people: Person[]): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [],
      topics: [],
      people,
      quotes: [],
      last_updated: NOW,
    },
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

function makeLinkedPerson(id: string, description: string, personaId: string): Person {
  return {
    id,
    name: id,
    description,
    sentiment: 0.5,
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers: [{ type: "Ei Persona", value: personaId, is_primary: true }],
  };
}

describe("resolvePersonLogLength — linked-record resolution", () => {
  it("returns undefined when the persona has no linked Person record", () => {
    const state = makeStateWithPeople([]);
    expect(resolvePersonLogLength("persona_0", state)).toBeUndefined();
  });

  it("returns undefined when Person records exist but none link to this persona", () => {
    const state = makeStateWithPeople([makeLinkedPerson("p1", "x".repeat(500), "some_other_persona")]);
    expect(resolvePersonLogLength("persona_0", state)).toBeUndefined();
  });

  it("returns the linked record's description length when under threshold", () => {
    const state = makeStateWithPeople([makeLinkedPerson("p1", "x".repeat(500), "persona_0")]);
    expect(resolvePersonLogLength("persona_0", state)).toBe(500);
  });

  it("returns the linked record's description length when over threshold", () => {
    const length = PERSON_LOG_REFLECTION_THRESHOLD + 200;
    const state = makeStateWithPeople([makeLinkedPerson("p1", "x".repeat(length), "persona_0")]);
    expect(resolvePersonLogLength("persona_0", state)).toBe(length);
  });

  it("reports the second linked record's length when only it is over threshold — a first-match implementation reads the wrong (under-threshold) record and stays silent", () => {
    const underLength = 400;
    const overLength = PERSON_LOG_REFLECTION_THRESHOLD + 300;
    const state = makeStateWithPeople([
      makeLinkedPerson("p1", "y".repeat(underLength), "persona_0"),
      makeLinkedPerson("p2", "z".repeat(overLength), "persona_0"),
    ]);
    expect(resolvePersonLogLength("persona_0", state)).toBe(overLength);
  });
});

describe("buildEiRelationshipBlock — Ei Person Log section", () => {
  it("emits no log section, and does not crash, when the persona has no linked Person record", () => {
    expect(() => buildEiRelationshipBlock(makePersonaResult(), undefined)).not.toThrow();
    const result = buildEiRelationshipBlock(makePersonaResult(), undefined);
    expect(result).not.toContain("Ei Person Log");
  });

  it("reports the count without the reflection prompt when under threshold", () => {
    const result = buildEiRelationshipBlock(makePersonaResult(), 500);
    expect(result).toContain("# Ei Person Log");
    expect(result).toContain("currently 500 characters");
    expect(result).not.toMatch(/reflection/i);
  });

  it("reports the count and the reflection prompt when over threshold", () => {
    const overLength = PERSON_LOG_REFLECTION_THRESHOLD + 1;
    const result = buildEiRelationshipBlock(makePersonaResult(), overLength);
    expect(result).toContain(`currently ${overLength} characters`);
    expect(result).toMatch(/prompt the user to perform a reflection soon/i);
  });

  it("does not add the reflection prompt exactly at the threshold (over means strictly greater, matching ceremony.ts)", () => {
    const result = buildEiRelationshipBlock(makePersonaResult(), PERSON_LOG_REFLECTION_THRESHOLD);
    expect(result).toContain(`currently ${PERSON_LOG_REFLECTION_THRESHOLD} characters`);
    expect(result).not.toMatch(/reflection/i);
  });

  it("keeps </ei-relationship> as the final line with the Person Log section present", () => {
    const result = buildEiRelationshipBlock(makePersonaResult(), PERSON_LOG_REFLECTION_THRESHOLD + 1);
    const lines = result.split("\n");
    expect(lines[lines.length - 1]).toBe("</ei-relationship>");
  });

  it("never leaks PersonLog content: a seeded marker in the linked record's description reaches only a length, never the block", () => {
    const marker = "SEEDED_MARKER_DO_NOT_LEAK_7f3c9a";
    const description = marker + "y".repeat(PERSON_LOG_REFLECTION_THRESHOLD + 50);
    const state = makeStateWithPeople([makeLinkedPerson("p1", description, "persona_0")]);

    const length = resolvePersonLogLength("persona_0", state);
    const result = buildEiRelationshipBlock(makePersonaResult({ id: "persona_0" }), length);

    expect(result).not.toContain(marker);
    expect(result).not.toContain(description);
    expect(result).toContain(`currently ${description.length} characters`);
  });
});
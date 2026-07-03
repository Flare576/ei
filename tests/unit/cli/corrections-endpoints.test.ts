import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { Fact, Person, Quote } from "../../../src/core/types/data-items.js";

const INITIAL_NOW = "2026-01-01T00:00:00.000Z";
const EMBEDDING = [0.25, 0.5, 0.75];
const PERSONA_ID = "11111111-1111-4111-8111-111111111111";
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    computeDataItemEmbedding: vi.fn().mockResolvedValue([0.25, 0.5, 0.75]),
    computeQuoteEmbedding: vi.fn().mockResolvedValue([0.25, 0.5, 0.75]),
  };
});


import { lookupById } from "../../../src/cli/retrieval.js";
import {
  CorrectionValidationError,
  createEntity,
  removeEntity,
  updateEntity,
} from "../../../src/cli/corrections-endpoints.js";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact_1",
    name: "Birthday",
    description: "1984-05-26",
    sentiment: 0,
    validated_date: INITIAL_NOW,
    last_updated: INITIAL_NOW,
    learned_by: "ei",
    embedding: EMBEDDING,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_1",
    name: "Existing Person",
    description: "Existing description",
    sentiment: 0.1,
    relationship: "friend",
    exposure_current: 0.1,
    exposure_desired: 0.5,
    last_updated: INITIAL_NOW,
    validated_date: INITIAL_NOW,
    identifiers: [{ type: "Nickname", value: "Existing Person", is_primary: true }],
    embedding: EMBEDDING,
    ...overrides,
  };
}

function makeQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote_1",
    message_id: null,
    data_item_ids: ["person_1"],
    persona_groups: [],
    text: "Existing quote text",
    speaker: "human",
    timestamp: INITIAL_NOW,
    start: null,
    end: null,
    created_at: INITIAL_NOW,
    created_by: "human",
    embedding: EMBEDDING,
    ...overrides,
  };
}

function makeState(overrides: Partial<StorageState> = {}): StorageState {
  return {
    version: 1,
    timestamp: INITIAL_NOW,
    human: {
      entity: "human",
      facts: [makeFact()],
      topics: [],
      people: [makePerson()],
      quotes: [],
      last_updated: INITIAL_NOW,
    },
    personas: {
      [PERSONA_ID]: {
        entity: {
          id: PERSONA_ID,
          display_name: "Sisyphus",
          aliases: ["Boulder Master"],
          entity: "system",
          short_description: "Test persona",
          long_description: "Test persona prompt",
          model: "Local LLM:test-model",
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: INITIAL_NOW,
        },
        messages: [],
      },
    },
    queue: [],
    providers: [],
    tools: [],
    ...overrides,
  };
}

let tempDir: string;

function writeState(state: StorageState): void {
  tempDir = mkdtempSync(join(tmpdir(), "ei-corrections-endpoints-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = tempDir;
}


afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined as never;
  }
  delete process.env.EI_DATA_PATH;
});

describe("corrections endpoints", () => {
  it("removes an existing fact so lookup no longer returns it", async () => {
    writeState(makeState());

    await removeEntity("fact", "fact_1");

    expect(await lookupById("fact_1")).toBeNull();
  });

  it("rejects removing a missing fact with the not-found contract", async () => {
    writeState(makeState());

    await expect(removeEntity("fact", "missing")).rejects.toThrow(
      /^No fact found with id: missing$/
    );
  });

  it("rejects updating a missing fact with the not-found contract", async () => {
    writeState(makeState());

    await expect(
      updateEntity("fact", "missing", {
        name: "Known Fact",
        description: "Valid update body",
        sentiment: 0.4,
        validated_date: INITIAL_NOW,
      })
    ).rejects.toThrow(/^No fact found with id: missing$/);
  });

  it.each([
    ["null", null],
    ["number", 42],
    ["string", "str"],
    ["array", [1, 2, 3]],
  ] as const)("rejects non-object fact create body (%s) with CorrectionValidationError", async (_name, body) => {
    writeState(makeState());

    await expect(createEntity("fact", body)).rejects.toThrow(CorrectionValidationError);
  });

  it.each([
    [
      "missing identifiers and name",
      {
        description: "No usable identity",
        sentiment: 0.1,
        relationship: "unknown",
      },
    ],
    [
      "empty identifiers",
      {
        description: "No usable identity",
        sentiment: 0.1,
        relationship: "unknown",
        identifiers: [],
      },
    ],
  ] as const)("rejects person create body with %s", async (_name, body) => {
    writeState(makeState());

    await expect(createEntity("person", body)).rejects.toThrow(CorrectionValidationError);
    await expect(createEntity("person", body)).rejects.toThrow(
      /Person requires at least one identifier or a name/
    );
  });

  it("accepts a lookupById payload on update and ignores server-owned round-trip fields", async () => {
    writeState(makeState());

    const lookupRecord = await lookupById("fact_1");
    expect(lookupRecord).toMatchObject({
      type: "fact",
      id: "fact_1",
      name: "Birthday",
      description: "1984-05-26",
      last_updated: INITIAL_NOW,
    });

    const updateStartedAt = Date.now();
    const updated = await updateEntity("fact", "fact_1", {
      ...lookupRecord,
      id: "spoofed-id",
      type: "topic",
      last_updated: "1999-12-31T23:59:59.000Z",
      description: "1984-05-27",
    });
    const updateFinishedAt = Date.now();

    expect(updated).toMatchObject({
      id: "fact_1",
      name: "Birthday",
      description: "1984-05-27",
    });
    expect(Date.parse(updated.last_updated)).toBeGreaterThanOrEqual(updateStartedAt);
    expect(Date.parse(updated.last_updated)).toBeLessThanOrEqual(updateFinishedAt);

    const persisted = await lookupById("fact_1");
    expect(persisted).toMatchObject({
      type: "fact",
      id: "fact_1",
      description: "1984-05-27",
      last_updated: updated.last_updated,
    });
    expect(await lookupById("spoofed-id")).toBeNull();
  });

  it("rejects user-supplied unknown keys that are outside the round-trip allowlist", async () => {
    writeState(makeState());

    await expect(
      createEntity("fact", {
        name: "Known Fact",
        description: "Valid shape except for one stray field",
        sentiment: 0.4,
        validated_date: INITIAL_NOW,
        unexpected: true,
      })
    ).rejects.toThrow(CorrectionValidationError);

    const lookupRecord = await lookupById("fact_1");
    await expect(
      updateEntity("fact", "fact_1", {
        ...lookupRecord,
        description: "Still invalid",
        unexpected: true,
      })
    ).rejects.toThrow(CorrectionValidationError);
  });

  it("rejects caller-supplied id/type/last_updated on create (round-trip allowlist is update-only)", async () => {
    writeState(makeState());

    await expect(
      createEntity("fact", {
        id: "caller-supplied-id",
        name: "Known Fact",
        description: "Valid shape except for server-owned fields",
        sentiment: 0.4,
        validated_date: INITIAL_NOW,
      })
    ).rejects.toThrow(CorrectionValidationError);

    await expect(
      createEntity("fact", {
        type: "topic",
        name: "Known Fact",
        description: "Valid shape except for server-owned fields",
        sentiment: 0.4,
        validated_date: INITIAL_NOW,
      })
    ).rejects.toThrow(CorrectionValidationError);

    await expect(
      createEntity("fact", {
        last_updated: "1999-12-31T23:59:59.000Z",
        name: "Known Fact",
        description: "Valid shape except for server-owned fields",
        sentiment: 0.4,
        validated_date: INITIAL_NOW,
      })
    ).rejects.toThrow(CorrectionValidationError);

    // Update still accepts and ignores these — the allowlist is update-only, not gone entirely.
    const lookupRecord = await lookupById("fact_1");
    const updated = await updateEntity("fact", "fact_1", {
      ...lookupRecord,
      id: "spoofed-id",
      type: "topic",
      last_updated: "1999-12-31T23:59:59.000Z",
    });
    expect(updated.id).toBe("fact_1");
  });

  it("materializes people by sanitizing persona identifiers, syncing name from the primary identifier, and stamping id/last_updated", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [],
        quotes: [],
        last_updated: INITIAL_NOW,
      },
    }));

    const createStartedAt = Date.now();
    const created = await createEntity("person", {
      name: "Will Be Replaced",
      description: "AI Persona",
      sentiment: 0.85,
      relationship: "AI Persona",
      exposure_current: 0,
      exposure_desired: 0.5,
      identifiers: [
        { type: "AI Persona", value: "Boulder Master" },
        { type: "Nickname", value: "Sisyphus", is_primary: true },
      ],
    });
    const createFinishedAt = Date.now();

    expect(created.record).toMatchObject({
      id: created.id,
      name: "Sisyphus",
      identifiers: [
        { type: "Ei Persona", value: PERSONA_ID },
        { type: "Nickname", value: "Sisyphus", is_primary: true },
      ],
    });
    expect(Array.isArray(created.record.embedding)).toBe(true);
    expect((created.record.embedding ?? []).length).toBeGreaterThan(0);
    expect(Date.parse(created.record.last_updated)).toBeGreaterThanOrEqual(createStartedAt);
    expect(Date.parse(created.record.last_updated)).toBeLessThanOrEqual(createFinishedAt);

    expect(await lookupById(created.id)).toMatchObject({
      type: "person",
      id: created.id,
      name: "Sisyphus",
      last_updated: created.record.last_updated,
      identifiers: [
        { type: "Ei Persona", value: PERSONA_ID },
        { type: "Nickname", value: "Sisyphus", is_primary: true },
      ],
    });
  });

  it("updates a quote's data_item_ids and recomputes its embedding (un-merge repoint)", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [makePerson(), makePerson({ id: "person_2", name: "Split Person" })],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    const updated = await updateEntity("quote", "quote_1", {
      message_id: null,
      data_item_ids: ["person_2"],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: INITIAL_NOW,
      start: null,
      end: null,
      created_at: INITIAL_NOW,
      created_by: "human",
    });

    expect(updated).toMatchObject({ id: "quote_1", data_item_ids: ["person_2"] });
    expect(updated.embedding).toEqual(EMBEDDING);

    const persisted = await lookupById("quote_1");
    expect(persisted).toMatchObject({ type: "quote", id: "quote_1", data_item_ids: ["person_2"] });
  });

  it("rejects an invalid quote update body (missing text) with CorrectionValidationError", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    await expect(
      updateEntity("quote", "quote_1", {
        message_id: null,
        data_item_ids: [],
        persona_groups: [],
        speaker: "human",
        timestamp: INITIAL_NOW,
        start: null,
        end: null,
        created_at: INITIAL_NOW,
        created_by: "human",
      })
    ).rejects.toThrow(CorrectionValidationError);
  });

  it("rejects updating a missing quote with the not-found contract", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [],
        quotes: [],
        last_updated: INITIAL_NOW,
      },
    }));

    await expect(
      updateEntity("quote", "missing", {
        message_id: null,
        data_item_ids: [],
        persona_groups: [],
        text: "x",
        speaker: "human",
        timestamp: INITIAL_NOW,
        start: null,
        end: null,
        created_at: INITIAL_NOW,
        created_by: "human",
      })
    ).rejects.toThrow(/^No quote found with id: missing$/);
  });

  it("accepts a lookupById quote payload on update, stripping round-trip fields without erroring", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [makePerson({ id: "person_2", name: "Split Person" })],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    const lookupRecord = await lookupById("quote_1");
    expect(lookupRecord).toMatchObject({ type: "quote", id: "quote_1" });

    const updated = await updateEntity("quote", "quote_1", {
      ...lookupRecord,
      data_item_ids: ["person_2"],
    });

    expect(updated.id).toBe("quote_1");
    expect(updated.data_item_ids).toEqual(["person_2"]);
  });

  it("rejects a quote update whose data_item_ids includes an ID that matches no fact/topic/person (T1)", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [makePerson()],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    const body = {
      message_id: null,
      data_item_ids: ["totally-made-up-id"],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: INITIAL_NOW,
      start: null,
      end: null,
      created_at: INITIAL_NOW,
      created_by: "human",
    };

    await expect(updateEntity("quote", "quote_1", body)).rejects.toThrow(CorrectionValidationError);
    await expect(updateEntity("quote", "quote_1", body)).rejects.toThrow(/totally-made-up-id/);

    const persisted = await lookupById("quote_1");
    expect(persisted).toMatchObject({ type: "quote", id: "quote_1", data_item_ids: ["person_1"] });
  });

  it("rejects a quote update whose data_item_ids includes a real ID of the wrong category, e.g. another quote's id (T2)", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [makePerson()],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    const body = {
      message_id: null,
      data_item_ids: ["quote_1"],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: INITIAL_NOW,
      start: null,
      end: null,
      created_at: INITIAL_NOW,
      created_by: "human",
    };

    await expect(updateEntity("quote", "quote_1", body)).rejects.toThrow(CorrectionValidationError);
    await expect(updateEntity("quote", "quote_1", body)).rejects.toThrow(/quote_1/);

    const persisted = await lookupById("quote_1");
    expect(persisted).toMatchObject({ type: "quote", id: "quote_1", data_item_ids: ["person_1"] });
  });

  it("repoints a quote from personA to personB across the lookup -> update -> lookup repair workflow (T3)", async () => {
    const personA = makePerson({ id: "person_a", name: "Person A" });
    const personB = makePerson({ id: "person_b", name: "Person B" });
    const quote = makeQuote({ id: "quote_1", data_item_ids: ["person_a"] });

    writeState(makeState({
      human: {
        entity: "human",
        facts: [],
        topics: [],
        people: [personA, personB],
        quotes: [quote],
        last_updated: INITIAL_NOW,
      },
    }));

    const personABefore = await lookupById("person_a");
    expect(personABefore).toMatchObject({
      linked_quotes: [{ id: quote.id, text: quote.text, speaker: quote.speaker, timestamp: quote.timestamp }],
    });

    const quoteRecord = await lookupById("quote_1");
    expect(quoteRecord).toMatchObject({ type: "quote", id: "quote_1", data_item_ids: ["person_a"] });

    const updated = await updateEntity("quote", "quote_1", {
      ...quoteRecord,
      data_item_ids: ["person_b"],
    });

    expect(updated.data_item_ids).toEqual(["person_b"]);

    const personAAfter = await lookupById("person_a");
    expect(personAAfter).toMatchObject({ linked_quotes: [] });

    const personBAfter = await lookupById("person_b");
    expect(personBAfter).toMatchObject({
      linked_quotes: [{ id: quote.id, text: quote.text, speaker: quote.speaker, timestamp: quote.timestamp }],
    });

    // Message metadata round-trips unchanged — only data_item_ids (and the
    // recomputed embedding) were meant to move.
    expect(updated).toMatchObject({
      message_id: quote.message_id,
      timestamp: quote.timestamp,
      created_at: quote.created_at,
      created_by: quote.created_by,
      text: quote.text,
    });
  });
});

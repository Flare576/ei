import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { Fact, Person, Quote } from "../../../src/core/types/data-items.js";
import { ContextStatus, RoomMode } from "../../../src/core/types/enums.js";
import { StateManager } from "../../../src/core/state-manager.js";
import { migrateMessageIds } from "../../../src/core/migrations.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { getMachineId } from "../../../src/integrations/machine-id.js";

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


import { computeDataItemEmbedding, computeQuoteEmbedding } from "../../../src/core/embedding-service.js";
import { lookupById, loadLatestState, getLastCorrectionSkips } from "../../../src/cli/retrieval.js";
import { writeCorrection } from "../../../src/cli/corrections-writer.js";
import {
  CorrectionValidationError,
  createEntity,
  removeEntity,
  updateEntity,
  createQuoteEntity,
  fixQuoteEntity,
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
    // Response never carries the raw embedding vector (CLI/MCP output hygiene) --
    // computation still happens, it's just not surfaced. See the dedicated
    // "strips the embedding vector" regression test below for the direct check.
    expect(created.record).not.toHaveProperty("embedding");
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
    expect(updated).not.toHaveProperty("embedding");

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

  it("strips the embedding vector from create/update responses (CLI/MCP output must never leak raw floats)", async () => {
    writeState(makeState({
      human: {
        entity: "human",
        facts: [makeFact()],
        topics: [],
        people: [makePerson()],
        quotes: [makeQuote()],
        last_updated: INITIAL_NOW,
      },
    }));

    const createdFact = await createEntity("fact", {
      name: "New Fact",
      description: "test",
      sentiment: 0,
      validated_date: INITIAL_NOW,
    });
    expect(createdFact.record).not.toHaveProperty("embedding");

    const updatedFact = await updateEntity("fact", "fact_1", {
      name: "Birthday",
      description: "1984-05-26",
      sentiment: 0,
      validated_date: INITIAL_NOW,
    });
    expect(updatedFact).not.toHaveProperty("embedding");

    const updatedQuote = await updateEntity("quote", "quote_1", {
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
    });
    expect(updatedQuote).not.toHaveProperty("embedding");

    // The strip only reshapes the response -- computation (and therefore
    // search) must still happen underneath.
    expect(computeDataItemEmbedding).toHaveBeenCalled();
    expect(computeQuoteEmbedding).toHaveBeenCalledWith("Existing quote text");
  });
});

// -----------------------------------------------------------------------
// createQuoteEntity / fixQuoteEntity (`ei create quote` / `ei fix quote`)
// -----------------------------------------------------------------------
// Real resolveExternalMessage + real matchQuoteInMessage run against the
// personas/rooms seeded below -- nothing but computeQuoteEmbedding is
// mocked (the module-level mock above), matching every other test in this
// file. Room/message content and expected match offsets were computed
// directly against the real matcher (not hand-counted) to avoid drift --
// see learnings.md's T3 entry for the derivation.

const QUOTE_PERSONA_ID = "22222222-2222-4222-8222-222222222222";
const DIRECT_MSG_ID = "ei:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCED_MSG_ID = "ei:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const DANGLING_MSG_ID = "ei:99999999-9999-4999-8999-999999999999"; // well-formed id, never created -- resolves to null
const ROOM_ID = "attest-room-1";
const ROOM_MSG_ID = "ei:cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// "the lease bug is the real defect" appears twice: [6,38) and [50,82).
const ROOM_CONTENT = "First the lease bug is the real defect and second the lease bug is the real defect for a different reason";
// "unique wording to verify channel derivation" -> [32,75).
const DIRECT_CONTENT = "Direct thread message with some unique wording to verify channel derivation";
// "anchors the sourced quote fixture" -> [13,46); "the real defect lives here too" -> [51,81).
const SOURCED_CONTENT = "This message anchors the sourced quote fixture and the real defect lives here too";

function buildAttestationState(quotes: Quote[]): StorageState {
  return {
    version: 1,
    timestamp: INITIAL_NOW,
    human: {
      entity: "human",
      facts: [{ id: "attest-fact-1", name: "Attest Fact", description: "linked from the sourced quote fixture", sentiment: 0, validated_date: INITIAL_NOW, last_updated: INITIAL_NOW }],
      topics: [],
      people: [],
      quotes,
      last_updated: INITIAL_NOW,
    },
    personas: {
      [QUOTE_PERSONA_ID]: {
        entity: {
          id: QUOTE_PERSONA_ID,
          display_name: "Attest Persona",
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
        messages: [
          { id: DIRECT_MSG_ID, role: "human", content: DIRECT_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
          { id: SOURCED_MSG_ID, role: "human", content: SOURCED_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
        ],
      },
    },
    rooms: {
      [ROOM_ID]: {
        id: ROOM_ID,
        display_name: "Attest Room",
        entity: "room",
        mode: RoomMode.FreeForAll,
        persona_ids: [QUOTE_PERSONA_ID],
        active_node_id: null,
        is_archived: false,
        created_at: INITIAL_NOW,
        last_updated: INITIAL_NOW,
        messages: [
          { id: ROOM_MSG_ID, parent_id: null, role: "human", content: ROOM_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
        ],
      },
    },
    queue: [],
    providers: [],
    tools: [],
  };
}

function makeOrphanedQuote(): Quote {
  return makeQuote({ id: "orphaned-quote-1", message_id: null, channel: "Attest Persona" });
}
function makeDanglingQuote(): Quote {
  return makeQuote({ id: "dangling-quote-1", message_id: DANGLING_MSG_ID, channel: "Attest Persona" });
}
function makeSourcedQuote(overrides: Partial<Quote> = {}): Quote {
  return makeQuote({
    id: "sourced-quote-1",
    message_id: SOURCED_MSG_ID,
    data_item_ids: ["attest-fact-1"],
    persona_groups: ["General"],
    text: "anchors the sourced quote fixture",
    speaker: "human",
    channel: "Attest Persona",
    start: 13,
    end: 46,
    created_at: "2020-01-01T00:00:00.000Z",
    created_by: "human",
    ...overrides,
  });
}
function makeRepeatedQuote(overrides: Partial<Quote> = {}): Quote {
  return makeQuote({
    id: "repeated-quote-1",
    message_id: ROOM_MSG_ID,
    data_item_ids: ["attest-fact-1"],
    persona_groups: ["General"],
    text: "the lease bug is the real defect",
    speaker: "human",
    channel: "Attest Room",
    start: 6,
    end: 38,
    created_at: "2020-01-01T00:00:00.000Z",
    created_by: "human",
    ...overrides,
  });
}

describe("createQuoteEntity (ei create quote / ei_quote_create)", () => {
  it("rejects a body missing message_id and text with CorrectionValidationError", async () => {
    writeState(buildAttestationState([]));
    await expect(createQuoteEntity({})).rejects.toThrow(CorrectionValidationError);
    await expect(createQuoteEntity({})).rejects.toThrow(/message_id/);
  });

  it.each([
    ["speaker", "forged"],
    ["timestamp", "2099-01-01T00:00:00.000Z"],
    ["channel", "forged-channel"],
    ["embedding", [9, 9, 9]],
    ["created_at", "2099-01-01T00:00:00.000Z"],
    ["created_by", "human"],
  ] as Array<[string, unknown]>)("rejects a caller-supplied '%s' field at the schema level and persists nothing", async (field, value) => {
    writeState(buildAttestationState([]));
    await expect(
      createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect", [field]: value })
    ).rejects.toThrow(CorrectionValidationError);

    const state = await loadLatestState();
    expect(state!.human.quotes).toHaveLength(0);
  });

  it("creates a verified quote from a room message: first occurrence on omitted offsets, room display_name as channel", async () => {
    writeState(buildAttestationState([]));

    const created = await createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect" });

    expect(created).toMatchObject({
      message_id: ROOM_MSG_ID,
      text: "the lease bug is the real defect",
      speaker: "human",
      channel: "Attest Room",
      start: 6,
      end: 38,
      data_item_ids: [],
      persona_groups: [],
      created_by: "extraction",
    });
    expect(created).not.toHaveProperty("embedding");
    expect(computeQuoteEmbedding).toHaveBeenCalledWith("the lease bug is the real defect");

    const persisted = await lookupById(created.id);
    expect(persisted).toMatchObject({ type: "quote", id: created.id, text: "the lease bug is the real defect", start: 6, end: 38 });
  });

  it("creates a verified quote from a direct persona message, deriving channel from the persona's display_name (not a room)", async () => {
    writeState(buildAttestationState([]));

    const created = await createQuoteEntity({ message_id: DIRECT_MSG_ID, text: "unique wording to verify channel derivation" });

    expect(created.channel).toBe("Attest Persona");
    expect(created.channel).not.toBe("ei");
    expect(created).toMatchObject({ message_id: DIRECT_MSG_ID, start: 32, end: 75 });
  });

  it("first-span offsets (matching the matcher's own result) also succeed", async () => {
    writeState(buildAttestationState([]));
    const created = await createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect", start: 6, end: 38 });
    expect(created).toMatchObject({ start: 6, end: 38 });
  });

  it("refuses with a no-match reason when the text cannot be found in the source, persisting nothing", async () => {
    writeState(buildAttestationState([]));
    await expect(
      createQuoteEntity({ message_id: ROOM_MSG_ID, text: "this text is nowhere in the message" })
    ).rejects.toThrow(/quote text not found in source message/);
    const state = await loadLatestState();
    expect(state!.human.quotes).toHaveLength(0);
  });

  it("refuses when message_id does not resolve to any known message", async () => {
    writeState(buildAttestationState([]));
    await expect(createQuoteEntity({ message_id: DANGLING_MSG_ID, text: "anything" })).rejects.toThrow(
      /source message could not be found/
    );
  });

  it.each([
    ["second-occurrence offsets", 50, 82],
    ["partial/malformed pair", 6, 7],
    ["out-of-range offsets", 9999, 10010],
  ] as Array<[string, number, number]>)("refuses with the offset-mismatch reason on %s, never silently ignoring or overriding them", async (_label, start, end) => {
    writeState(buildAttestationState([]));
    await expect(
      createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect", start, end })
    ).rejects.toThrow(/offset does not match the resolved text location/);
    const state = await loadLatestState();
    expect(state!.human.quotes).toHaveLength(0);
  });

  it("refuses when only one of start/end is supplied", async () => {
    writeState(buildAttestationState([]));
    await expect(
      createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect", start: 6 })
    ).rejects.toThrow(/offset does not match the resolved text location/);
  });
});

describe("fixQuoteEntity (ei fix quote / ei_quote_fix)", () => {
  it("rejects a body missing quote_id and text with CorrectionValidationError", async () => {
    writeState(buildAttestationState([makeSourcedQuote()]));
    await expect(fixQuoteEntity({})).rejects.toThrow(CorrectionValidationError);
    await expect(fixQuoteEntity({})).rejects.toThrow(/quote_id/);
  });

  it.each([
    ["message_id", "forged"],
    ["speaker", "forged"],
    ["created_by", "human"],
  ] as Array<[string, unknown]>)("rejects a caller-supplied '%s' field at the schema level and mutates nothing", async (field, value) => {
    writeState(buildAttestationState([makeSourcedQuote()]));
    await expect(
      fixQuoteEntity({ quote_id: "sourced-quote-1", text: "anything", [field]: value })
    ).rejects.toThrow(CorrectionValidationError);

    const persisted = await lookupById("sourced-quote-1");
    expect(persisted).toMatchObject({ text: "anchors the sourced quote fixture" });
  });

  it("rejects a nonexistent quote_id distinctly from all four named refusal reasons", async () => {
    writeState(buildAttestationState([]));
    await expect(fixQuoteEntity({ quote_id: "does-not-exist", text: "anything" })).rejects.toThrow(
      "Cannot fix quote: no quote found with the supplied id"
    );
  });

  it("refuses an orphaned quote (message_id already null) with the orphaned reason", async () => {
    writeState(buildAttestationState([makeOrphanedQuote()]));
    await expect(fixQuoteEntity({ quote_id: "orphaned-quote-1", text: "anything" })).rejects.toThrow(
      "Cannot fix quote: no source message to verify against"
    );
  });

  it("refuses a dangling quote (message_id set but unresolvable) with the dangling reason", async () => {
    writeState(buildAttestationState([makeDanglingQuote()]));
    await expect(fixQuoteEntity({ quote_id: "dangling-quote-1", text: "anything" })).rejects.toThrow(
      "Cannot fix quote: source message could not be found"
    );
  });

  it("refuses on no-match with the no-match reason", async () => {
    writeState(buildAttestationState([makeSourcedQuote()]));
    await expect(
      fixQuoteEntity({ quote_id: "sourced-quote-1", text: "this text is nowhere in the sourced message" })
    ).rejects.toThrow("Cannot fix quote: quote text not found in source message");
  });

  it("produces four pairwise-distinct refusal reasons across orphaned/dangling/no-match/offset-mismatch (not two)", async () => {
    writeState(buildAttestationState([makeOrphanedQuote(), makeDanglingQuote(), makeSourcedQuote(), makeRepeatedQuote()]));

    const reasonOf = async (fn: () => Promise<unknown>): Promise<string> => {
      try {
        await fn();
        throw new Error("expected fixQuoteEntity to reject");
      } catch (e) {
        return (e as Error).message;
      }
    };

    const orphaned = await reasonOf(() => fixQuoteEntity({ quote_id: "orphaned-quote-1", text: "anything" }));
    const dangling = await reasonOf(() => fixQuoteEntity({ quote_id: "dangling-quote-1", text: "anything" }));
    const noMatch = await reasonOf(() => fixQuoteEntity({ quote_id: "sourced-quote-1", text: "not present in the source at all" }));
    const offsetMismatch = await reasonOf(() =>
      fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect", start: 0, end: 1 })
    );

    const suffixes = [orphaned, dangling, noMatch, offsetMismatch].map((msg) => msg.split(": ").slice(1).join(": "));

    expect(new Set(suffixes).size).toBe(4);
    for (let i = 0; i < suffixes.length; i++) {
      for (let j = 0; j < suffixes.length; j++) {
        if (i === j) continue;
        expect(suffixes[i]).not.toContain(suffixes[j]);
      }
    }
  });

  it("re-verifies and recomputes offsets on an omitted-offset fix, correcting stale start/end while preserving links/provenance", async () => {
    // Deliberately stale start/end -- proves the fix RE-VERIFIES, it doesn't trust the existing record's own offsets.
    writeState(buildAttestationState([makeRepeatedQuote({ start: 999, end: 1031 })]));

    const fixed = await fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect" });

    expect(fixed).toMatchObject({
      id: "repeated-quote-1",
      message_id: ROOM_MSG_ID,
      text: "the lease bug is the real defect",
      start: 6,
      end: 38,
      data_item_ids: ["attest-fact-1"],
      persona_groups: ["General"],
      speaker: "human",
      channel: "Attest Room",
      created_at: "2020-01-01T00:00:00.000Z",
      created_by: "human",
    });
    expect(computeQuoteEmbedding).toHaveBeenCalledWith("the lease bug is the real defect");

    const persisted = await lookupById("repeated-quote-1");
    expect(persisted).toMatchObject({
      start: 6,
      end: 38,
      data_item_ids: ["attest-fact-1"],
      persona_groups: ["General"],
      created_at: "2020-01-01T00:00:00.000Z",
    });
  });

  it("preserves data_item_ids/persona_groups/created_at/created_by/message_id/speaker/timestamp/channel exactly, changing only text/start/end/embedding (T3 field table)", async () => {
    const before = makeSourcedQuote();
    writeState(buildAttestationState([before]));

    const fixed = await fixQuoteEntity({ quote_id: "sourced-quote-1", text: "the real defect lives here too" });

    expect(fixed.text).toBe("the real defect lives here too");
    expect(fixed.start).toBe(51);
    expect(fixed.end).toBe(81);
    expect(fixed.data_item_ids).toEqual(before.data_item_ids);
    expect(fixed.persona_groups).toEqual(before.persona_groups);
    expect(fixed.created_at).toBe(before.created_at);
    expect(fixed.created_by).toBe(before.created_by);
    expect(fixed.message_id).toBe(before.message_id);
    expect(fixed.speaker).toBe(before.speaker);
    expect(fixed.timestamp).toBe(before.timestamp);
    expect(fixed.channel).toBe(before.channel);

    const persisted = await lookupById("sourced-quote-1");
    expect(persisted).toMatchObject({
      text: "the real defect lives here too",
      start: 51,
      end: 81,
      data_item_ids: before.data_item_ids,
      persona_groups: before.persona_groups,
      created_at: before.created_at,
      created_by: before.created_by,
      message_id: before.message_id,
      speaker: before.speaker,
      channel: before.channel,
    });
  });

  it("first-span offsets (matching the matcher's own result) also succeed", async () => {
    writeState(buildAttestationState([makeRepeatedQuote()]));
    const fixed = await fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect", start: 6, end: 38 });
    expect(fixed).toMatchObject({ start: 6, end: 38 });
  });

  it.each([
    ["second-occurrence offsets", 50, 82],
    ["partial/malformed pair", 6, 7],
    ["out-of-range offsets", 9999, 10031],
  ] as Array<[string, number, number]>)("refuses with the offset-mismatch reason on %s, mutating nothing", async (_label, start, end) => {
    const before = makeRepeatedQuote();
    writeState(buildAttestationState([before]));
    await expect(
      fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect", start, end })
    ).rejects.toThrow("Cannot fix quote: offset does not match the resolved text location");

    const persisted = await lookupById("repeated-quote-1");
    expect(persisted).toMatchObject({ start: before.start, end: before.end, text: before.text });
  });

  it("refuses when only one of start/end is supplied", async () => {
    writeState(buildAttestationState([makeRepeatedQuote()]));
    await expect(
      fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect", start: 6 })
    ).rejects.toThrow(/offset does not match the resolved text location/);
  });
});

// -----------------------------------------------------------------------
// createQuoteEntity / fixQuoteEntity — self-drain skip surfaces as
// failure, not success (I2)
// -----------------------------------------------------------------------
// writeCorrection() returns a structured `{skipped: [...]}` diagnostic
// when its own synchronous self-drain (no live instance holding
// ei.lock) declines to materialize a just-queued record. Both endpoints
// must inspect it and fail visibly -- distinct from the live-lock case,
// where the correction only queues and is legitimately still pending.

describe("createQuoteEntity / fixQuoteEntity — self-drain skip surfaces as failure (I2)", () => {
  const EMPTY_CHANNEL_PERSONA_ID = "77777777-7777-4777-8777-777777777777";
  const EMPTY_CHANNEL_MSG_ID = "ei:dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const EMPTY_CHANNEL_CONTENT = "content whose derived channel ends up empty on create";

  function buildEmptyChannelState(): StorageState {
    return {
      version: 1,
      timestamp: INITIAL_NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes: [], last_updated: INITIAL_NOW },
      personas: {
        [EMPTY_CHANNEL_PERSONA_ID]: {
          entity: {
            id: EMPTY_CHANNEL_PERSONA_ID,
            // I2: an empty derived channel -- e.g. the legacy OpenCode
            // reader's own `session.title: ""` fallback reaches this same
            // wire-grammar gate; an empty persona display_name reproduces
            // the identical failure mode through the "ei-direct" path
            // without needing the OpenCode integration.
            display_name: "",
            entity: "system",
            short_description: "t",
            long_description: "t",
            model: "Local LLM:test-model",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: INITIAL_NOW,
          },
          messages: [
            { id: EMPTY_CHANNEL_MSG_ID, role: "human", content: EMPTY_CHANNEL_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
          ],
        },
      },
      queue: [],
      providers: [],
      tools: [],
    };
  }

  it("createQuoteEntity fails visibly (not success) when the derived channel is empty, persisting nothing, and the public error never echoes the internal validation reason (I1/I5)", async () => {
    writeState(buildEmptyChannelState());

    await expect(
      createQuoteEntity({ message_id: EMPTY_CHANNEL_MSG_ID, text: "derived channel ends up empty" })
    ).rejects.toThrow("Cannot create quote: the write could not be verified");

    const state = await loadLatestState();
    expect(state!.human.quotes).toHaveLength(0);
  });

  it("fixQuoteEntity reports failure (not success) when its queued fix is skipped because a concurrent remove took the target before this call's own self-drain, and does not resurrect it (I1/I5)", async () => {
    const before = makeRepeatedQuote();
    writeState(buildAttestationState([before]));

    // Simulate the exact race I2 describes: the target is removed
    // *between* this call's own lookup/verification (which already
    // succeeded against the still-present quote) and writeCorrection()'s
    // later self-drain -- by injecting the removal as a side effect of
    // computeQuoteEmbedding, the one async step that genuinely sits
    // between "verified" and "build the wire record & call
    // writeCorrection()" in the real implementation.
    const correctionsPath = join(tempDir, "corrections.json");
    vi.mocked(computeQuoteEmbedding).mockImplementationOnce(async () => {
      writeFileSync(correctionsPath, JSON.stringify([{ op: "quote.remove", entity_type: "quote", id: "repeated-quote-1" }]));
      return EMBEDDING;
    });

    await expect(
      fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect" })
    ).rejects.toThrow("Cannot fix quote: the write could not be verified");

    // The concurrent remove's own effect persists (it was a legitimate,
    // independent write) -- but the fix must not have resurrected the
    // quote or silently succeeded.
    const persisted = await lookupById("repeated-quote-1");
    expect(persisted).toBeNull();
  });

});

// -----------------------------------------------------------------------
// fixQuoteEntity — a stray persisted attempt_id cannot shadow the fresh
// fix token (I7)
// -----------------------------------------------------------------------
// fixQuoteEntity's wire record starts from `current` (the ALREADY-STORED
// Quote), which is untyped at the JSON boundary -- nothing statically
// prevents an extra runtime `attempt_id` property from existing on it
// (hand-edited state, or any past/future bug that let one leak through).
// Before the fix, `attempt_id: attemptId` was listed BEFORE `...quote` in
// the record literal, so a stray stored `attempt_id` would win via the
// later spread, silently replacing the fresh per-call token the endpoint
// relies on to recognize its own skip.

describe("fixQuoteEntity — a stray persisted attempt_id cannot shadow the fresh fix token (I7)", () => {
  it("still detects its own skip when the stored quote carries a stale attempt_id alongside another invalid field, instead of reporting false success", async () => {
    // Two independent kinds of pollution on the SAME stored quote:
    // speaker: "" is a wire-grammar violation that forces a skip (same
    // construct as T15); attempt_id is a stray runtime property that,
    // pre-fix, would have overwritten this call's fresh token via the
    // `...quote` spread in the wire record.
    const polluted = { ...makeRepeatedQuote({ speaker: "" }), attempt_id: "carried-forward-attempt" };
    writeState(buildAttestationState([polluted]));

    await expect(
      fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect" })
    ).rejects.toThrow("Cannot fix quote: the write could not be verified");

    // The skipped fix must not have replaced the stored quote: it stays
    // exactly as polluted (empty speaker, matching text/spans it would
    // also have after a genuine fix) -- proving this call's own attempt
    // was correctly detected as skipped by attempt_id, not laundered
    // into success by a stale token shadowing the fresh one.
    const persisted = await lookupById("repeated-quote-1");
    expect(persisted).toMatchObject({ speaker: "", text: "the lease bug is the real defect", start: 6, end: 38 });
  });
});

// -----------------------------------------------------------------------
// createQuoteEntity / fixQuoteEntity — an honest "queued, pending"
// response replaces a racy live-lock verification attempt (I8)
// -----------------------------------------------------------------------
// Under a live lock, writeCorrection() only appends -- nothing is
// validated synchronously, and whatever a live Processor eventually
// decides happens entirely in a different process, on its own loop.
// Re-deriving that outcome here via a fresh loadLatestState() overlay
// (the retired getLastCorrectionSkips() fallback) was a genuine race: a
// live Processor can drain and clear corrections.json at any point after
// the append returns, including before such a follow-up read runs.

describe("createQuoteEntity / fixQuoteEntity — an honest queued/pending response replaces a racy live-lock verification (I8)", () => {
  it("createQuoteEntity reports a distinct queued/pending response, never a confirmed success, when a live instance holds ei.lock", async () => {
    writeState(buildAttestationState([]));
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const originalStateBytes = readFileSync(statePath, "utf-8");
    writeFileSync(join(tempDir, "ei.lock"), JSON.stringify({ pid: process.pid }));

    const result = await createQuoteEntity({ message_id: ROOM_MSG_ID, text: "the lease bug is the real defect" });

    // Distinct shape from a confirmed Quote -- no text/message_id/etc --
    // so a caller checking for Quote-shaped fields cannot mistake this
    // for a durable create.
    expect(result).toEqual({
      status: "queued",
      id: expect.any(String),
      message: expect.stringContaining("queued"),
    });
    expect(result).not.toHaveProperty("text");
    expect(result).not.toHaveProperty("message_id");
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    const queued = JSON.parse(readFileSync(correctionsPath, "utf-8")) as Array<{ id: string }>;
    expect(queued).toHaveLength(1);
    expect(result.id).toBe(queued[0].id);
  });

  it("fixQuoteEntity reports the honest queued response and never races to re-inspect the queue, even when a live Processor would drain and clear it immediately afterward", async () => {
    // A malformed carried-forward field (empty speaker) that a real drain
    // would skip -- the same construct as T15/I7, exercised under a LIVE
    // LOCK instead of self-drain, matching I8's own reproduction.
    const before = makeRepeatedQuote({ speaker: "" });
    writeState(buildAttestationState([before]));
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const originalStateBytes = readFileSync(statePath, "utf-8");
    writeFileSync(join(tempDir, "ei.lock"), JSON.stringify({ pid: process.pid }));

    const result = await fixQuoteEntity({ quote_id: "repeated-quote-1", text: "the lease bug is the real defect" });

    // The endpoint's answer was already decided the instant
    // writeCorrection() reported drainMode "queued" -- before any drain
    // could possibly have happened.
    expect(result).toEqual({
      status: "queued",
      id: "repeated-quote-1",
      message: expect.stringContaining("queued"),
    });
    expect(result).not.toHaveProperty("text");
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    // Now simulate exactly what I8 describes: a live Processor, running
    // in a separate process, ticks its own loop right after this call's
    // append lands. It would skip this record for the empty speaker (the
    // same wire-grammar gate a self-drain enforces) and clear the queue --
    // entirely outside this process's view.
    const queuedBeforeDrain = JSON.parse(readFileSync(correctionsPath, "utf-8"));
    expect(queuedBeforeDrain).toHaveLength(1);
    writeFileSync(correctionsPath, "[]");

    // This is the exact danger the fix closes: re-deriving the outcome
    // via the retired getLastCorrectionSkips() overlay would now find
    // nothing at all and wrongly conclude success, because the record it
    // needs to see is already gone.
    await loadLatestState();
    expect(getLastCorrectionSkips()).toEqual([]);

    // But the endpoint never attempted that check -- the value it
    // already returned stayed the honest "queued" response throughout,
    // and neither this call nor the simulated drain touched state.json.
    expect(result).toEqual({
      status: "queued",
      id: "repeated-quote-1",
      message: expect.stringContaining("queued"),
    });
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);
  });
});

// -----------------------------------------------------------------------
// fixQuoteEntity — a same-id prior pending skip must not be attributed
// to this call's own successful write (I4)
// -----------------------------------------------------------------------
// The self-drain applies every pre-existing pending correction plus this
// call's own new record in one batch (src/cli/corrections-writer.ts),
// and QuoteCorrectionSkip carries only {record_id, reason} -- no
// per-attempt identity. If an unrelated, already-malformed pending
// correction for the SAME quote id happens to be sitting in
// corrections.json when this call runs, a same-id record_id match would
// wrongly attribute that older skip to this call even though this call's
// own record (always applied LAST in the batch) genuinely persisted.
// createQuoteEntity shares the identical read-back mechanism (see the
// matching comment in the source), but its fresh crypto.randomUUID()
// target makes a real same-id collision with a pre-existing pending
// correction practically unreachable, so only fixQuoteEntity -- whose
// target id is caller-supplied -- gets a dedicated regression here.

describe("fixQuoteEntity — a same-id prior pending skip does not fail this call's own successful write (I4)", () => {
  it("a malformed pending quote.fix for the same quote id, seeded before this call, does not cause a false failure once this call's own fix is genuinely applied", async () => {
    writeState(buildAttestationState([makeSourcedQuote()]));
    const correctionsPath = join(tempDir, "corrections.json");
    // An unrelated, already-pending correction for the SAME quote id --
    // malformed enough (missing every quote.fix-required field beyond
    // id/op/entity_type/verified) that assertValidQuoteCorrection skips
    // it. This must never be mistaken for this call's own record.
    writeFileSync(
      correctionsPath,
      JSON.stringify([{ op: "quote.fix", entity_type: "quote", id: "sourced-quote-1", verified: true }])
    );

    const fixed = await fixQuoteEntity({ quote_id: "sourced-quote-1", text: "the real defect lives here too" });

    expect(fixed.text).toBe("the real defect lives here too");
    expect(fixed.start).toBe(51);
    expect(fixed.end).toBe(81);

    const persisted = await lookupById("sourced-quote-1");
    expect(persisted).toMatchObject({ text: "the real defect lives here too", start: 51, end: 81 });

    // The whole batch -- the older malformed record included -- drains.
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");
  });
});

// -----------------------------------------------------------------------
// fixQuoteEntity — bare-UUID recovery after T5 migration (I3/T3)
// -----------------------------------------------------------------------
// T5's migrateMessageIds() conservatively leaves a Quote's message_id as
// a bare (unqualified) internal UUID when its stored text doesn't match
// the mapped source at migration time (src/core/migrations.ts). The real
// source message itself IS promoted to its qualified `ei:<uuid>` form
// regardless (migrateMessageIds' first pass qualifies every non-external
// persona/room message id unconditionally) -- these tests run the REAL
// migration first, to produce a genuinely T5-quarantined quote, then
// prove fixQuoteEntity's bare-UUID fallback can still resolve and repair
// it via the corrected text, for both a direct and a room source.

const MIGRATE_PERSONA_ID = "d3333333-3333-4333-8333-d33333333333";
const MIGRATE_ROOM_ID = "migrate-room-1";
const BARE_DIRECT_UUID = "d1111111-1111-4111-8111-d11111111111";
const BARE_ROOM_UUID = "d2222222-2222-4222-8222-d22222222222";
// Deliberately absent from either real message's content below -- this is
// what makes T5 leave message_id as the bare uuid, unqualified.
const STALE_TEXT = "this stale wording no longer appears anywhere";
const DIRECT_REAL_CONTENT = "The corrected direct content lives right here";
const ROOM_REAL_CONTENT = "The corrected room content also lives right here";

function buildPreMigrationState(): StorageState {
  return {
    version: 1,
    timestamp: INITIAL_NOW,
    human: {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [
        makeQuote({ id: "bare-direct-quote-1", message_id: BARE_DIRECT_UUID, text: STALE_TEXT, channel: "Migrate Persona" }),
        makeQuote({ id: "bare-room-quote-1", message_id: BARE_ROOM_UUID, text: STALE_TEXT, channel: "Migrate Room" }),
      ],
      last_updated: INITIAL_NOW,
    },
    personas: {
      [MIGRATE_PERSONA_ID]: {
        entity: {
          id: MIGRATE_PERSONA_ID,
          display_name: "Migrate Persona",
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
        messages: [
          { id: BARE_DIRECT_UUID, role: "human", content: DIRECT_REAL_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
        ],
      },
    },
    rooms: {
      [MIGRATE_ROOM_ID]: {
        id: MIGRATE_ROOM_ID,
        display_name: "Migrate Room",
        entity: "room",
        mode: RoomMode.FreeForAll,
        persona_ids: [MIGRATE_PERSONA_ID],
        active_node_id: null,
        is_archived: false,
        created_at: INITIAL_NOW,
        last_updated: INITIAL_NOW,
        messages: [
          { id: BARE_ROOM_UUID, parent_id: null, role: "human", content: ROOM_REAL_CONTENT, timestamp: INITIAL_NOW, read: false, context_status: ContextStatus.Default },
        ],
      },
    },
    queue: [],
    providers: [],
    tools: [],
  };
}

async function migrateAndCollectState(preload: StorageState): Promise<StorageState> {
  const stateManager = new StateManager();
  const storage = createMockStorage();
  vi.mocked(storage.load).mockResolvedValue(preload);
  await stateManager.initialize(storage);
  await migrateMessageIds(stateManager, false);

  const personas: StorageState["personas"] = {};
  for (const persona of stateManager.persona_getAll()) {
    personas[persona.id] = { entity: persona, messages: stateManager.messages_get(persona.id) };
  }

  const rooms: StorageState["rooms"] = {};
  for (const summary of stateManager.getRoomList(true)) {
    const room = stateManager.getRoom(summary.id);
    if (room) rooms[room.id] = room;
  }

  return {
    version: 1,
    timestamp: INITIAL_NOW,
    human: stateManager.getHuman(),
    personas,
    rooms,
    queue: [],
    providers: [],
    tools: [],
  };
}

describe("fixQuoteEntity — bare-UUID recovery after T5 migration (I3/T3)", () => {
  it("migration leaves both quotes' message_id as the bare UUID, but promotes both real messages to their qualified form", async () => {
    const migrated = await migrateAndCollectState(buildPreMigrationState());

    const directQuote = migrated.human.quotes.find((q) => q.id === "bare-direct-quote-1")!;
    const roomQuote = migrated.human.quotes.find((q) => q.id === "bare-room-quote-1")!;
    expect(directQuote.message_id).toBe(BARE_DIRECT_UUID);
    expect(roomQuote.message_id).toBe(BARE_ROOM_UUID);

    expect(migrated.personas[MIGRATE_PERSONA_ID].messages[0].id).toBe(`ei:${BARE_DIRECT_UUID}`);
    expect(migrated.rooms![MIGRATE_ROOM_ID].messages[0].id).toBe(`ei:${BARE_ROOM_UUID}`);
  });

  it("repairs a T5-quarantined bare-UUID DIRECT quote with the real corresponding text, leaving message_id's format unchanged", async () => {
    writeState(await migrateAndCollectState(buildPreMigrationState()));

    const fixed = await fixQuoteEntity({ quote_id: "bare-direct-quote-1", text: "corrected direct content lives right here" });

    expect(fixed.message_id).toBe(BARE_DIRECT_UUID); // still bare -- fix never upgrades the locator
    expect(fixed.text).toBe("corrected direct content lives right here");

    const persisted = await lookupById("bare-direct-quote-1");
    expect(persisted).toMatchObject({ message_id: BARE_DIRECT_UUID, text: "corrected direct content lives right here" });
  });

  it("repairs a T5-quarantined bare-UUID ROOM quote with the real corresponding text, leaving message_id's format unchanged", async () => {
    writeState(await migrateAndCollectState(buildPreMigrationState()));

    const fixed = await fixQuoteEntity({ quote_id: "bare-room-quote-1", text: "corrected room content also lives right here" });

    expect(fixed.message_id).toBe(BARE_ROOM_UUID);
    expect(fixed.text).toBe("corrected room content also lives right here");

    const persisted = await lookupById("bare-room-quote-1");
    expect(persisted).toMatchObject({ message_id: BARE_ROOM_UUID, text: "corrected room content also lives right here" });
  });

  it("still refuses with the dangling reason for a bare UUID that matches no local message at all", async () => {
    const migrated = await migrateAndCollectState(buildPreMigrationState());
    migrated.human.quotes.push(
      makeQuote({ id: "bare-orphan-quote-1", message_id: "ffffffff-ffff-4fff-8fff-ffffffffffff", text: "anything", channel: "Migrate Persona" })
    );
    writeState(migrated);

    await expect(fixQuoteEntity({ quote_id: "bare-orphan-quote-1", text: "anything" })).rejects.toThrow(
      "Cannot fix quote: source message could not be found"
    );
  });
});

// -----------------------------------------------------------------------
// verifyQuoteAgainstSource — verification errors are sanitized, no
// caller-controlled text or local hostname leak (I1/T8)
// -----------------------------------------------------------------------
// resolveExternalMessage's "refused"/"error" results can carry
// caller-controlled id text (a refusal's `reason`) or this machine's own
// hostname (a cross-machine `error`, via getMachineId()). Neither may
// ever be echoed into the create/fix public error -- the stable, named
// "source message could not be found" reason is the only thing a caller
// sees, regardless of what the resolver internally reported.

describe("createQuoteEntity / fixQuoteEntity — verification errors are sanitized (I1/T8)", () => {
  it("a control-character-bearing generated-document id never leaks into the create error", async () => {
    writeState(buildAttestationState([]));
    const evilId = "generate:document:evil\x07bell\x1b[31mred\x1b[0m:00000000-0000-4000-8000-000000000000";

    let caught: Error | undefined;
    try {
      await createQuoteEntity({ message_id: evilId, text: "anything" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot create quote: source message could not be found");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(caught!.message)).toBe(false);
  });

  it("a control-character-bearing nonexistent quote_id never leaks the raw refusal detail into the fix error", async () => {
    writeState(buildAttestationState([makeSourcedQuote({ message_id: "generate:document:slug\x1b[31m:00000000-0000-4000-8000-000000000001" })]));

    let caught: Error | undefined;
    try {
      await fixQuoteEntity({ quote_id: "sourced-quote-1", text: "anything" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot fix quote: source message could not be found");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(caught!.message)).toBe(false);
  });

  it("a control-character-bearing quote_id that matches no quote never leaks the raw id into the not-found error (I1 round 2)", async () => {
    writeState(buildAttestationState([]));
    const evilQuoteId = "does-not-exist\x07bell\x1b[31mred\x1b[0m";

    let caught: Error | undefined;
    try {
      await fixQuoteEntity({ quote_id: evilQuoteId, text: "anything" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot fix quote: no quote found with the supplied id");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(caught!.message)).toBe(false);
    expect(caught!.message).not.toContain(evilQuoteId);
    expect(caught!.message).not.toContain("does-not-exist");
  });

  it("a foreign-machine external id never discloses this machine's real hostname in the create error", async () => {
    writeState(buildAttestationState([]));
    const realMachineId = getMachineId();
    const foreignId = `opencode:${realMachineId}-not-this-one:some-session:msg_foo`;

    let caught: Error | undefined;
    try {
      await createQuoteEntity({ message_id: foreignId, text: "anything" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot create quote: source message could not be found");
    expect(caught!.message).not.toContain(realMachineId);
  });

  it("a foreign-machine external id never discloses this machine's real hostname in the fix error", async () => {
    const realMachineId = getMachineId();
    const foreignId = `opencode:${realMachineId}-not-this-one:some-session:msg_foo`;
    writeState(buildAttestationState([makeSourcedQuote({ message_id: foreignId })]));

    let caught: Error | undefined;
    try {
      await fixQuoteEntity({ quote_id: "sourced-quote-1", text: "anything" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot fix quote: source message could not be found");
    expect(caught!.message).not.toContain(realMachineId);
  });
});

// -----------------------------------------------------------------------
// createQuoteEntity / fixQuoteEntity — attempt_id replaces the retired
// final-state-equality check (I1 remaining leak / I5, round 3)
// -----------------------------------------------------------------------
// Round 3 found two related but distinct defects in the round-2 repair:
//   I1 (remaining): a genuine post-write skip still surfaced its raw
//   internal `reason` (which can interpolate a caller-selected quote id,
//   e.g. a concurrent quote.remove's `quote "<id>" does not exist`) as
//   the PUBLIC error.
//   I5: the round-2 fix's own success predicate -- final-state text/
//   start/end equality -- cannot distinguish "my write applied" from
//   "the value already happened to be right," since it never observes
//   an operation identity.
// Both are closed by the SAME mechanism: attempt_id, a fresh
// crypto.randomUUID() minted per call, threaded through the wire record
// so writeCorrection()'s own skip result (self-drain) or the read
// overlay's getLastCorrectionSkips() (live-lock/backup-only) can prove
// with certainty whether THIS call's own record was skipped -- and, when
// it was, the caller always gets the same fixed, id-free refusal
// regardless of what the internal skip reason said.

describe("createQuoteEntity / fixQuoteEntity — post-write skip is an id-free, attempt_id-verified refusal (I1/I5, round 3)", () => {
  it("T14: a control-bearing durable quote id plus a post-verification remove produces an id-free, control-character-free refusal — never the raw id or the raw internal skip reason", async () => {
    const evilId = "attest\x07bell\x1b[31mred\x1b[0mquote-1";
    const before = makeRepeatedQuote({ id: evilId });
    writeState(buildAttestationState([before]));

    // Same technique as the I2 concurrent-remove test above: the removal
    // is injected as a side effect of computeQuoteEmbedding, the one
    // async step that genuinely sits between "verified" and "build the
    // wire record & call writeCorrection()" in the real implementation.
    const correctionsPath = join(tempDir, "corrections.json");
    vi.mocked(computeQuoteEmbedding).mockImplementationOnce(async () => {
      writeFileSync(correctionsPath, JSON.stringify([{ op: "quote.remove", entity_type: "quote", id: evilId }]));
      return EMBEDDING;
    });

    let caught: Error | undefined;
    try {
      await fixQuoteEntity({ quote_id: evilId, text: "the lease bug is the real defect" });
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).toBeDefined();
    expect(caught!.message).toBe("Cannot fix quote: the write could not be verified");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(caught!.message)).toBe(false);
    expect(caught!.message).not.toContain(evilId);
    expect(caught!.message).not.toContain("does not exist");
    expect(caught!.message).not.toContain("quote.create");

    // The concurrent remove's own effect persists; the fix did not
    // resurrect the quote or silently succeed.
    const persisted = await lookupById(evilId);
    expect(persisted).toBeNull();
  });

  it("T15: a malformed carried-forward quote field causes a skip even when the old text/spans coincidentally equal the requested match — the endpoint rejects, never claims a fresh write", async () => {
    // current.speaker is empty -- a value wire validation forbids on
    // every real write path (this simulates hand-edited/pre-migration
    // state). Its text/start/end already equal what this call requests,
    // so the retired final-state-equality check would have wrongly
    // reported success; attempt_id does not.
    const malformed = makeRepeatedQuote({ id: "malformed-speaker-quote", speaker: "" });
    writeState(buildAttestationState([malformed]));

    await expect(
      fixQuoteEntity({ quote_id: "malformed-speaker-quote", text: "the lease bug is the real defect" })
    ).rejects.toThrow("Cannot fix quote: the write could not be verified");

    const persisted = await lookupById("malformed-speaker-quote");
    expect(persisted).toMatchObject({ speaker: "", text: "the lease bug is the real defect", start: 6, end: 38 });
  });

  it("T16: an unrelated later create sharing the same id cannot launder an already-skipped fix into success", async () => {
    // Round 3's [INFERENCE]: a queued remove(Q) -> this fix (skipped,
    // since Q no longer exists when it applies) -> a fully independent
    // LATER write reusing the same id with a coincidentally matching
    // projection. Exercised directly against writeCorrection() (the
    // exact mechanism createQuoteEntity/fixQuoteEntity rely on) since a
    // genuine cross-call race cannot be made deterministic through the
    // full endpoint without production-only test hooks.
    const before = makeRepeatedQuote();
    writeState(buildAttestationState([before]));
    const correctionsPath = join(tempDir, "corrections.json");
    writeFileSync(correctionsPath, JSON.stringify([{ op: "quote.remove", entity_type: "quote", id: "repeated-quote-1" }]));

    const fixResult = await writeCorrection({
      op: "quote.fix",
      entity_type: "quote",
      id: "repeated-quote-1",
      attempt_id: "attempt-under-test",
      message_id: ROOM_MSG_ID,
      data_item_ids: [],
      persona_groups: [],
      text: "the lease bug is the real defect",
      speaker: "human",
      channel: "Attest Room",
      timestamp: INITIAL_NOW,
      start: 6,
      end: 38,
      created_at: INITIAL_NOW,
      created_by: "human",
      embedding: EMBEDDING,
      verified: true,
    });

    expect(fixResult.skipped).toEqual([
      { record_id: "repeated-quote-1", attempt_id: "attempt-under-test", reason: expect.stringContaining("does not exist") },
    ]);

    // A fully independent, LATER write reuses the same id with a
    // projection that coincidentally matches the fix above.
    await writeCorrection({
      op: "quote.create",
      entity_type: "quote",
      id: "repeated-quote-1",
      attempt_id: "later-writer-attempt",
      message_id: ROOM_MSG_ID,
      data_item_ids: [],
      persona_groups: [],
      text: "the lease bug is the real defect",
      speaker: "human",
      channel: "Attest Room",
      timestamp: INITIAL_NOW,
      start: 6,
      end: 38,
      created_at: INITIAL_NOW,
      created_by: "extraction",
      embedding: EMBEDDING,
      verified: true,
    });

    // The coincidental-match premise is real: final state now DOES show
    // matching text/start/end -- a final-state check would be fooled.
    const persisted = await lookupById("repeated-quote-1");
    expect(persisted).toMatchObject({ text: "the lease bug is the real defect", start: 6, end: 38 });

    // But the fix's own already-settled skip evidence never changes:
    // attempt_id "attempt-under-test" was, and remains, the one skipped
    // record -- unaffected by the later create's unrelated attempt_id.
    expect(fixResult.skipped[0].attempt_id).toBe("attempt-under-test");
  });
});

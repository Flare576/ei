import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { writeCorrection } from "../../../src/cli/corrections-writer.js";
import { appendCorrection } from "../../../src/core/corrections.js";
import { acquireLock, releaseLock } from "../../../src/storage/file-lock.js";
import type { CorrectionRecord, QuoteCreateRecord, QuoteFixRecord, QuoteRelinkRecord, QuoteRemoveRecord } from "../../../src/core/corrections.js";
import type { Fact, Topic, Quote, Person, PersonaEntity, Message, StorageState } from "../../../src/core/types.js";

const NOW = "2026-01-01T00:00:00Z";

function makeFact(overrides: Partial<Fact> = {}): Fact {
  return {
    id: "fact-1",
    name: "Fact 1",
    description: "A fact worth keeping accurate",
    sentiment: 0.5,
    last_updated: NOW,
    validated_date: NOW,
    ...overrides,
  };
}

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: "topic-1",
    name: "Topic 1",
    description: "A topic worth tracking",
    sentiment: 0.25,
    last_updated: NOW,
    category: "Interest",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    ...overrides,
  };
}

function makeQuote(data_item_ids: string[], overrides: Partial<Quote> = {}): Quote {
  return {
    id: "quote-1",
    text: "A supporting quote",
    speaker: "human",
    timestamp: NOW,
    message_id: null,
    data_item_ids,
    persona_groups: [],
    start: null,
    end: null,
    created_at: NOW,
    created_by: "human",
    ...overrides,
  };
}

/** Builds a valid `quote.create` wire record — makeQuote's fields plus the create-only structural fields (op/entity_type/channel/embedding/verified). data_item_ids/persona_groups default empty, matching create's own constraint. */
function makeQuoteCreateRecord(overrides: Partial<QuoteCreateRecord> = {}): QuoteCreateRecord {
  return { op: "quote.create", entity_type: "quote", attempt_id: crypto.randomUUID(), ...makeQuote([]), channel: "Test Channel", embedding: [0.1, 0.2, 0.3], verified: true, ...overrides };
}

/** Builds a valid `quote.fix` wire record. Unlike create, fix does not require empty data_item_ids/persona_groups. */
function makeQuoteFixRecord(dataItemIds: string[] = [], overrides: Partial<QuoteFixRecord> = {}): QuoteFixRecord {
  return { op: "quote.fix", entity_type: "quote", attempt_id: crypto.randomUUID(), ...makeQuote(dataItemIds), channel: "Test Channel", embedding: [0.1, 0.2, 0.3], verified: true, ...overrides };
}

/** Builds a valid `quote.relink` wire record — `{id, data_item_ids}` only. */
function makeQuoteRelinkRecord(id: string, dataItemIds: string[]): QuoteRelinkRecord {
  return { op: "quote.relink", entity_type: "quote", id, data_item_ids: dataItemIds };
}

/** Builds a valid `quote.remove` wire record — `{id}` only. */
function makeQuoteRemoveRecord(id: string): QuoteRemoveRecord {
  return { op: "quote.remove", entity_type: "quote", id };
}

function makePersona(overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id: "persona-1",
    display_name: "Persona 1",
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: NOW,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person-1",
    name: "Person 1",
    description: "A person worth remembering accurately",
    sentiment: 0.5,
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers: [{ type: "Nickname", value: "Person 1", is_primary: true }],
    ...overrides,
  };
}

function buildState(overrides: {
  facts?: Fact[];
  topics?: Topic[];
  quotes?: Quote[];
  people?: Person[];
  personas?: StorageState["personas"];
} = {}): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: overrides.facts ?? [],
      traits: [],
      people: overrides.people ?? [],
      topics: overrides.topics ?? [],
      quotes: overrides.quotes ?? [],
      last_updated: NOW,
    },
    personas: overrides.personas ?? {},
    queue: [],
  } as StorageState;
}

function writeJson(path: string, value: unknown) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ei-corrections-writer-"));
  process.env.EI_DATA_PATH = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined as unknown as string;
  delete process.env.EI_DATA_PATH;
});

describe("writeCorrection — self-drain and branch selection", () => {
  it("removes a deleted fact from state.json and strips its quote links during self-drain", async () => {
    const fact = makeFact({ id: "fact-remove" });
    const survivingTopic = makeTopic({ id: "topic-keep" });
    const statePath = join(tempDir, "state.json");
    writeJson(
      statePath,
      buildState({
        facts: [fact],
        topics: [survivingTopic],
        quotes: [makeQuote([fact.id, survivingTopic.id])],
      }),
    );

    const removeFact: CorrectionRecord = {
      op: "remove",
      entity_type: "fact",
      id: fact.id,
      timestamp: NOW,
    };

    await writeCorrection(removeFact);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.facts.map((item) => item.id)).toEqual([]);
    expect(persisted.human.quotes[0].data_item_ids).toEqual([survivingTopic.id]);
  });

  it("removes a deleted topic from state.json and strips its quote links during self-drain", async () => {
    const fact = makeFact({ id: "fact-keep" });
    const topic = makeTopic({ id: "topic-remove" });
    const statePath = join(tempDir, "state.json");
    writeJson(
      statePath,
      buildState({
        facts: [fact],
        topics: [topic],
        quotes: [makeQuote([topic.id, fact.id])],
      }),
    );

    const removeTopic: CorrectionRecord = {
      op: "remove",
      entity_type: "topic",
      id: topic.id,
      timestamp: NOW,
    };

    await writeCorrection(removeTopic);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.topics.map((item) => item.id)).toEqual([]);
    expect(persisted.human.quotes[0].data_item_ids).toEqual([fact.id]);
  });

  it("rejects a queued correction with an unknown entity_type instead of corrupting state.json", async () => {
    const fact = makeFact({ id: "fact-existing" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact], quotes: [makeQuote([fact.id])] }));
    writeJson(correctionsPath, [
      {
        op: "upsert",
        entity_type: "not-a-real-type",
        id: "bad-1",
        record: { description: "should never be reinterpreted as a person" },
        timestamp: NOW,
      },
    ]);
    const originalState = readFileSync(statePath, "utf-8");

    let error: unknown;
    try {
      await writeCorrection({
        op: "remove",
        entity_type: "fact",
        id: fact.id,
        timestamp: NOW,
      });
    } catch (caught) {
      error = caught;
    }

    expect(readFileSync(statePath, "utf-8")).toBe(originalState);
    expect(error).toBeInstanceOf(Error);
  });

  it("queues a removal without touching state.json while a live Ei instance owns ei.lock", async () => {
    const fact = makeFact({ id: "fact-live-instance" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact] }));
    writeJson(join(tempDir, "ei.lock"), { pid: process.pid });
    const originalState = readFileSync(statePath, "utf-8");

    const removeFact: CorrectionRecord = {
      op: "remove",
      entity_type: "fact",
      id: fact.id,
      timestamp: NOW,
    };

    const result = await writeCorrection(removeFact);

    expect(result).toEqual({ skipped: [], drainMode: "queued" });
    expect(readFileSync(statePath, "utf-8")).toBe(originalState);
    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([removeFact]);
  });

  it("rejects an existing queued correction with a malformed op without rewriting state.json", async () => {
    const fact = makeFact({ id: "fact-existing" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact] }));
    writeJson(correctionsPath, [
      {
        op: "delete",
        entity_type: "fact",
        id: fact.id,
        timestamp: NOW,
      },
    ]);
    const originalState = readFileSync(statePath, "utf-8");

    await expect(
      writeCorrection({
        op: "remove",
        entity_type: "fact",
        id: fact.id,
        timestamp: NOW,
      }),
    ).rejects.toThrow(/op must be "upsert" or "remove"/);
    expect(readFileSync(statePath, "utf-8")).toBe(originalState);
  });

  it("rejects an existing queued upsert whose wrapper id and record id disagree without rewriting state.json", async () => {
    const fact = makeFact({ id: "fact-existing" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact] }));
    writeJson(correctionsPath, [
      {
        op: "upsert",
        entity_type: "fact",
        id: "fact-wrapper",
        record: makeFact({ id: "fact-record" }),
        timestamp: NOW,
      },
    ]);
    const originalState = readFileSync(statePath, "utf-8");

    await expect(
      writeCorrection({
        op: "remove",
        entity_type: "fact",
        id: fact.id,
        timestamp: NOW,
      }),
    ).rejects.toThrow(/record\.id .* must equal wrapper id/);
    expect(readFileSync(statePath, "utf-8")).toBe(originalState);
  });

  it("rejects invalid JSON syntax in corrections.json without rewriting state.json", async () => {
    const fact = makeFact({ id: "fact-existing" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact] }));
    writeFileSync(correctionsPath, "[");
    const originalState = readFileSync(statePath, "utf-8");

    await expect(
      writeCorrection({
        op: "remove",
        entity_type: "fact",
        id: fact.id,
        timestamp: NOW,
      }),
    ).rejects.toThrow(SyntaxError);
    expect(readFileSync(statePath, "utf-8")).toBe(originalState);
  });

  it("queues the correction when only state.backup.json exists and does not fabricate state.json", async () => {
    const backupPath = join(tempDir, "state.backup.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeFileSync(backupPath, "{}\n");

    const removeFact: CorrectionRecord = {
      op: "remove",
      entity_type: "fact",
      id: "fact-queued",
      timestamp: NOW,
    };

    const result = await writeCorrection(removeFact);

    expect(result).toEqual({ skipped: [], drainMode: "queued" });
    expect(existsSync(join(tempDir, "state.json"))).toBe(false);
    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([removeFact]);
  });

  it("throws a hard error when neither state.json nor state.backup.json exists", async () => {
    const missingStateRecord: CorrectionRecord = {
      op: "remove",
      entity_type: "topic",
      id: "topic-missing-state",
      timestamp: NOW,
    };

    await expect(writeCorrection(missingStateRecord)).rejects.toThrow(/No Ei data found/);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("never silently loses a correction appended by another writer while self-drain is in progress (I4)", async () => {
    const fact = makeFact({ id: "fact-remove" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState({ facts: [fact] }));

    // Hold correctionsPath's lock ourselves to force writeCorrection's
    // self-drain to block on lock acquisition — deterministically
    // reproducing "a concurrent writer is mid-append while self-drain
    // wants to read+clear the queue" without any wall-clock timing.
    const acquired = await acquireLock(correctionsPath);
    expect(acquired).toBe(true);

    const removeFact: CorrectionRecord = {
      op: "remove",
      entity_type: "fact",
      id: fact.id,
      timestamp: NOW,
    };
    const concurrentUpsert: CorrectionRecord = {
      op: "upsert",
      entity_type: "topic",
      id: "topic-concurrent",
      record: makeTopic({ id: "topic-concurrent" }),
      timestamp: NOW,
    };

    // Starts self-drain for removeFact — it will block acquiring
    // correctionsPath's lock since we're holding it.
    const drainPromise = writeCorrection(removeFact);

    // Simulate a second writer appending while the lock is held. Under the
    // pre-fix code (lock only on statePath), self-drain's unlocked read of
    // corrections.json plus unconditional "[]" clear could read before this
    // append lands and then wipe it out. Under the fix, appendCorrection
    // blocks on the same correctionsPath lock we're holding, so it cannot
    // interleave with self-drain's read/apply/clear at all.
    const appendPromise = appendCorrection(correctionsPath, concurrentUpsert);

    await releaseLock(correctionsPath);
    await Promise.all([drainPromise, appendPromise]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.facts.map((item) => item.id)).toEqual([]);

    // The concurrent upsert must have survived — either applied into
    // state.json (if it was serialized before self-drain's read) or still
    // sitting in corrections.json (if it landed after), but never silently
    // dropped by an overlapping unlocked clear.
    const topicInState = persisted.human.topics.some((t) => t.id === "topic-concurrent");
    const remainingCorrections = existsSync(correctionsPath) ? readJson<CorrectionRecord[]>(correctionsPath) : [];
    const topicStillQueued = remainingCorrections.some((c) => c.id === "topic-concurrent");
    expect(topicInState || topicStillQueued).toBe(true);
  });

  it("applies pre-queued mixed fact+persona corrections plus a new write during self-drain, preserving persona messages and clearing the queue (T5)", async () => {
    const existingMessage: Message = {
      id: "msg-1",
      role: "human",
      content: "Hello from before",
      timestamp: NOW,
      read: true,
      context_status: "default" as Message["context_status"],
    };
    const existingPersona = makePersona({ id: "persona-existing", display_name: "Existing Persona" });
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(
      statePath,
      buildState({
        personas: {
          "persona-existing": { entity: existingPersona, messages: [existingMessage] },
        },
      }),
    );

    // Pending corrections already queued from a prior write: a fact upsert and a persona upsert.
    const pendingFact: CorrectionRecord = {
      op: "upsert",
      entity_type: "fact",
      id: "fact-pending",
      record: makeFact({ id: "fact-pending", name: "Pending Fact" }),
      timestamp: NOW,
    };
    const pendingPersona: CorrectionRecord = {
      op: "upsert",
      entity_type: "persona",
      id: "persona-existing",
      record: makePersona({ id: "persona-existing", display_name: "Updated Persona Name" }),
      timestamp: NOW,
    };
    writeJson(correctionsPath, [pendingFact, pendingPersona]);

    // A brand new correction arrives now with no live instance running -> self-drain.
    const newTopic: CorrectionRecord = {
      op: "upsert",
      entity_type: "topic",
      id: "topic-new",
      record: makeTopic({ id: "topic-new", name: "Freshly Written Topic" }),
      timestamp: NOW,
    };

    await writeCorrection(newTopic);

    const persisted = readJson<StorageState>(statePath);

    // The pending fact landed in state.human.
    expect(persisted.human.facts.some((f) => f.id === "fact-pending" && f.name === "Pending Fact")).toBe(true);
    // The pending persona landed in state.personas, fully replaced, with messages preserved.
    expect(persisted.personas["persona-existing"].entity.display_name).toBe("Updated Persona Name");
    expect(persisted.personas["persona-existing"].messages).toEqual([existingMessage]);
    // The new write's own correction applied too.
    expect(persisted.human.topics.some((t) => t.id === "topic-new")).toBe(true);

    // Queue cleared.
    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });
});

describe("writeCorrection — quote corrections (Corrections Wire Grammar)", () => {
  it("self-drains a quote.create correction into state.json, never leaking the wire-only verified marker or attempt_id onto the persisted Quote", async () => {
    const statePath = join(tempDir, "state.json");
    writeJson(statePath, buildState());

    const result = await writeCorrection(makeQuoteCreateRecord());

    expect(result).toEqual({ skipped: [], drainMode: "self" });
    const persisted = readJson<StorageState>(statePath);
    const applied = persisted.human.quotes.find((q) => q.id === "quote-1");
    expect(applied).toBeDefined();
    expect(applied).not.toHaveProperty("verified");
    expect(applied).not.toHaveProperty("attempt_id");
  });

  it("self-drains a quote.relink correction, changing only data_item_ids and leaving every other field byte-identical", async () => {
    const statePath = join(tempDir, "state.json");
    const existing = makeQuote(["merged-person"]);
    writeJson(statePath, buildState({ quotes: [existing], people: [makePerson({ id: "split-person" })] }));

    const result = await writeCorrection(makeQuoteRelinkRecord("quote-1", ["split-person"]));

    expect(result).toEqual({ skipped: [], drainMode: "self" });
    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes).toEqual([{ ...existing, data_item_ids: ["split-person"] }]);
  });

  it("self-drains a quote.remove correction", async () => {
    const statePath = join(tempDir, "state.json");
    writeJson(statePath, buildState({ quotes: [makeQuote([])] }));

    const result = await writeCorrection(makeQuoteRemoveRecord("quote-1"));

    expect(result).toEqual({ skipped: [], drainMode: "self" });
    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes).toEqual([]);
  });

  it("skips a pre-cutover unmarked full-record quote correction during self-drain, applies a valid quote.remove and a valid person upsert in the same batch, and returns exactly one skip from writeCorrection()", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const survivingQuote = makeQuote([], { id: "quote-keep" });
    const removableQuote = makeQuote([], { id: "quote-remove-me" });
    writeJson(statePath, buildState({ quotes: [survivingQuote, removableQuote] }));

    const legacyForgedRecord = {
      op: "upsert",
      entity_type: "quote",
      id: "quote-forged",
      record: makeQuote([], { id: "quote-forged", text: "forged text" }),
      timestamp: NOW,
    } as unknown as CorrectionRecord;
    writeJson(correctionsPath, [legacyForgedRecord, makeQuoteRemoveRecord("quote-remove-me")]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-forged", reason: expect.stringContaining("quote.create") }]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes.find((q) => q.id === "quote-forged")).toBeUndefined();
    expect(persisted.human.quotes.find((q) => q.id === "quote-remove-me")).toBeUndefined();
    expect(persisted.human.quotes.find((q) => q.id === "quote-keep")).toBeDefined();
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });

  it("T1: self-drain — a stale quote.fix does not recreate a quote removed earlier in the same batch, or restore a link an earlier fact removal already cleared, and writeCorrection() still applies a following valid correction (C1)", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const linkedFact = makeFact({ id: "fact-linked" });
    const quoteLinked = makeQuote(["fact-linked"], { id: "quote-linked" });
    const quoteDoomed = makeQuote([], { id: "quote-doomed" });
    writeJson(statePath, buildState({ facts: [linkedFact], quotes: [quoteLinked, quoteDoomed] }));

    const staleFixForLinked = makeQuoteFixRecord(["fact-linked"], { id: "quote-linked", persona_groups: ["stale-group"], text: "stale corrected text" });
    const staleFixForDoomed = makeQuoteFixRecord([], { id: "quote-doomed", text: "should never land" });

    // File order matters: both removals land BEFORE the stale fixes that
    // target their now-gone quote/link, exactly like C1's trigger.
    writeJson(correctionsPath, [
      { op: "remove", entity_type: "fact", id: "fact-linked", timestamp: NOW },
      makeQuoteRemoveRecord("quote-doomed"),
      staleFixForLinked,
      staleFixForDoomed,
    ]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-doomed", attempt_id: staleFixForDoomed.attempt_id, reason: expect.stringContaining("does not exist") }]);

    const persisted = readJson<StorageState>(statePath);
    // The removed quote was never recreated by the stale fix that targeted it.
    expect(persisted.human.quotes.find((q) => q.id === "quote-doomed")).toBeUndefined();
    // The surviving quote's fix applied its text change but did NOT restore
    // the link the fact removal already cleared.
    const fixedQuote = persisted.human.quotes.find((q) => q.id === "quote-linked");
    expect(fixedQuote).toBeDefined();
    expect(fixedQuote!.text).toBe("stale corrected text");
    expect(fixedQuote!.data_item_ids).toEqual([]);
    expect(fixedQuote!.persona_groups).toEqual([]);
    expect(persisted.human.facts.find((f) => f.id === "fact-linked")).toBeUndefined();
    // The following valid correction still applied.
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });

  it("T2: self-drain skips a quote.relink with a missing entity_type and writeCorrection() still applies a later valid correction, with no throw (I2)", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const survivingQuote = makeQuote([], { id: "quote-keep" });
    writeJson(statePath, buildState({ quotes: [survivingQuote] }));

    const malformedRelink = { op: "quote.relink", id: "quote-keep", data_item_ids: ["anything"] } as unknown as CorrectionRecord;
    writeJson(correctionsPath, [malformedRelink]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-keep", reason: expect.stringContaining("entity_type") }]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes.find((q) => q.id === "quote-keep")?.data_item_ids).toEqual([]);
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });

  it("T2: self-drain skips a quote.create with a missing entity_type and writeCorrection() still applies a later valid correction, with no throw (I6)", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    writeJson(statePath, buildState());

    const malformedCreate: Record<string, unknown> = { ...makeQuoteCreateRecord({ id: "quote-new" }) };
    delete malformedCreate.entity_type;
    writeJson(correctionsPath, [malformedCreate]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-new", attempt_id: malformedCreate.attempt_id, reason: expect.stringContaining("entity_type") }]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes.find((q) => q.id === "quote-new")).toBeUndefined();
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });

  it("T2: self-drain skips a quote.fix with a missing entity_type and writeCorrection() still applies a later valid correction, with no throw (I6)", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const survivingQuote = makeQuote([], { id: "quote-keep" });
    writeJson(statePath, buildState({ quotes: [survivingQuote] }));

    const malformedFix: Record<string, unknown> = { ...makeQuoteFixRecord([], { id: "quote-keep", text: "should never land" }) };
    delete malformedFix.entity_type;
    writeJson(correctionsPath, [malformedFix]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-keep", attempt_id: malformedFix.attempt_id, reason: expect.stringContaining("entity_type") }]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes.find((q) => q.id === "quote-keep")?.text).toBe(survivingQuote.text);
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });

  it("T2: self-drain skips a quote.remove with a missing entity_type and writeCorrection() still applies a later valid correction, with no throw (I6)", async () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const survivingQuote = makeQuote([], { id: "quote-keep" });
    writeJson(statePath, buildState({ quotes: [survivingQuote] }));

    const malformedRemove: Record<string, unknown> = { ...makeQuoteRemoveRecord("quote-keep") };
    delete malformedRemove.entity_type;
    writeJson(correctionsPath, [malformedRemove]);

    const goodPerson = makePerson({ id: "person-new" });
    const result = await writeCorrection({
      op: "upsert",
      entity_type: "person",
      id: goodPerson.id,
      record: goodPerson,
      timestamp: NOW,
    });

    expect(result.skipped).toEqual([{ record_id: "quote-keep", reason: expect.stringContaining("entity_type") }]);

    const persisted = readJson<StorageState>(statePath);
    expect(persisted.human.quotes.find((q) => q.id === "quote-keep")).toBeDefined();
    expect(persisted.human.people.find((p) => p.id === "person-new")).toBeDefined();

    expect(readJson<CorrectionRecord[]>(correctionsPath)).toEqual([]);
  });
});

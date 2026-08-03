/**
 * Unmocked end-to-end integration for `ei_quote_create` / `ei_quote_fix`:
 * a real MCP server (createMcpServer, undocked from any mock) driven
 * through a real InMemoryTransport client, against a scratch EI_DATA_PATH.
 *
 * Distinct from tests/unit/cli/mcp.test.ts, which globally mocks
 * src/cli/retrieval.js and src/cli/corrections-endpoints.js before
 * importing createMcpServer -- that suite can only prove tool
 * registration/schema/forwarding, never that the real resolver, matcher,
 * correction-writer, and drain path actually produce a correctly-shaped
 * queued record and a correctly-updated persisted Quote. Per Beta's
 * coverage audit (.sisyphus/reviews/t3-create-fix-quote-coverage.md), this
 * suite is what closes that gap.
 *
 * Only computeQuoteEmbedding is mocked (to a fixed, deterministic value --
 * the real implementation lazily initializes FastEmbed, which is slow and
 * nondeterministic to assert against). retrieval.js and
 * corrections-endpoints.js are both real and unmocked.
 *
 * Two-phase fixture per the plan's exact instruction: writeCorrection()
 * self-drains immediately unless a live ei.lock exists
 * (corrections-writer.ts:83-135), so observing the queued record and the
 * post-drain persisted state are two different setups, not one call.
 *   Phase 1 -- write a fake ei.lock ({pid: process.pid}, matching
 *   corrections-writer.test.ts:238-257's live-lock fixture pattern) BEFORE
 *   the MCP call, so the correction queues without draining; assert the
 *   queued record's exact shape (including the `verified` marker) in
 *   corrections.json, and that state.json is byte-identical to before.
 *   Phase 2 -- remove the lock, then drive a real self-drain by calling
 *   writeCorrection() directly with a harmless throwaway fact upsert (the
 *   self-drain path applies every pending record in corrections.json
 *   alongside the new one, so this also applies the phase-1 quote record);
 *   assert the persisted Quote and that corrections.json is cleared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ContextStatus, RoomMode } from "../../../src/core/types/enums.js";
import type { StorageState, Quote } from "../../../src/core/types.js";
import type { CorrectionRecord, QuoteCreateRecord, QuoteFixRecord } from "../../../src/core/corrections.js";
import { decodeAllEmbeddings } from "../../../src/storage/embeddings.js";

const NOW = "2026-01-01T00:00:00.000Z";
const OLD = "2020-01-01T00:00:00.000Z";

// vi.mock factories are hoisted above every top-level statement in this
// file, so the mocked value must come from vi.hoisted -- an ordinary
// `const MOCK_EMBEDDING = [...]` referenced inside the factory below would
// throw "Cannot access before initialization" once hoisted above itself.
// [0.25, 0.5, 0.75] (matching corrections-endpoints.test.ts's own EMBEDDING
// fixture): exact binary fractions survive the state.json storage layer's
// float32 round-trip (storage/embeddings.js) byte-for-byte, unlike 0.1/0.2/
// 0.3, which are inexact in binary floating point at any width.
const { MOCK_EMBEDDING } = vi.hoisted(() => ({ MOCK_EMBEDDING: [0.25, 0.5, 0.75] }));

vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    computeQuoteEmbedding: vi.fn().mockResolvedValue(MOCK_EMBEDDING),
  };
});

import { createMcpServer } from "../../../src/cli/mcp.js";
import { writeCorrection } from "../../../src/cli/corrections-writer.js";
import { computeQuoteEmbedding } from "../../../src/core/embedding-service.js";

const PERSONA_ID = "33333333-4333-4333-8333-333333333333";
const DIRECT_MSG_ID = "ei:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SOURCED_MSG_ID = "ei:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ROOM_ID = "integration-room-1";
const ROOM_MSG_ID = "ei:cccccccc-cccc-4ccc-8ccc-cccccccccccc";

// "the lease bug is the real defect" appears twice: [6,38) and [50,82).
const ROOM_CONTENT = "First the lease bug is the real defect and second the lease bug is the real defect for a different reason";
const DIRECT_CONTENT = "Direct thread message with some unique wording to verify channel derivation";
// "anchors the sourced quote fixture" -> [13,46); "the real defect lives here too" -> [51,81).
const SOURCED_CONTENT = "This message anchors the sourced quote fixture and the real defect lives here too";

function buildState(quotes: Quote[]): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [{ id: "linked-fact-1", name: "Linked Fact", description: "linked from the sourced quote fixture", sentiment: 0, validated_date: OLD, last_updated: OLD }],
      topics: [],
      people: [],
      quotes,
      last_updated: NOW,
    },
    personas: {
      [PERSONA_ID]: {
        entity: {
          id: PERSONA_ID,
          display_name: "Integration Persona",
          entity: "system",
          short_description: "Test persona",
          long_description: "Test persona prompt",
          model: "Local LLM:test-model",
          traits: [],
          topics: [],
          is_paused: false,
          is_archived: false,
          is_static: false,
          last_updated: NOW,
        },
        messages: [
          { id: DIRECT_MSG_ID, role: "human", content: DIRECT_CONTENT, timestamp: NOW, read: false, context_status: ContextStatus.Default },
          { id: SOURCED_MSG_ID, role: "human", content: SOURCED_CONTENT, timestamp: NOW, read: false, context_status: ContextStatus.Default },
        ],
      },
    },
    rooms: {
      [ROOM_ID]: {
        id: ROOM_ID,
        display_name: "Integration Room",
        entity: "room",
        mode: RoomMode.FreeForAll,
        persona_ids: [PERSONA_ID],
        active_node_id: null,
        is_archived: false,
        created_at: NOW,
        last_updated: NOW,
        messages: [{ id: ROOM_MSG_ID, parent_id: null, role: "human", content: ROOM_CONTENT, timestamp: NOW, read: false, context_status: ContextStatus.Default }],
      },
    },
    queue: [],
    providers: [],
    tools: [],
  };
}

function makeSourcedQuote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: "sourced-quote-1",
    message_id: SOURCED_MSG_ID,
    data_item_ids: ["linked-fact-1"],
    persona_groups: ["General"],
    text: "anchors the sourced quote fixture",
    speaker: "human",
    channel: "Integration Persona",
    timestamp: NOW,
    start: 13,
    end: 46,
    created_at: OLD,
    created_by: "human",
    embedding: [0.9, 0.9, 0.9],
    ...overrides,
  };
}

let tempDir: string;
let statePath: string;
let correctionsPath: string;
let lockPath: string;

function writeState(state: StorageState): void {
  writeFileSync(statePath, JSON.stringify(state));
}

function readCorrectionsFile(): CorrectionRecord[] {
  return JSON.parse(readFileSync(correctionsPath, "utf-8")) as CorrectionRecord[];
}

// State on disk stores embeddings base64-encoded (see storage/embeddings.js,
// the same encoding loadLatestState() decodes on read) -- decode here too,
// or a raw-array embedding assertion would compare against an opaque string.
function readStateFile(): StorageState {
  return decodeAllEmbeddings(JSON.parse(readFileSync(statePath, "utf-8")) as StorageState);
}

async function setupClient() {
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "integration-test-client", version: "1.0.0" });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return client;
}

/** Real self-drain, triggered via a harmless throwaway fact upsert -- writeCorrection()'s self-drain path applies every pending corrections.json record (including whatever the MCP call above queued) alongside this one. */
async function driveRealDrain(): Promise<void> {
  await writeCorrection({
    op: "upsert",
    entity_type: "fact",
    id: "drain-trigger-fact",
    record: { id: "drain-trigger-fact", name: "Drain Trigger", description: "unrelated to quote assertions", sentiment: 0, validated_date: NOW, last_updated: NOW },
    timestamp: NOW,
  });
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ei-mcp-quote-integration-"));
  statePath = join(tempDir, "state.json");
  correctionsPath = join(tempDir, "corrections.json");
  lockPath = join(tempDir, "ei.lock");
  process.env.EI_DATA_PATH = tempDir;
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  delete process.env.EI_DATA_PATH;
  vi.clearAllMocks();
});

describe("ei_quote_create — two-phase queue and drain (T2/T3)", () => {
  it("queues a well-formed quote.create record under a live lock, leaving state.json untouched", async () => {
    writeState(buildState([]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const originalStateBytes = readFileSync(statePath, "utf-8");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_create",
      arguments: { message_id: ROOM_MSG_ID, text: "the lease bug is the real defect" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    const queued = readCorrectionsFile();
    expect(queued).toHaveLength(1);
    const record = queued[0] as QuoteCreateRecord;
    expect(record).toMatchObject({
      op: "quote.create",
      entity_type: "quote",
      message_id: ROOM_MSG_ID,
      text: "the lease bug is the real defect",
      speaker: "human",
      channel: "Integration Room",
      start: 6,
      end: 38,
      data_item_ids: [],
      persona_groups: [],
      created_by: "extraction",
      embedding: MOCK_EMBEDDING,
      verified: true,
    });
    expect(typeof record.id).toBe("string");
    expect(record.id.length).toBeGreaterThan(0);
    // I5 (round 3): the transport-only correlation id -- distinct from
    // the persisted Quote's own id -- must be present so the endpoint
    // can verify with certainty whether this exact queued write applied.
    expect(typeof record.attempt_id).toBe("string");
    expect(record.attempt_id.length).toBeGreaterThan(0);
    expect(record.attempt_id).not.toBe(record.id);
  });

  it("after a real drain, persists the attested Quote with the room's display_name as channel and the matcher's own offsets", async () => {
    writeState(buildState([]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    const createResult = await client.callTool({
      name: "ei_quote_create",
      arguments: { message_id: ROOM_MSG_ID, text: "the lease bug is the real defect" },
    });
    await client.close();
    const createdId = JSON.parse((createResult.content as Array<{ text: string }>)[0].text).id as string;

    rmSync(lockPath);
    await driveRealDrain();

    expect(readCorrectionsFile()).toEqual([]);

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === createdId);
    expect(persisted).toMatchObject({
      message_id: ROOM_MSG_ID,
      text: "the lease bug is the real defect",
      speaker: "human",
      channel: "Integration Room",
      start: 6,
      end: 38,
      data_item_ids: [],
      persona_groups: [],
      created_by: "extraction",
    });
  });
});

describe("ei_quote_fix — two-phase queue and drain preservation (T4)", () => {
  it("queues a well-formed quote.fix record under a live lock, leaving state.json untouched", async () => {
    writeState(buildState([makeSourcedQuote()]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const originalStateBytes = readFileSync(statePath, "utf-8");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: "sourced-quote-1", text: "the real defect lives here too" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    const queued = readCorrectionsFile();
    expect(queued).toHaveLength(1);
    const record = queued[0] as QuoteFixRecord;
    expect(record).toMatchObject({
      op: "quote.fix",
      entity_type: "quote",
      id: "sourced-quote-1",
      text: "the real defect lives here too",
      start: 51,
      end: 81,
      embedding: MOCK_EMBEDDING,
      verified: true,
    });
    // I5 (round 3): a fresh, transport-only correlation id, distinct
    // from the target quote's own persisted id.
    expect(typeof record.attempt_id).toBe("string");
    expect(record.attempt_id.length).toBeGreaterThan(0);
    expect(record.attempt_id).not.toBe(record.id);
  });

  it("after a real drain, preserves message_id/speaker/timestamp/channel/data_item_ids/persona_groups/created_at/created_by exactly, changing only text/start/end/embedding", async () => {
    const before = makeSourcedQuote();
    writeState(buildState([before]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: "sourced-quote-1", text: "the real defect lives here too" },
    });
    await client.close();

    rmSync(lockPath);
    await driveRealDrain();
    expect(readCorrectionsFile()).toEqual([]);

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === "sourced-quote-1")!;
    expect(persisted.text).toBe("the real defect lives here too");
    expect(persisted.start).toBe(51);
    expect(persisted.end).toBe(81);
    expect(persisted.embedding).toEqual(MOCK_EMBEDDING);
    // Every other field is byte-identical to the pre-fix record -- the
    // dispatcher (applyQuoteOperation) overwrites these 8 from the CURRENT
    // stored record regardless of what the wire record carried for them.
    expect(persisted.message_id).toBe(before.message_id);
    expect(persisted.speaker).toBe(before.speaker);
    expect(persisted.timestamp).toBe(before.timestamp);
    expect(persisted.channel).toBe(before.channel);
    expect(persisted.data_item_ids).toEqual(before.data_item_ids);
    expect(persisted.persona_groups).toEqual(before.persona_groups);
    expect(persisted.created_at).toBe(before.created_at);
    expect(persisted.created_by).toBe(before.created_by);
  });
});

describe("ei_quote_fix — synchronous self-drain outcomes with no live lock (I1 round 2 / I4)", () => {
  it("a control-character-bearing quote_id that matches no quote produces a stable, id-free refusal, not a control-bearing raw echo", async () => {
    writeState(buildState([]));
    const evilQuoteId = "does-not-exist\x1b[31mRED\x1b[0m";

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: evilQuoteId, text: "anything" },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot fix quote: no quote found with the supplied id");
    expect(content[0].text).not.toContain(evilQuoteId);
    expect(content[0].text).not.toContain("does-not-exist");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(content[0].text)).toBe(false);
  });

  it("T14 (round 3): a control-bearing durable quote id plus a post-verification remove produces an id-free, control-character-free refusal — never the raw id or the raw internal skip reason", async () => {
    const evilId = "attest\x07bell\x1b[31mred\x1b[0mquote-1";
    writeState(buildState([makeSourcedQuote({ id: evilId })]));

    // Same technique as the corrections-endpoints.test.ts T14 case: the
    // removal is injected as a side effect of computeQuoteEmbedding, the
    // one async step that genuinely sits between "verified" and "build
    // the wire record & call writeCorrection()" in the real endpoint.
    vi.mocked(computeQuoteEmbedding).mockImplementationOnce(async () => {
      writeFileSync(correctionsPath, JSON.stringify([{ op: "quote.remove", entity_type: "quote", id: evilId }]));
      return MOCK_EMBEDDING;
    });

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: evilId, text: "the real defect lives here too" },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot fix quote: the write could not be verified");
    expect(content[0].text).not.toContain(evilId);
    expect(content[0].text).not.toContain("does not exist");
    expect(content[0].text).not.toContain("quote.create");
    // eslint-disable-next-line no-control-regex
    expect(/[\x00-\x1f]/.test(content[0].text)).toBe(false);

    const state = readStateFile();
    expect(state.human.quotes.find((q) => q.id === evilId)).toBeUndefined();
  });

  it("a malformed pending quote.fix already queued for the same quote id does not cause a false failure once this call's own fix genuinely persists (I4)", async () => {
    writeState(buildState([makeSourcedQuote()]));
    // An unrelated, already-pending correction for the SAME quote id,
    // seeded before this call, malformed enough that the self-drain
    // skips it -- this must never be mistaken for this call's own record.
    writeFileSync(
      correctionsPath,
      JSON.stringify([{ op: "quote.fix", entity_type: "quote", id: "sourced-quote-1", verified: true }])
    );

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_fix",
      arguments: { quote_id: "sourced-quote-1", text: "the real defect lives here too" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    const content = result.content as Array<{ type: string; text: string }>;
    const parsed = JSON.parse(content[0].text);
    expect(parsed.text).toBe("the real defect lives here too");

    expect(readCorrectionsFile()).toEqual([]);
    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === "sourced-quote-1")!;
    expect(persisted.text).toBe("the real defect lives here too");
    expect(persisted.start).toBe(51);
    expect(persisted.end).toBe(81);
  });
});

describe("MCP forbidden fields have zero effect (T5)", () => {
  it("ei_quote_create with a forged 'speaker' argument persists the server-derived speaker/channel/created_by, never the forged value", async () => {
    writeState(buildState([]));

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_create",
      // @ts-expect-error -- deliberately supplying undeclared fields to prove the SDK strips them before persistence
      arguments: { message_id: DIRECT_MSG_ID, text: "unique wording to verify channel derivation", speaker: "forged-speaker", created_by: "human" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    const created = JSON.parse((result.content as Array<{ text: string }>)[0].text) as Quote;
    expect(created.speaker).toBe("human");
    expect(created.speaker).not.toBe("forged-speaker");
    expect(created.created_by).toBe("extraction");
    expect(created.channel).toBe("Integration Persona");

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === created.id)!;
    expect(persisted.speaker).toBe("human");
    expect(persisted.created_by).toBe("extraction");
  });

  it("ei_quote_fix with a forged 'created_by'/'message_id' argument preserves the existing provenance, never the forged value", async () => {
    const before = makeSourcedQuote({ created_by: "human" });
    writeState(buildState([before]));

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_fix",
      // @ts-expect-error -- deliberately supplying undeclared fields to prove the SDK strips them before persistence
      arguments: { quote_id: "sourced-quote-1", text: "the real defect lives here too", created_by: "forged", message_id: "ei:forged-message-id" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === "sourced-quote-1")!;
    expect(persisted.created_by).toBe("human");
    expect(persisted.created_by).not.toBe("forged");
    expect(persisted.message_id).toBe(SOURCED_MSG_ID);
    expect(persisted.message_id).not.toBe("ei:forged-message-id");
  });
});

describe("ei_quote_relink — two-phase queue and drain (T4)", () => {
  it("queues a well-formed quote.relink record under a live lock, leaving state.json untouched", async () => {
    writeState(buildState([makeSourcedQuote()]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const originalStateBytes = readFileSync(statePath, "utf-8");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "sourced-quote-1", data_item_ids: [] },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    const queued = readCorrectionsFile();
    // The narrow wire shape -- {op, entity_type, id, data_item_ids} only --
    // proves relink can never smuggle a full-record replacement through,
    // unlike the retired generic quote_upsert path.
    expect(queued).toEqual([{ op: "quote.relink", entity_type: "quote", id: "sourced-quote-1", data_item_ids: [], attempt_id: expect.any(String) }]);
  });

  it("after a real drain, changes only data_item_ids -- every other field remains byte-identical to the pre-relink record", async () => {
    const before = makeSourcedQuote();
    writeState(buildState([before]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "sourced-quote-1", data_item_ids: [] },
    });
    await client.close();

    rmSync(lockPath);
    await driveRealDrain();
    expect(readCorrectionsFile()).toEqual([]);

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === "sourced-quote-1")!;
    expect(persisted.data_item_ids).toEqual([]);
    expect(persisted.text).toBe(before.text);
    expect(persisted.message_id).toBe(before.message_id);
    expect(persisted.speaker).toBe(before.speaker);
    expect(persisted.timestamp).toBe(before.timestamp);
    expect(persisted.channel).toBe(before.channel);
    expect(persisted.persona_groups).toEqual(before.persona_groups);
    expect(persisted.created_at).toBe(before.created_at);
    expect(persisted.created_by).toBe(before.created_by);
    expect(persisted.start).toBe(before.start);
    expect(persisted.end).toBe(before.end);
  });
});

describe("ei_remove(entity_type: 'quote') — two-phase queue and drain (T4)", () => {
  it("queues a well-formed quote.remove record under a live lock, leaving state.json untouched", async () => {
    writeState(buildState([makeSourcedQuote()]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));
    const originalStateBytes = readFileSync(statePath, "utf-8");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_remove",
      arguments: { entity_type: "quote", id: "sourced-quote-1" },
    });
    await client.close();

    expect(result.isError).toBeUndefined();
    expect(readFileSync(statePath, "utf-8")).toBe(originalStateBytes);

    const queued = readCorrectionsFile();
    expect(queued).toEqual([{ op: "quote.remove", entity_type: "quote", id: "sourced-quote-1" }]);
  });

  it("after a real drain, the quote is gone and the queue is empty", async () => {
    writeState(buildState([makeSourcedQuote()]));
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    await client.callTool({ name: "ei_remove", arguments: { entity_type: "quote", id: "sourced-quote-1" } });
    await client.close();

    rmSync(lockPath);
    await driveRealDrain();
    expect(readCorrectionsFile()).toEqual([]);

    const state = readStateFile();
    expect(state.human.quotes.find((q) => q.id === "sourced-quote-1")).toBeUndefined();
  });
});

describe("ei_quote_relink / ei_remove(quote) — a nonexistent quote id fails immediately with the named refusal, queuing nothing (T4)", () => {
  it("ei_quote_relink against a well-formed quote id absent from state returns isError: true with the named refusal and leaves corrections.json byte-identical", async () => {
    writeState(buildState([]));
    // Beta's coverage audit (t4-mcp-fixture-coverage-audit.md, T4-MCP-5):
    // readCorrectionsFile() assumes corrections.json already exists -- a
    // correct refusal should never create it, so seed a baseline here
    // rather than calling readCorrectionsFile() on a possibly-absent file.
    writeFileSync(correctionsPath, "[]");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "does-not-exist-at-all", data_item_ids: [] },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot relink quote: no quote found with the supplied id");
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");
  });

  it("ei_remove(entity_type: 'quote') against a well-formed quote id absent from state returns isError: true with the named refusal and leaves corrections.json byte-identical", async () => {
    writeState(buildState([]));
    writeFileSync(correctionsPath, "[]");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_remove",
      arguments: { entity_type: "quote", id: "does-not-exist-at-all" },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot remove quote: no quote found with the supplied id");
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");
  });

  it("ei_quote_relink against a well-formed quote id absent from state, under a live lock, still queues nothing (T4 -- falsifiable, not inferred from an empty self-drained file)", async () => {
    writeState(buildState([]));
    writeFileSync(correctionsPath, "[]");
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "does-not-exist-at-all", data_item_ids: [] },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot relink quote: no quote found with the supplied id");
    // Under a live lock, writeCorrection() would otherwise unconditionally
    // APPEND the record -- byte-identical here proves the pre-check ran
    // before writeCorrection() was ever called, not merely that a
    // self-drain later cleared the queue back to empty.
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");
  });

  it("ei_remove(entity_type: 'quote') against a well-formed quote id absent from state, under a live lock, still queues nothing (T4 -- falsifiable, not inferred from an empty self-drained file)", async () => {
    writeState(buildState([]));
    writeFileSync(correctionsPath, "[]");
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid }));

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_remove",
      arguments: { entity_type: "quote", id: "does-not-exist-at-all" },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe("Error: Cannot remove quote: no quote found with the supplied id");
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");
  });
});

describe("ei_quote_relink — an invalid data_item_ids target is sanitized before reaching MCP output (I1, T1)", () => {
  it("a control/ANSI-bearing invalid relink target never reaches the MCP response text", async () => {
    writeState(buildState([makeSourcedQuote()]));
    const evilId = "not-a-real-id\x1b[31mRED\x1b[0m";

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_quote_relink",
      arguments: { id: "sourced-quote-1", data_item_ids: [evilId] },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe(
      "Error: Invalid quote (relink): data_item_ids references unknown or disallowed entities (must resolve to an existing fact, topic, or person — not a quote, persona, or unmatched ID)"
    );
    expect(content[0].text).not.toContain(evilId);
    expect(content[0].text).not.toContain("not-a-real-id");
    expect(content[0].text).not.toContain("\x1b[31m");
  });
});

describe("ei_update(entity_type: 'quote') — ADR-012 tombstone (T4)", () => {
  it("always rejects with the exact tombstone text -- not a generic MCP/schema error -- and leaves corrections.json byte-identical", async () => {
    const before = makeSourcedQuote();
    writeState(buildState([before]));
    writeFileSync(correctionsPath, "[]");

    const client = await setupClient();
    const result = await client.callTool({
      name: "ei_update",
      arguments: {
        entity_type: "quote",
        id: "sourced-quote-1",
        data: {
          message_id: null,
          data_item_ids: [],
          persona_groups: [],
          text: "Forged replacement text",
          speaker: "human",
          timestamp: NOW,
          start: null,
          end: null,
          created_at: NOW,
          created_by: "human",
        },
      },
    });
    await client.close();

    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text).toBe(
      'Error: "ei update quote" is retired. Use "ei fix quote" to correct text, "ei relink quote" to change links, or "ei remove quote" to delete a quote instead — if you were told to call this, your installed skills predate this version. Scheduled for removal two releases after the one that ships this message (ADR-012).'
    );
    expect(readFileSync(correctionsPath, "utf-8")).toBe("[]");

    const state = readStateFile();
    const persisted = state.human.quotes.find((q) => q.id === "sourced-quote-1")!;
    expect(persisted.text).toBe(before.text);
  });
});

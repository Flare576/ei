/**
 * I7 regression (.sisyphus/reviews/tonight-post-audit-fix-queue.md, T22):
 * the queued CLI/MCP read overlay, self-drain, and the live Processor
 * drain must all decide a Person's ADR-006/ADR-010 duplicate-link
 * cardinality through ONE shared guard implementation
 * (guardPersonUpsert, src/core/corrections.ts) instead of two
 * independent call sites that each separately invoke guardPersonaLinks
 * and happen to agree by coincidence.
 *
 * Scenario, identical across all three consumers: a Person is already
 * persisted with exactly one `{type: "Ei Persona", value: PERSONA_X}`
 * link. A correction submits that same Person with the link duplicated
 * ([X, X]). Every materialized view must keep exactly one X.
 *
 * The overlay and self-drain checks exercise the real production entry
 * points (loadLatestState / updateEntity's self-drain branch). The
 * live-drain check goes through the real Processor.drainCorrections() ->
 * applyCorrectionRecord() -> StateManager.human_person_upsert() path
 * (never calling human_person_upsert directly) and additionally spies on
 * the shared guardPersonUpsert export to prove the live path now reaches
 * the SAME function the overlay/self-drain path is built from, not a
 * separately-maintained duplicate that merely produces the same answer.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { Person, Ei_Interface } from "../../../src/core/types.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
import { appendCorrection } from "../../../src/core/corrections.js";
import * as correctionsModule from "../../../src/core/corrections.js";
import { Processor } from "../../../src/core/processor.js";

const NOW = "2026-01-01T00:00:00.000Z";
const PERSONA_X = "11111111-1111-4111-8111-111111111111";

// Bare-specifier mock (matches corrections-endpoints.test.ts's own shim) --
// without it, evaluating corrections-endpoints.ts's module-level zod schema
// literals throws "z.string is not a function" while updateEntity/loadLatestState
// are being collected below.
vi.mock("zod", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

// computeDataItemEmbedding hits a real local fastembed model load when
// unmocked (self-drain's buildAndWriteUpsert), and Processor.start()'s
// built-in-fact seeding touches getEmbeddingService() too (live-drain).
vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return {
    ...actual,
    computeDataItemEmbedding: vi.fn().mockResolvedValue([0.25, 0.5, 0.75]),
    computeQuoteEmbedding: vi.fn().mockResolvedValue([0.25, 0.5, 0.75]),
    getEmbeddingService: vi.fn(() => ({
      embed: vi.fn(async (text: string) => [text.length, 0, 0]),
      embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 0, 0])),
      isReady: () => true,
    })),
  };
});

// Processor.start() reaches these — mocked exactly like
// processor-corrections-drain.test.ts so it never tries to reach a real LLM.
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
  queueReflectionDrain: vi.fn(),
  queueUserDedupRequest: vi.fn(),
  queueRoomCapture: vi.fn(),
  queuePersonaCapture: vi.fn(),
  checkAndQueueRoomExtraction: vi.fn(),
  queueTargetedPersonUpdate: vi.fn(),
  queueTargetedTopicUpdate: vi.fn(),
}));

import { loadLatestState } from "../../../src/cli/retrieval.js";
import { updateEntity } from "../../../src/cli/corrections-endpoints.js";

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: "person_x",
    name: "Test Person",
    description: "A test person",
    sentiment: 0.1,
    relationship: "friend",
    exposure_current: 0.1,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers: [{ type: "Ei Persona", value: PERSONA_X }],
    ...overrides,
  };
}

function makeState(overrides: Partial<StorageState> = {}): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [],
      topics: [],
      people: [makePerson()],
      quotes: [],
      last_updated: NOW,
    },
    personas: {},
    queue: [],
    providers: [],
    tools: [],
    ...overrides,
  };
}

function xLinksOf(person: Person): unknown[] {
  return (person.identifiers ?? []).filter((i) => i.type === "Ei Persona" && i.value === PERSONA_X);
}

let cliTempDir: string | undefined;

function writeCliState(state: StorageState): void {
  cliTempDir = mkdtempSync(join(tmpdir(), "ei-i7-parity-"));
  writeFileSync(join(cliTempDir, "state.json"), JSON.stringify(state));
  process.env.EI_DATA_PATH = cliTempDir;
}

afterEach(() => {
  if (cliTempDir) {
    rmSync(cliTempDir, { recursive: true, force: true });
    cliTempDir = undefined;
  }
  delete process.env.EI_DATA_PATH;
  vi.restoreAllMocks();
});

describe("I7 T22: Person duplicate-link guard parity across overlay, self-drain, and live-drain", () => {
  it("overlay: a queued [X,X] update over a stored [X] Person exposes exactly one X through loadLatestState", async () => {
    writeCliState(makeState());

    const correction: CorrectionRecord = {
      op: "upsert",
      entity_type: "person",
      id: "person_x",
      record: makePerson({
        identifiers: [
          { type: "Ei Persona", value: PERSONA_X },
          { type: "Ei Persona", value: PERSONA_X },
        ],
      }),
      timestamp: NOW,
    };
    writeFileSync(join(cliTempDir!, "corrections.json"), JSON.stringify([correction]));

    const state = await loadLatestState();
    const person = state!.human.people.find((p) => p.id === "person_x")!;
    expect(xLinksOf(person)).toHaveLength(1);
  });

  it("self-drain: updateEntity submitting [X,X] over a stored [X] Person self-drains to exactly one X, refusing the duplicate synchronously", async () => {
    writeCliState(makeState());
    // No ei.lock in this tempDir -- writeCorrection() (inside updateEntity)
    // takes its self-drain branch, applying straight into state.json via
    // applyCorrectionsToStateWithMerges -> applyCorrectionToState. The
    // duplicate is refused, and (matching buildAndWriteUpsert's own
    // self-drain reporting) that refusal throws synchronously here --
    // the rest of the write still persists (ADR-010 clauses 1/4).
    await expect(updateEntity("person", "person_x", {
      description: "A test person",
      sentiment: 0.1,
      relationship: "friend",
      identifiers: [
        { type: "Ei Persona", value: PERSONA_X },
        { type: "Ei Persona", value: PERSONA_X },
      ],
    })).rejects.toThrow(/one-Person-per-Persona/);

    // Also confirm the durable write itself, not just the returned value.
    const state = await loadLatestState();
    const person = state!.human.people.find((p) => p.id === "person_x")!;
    expect(xLinksOf(person)).toHaveLength(1);
  });

  it("live-drain: Processor.drainCorrections() applies [X,X] over a stored [X] Person via the SAME shared guardPersonUpsert as overlay/self-drain", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-i7-parity-live-"));
    const storage = {
      isAvailable: vi.fn().mockResolvedValue(true),
      load: vi.fn().mockResolvedValue(null),
      save: vi.fn().mockResolvedValue(undefined),
      moveToBackup: vi.fn().mockResolvedValue(undefined),
      loadBackup: vi.fn().mockResolvedValue(null),
      saveRollingBackup: vi.fn().mockResolvedValue(undefined),
      getDataPath: () => dataDir,
    };
    const ei: Ei_Interface = { onHumanUpdated: () => {} };

    const processor = new Processor(ei);
    try {
      await processor.start(storage as unknown as Parameters<Processor["start"]>[0]);
      const sm = processor.getStateManager();

      // Seed the prior stored [X] Person through the guarded live API
      // itself -- a single, non-conflicting link, so this seeding call
      // produces no refusal.
      sm.human_person_upsert(makePerson());

      // Isolate the spy to the correction-drain call under test; the
      // seeding upsert above (and Processor.start()'s own bootstrap)
      // already exercised guardPersonUpsert legitimately.
      const guardSpy = vi.spyOn(correctionsModule, "guardPersonUpsert");

      const correction: CorrectionRecord = {
        op: "upsert",
        entity_type: "person",
        id: "person_x",
        record: makePerson({
          identifiers: [
            { type: "Ei Persona", value: PERSONA_X },
            { type: "Ei Persona", value: PERSONA_X },
          ],
        }),
        timestamp: new Date().toISOString(),
      };
      await appendCorrection(join(dataDir, "corrections.json"), correction);

      interface DrainableProcessor { drainCorrections(): Promise<void> }
      await (processor as unknown as DrainableProcessor).drainCorrections();

      const applied = sm.getHuman().people.find((p) => p.id === "person_x")!;
      expect(xLinksOf(applied)).toHaveLength(1);

      // Source-route assertion (I7): live-drain reaches the exact same
      // shared guard function applyCorrectionToState is built from --
      // not a reimplementation that happens to produce the same answer.
      // Called exactly once, for this correction's own person, and its
      // real (un-mocked-through) return value reports the duplicate as
      // refused.
      expect(guardSpy).toHaveBeenCalledTimes(1);
      expect(guardSpy.mock.calls[0][0]).toMatchObject({ id: "person_x" });
      expect(guardSpy.mock.results[0].value.refusals).toHaveLength(1);
    } finally {
      await processor.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

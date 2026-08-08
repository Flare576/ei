/**
 * Plan 1 (ADR-029 merge-patch), TODO 4 & TODO 5.
 *
 * TODO 4's acceptance criteria: "all three apply paths (live-drain,
 * self-drain, and read-overlay) reach the same underlying write logic for
 * a topic/person upsert... Read-overlay specifically must be exercised,
 * not just asserted equal to the other two by construction." This file
 * runs an IDENTICAL merge-patch update through all three real entry
 * points and asserts the actual semantic content each one computed, not
 * merely "all three succeed."
 *
 * TODO 5's acceptance criterion 3 / QA step 5-6: "a patch valid by
 * grammar but invalid after merging onto stored state is rejected
 * wholesale — no partial write," verified by mutation testing (flip
 * validate-candidate to validate-patch-only, and flip
 * mutate-before-validate to mutate-after-validate; confirm each turns
 * this file's own atomicity test red, then revert — see the session's
 * evidence file for the manual mutation pass; it is not re-encoded here
 * as permanent code because there is nothing meaningful to assert about
 * a mutation that has already been reverted).
 *
 * "Red first" per Flare's own framing (not TDD): "'Red first' is simply
 * 'something is broken right now — write a test that shows it is broken,
 * so that when it is fixed, we know that we fixed it, and if we break it
 * again, we have a signal we can trust.'" Before TODO 4/5 landed, the
 * self-drain and read-overlay paths spliced a bare record directly and
 * had no merge-patch or validation step at all; this file's own tests
 * are what would have caught that gap directly.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { StorageState } from "../../../src/core/types/integrations.js";
import type { Topic, Person, Ei_Interface } from "../../../src/core/types.js";
import type { CorrectionRecord } from "../../../src/core/corrections.js";
import { appendCorrection } from "../../../src/core/corrections.js";
import { Processor } from "../../../src/core/processor.js";

const NOW = "2026-01-01T00:00:00.000Z";
const TOPIC_ID = "topic-1";
const PERSON_ID = "person-1";

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
    getEmbeddingService: vi.fn(() => ({
      embed: vi.fn(async (text: string) => [text.length, 0, 0]),
      embedBatch: vi.fn(async (texts: string[]) => texts.map((t) => [t.length, 0, 0])),
      isReady: () => true,
    })),
  };
});

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

function makeTopic(overrides: Partial<Topic> = {}): Topic {
  return {
    id: TOPIC_ID,
    name: "Distributed Systems",
    description: "Interested in consensus algorithms.",
    sentiment: 0.6,
    category: "Interest",
    exposure_current: 0.2,
    exposure_desired: 0.7,
    last_updated: NOW,
    ...overrides,
  };
}

function makePerson(overrides: Partial<Person> = {}): Person {
  return {
    id: PERSON_ID,
    name: "Alice",
    description: "A colleague.",
    sentiment: 0.4,
    relationship: "coworker",
    exposure_current: 0.1,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers: [{ type: "Nickname", value: "Alice", is_primary: true }],
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
      topics: [makeTopic()],
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

let cliTempDir: string | undefined;

function writeCliState(state: StorageState): void {
  cliTempDir = mkdtempSync(join(tmpdir(), "ei-todo4-parity-"));
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

describe("Plan 1 TODO 4/5: topic merge-patch parity across overlay, self-drain, and live-drain", () => {
  const PATCH = { description: "Now also interested in Byzantine fault tolerance." };

  it("overlay: a queued topic patch is shown SEMANTICALLY MERGED (not raw) through loadLatestState — description changed, category/sentiment/name preserved from stored state", async () => {
    writeCliState(makeState());
    const correction: CorrectionRecord = {
      op: "patch",
      entity_type: "topic",
      id: TOPIC_ID,
      patch: PATCH,
      timestamp: NOW,
    };
    writeFileSync(join(cliTempDir!, "corrections.json"), JSON.stringify([correction]));

    const state = await loadLatestState();
    const topic = state!.human.topics.find((t) => t.id === TOPIC_ID)!;

    expect(topic.description).toBe(PATCH.description);
    expect(topic.name).toBe("Distributed Systems");
    expect(topic.category).toBe("Interest");
    expect(topic.sentiment).toBe(0.6);
  });

  it("self-drain: updateEntity applies the same patch directly to state.json with the same semantic merge", async () => {
    writeCliState(makeState());

    await updateEntity("topic", TOPIC_ID, PATCH);

    const state = await loadLatestState();
    const topic = state!.human.topics.find((t) => t.id === TOPIC_ID)!;
    expect(topic.description).toBe(PATCH.description);
    expect(topic.name).toBe("Distributed Systems");
    expect(topic.category).toBe("Interest");
    expect(topic.sentiment).toBe(0.6);
  });

  it("live-drain: Processor.drainCorrections() applies the same patch through the SAME resolveTopicPatchCandidate + HumanState.topic_upsert choke point", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-todo4-parity-live-"));
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
      sm.human_topic_upsert(makeTopic());

      const correction: CorrectionRecord = {
        op: "patch",
        entity_type: "topic",
        id: TOPIC_ID,
        patch: PATCH,
        timestamp: new Date().toISOString(),
      };
      await appendCorrection(join(dataDir, "corrections.json"), correction);

      interface DrainableProcessor { drainCorrections(): Promise<void> }
      await (processor as unknown as DrainableProcessor).drainCorrections();

      const applied = sm.getHuman().topics.find((t) => t.id === TOPIC_ID)!;
      expect(applied.description).toBe(PATCH.description);
      expect(applied.name).toBe("Distributed Systems");
      expect(applied.category).toBe("Interest");
      expect(applied.sentiment).toBe(0.6);
    } finally {
      await processor.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

describe("Plan 1 TODO 5: atomicity — a patch valid by grammar but invalid after merging onto stored state is rejected wholesale", () => {
  it("a person patch that, merged, leaves neither identifiers nor a name is rejected — nothing is written, the stored record is untouched", async () => {
    // `name` is independently stored (not purely derived) and survives a
    // merge on its own unless the patch also clears it -- syncPersonName
    // only ever SETS name from a primary identifier, it never blanks name
    // just because identifiers became empty. So a patch that fails the
    // refine invariant genuinely has to clear both.
    const existing = makePerson({ identifiers: [{ type: "Nickname", value: "Alice", is_primary: true }] });
    writeCliState(makeState({
      human: { entity: "human", facts: [], topics: [], people: [existing], quotes: [], last_updated: NOW },
    }));

    await expect(
      updateEntity("person", PERSON_ID, { identifiers: null, name: null })
    ).rejects.toThrow(/at least one identifier or a name/);

    // No partial write: the stored record is byte-identical to before.
    const state = await loadLatestState();
    const person = state!.human.people.find((p) => p.id === PERSON_ID)!;
    expect(person.identifiers).toEqual(existing.identifiers);
    expect(person.name).toBe(existing.name);
    expect(person.description).toBe(existing.description);
  });


  it("a topic patch that clears the required `description` field is rejected wholesale, leaving the stored record untouched", async () => {
    const existing = makeTopic();
    writeCliState(makeState({
      human: { entity: "human", facts: [], topics: [existing], people: [], quotes: [], last_updated: NOW },
    }));

    await expect(
      updateEntity("topic", TOPIC_ID, { description: null, category: "Project" })
    ).rejects.toThrow(/description: Required/);

    const state = await loadLatestState();
    const topic = state!.human.topics.find((t) => t.id === TOPIC_ID)!;
    expect(topic.description).toBe(existing.description);
    expect(topic.category).toBe(existing.category);
  });

  it("live-drain: a patch that clears the required description is rejected without corrupting the live in-memory StateManager's own stored topic (merge must never mutate the stored object before validating, ADR-029 clause 3)", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "ei-todo5-atomicity-live-"));
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
      sm.human_topic_upsert(makeTopic());

      const correction: CorrectionRecord = {
        op: "patch",
        entity_type: "topic",
        id: TOPIC_ID,
        patch: { description: null, category: "Project" },
        timestamp: new Date().toISOString(),
      };
      await appendCorrection(join(dataDir, "corrections.json"), correction);

      interface DrainableProcessor { drainCorrections(): Promise<void> }
      // drainCorrections() catches per-record failures internally (logs and
      // continues) rather than rethrowing -- so this call itself resolves;
      // the assertion is on the STATE afterward, not on a rejection here.
      await (processor as unknown as DrainableProcessor).drainCorrections();

      const stillStored = sm.getHuman().topics.find((t) => t.id === TOPIC_ID)!;
      expect(stillStored.description).toBe(makeTopic().description);
      expect(stillStored.category).toBe(makeTopic().category);
    } finally {
      await processor.stop();
      rmSync(dataDir, { recursive: true, force: true });
    }
  });
});

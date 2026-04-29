import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Processor } from "../../../src/core/processor.js";
import { BUILT_IN_FACTS } from "../../../src/core/constants/built-in-facts.js";
import type { Ei_Interface } from "../../../src/core/types.js";
import { createDefaultTestState } from "../../helpers/mock-storage.js";

/**
 * Tests for Processor.seedBuiltinFacts()
 * The private method is exercised through processor.start(), then state
 * is inspected via processor.getStateManager().getHuman().
 *
 * Seeding logic:
 *   - Checks existence by name (Set-based O(n) scan)
 *   - Creates missing facts with description="", validated_date="", sentiment=0
 *   - Uses BUILT_IN_FACTS array for iteration
 *   - Safe to call repeatedly (idempotent)
 */

// Mock the handlers and orchestrators to prevent real LLM calls
vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {
    handlePersonaResponse: vi.fn(),
    handlePersonaGeneration: vi.fn(),
    handleFactFind: vi.fn(),
    handleHumanTopicScan: vi.fn(),
    handleHumanPersonScan: vi.fn(),
    handlePersonaTraitExtraction: vi.fn(),
    handlePersonaTopicDetection: vi.fn(),
    handlePersonaTopicExploration: vi.fn(),
    handleHeartbeatCheck: vi.fn(),
    handleEiHeartbeat: vi.fn(),
    handleOneShot: vi.fn(),
  },
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
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

function createMockInterface(): Ei_Interface {
  return {
    onPersonaAdded: vi.fn(),
    onPersonaRemoved: vi.fn(),
    onPersonaUpdated: vi.fn(),
    onMessageAdded: vi.fn(),
    onMessageProcessing: vi.fn(),
    onMessageQueued: vi.fn(),
    onMessageRecalled: vi.fn(),
    onHumanUpdated: vi.fn(),
    onQueueStateChanged: vi.fn(),
    onError: vi.fn(),
    onStateImported: vi.fn(),
    onOneShotReturned: vi.fn(),
  };
}

function createMockStorage(preloadState?: any) {
  return {
    isAvailable: vi.fn().mockReturnValue(true),
    load: vi.fn().mockResolvedValue(preloadState ?? null),
    save: vi.fn().mockResolvedValue(undefined),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
  };
}

describe("Processor.seedBuiltinFacts()", () => {
  let processor: Processor;

  beforeEach(() => {
    processor = new Processor(createMockInterface());
  });

  afterEach(async () => {
    await processor.stop();
  });

  it("scenario 1: fresh state — seeds all 25 built-in facts with empty descriptions", async () => {
    const storage = createMockStorage(null); // null = no existing data
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();

    // All 25 built-in facts should be present
    expect(human.facts.length).toBeGreaterThanOrEqual(BUILT_IN_FACTS.length);

    // Every built-in fact should exist with empty description
    for (const builtIn of BUILT_IN_FACTS) {
      const found = human.facts.find(f => f.name === builtIn.name);
      expect(found).toBeDefined();
      expect(found!.description).toBe("");
      expect(found!.validated_date).toBe("");
      expect(found!.sentiment).toBe(0);
    }
  });

  it("scenario 2: partial state — only missing facts seeded, existing facts preserved", async () => {
    const state = createDefaultTestState();
    // Pre-populate 3 facts with descriptions
    state.human.facts = [
      {
        id: "f-fullname",
        name: "Full Name",
        description: "Jeremy Scherer",
        sentiment: 0.5,
        validated_date: "2024-01-01T00:00:00.000Z",
        last_updated: "2024-01-01T00:00:00.000Z",
      },
      {
        id: "f-birthday",
        name: "Birthday",
        description: "March 3rd",
        sentiment: 0,
        validated_date: "",
        last_updated: "2024-01-01T00:00:00.000Z",
      },
    ];

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();

    // Should have at least 25 facts (the 2 existing + 23 seeded)
    expect(human.facts.length).toBeGreaterThanOrEqual(BUILT_IN_FACTS.length);

    // Existing facts are preserved with their original data
    const fullName = human.facts.find(f => f.name === "Full Name")!;
    expect(fullName).toBeDefined();
    expect(fullName.description).toBe("Jeremy Scherer");
    expect(fullName.sentiment).toBe(0.5);
    expect(fullName.id).toBe("f-fullname");

    const birthday = human.facts.find(f => f.name === "Birthday")!;
    expect(birthday).toBeDefined();
    expect(birthday.description).toBe("March 3rd");

    // Newly seeded facts have empty descriptions
    const birthplace = human.facts.find(f => f.name === "Birthplace")!;
    expect(birthplace).toBeDefined();
    expect(birthplace.description).toBe("");
    expect(birthplace.validated_date).toBe("");
  });

  it("scenario 3: complete state — all 25 facts already present, no duplicates added", async () => {
    const state = createDefaultTestState();
    // Pre-populate all 25 built-in facts
    state.human.facts = BUILT_IN_FACTS.map((f, i) => ({
      id: `f-${i}`,
      name: f.name,
      description: "existing value",
      sentiment: 0,
      validated_date: "",
      last_updated: "2024-01-01T00:00:00.000Z",
    }));

    const storage = createMockStorage(state);
    await processor.start(storage);

    const human = processor.getStateManager().getHuman();

    // Count should be exactly 25 (no duplicates added)
    const builtInFacts = human.facts.filter(f =>
      BUILT_IN_FACTS.some(b => b.name === f.name)
    );
    expect(builtInFacts).toHaveLength(BUILT_IN_FACTS.length);

    // All existing descriptions preserved
    for (const fact of builtInFacts) {
      expect(fact.description).toBe("existing value");
    }
  });
});

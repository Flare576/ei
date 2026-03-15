import { describe, it, expect, vi, beforeEach } from "vitest";
import type { HumanEntity, Message, PersonaEntity } from "../../../src/core/types.js";

/**
 * Tests for the taper logic in checkAndQueueHumanExtraction() (message-manager.ts).
 *
 * The critical fix: threshold is computed from facts WITH descriptions,
 * not total fact count. Before the fix, all 25 seeded-but-empty facts made
 * threshold=10 immediately, blocking bootstrap extraction.
 *
 * Formula:
 *   factsThreshold = Math.min(EXTRACTION_TAPER_CAP, human.facts.filter(f => f.description && f.description !== "").length)
 *   where EXTRACTION_TAPER_CAP = 10
 *
 * Extraction fires when:
 *   unextractedFacts.length > 0 AND unextractedFacts.length >= factsThreshold
 */

// Mock orchestrators BEFORE importing message-manager
vi.mock("../../../src/core/orchestrators/index.js", () => ({
  queueFactFind: vi.fn().mockReturnValue(1),
  queueTopicScan: vi.fn().mockReturnValue(1),
  queuePersonScan: vi.fn().mockReturnValue(1),
  queueAllScans: vi.fn(),
  orchestratePersonaGeneration: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  queueExpirePhase: vi.fn(),
  queueExplorePhase: vi.fn(),
  queueDescriptionCheck: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

import { checkAndQueueHumanExtraction } from "../../../src/core/message-manager.js";
import { queueFactFind } from "../../../src/core/orchestrators/index.js";

function makeFact(name: string, description = "") {
  return { id: crypto.randomUUID(), name, description, sentiment: 0, validated_date: "", last_updated: "" };
}

function makeMessage(id: string): Message {
  return {
    id,
    role: "human",
    content: `message ${id}`,
    timestamp: new Date().toISOString(),
    read: true,
    context_status: "default" as any,
    f: false,  // not yet extracted for facts
  };
}

function createMockStateManager(
  facts: ReturnType<typeof makeFact>[],
  unextractedMessages: Message[]
) {
  const human: HumanEntity = {
    entity: "human",
    facts,
    traits: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    last_activity: new Date().toISOString(),
  };

  return {
    getHuman: vi.fn(() => human),
    // messages_getUnextracted returns the configured unextracted messages for "f" flag
    messages_getUnextracted: vi.fn((personaId: string, flag: string) => {
      if (flag === "f") return unextractedMessages;
      return [];
    }),
    // messages_markExtracted needed by queueFactFind internal pre-marking
    messages_markExtracted: vi.fn(),
    queue_enqueue: vi.fn(),
    persona_getAll: vi.fn(() => []),
    _human: human,
  };
}

describe("checkAndQueueHumanExtraction() — taper logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("bootstrap phase (threshold = 0)", () => {
    it("fires on first unextracted message when zero facts have descriptions", () => {
      // 25 seeded facts, ALL empty — the old bug would set threshold=10
      const facts = Array.from({ length: 25 }, (_, i) =>
        makeFact(`Fact ${i}`, "") // all empty descriptions
      );
      const unextracted = [makeMessage("m1")]; // 1 unextracted message

      const state = createMockStateManager(facts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      // threshold = min(10, 0) = 0; 1 > 0 && 1 >= 0 → fires
      expect(queueFactFind).toHaveBeenCalledTimes(1);
    });

    it("fires even with only 1 unextracted message and no descriptions discovered", () => {
      const facts = [makeFact("Full Name", ""), makeFact("Birthday", "")];
      const unextracted = [makeMessage("m1")];

      const state = createMockStateManager(facts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      expect(queueFactFind).toHaveBeenCalledTimes(1);
    });
  });

  describe("steady-state phase (threshold grows with discoveries)", () => {
    it("does NOT fire when fewer unextracted messages than discovered facts (below threshold)", () => {
      // 10 facts with descriptions → threshold = min(10, 10) = 10
      const discoveredFacts = Array.from({ length: 10 }, (_, i) =>
        makeFact(`Fact ${i}`, `discovered value ${i}`)
      );
      const emptyFacts = Array.from({ length: 15 }, (_, i) =>
        makeFact(`Empty ${i}`, "")
      );
      const unextracted = Array.from({ length: 5 }, (_, i) => makeMessage(`m${i}`)); // 5 < 10

      const state = createMockStateManager([...discoveredFacts, ...emptyFacts], unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      // 5 < 10 threshold → should NOT fire
      expect(queueFactFind).not.toHaveBeenCalled();
    });

    it("fires when unextracted messages reaches the threshold", () => {
      // 10 facts with descriptions → threshold = min(10, 10) = 10
      const discoveredFacts = Array.from({ length: 10 }, (_, i) =>
        makeFact(`Fact ${i}`, `discovered value ${i}`)
      );
      const unextracted = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`)); // exactly 10

      const state = createMockStateManager(discoveredFacts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      // 10 >= 10 threshold → fires
      expect(queueFactFind).toHaveBeenCalledTimes(1);
    });

    it("caps threshold at 10 regardless of how many facts are discovered", () => {
      // 25 facts with descriptions — threshold should still be capped at 10
      const facts = Array.from({ length: 25 }, (_, i) =>
        makeFact(`Fact ${i}`, `value ${i}`)
      );
      const unextracted = Array.from({ length: 10 }, (_, i) => makeMessage(`m${i}`));

      const state = createMockStateManager(facts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      // threshold = min(10, 25) = 10; 10 >= 10 → fires
      expect(queueFactFind).toHaveBeenCalledTimes(1);
    });

    it("does NOT fire when there are zero unextracted messages", () => {
      const facts = [makeFact("Full Name", "")]; // no descriptions → threshold=0
      const unextracted: Message[] = []; // zero unextracted

      const state = createMockStateManager(facts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      // 0 > 0 is FALSE → never fires regardless of threshold
      expect(queueFactFind).not.toHaveBeenCalled();
    });
  });

  describe("threshold uses description filter, not total fact count", () => {
    it("treats facts with description='' same as no description (unacknowledged)", () => {
      // 5 facts with explicit empty string — should NOT count toward threshold
      const facts = Array.from({ length: 5 }, (_, i) =>
        makeFact(`Built-In ${i}`, "")
      );
      // 1 additional fact with a real description
      facts.push(makeFact("Full Name", "Jeremy Scherer"));
      // threshold = min(10, 1) = 1

      const unextracted = [makeMessage("m1")]; // 1 message; 1 >= 1 → fires

      const state = createMockStateManager(facts, unextracted);

      checkAndQueueHumanExtraction(state as any, "persona-1", "TestBot", []);

      expect(queueFactFind).toHaveBeenCalledTimes(1);
    });
  });
});

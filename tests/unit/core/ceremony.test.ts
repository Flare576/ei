import { describe, it, expect, vi, beforeEach } from "vitest";
import { QueueState } from "../../../src/core/state/queue.js";
import { 
  shouldStartCeremony, 
  isNewDay, 
  isPastCeremonyTime 
} from "../../../src/core/orchestrators/ceremony.js";
import { 
  calculateExponentialDecay, 
  applyDecayToValue 
} from "../../../src/core/utils/decay.js";
import type { CeremonyConfig } from "../../../src/core/types.js";
import type { StateManager } from "../../../src/core/state-manager.js";

const mockState = (queueLength = 0) => ({ queue_length: () => queueLength }) as unknown as StateManager;

describe("Ceremony Trigger Logic", () => {
  describe("isNewDay", () => {
    it("returns true when no last ceremony", () => {
      expect(isNewDay(undefined, new Date())).toBe(true);
    });

    it("returns true when last ceremony was yesterday", () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      expect(isNewDay(yesterday.toISOString(), new Date())).toBe(true);
    });

    it("returns false when last ceremony was today", () => {
      const now = new Date();
      const earlierToday = new Date(now);
      earlierToday.setMinutes(now.getMinutes() - 1, 0, 0);
      // If we're at exactly minute 0, roll back a full day instead
      if (earlierToday.toDateString() !== now.toDateString()) {
        earlierToday.setTime(now.getTime() - 60_000);
      }
      expect(isNewDay(earlierToday.toISOString(), now)).toBe(false);
    });

    it("handles midnight boundary correctly", () => {
      const lastNight = new Date(2026, 0, 28, 23, 59, 0);
      const thisAM = new Date(2026, 0, 29, 0, 1, 0);
      expect(isNewDay(lastNight.toISOString(), thisAM)).toBe(true);
    });
  });

  describe("isPastCeremonyTime", () => {
    it("returns true when current time is after ceremony time", () => {
      const now = new Date("2026-01-29T04:00:00");
      expect(isPastCeremonyTime("03:00", now)).toBe(true);
    });

    it("returns false when current time is before ceremony time", () => {
      const now = new Date("2026-01-29T02:00:00");
      expect(isPastCeremonyTime("03:00", now)).toBe(false);
    });

    it("returns true when current time equals ceremony time", () => {
      const now = new Date("2026-01-29T03:00:00");
      expect(isPastCeremonyTime("03:00", now)).toBe(true);
    });

    it("handles afternoon times correctly", () => {
      const afternoon = new Date("2026-01-29T14:30:00");
      expect(isPastCeremonyTime("14:00", afternoon)).toBe(true);
      expect(isPastCeremonyTime("15:00", afternoon)).toBe(false);
    });
  });

  describe("shouldStartCeremony", () => {
    const baseConfig: CeremonyConfig = {
      time: "03:00",
    };

    it("returns true when new day and past time", () => {
      const config = { 
        ...baseConfig, 
        last_ceremony: "2026-01-28T03:00:00Z" 
      };
      const now = new Date("2026-01-29T04:00:00");
      expect(shouldStartCeremony(config, mockState(), now)).toBe(true);
    });

    it("returns false when already ran today", () => {
      const now = new Date("2026-01-29T04:00:00");
      const config = { 
        ...baseConfig, 
        last_ceremony: new Date("2026-01-29T03:00:00").toISOString()
      };
      expect(shouldStartCeremony(config, mockState(), now)).toBe(false);
    });

    it("returns false when past time but not new day", () => {
      const now = new Date("2026-01-29T05:00:00");
      const config = { 
        ...baseConfig, 
        last_ceremony: new Date("2026-01-29T03:00:00").toISOString()
      };
      expect(shouldStartCeremony(config, mockState(), now)).toBe(false);
    });

    it("returns false when new day but not past time yet", () => {
      const config = { 
        ...baseConfig, 
        last_ceremony: "2026-01-28T03:00:00Z" 
      };
      const now = new Date("2026-01-29T02:00:00");
      expect(shouldStartCeremony(config, mockState(), now)).toBe(false);
    });

    it("returns true on first run (no last_ceremony)", () => {
      const now = new Date("2026-01-29T04:00:00");
      expect(shouldStartCeremony(baseConfig, mockState(), now)).toBe(true);
    });

    it("returns false when queue has pending items", () => {
      const config = { 
        ...baseConfig, 
        last_ceremony: "2026-01-28T03:00:00Z" 
      };
      const now = new Date("2026-01-29T04:00:00");
      expect(shouldStartCeremony(config, mockState(5), now)).toBe(false);
    });
  });
});

describe("Decay Computation", () => {
  describe("calculateExponentialDecay", () => {
    it("decays value toward zero over time", () => {
      const result = calculateExponentialDecay(0.8, 24, 0.1);
      expect(result).toBeLessThan(0.8);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 0 when input is 0 (no negative values)", () => {
      expect(calculateExponentialDecay(0, 24, 0.1)).toBe(0);
    });

    it("decays values at 1.0 (no immunity at peak)", () => {
      const result = calculateExponentialDecay(1, 24, 0.1);
      // v(t) = 1.0 * e^(-0.1 * 1) ≈ 0.905 after 1 day
      expect(result).toBeLessThan(1);
      expect(result).toBeCloseTo(0.905, 2);
    });

    it("decays faster at high values than at low values (proportional decay)", () => {
      // Absolute drop at 0.9 should be larger than absolute drop at 0.1
      // because decay is proportional: 0.9 * (1 - e^-K) > 0.1 * (1 - e^-K)
      const decayAt09 = 0.9 - calculateExponentialDecay(0.9, 24, 0.1);
      const decayAt01 = 0.1 - calculateExponentialDecay(0.1, 24, 0.1);

      expect(decayAt09).toBeGreaterThan(decayAt01);
    });

    it("reaches ~50% after 7 days at K=0.1", () => {
      const result = calculateExponentialDecay(1.0, 7 * 24, 0.1);
      // v(t) = e^(-0.1 * 7) ≈ 0.497
      expect(result).toBeCloseTo(0.497, 2);
    });

    it("clamps result to [0, 1] range", () => {
      const result = calculateExponentialDecay(0.5, 1000, 0.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it("respects custom K decay rate", () => {
      const slowDecay = calculateExponentialDecay(0.5, 24, 0.05);
      const fastDecay = calculateExponentialDecay(0.5, 24, 0.2);
      expect(slowDecay).toBeGreaterThan(fastDecay);
    });
  });

  describe("applyDecayToValue", () => {
    it("returns unchanged value for very recent updates", () => {
      const now = new Date();
      const justNow = new Date(now.getTime() - 1000).toISOString();
      const { newValue } = applyDecayToValue(0.8, justNow, now);
      expect(newValue).toBe(0.8);
    });

    it("applies decay for older timestamps", () => {
      const now = new Date();
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      const { newValue, hoursSinceUpdate } = applyDecayToValue(0.8, dayAgo, now);
      
      expect(newValue).toBeLessThan(0.8);
      expect(hoursSinceUpdate).toBeCloseTo(24, 0);
    });

    it("reports hours since update correctly", () => {
      const now = new Date();
      const hoursAgo = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
      const { hoursSinceUpdate } = applyDecayToValue(0.5, hoursAgo, now);
      
      expect(hoursSinceUpdate).toBeCloseTo(12, 0);
    });
  });
});

// =============================================================================
// Rewrite Phase Tests (queueRewritePhase)
// =============================================================================

import { queueRewritePhase, handleCeremonyProgress } from "../../../src/core/orchestrators/ceremony.js";
import { LLMNextStep, LLMRequestType, LLMPriority } from "../../../src/core/types.js";
import type { HumanEntity, Fact, Topic, Person } from "../../../src/core/types.js";

function createMockRewriteState(overrides: Partial<HumanEntity> = {}) {
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: new Date().toISOString(),
    ...overrides,
  };

  return {
    getHuman: vi.fn(() => human),
    queue_enqueue: vi.fn(),
    _human: human,
  };
}

function makeFact(id: string, descLength: number): Fact {
  return {
    id,
    name: `Fact ${id}`,
    description: "X".repeat(descLength),
    sentiment: 0.5,
    last_updated: new Date().toISOString(),
    validated_date: new Date().toISOString(),
  };
}

function makeTopic(id: string, descLength: number): Topic {
  return {
    id,
    name: `Topic ${id}`,
    description: "X".repeat(descLength),
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
  };
}

function makePerson(id: string, descLength: number): Person {
  return {
    id,
    name: `Person ${id}`,
    description: "X".repeat(descLength),
    sentiment: 0.5,
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
  };
}

describe("Rewrite Phase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("queueRewritePhase", () => {
    it("skips when rewrite_model not set", () => {
      const state = createMockRewriteState({
        settings: { ceremony: { time: "03:00" } },
      });

      queueRewritePhase(state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("skips when no items above threshold (750 chars)", () => {
      const state = createMockRewriteState({
        settings: { rewrite_model: "TestProvider:model" },
        facts: [makeFact("f1", 500)],
      });

      queueRewritePhase(state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("scans topics and people above threshold", () => {
      const state = createMockRewriteState({
        settings: { rewrite_model: "TestProvider:model" },
        topics: [makeTopic("top1", 1000)],
        people: [makePerson("p1", 751)],
      });

      queueRewritePhase(state as any);

      expect(state.queue_enqueue).toHaveBeenCalledTimes(2);

      const types = state.queue_enqueue.mock.calls.map(
        (c: any[]) => c[0].data.itemType
      );
      expect(types).toEqual(["topic", "person"]);
    });

    it("never scans facts — facts are read-only", () => {
      const state = createMockRewriteState({
        settings: { rewrite_model: "TestProvider:model" },
        facts: [makeFact("f1", 800)],
      });

      queueRewritePhase(state as any);

      expect(state.queue_enqueue).not.toHaveBeenCalled();
    });

    it("only scans items above threshold, skips those below", () => {
      const state = createMockRewriteState({
        settings: { rewrite_model: "TestProvider:model" },
        topics: [
          makeTopic("t-small", 200),
          makeTopic("t-big", 800),
        ],
      });

      queueRewritePhase(state as any);

      expect(state.queue_enqueue).toHaveBeenCalledTimes(1);
      expect(state.queue_enqueue).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ itemId: "t-big" }),
        })
      );
    });
  });
});

// =============================================================================
// handleCeremonyProgress Tests (Multi-Phase Support)
// =============================================================================

function createMockProgressState(pendingCeremonies: boolean = false, hasActivity: boolean = true) {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  
  const human: HumanEntity = {
    entity: "human",
    facts: [],
    topics: [],
    people: [],
    quotes: [],
    last_updated: now.toISOString(),
    settings: {
      ceremony: {
        time: "03:00",
        last_ceremony: yesterday.toISOString(),
      },
    },
  };

  const activePersona = {
    id: "test-persona",
    display_name: "Test Persona",
    is_paused: false,
    is_archived: false,
    is_static: false,
    topics: [],
    traits: [],
  };

  return {
    queue_hasPendingCeremonies: vi.fn(() => pendingCeremonies),
    getHuman: vi.fn(() => human),
    persona_getAll: vi.fn(() => [activePersona]),
    persona_getById: vi.fn((id: string) => id === "test-persona" ? activePersona : null),
    messages_get: vi.fn(() => hasActivity ? [{ id: "msg1", role: "human" as const, content: "test", timestamp: now.toISOString(), read: true, context_status: 0, f: false, r: false, p: false, o: false }] : []),
    messages_getUnextracted: vi.fn(() => {
      return [{ id: "msg1", role: "user", content: "test", created_at: now.toISOString(), f: false, r: false, p: false, o: false }];
    }),
    messages_markExtracted: vi.fn(),
    messages_markPersonaExtracted: vi.fn(),
    messages_getUnextractedForPersona: vi.fn(() => []),
    messages_sort: vi.fn(),
    setHuman: vi.fn(),
    queue_enqueue: vi.fn(),
    getRoomList: vi.fn(() => []),
    getRoomActivePath: vi.fn(() => []),
    getRoomUnextractedMessagesForPersona: vi.fn(() => []),
    _human: human,
  };
}

describe("handleCeremonyProgress Multi-Phase Support", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("waits when queue has pending ceremonies", () => {
    const state = createMockProgressState(true);
    
    handleCeremonyProgress(state as any, 2);
    
    expect(state.queue_enqueue).not.toHaveBeenCalled();
  });

  it("Phase 1 complete → queues Expose phase with ceremony_progress: 2", () => {
    const state = createMockProgressState(false, true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    handleCeremonyProgress(state as any, 1);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Dedup complete, starting Expose phase")
    );
    expect(state.queue_enqueue).toHaveBeenCalled();
    
    consoleSpy.mockRestore();
  });

  it("Phase 2 complete → queues EventSummary phase with ceremony_progress: 3", () => {
    const state = createMockProgressState(false, true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    handleCeremonyProgress(state as any, 2);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Expose complete, starting EventSummary phase")
    );
    
    consoleSpy.mockRestore();
  });

  it("Phase 3 complete → advances to Decay", () => {
    const state = createMockProgressState(false, true);
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    
    handleCeremonyProgress(state as any, 3);
    
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("EventSummary complete, advancing to Decay")
    );
    
    consoleSpy.mockRestore();
  });

  it("filters out paused/archived/static personas", () => {
    const state = createMockProgressState(false, true);
    state.persona_getAll.mockReturnValue([
      { id: "active", display_name: "Active", is_paused: false, is_archived: false, is_static: false, last_updated: new Date().toISOString(), topics: [], traits: [] },
      { id: "paused", display_name: "Paused", is_paused: true, is_archived: false, is_static: false, last_updated: new Date().toISOString(), topics: [], traits: [] },
      { id: "archived", display_name: "Archived", is_paused: false, is_archived: true, is_static: false, last_updated: new Date().toISOString(), topics: [], traits: [] },
      { id: "static", display_name: "Static", is_paused: false, is_archived: false, is_static: true, last_updated: new Date().toISOString(), topics: [], traits: [] },
    ]);
    
    handleCeremonyProgress(state as any, 1);
    
    // Should only process "active" persona
    expect(state.persona_getById).toHaveBeenCalledWith("active");
    expect(state.persona_getById).not.toHaveBeenCalledWith("paused");
    expect(state.persona_getById).not.toHaveBeenCalledWith("archived");
    expect(state.persona_getById).not.toHaveBeenCalledWith("static");
  });
});

// =============================================================================
// Queue Ceremony Filter Tests
// =============================================================================



describe("Queue hasPendingCeremonies with Number Support", () => {
  it("returns true for ceremony_progress: 1", () => {
    const queue = new QueueState();
    queue.enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      next_step: LLMNextStep.HandleFactFind,
      model: "test:model",
      system: "test",
      user: "test",
      data: { ceremony_progress: 1 },
    });
    
    expect(queue.hasPendingCeremonies()).toBe(true);
  });

  it("returns true for ceremony_progress: 2", () => {
    const queue = new QueueState();
    queue.enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      next_step: LLMNextStep.HandleHumanTopicScan,
      model: "test:model",
      system: "test",
      user: "test",
      data: { ceremony_progress: 2 },
    });
    
    expect(queue.hasPendingCeremonies()).toBe(true);
  });

  it("returns false for ceremony_progress: 0", () => {
    const queue = new QueueState();
    queue.enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      next_step: LLMNextStep.HandleFactFind,
      model: "test:model",
      system: "test",
      user: "test",
      data: { ceremony_progress: 0 },
    });
    
    expect(queue.hasPendingCeremonies()).toBe(false);
  });

  it("returns false when no ceremony_progress field", () => {
    const queue = new QueueState();
    queue.enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Normal,
      next_step: LLMNextStep.HandlePersonaResponse,
      model: "test:model",
      system: "test",
      user: "test",
      data: {},
    });
    
    expect(queue.hasPendingCeremonies()).toBe(false);
  });
});

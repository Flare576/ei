import { describe, it, expect } from "vitest";
import { 
  shouldStartCeremony, 
  isNewDay, 
  isPastCeremonyTime 
} from "../../../src/core/orchestrators/ceremony.js";
import { 
  calculateLogarithmicDecay, 
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
      earlierToday.setHours(now.getHours() - 1);
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
  describe("calculateLogarithmicDecay", () => {
    it("decays value toward zero over time", () => {
      const result = calculateLogarithmicDecay(0.8, 24, 0.1);
      expect(result).toBeLessThan(0.8);
      expect(result).toBeGreaterThan(0);
    });

    it("returns 0 when input is 0 (no negative values)", () => {
      expect(calculateLogarithmicDecay(0, 24, 0.1)).toBe(0);
    });

    it("does not decay value of exactly 1 (extreme stability)", () => {
      const result = calculateLogarithmicDecay(1, 24, 0.1);
      expect(result).toBe(1);
    });

    it("decays values close to 1", () => {
      const result = calculateLogarithmicDecay(0.99, 24, 0.1);
      expect(result).toBeLessThan(0.99);
      expect(result).toBeGreaterThan(0.95);
    });

    it("decays faster at midpoint than at extremes", () => {
      const decayAt05 = 0.5 - calculateLogarithmicDecay(0.5, 24, 0.1);
      const decayAt09 = 0.9 - calculateLogarithmicDecay(0.9, 24, 0.1);
      const decayAt01 = 0.1 - calculateLogarithmicDecay(0.1, 24, 0.1);
      
      expect(decayAt05).toBeGreaterThan(decayAt09);
      expect(decayAt05).toBeGreaterThan(decayAt01);
    });

    it("clamps result to [0, 1] range", () => {
      const result = calculateLogarithmicDecay(0.5, 1000, 0.5);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThanOrEqual(1);
    });

    it("respects custom K decay rate", () => {
      const slowDecay = calculateLogarithmicDecay(0.5, 24, 0.05);
      const fastDecay = calculateLogarithmicDecay(0.5, 24, 0.2);
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

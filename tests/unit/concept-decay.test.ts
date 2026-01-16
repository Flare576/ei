import { describe, it, expect } from 'vitest';
import { calculateLogarithmicDecay } from '../../src/concept-decay.js';

describe('calculateLogarithmicDecay', () => {
  it('decays fastest at midpoint (0.5)', () => {
    const hours = 10;
    const decayAt05 = 0.5 - calculateLogarithmicDecay(0.5, hours);
    const decayAt02 = 0.2 - calculateLogarithmicDecay(0.2, hours);
    const decayAt08 = 0.8 - calculateLogarithmicDecay(0.8, hours);

    expect(decayAt05).toBeGreaterThan(decayAt02);
    expect(decayAt05).toBeGreaterThan(decayAt08);
  });

  it('returns 0 when starting at 0', () => {
    expect(calculateLogarithmicDecay(0, 100)).toBe(0);
  });

  it('decays very slowly near ceiling (0.99)', () => {
    const result = calculateLogarithmicDecay(0.99, 10);
    const decay = 0.99 - result;

    expect(decay).toBeLessThan(0.01);
    expect(result).toBeGreaterThan(0.98);
  });

  it('returns original value when hours is 0', () => {
    expect(calculateLogarithmicDecay(0.5, 0)).toBe(0.5);
    expect(calculateLogarithmicDecay(0.8, 0)).toBe(0.8);
  });

  it('decay increases with more hours', () => {
    const value = 0.5;
    const decay1h = value - calculateLogarithmicDecay(value, 1);
    const decay10h = value - calculateLogarithmicDecay(value, 10);
    const decay100h = value - calculateLogarithmicDecay(value, 100);

    expect(decay10h).toBeGreaterThan(decay1h);
    expect(decay100h).toBeGreaterThan(decay10h);
  });

  it('never returns negative', () => {
    expect(calculateLogarithmicDecay(0.01, 1000)).toBeGreaterThanOrEqual(0);
    expect(calculateLogarithmicDecay(0.5, 1000)).toBeGreaterThanOrEqual(0);
  });

  it('always decays toward 0 (result <= input)', () => {
    const testCases = [0.1, 0.25, 0.5, 0.75, 0.9];
    for (const value of testCases) {
      const result = calculateLogarithmicDecay(value, 10);
      expect(result).toBeLessThanOrEqual(value);
    }
  });
});

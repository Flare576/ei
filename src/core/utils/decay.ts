/**
 * Logarithmic decay utility for exposure values.
 * Ported from V0: v0/src/topic-decay.ts
 * 
 * The formula decays faster at extremes (0 and 1), slower in the middle.
 * K=0.1 means ~10% decay per day at midpoint (0.5).
 */

export function calculateLogarithmicDecay(
  currentValue: number,
  hoursSinceUpdate: number,
  K: number = 0.1
): number {
  const decay = K * currentValue * (1 - currentValue) * hoursSinceUpdate;
  return Math.max(0, Math.min(1, currentValue - decay));
}

export function applyDecayToValue(
  currentValue: number,
  lastUpdated: string,
  now: Date = new Date(),
  K: number = 0.1
): { newValue: number; hoursSinceUpdate: number } {
  const lastUpdatedTime = new Date(lastUpdated).getTime();
  const hoursSinceUpdate = (now.getTime() - lastUpdatedTime) / (1000 * 60 * 60);
  
  if (hoursSinceUpdate < 0.1) {
    return { newValue: currentValue, hoursSinceUpdate };
  }
  
  const newValue = calculateLogarithmicDecay(currentValue, hoursSinceUpdate, K);
  return { newValue, hoursSinceUpdate };
}

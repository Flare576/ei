/**
 * Exponential decay utility for exposure values.
 * 
 * Formula: v(t) = v₀ · e^(-K · days)
 * 
 * K=0.1 means ~9.5% decay per day regardless of current value.
 * Decays fastest immediately after peak, slows as it approaches 0.
 * A topic at 1.0 reaches ~0.5 after ~7 days, ~0.05 after ~30 days.
 * 
 * This replaced the old logistic approximation (K * v * (1-v) * hours)
 * which had the wrong shape: it decayed FASTEST at 0.5, not at 1.0,
 * and was aggressive enough to drop 0.2 → 0 in a single day.
 */

export function calculateExponentialDecay(
  currentValue: number,
  hoursSinceUpdate: number,
  K: number = 0.1
): number {
  const days = hoursSinceUpdate / 24;
  return Math.max(0, Math.min(1, currentValue * Math.exp(-K * days)));
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
  
  const newValue = calculateExponentialDecay(currentValue, hoursSinceUpdate, K);
  return { newValue, hoursSinceUpdate };
}

import type { ExposureImpact } from "../../prompts/human/types.js";

export function calculateExposureCurrent(impact: ExposureImpact | undefined, current: number = 0): number {
  const target = (() => {
    switch (impact) {
      case "high": return 0.9;
      case "medium": return 0.6;
      case "low": return 0.3;
      case "none": return 0.1;
      default: return 0.5;
    }
  })();
  return Math.max(target, current);
}

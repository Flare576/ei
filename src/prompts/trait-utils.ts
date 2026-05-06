import type { PersonaTrait } from "../core/types.js";

export interface TraitBucket {
  min: number;
  max: number;
  header: string;
}

export interface PartitionedTraits {
  guardrails: PersonaTrait[];
  active: PersonaTrait[];
}

// Special-case: .filter() is intentional here. This file is the designated home
// for trait partitioning logic that prompt builders need for rendering. Keeping it
// here (rather than inline in each builder) is what lets the structural check
// enforce "no .filter() in prompt builders" elsewhere.
export function partitionTraits(traits: PersonaTrait[]): PartitionedTraits {
  return {
    guardrails: traits.filter(t => (t.strength ?? 0.5) === 0),
    active: traits.filter(t => (t.strength ?? 0.5) > 0),
  };
}

export function bucketTraits(active: PersonaTrait[], buckets: readonly TraitBucket[]): Array<{ bucket: TraitBucket; traits: PersonaTrait[] }> {
  return buckets.map(bucket => ({
    bucket,
    traits: active.filter(t => {
      const pct = Math.round((t.strength ?? 0.5) * 100);
      return pct >= bucket.min && pct <= bucket.max;
    }),
  }));
}

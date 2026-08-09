/**
 * The single shared `rewrite_length_floor` formula (ADR-032): once a record
 * has been reviewed (by ReWrite, or implicitly by any write that stamps a
 * floor), the ceremony skips it again until its description outgrows this
 * value. `MIN_REWRITE_FLOOR` guarantees even a very short description still
 * buys some headroom before the next rewrite-scan candidacy check.
 *
 * Previously duplicated across every ReWrite call site
 * (src/core/handlers/rewrite.ts) as inline `Math.max(750, Math.ceil(len *
 * 1.1))`. Extracted so the upsert choke point (src/core/state/human.ts) and
 * every caller share exactly one definition — see ADR-032.
 */
export const MIN_REWRITE_FLOOR = 750;

export function computeRewriteLengthFloor(descriptionLength: number): number {
  return Math.max(MIN_REWRITE_FLOOR, Math.ceil(descriptionLength * 1.1));
}

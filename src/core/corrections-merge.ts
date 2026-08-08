/**
 * RFC 7396 JSON Merge Patch primitives — ADR-029.
 *
 * `applyMergePatch` is the one merge implementation every apply path
 * (live-drain, self-drain, CLI read-overlay) shares — "one function,
 * three callers," per ADR-029 clause 2, extended from the write itself to
 * the merge that precedes it.
 *
 * This module deliberately stays framework-agnostic (no Zod) and holds
 * ONLY the merge itself plus `MergePatchValidationError`. The "validate
 * the whole candidate against the externally-writable projection" step
 * ADR-029 clause 3 requires — did the merge leave a REQUIRED field
 * missing (RFC 7396 `null` removed it), or a cross-field invariant
 * broken? — lives in `src/core/entity-schemas.ts`'s `validateCandidate`,
 * run against the SAME real Zod candidate schemas the CLI layer parses
 * input against (`topicCandidateSchema`/`personCandidateSchema`/
 * `personaCandidateSchema`), not a hand-maintained shadow of them.
 * Corrected 2026-08-07 (Beta's review, plan-1-adr029-merge-patch.md
 * [I3]): an earlier version of this module held its own hand-written
 * `assertTopicCandidateValid`/`assertPersonCandidateValid`/
 * `assertPersonaCandidateValid` predicates specifically to avoid core
 * depending on Zod — those predicates had already drifted from the real
 * schemas (e.g. checking `typeof sentiment === "number"` where the
 * schema requires `-1..1`), making "keep predicates in sync by hand" an
 * unsafe trade-off in practice, not merely a maintenance risk. Zod itself
 * is a generic runtime validator with no CLI/DOM dependency, so giving
 * core a direct dependency on it is the correct fix.
 *
 * Entities in scope (PersonaEntity, Person, Topic — see
 * src/core/types/entities.ts and data-items.ts) have no nested
 * plain-object fields subject to patching: every Full-Access field is
 * either a scalar or an array, and arrays replace wholesale under
 * ADR-029, never element-merge. `pending_update` (persona) is the one
 * object-shaped field this ADR touches, and it is Clearable-only —
 * accepted as `null` (remove) or absent (unchanged), never as a
 * caller-supplied object — so the recursive branch below exists for
 * completeness against the general RFC, not because any field currently
 * exercises it.
 */

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Every field of `T` may be omitted (leave unchanged), set to its own
 * value (RFC 7396 "present"), or set to `null` (RFC 7396 "remove"). This
 * is deliberately more permissive than "only Clearable fields may be
 * null" — that narrower rule is enforced by each entity's Zod patch
 * schema (`src/core/entity-schemas.ts`) at parse time, not by this type, which
 * only describes the wire shape a merge function can accept.
 */
export type MergePatch<T> = { [K in keyof T]?: T[K] | null };

/**
 * Merges `patch` onto a COPY of `target` per RFC 7396: a member absent
 * from `patch` leaves `target`'s value unchanged; present-and-non-null
 * sets it; present-as-`null` removes it. Nested plain objects merge
 * recursively; arrays and every other value type replace wholesale.
 * Never mutates `target` or `patch`.
 */
export function applyMergePatch<T extends object>(target: T, patch: MergePatch<T>): T {
  const result: Record<string, unknown> = { ...(target as Record<string, unknown>) };
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    } else if (value === null) {
      delete result[key];
    } else if (isPlainObject(value) && isPlainObject(result[key])) {
      result[key] = applyMergePatch(result[key] as Record<string, unknown>, value as MergePatch<Record<string, unknown>>);
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

/**
 * Thrown when a patch, merged onto stored state, produces a candidate
 * that violates an entity's own required-field or cross-field invariant
 * — "a patch valid by grammar but invalid after merging onto stored
 * state," per ADR-029's Risks section and this plan's TODO 5 acceptance
 * criterion 3. The write this candidate was headed for must not happen
 * at all; every caller of the assert* functions below is expected to
 * propagate the throw rather than partially apply anything.
 */
export class MergePatchValidationError extends Error {}


import type { PersonIdentifier, Person } from "../types/data-items.js";
import type { PersonaEntity } from "../types/entities.js";
import { isReservedPersonaId } from "../types/entities.js";
import type { StateManager } from "../state-manager.js";
import { BUILT_IN_IDENTIFIER_TYPES } from "../constants/built-in-identifier-types.js";
import { sanitizeMessageIdForLog } from "./message-refusal.js";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNormalizedKey(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Fuzzy-matches LLM-provided type against built-in + in-use types (strip non-alphanumeric, lowercase).
// "nickname" -> "Nickname", "full_name" -> "Full Name", "EMAIL" -> "Email", "Slack RNP" -> "Slack RNP" (custom, no match)
export function normalizeIdentifierType(llmType: string, state: StateManager): string {
  const inUseTypes = state.getHuman().people.flatMap(p =>
    (p.identifiers ?? []).map(i => i.type)
  );

  const canonicalMap = new Map<string, string>();
  for (const t of [...BUILT_IN_IDENTIFIER_TYPES, ...inUseTypes]) {
    const key = toNormalizedKey(t);
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, t);
    }
  }

  const normalized = toNormalizedKey(llmType);
  return canonicalMap.get(normalized) ?? llmType;
}

export function sanitizeEiPersonaIdentifiers(
  identifiers: PersonIdentifier[],
  personas: PersonaEntity[]
): PersonIdentifier[] {
  return identifiers.map(id => {
    if (!isEiPersonaIdentifierType(id.type) && id.type !== 'AI Persona') return id;
    // Reserved system-persona ids ("ei"/"emmet") are always valid Ei
    // Persona link targets, regardless of whether that Persona has
    // actually been bootstrapped yet (I4) -- Emmett is lazily created,
    // so demoting this to Nickname before that happens would destroy a
    // legitimate reserved-id link on an ordinary CLI/MCP edit. Passed
    // through completely unchanged (never re-cased) so a legacy-cased
    // record round-trips exactly as written.
    if (isReservedPersonaId(id.value)) return id;
    if (UUID_REGEX.test(id.value)) return { ...id, type: 'Ei Persona' };
    const matched = personas.find(p =>
      p.display_name === id.value || p.aliases?.includes(id.value)
    );
    if (matched) return { ...id, type: 'Ei Persona', value: matched.id };
    return id.type === 'AI Persona' ? id : { ...id, type: 'Nickname' };
  });
}

/**
 * Canonical predicate for identifying an `Ei Persona`-typed identifier —
 * case-insensitive on the type string, but NOT separator-flexible:
 * "ei persona" / "EI PERSONA" match, "ei_persona" / "eipersona" do not
 * (ADR-010 clause 6, CONTRACTS.md's `Ei Persona` Type section). Every
 * consumer that needs to recognize this identifier type — sanitizing,
 * guarding cardinality, synthesizing a nickname — must use this instead
 * of writing its own `'Ei Persona'` string comparison, so a
 * lowercase-written record and a Title-Case one are treated identically
 * everywhere.
 */
export function isEiPersonaIdentifierType(type: string): boolean {
  return type.trim().toLowerCase() === 'ei persona';
}

/**
 * True when `id` is a real, guardable Persona link: its type matches the
 * canonical Ei Persona predicate AND its value is not one of the reserved
 * system-persona ids (`RESERVED_PERSONA_IDS` — "ei"/"emmet",
 * src/core/types/entities.ts). Those two literal values are documented,
 * valid values for this field (PersonIdentifier.value's own doc comment),
 * but they name Ei's own built-in personas, not a user-created composite —
 * they are never treated as a linkable target for ADR-006's one-to-one
 * invariant, so guardPersonaLinks below ignores them entirely rather than
 * ever refusing them.
 */
export function isEiPersonaLinkIdentifier(id: PersonIdentifier): boolean {
  return isEiPersonaIdentifierType(id.type) && !isReservedPersonaId(id.value);
}

/** One `Ei Persona` link a write-time guard declined to keep, with enough detail to name it in a report. */
export interface PersonaLinkRefusal {
  personId: string;
  personName?: string;
  value: string;
  reason: string;
  /**
   * The id of the OTHER Person already holding this value -- set only for
   * a B-many collision (never for an A-many/duplicate refusal, where
   * there is no separate conflicting Person). `reason`'s own text never
   * names that Person, only this id, so a consumer that must stay
   * id-only for a durable, privileged message (I5,
   * buildPersonaLinkRefusalMessage) can point at the record without ever
   * rendering its caller-controlled name.
   */
  conflictPersonId?: string;
}

/**
 * ADR-006/ADR-010 write-time enforcement: a Person carries at most one Ei
 * Persona link, and a Persona is linked from at most one Person. Never
 * repairs existing data (ADR-010 clause 1) -- every check below only ever
 * refuses a link this write is actually INTRODUCING; a link already
 * present on the same Person's OWN prior stored record (`priorStored`,
 * `undefined` for a brand-new Person) always survives this write
 * untouched, even if it now looks ambiguous against this Person's other
 * links or collides with another CURRENT Person's already-existing claim
 * on the same value -- that is pre-existing invalid data for a human to
 * resolve, never something an unrelated write may silently repair by
 * deleting (C2, .sisyphus/reviews/tonight-post-audit-fix-queue.md).
 *
 * `allPeople` must be authoritative, live state; a stale pre-queue
 * snapshot can pass this check and still collide once applied, see the
 * issue's "Authoritative queued-write correction".
 *
 * `excludeIds` names People being removed as part of this SAME operation
 * (dedup's departing donors) -- a link inherited from a departing donor is
 * not a collision with that donor's own not-yet-deleted record (ADR-010's
 * dated note, "the guard must be told what is leaving").
 *
 * Resolution, with NO precedence between two otherwise-valid NEW links
 * (ADR-010 clause 4a -- every tiebreak is a silent guess):
 *   1. At most one Ei-Persona-typed identifier on the candidate -> nothing
 *      to resolve on this Person alone; it proceeds to step 4 unchanged.
 *   2. More than one, and this write introduces no NEW value at all
 *      (every link was already on `priorStored`, however many there are)
 *      -> the whole pre-existing shape survives untouched; never repaired.
 *   3. More than one, and this write DOES introduce at least one NEW
 *      value: if exactly one PRE-EXISTING link remains, it is preferred
 *      and every newly introduced one is refused (clause 4's "the
 *      offending link"); otherwise (no pre-existing link to prefer, or an
 *      already-ambiguous multiple) every pre-existing link still survives
 *      untouched and only the newly introduced ones are refused -- this
 *      write's own ambiguity, never the inherited one.
 *   4. Whatever survives steps 1-3 is then checked against every OTHER
 *      Person for the same value (the B-many direction) -- but ONLY when
 *      that value is itself new to this Person's record; a value already
 *      on `priorStored` is never refused here either, no matter what any
 *      other Person currently claims.
 *
 * Returns the candidate with only the surviving link (if any) in its
 * `identifiers`, plus a refusal entry for every link that did not
 * survive. Reporting the refusal is the caller's job -- this function only
 * decides the data. Every free-text field on a refusal (Person name,
 * identifier value) is stripped of control bytes before being recorded
 * (I5) -- these values are caller-controlled and refusals are later
 * rendered verbatim into CLI/MCP output. The conflicting Person in a
 * B-many refusal is never named at all here, only referenced by
 * `conflictPersonId` (I5) -- guardPersonaLinks cannot know whether a
 * caller will render a refusal into that CLI/MCP diagnostic or into a
 * durable, privileged system-prompt message, so the conflicting Person's
 * own name (also caller-controlled) never enters either.
 *
 * Also refuses an intra-candidate duplicate: the exact same value
 * appearing 2+ times in `candidate.identifiers` in this ONE write (I7).
 * That is never legitimate regardless of prior state -- a literal
 * duplicate entry, not a cardinality dispute between two different
 * values. The first occurrence of a repeated value keeps whatever fate
 * the prior-vs-introduced/B-many resolution below gives it; every
 * REPEATED occurrence already accounted for in this same write is
 * refused as a duplicate.
 */
export function guardPersonaLinks(
  candidate: Person,
  priorStored: Person | undefined,
  allPeople: readonly Person[],
  excludeIds?: ReadonlySet<string> | readonly string[]
): { person: Person; refusals: PersonaLinkRefusal[] } {
  const identifiers = candidate.identifiers ?? [];
  const links = identifiers.filter(isEiPersonaLinkIdentifier);
  if (links.length === 0) {
    return { person: candidate, refusals: [] };
  }

  const priorValues = new Set(
    (priorStored?.identifiers ?? []).filter(isEiPersonaLinkIdentifier).map(i => i.value)
  );
  const personName = sanitizeMessageIdForLog(candidate.name);

  const refusals: PersonaLinkRefusal[] = [];
  let survivors: PersonIdentifier[];

  if (links.length === 1) {
    // Nothing to resolve on this Person alone — the sole B-many check below decides its fate.
    survivors = links;
  } else {
    const preExisting = links.filter(l => priorValues.has(l.value));
    const introduced = links.filter(l => !priorValues.has(l.value));

    if (introduced.length === 0) {
      // This write introduces nothing new — whatever shape was already
      // stored (however many links, even an already-ambiguous multiple)
      // survives untouched (ADR-010 clause 1: never repair pre-existing
      // invalid data on an unrelated write).
      survivors = links;
    } else if (preExisting.length === 1) {
      survivors = preExisting;
      for (const bad of introduced) {
        refusals.push({
          personId: candidate.id,
          personName,
          value: sanitizeMessageIdForLog(bad.value),
          reason: `already linked to a different Persona (${sanitizeMessageIdForLog(preExisting[0].value)})`,
        });
      }
    } else {
      // No single pre-existing link to prefer (none, or an
      // already-ambiguous multiple) — that inherited shape is left
      // exactly as it was; only the NEWLY introduced links are this
      // write's own ambiguity.
      survivors = preExisting;
      for (const bad of introduced) {
        refusals.push({
          personId: candidate.id,
          personName,
          value: sanitizeMessageIdForLog(bad.value),
          reason: "this write introduced more than one Persona link at once",
        });
      }
    }
  }

  // I7: `survivors` can still hold the exact same value more than once --
  // e.g. a Person already holding [X] updated with [X, X] has BOTH raw X
  // entries land in the "introduces nothing new" branch above untouched.
  // The first occurrence of each value here keeps whatever fate the
  // resolution above already gave it; every REPEATED occurrence of a
  // value already seen in THIS pass is refused as a duplicate before it
  // ever reaches the cross-Person check below.
  const seenSurvivorValues = new Set<string>();
  const dedupedSurvivors: PersonIdentifier[] = [];
  for (const link of survivors) {
    if (seenSurvivorValues.has(link.value)) {
      refusals.push({
        personId: candidate.id,
        personName,
        value: sanitizeMessageIdForLog(link.value),
        reason: "duplicate of a Persona link already present in this same write",
      });
      continue;
    }
    seenSurvivorValues.add(link.value);
    dedupedSurvivors.push(link);
  }
  survivors = dedupedSurvivors;

  const excluded = new Set(excludeIds ?? []);
  const finalSurvivors: PersonIdentifier[] = [];
  for (const link of survivors) {
    // A link this Person already had before this write is never refused
    // for colliding with another Person's claim — that collision (if any)
    // predates this write, and ADR-010 forbids repairing it on an
    // unrelated edit.
    if (priorValues.has(link.value)) {
      finalSurvivors.push(link);
      continue;
    }
    const conflict = allPeople.find(p =>
      p.id !== candidate.id &&
      !excluded.has(p.id) &&
      (p.identifiers ?? []).some(i => isEiPersonaLinkIdentifier(i) && i.value === link.value)
    );
    if (conflict) {
      refusals.push({
        personId: candidate.id,
        personName,
        value: sanitizeMessageIdForLog(link.value),
        reason: `already linked from a different Person (${conflict.id})`,
        conflictPersonId: conflict.id,
      });
    } else {
      finalSurvivors.push(link);
    }
  }

  if (refusals.length === 0) {
    return { person: candidate, refusals: [] };
  }

  // Reference-safe, not value-based: I7's duplicate handling above means
  // `identifiers` can legitimately hold two objects sharing one `.value`
  // (the surviving first occurrence and the refused repeat) -- filtering
  // by value alone would let both back in. `emittedValues` keeps at most
  // one identifier per surviving value, in original order.
  const survivingValues = new Set(finalSurvivors.map(l => l.value));
  const emittedValues = new Set<string>();
  const newIdentifiers = identifiers.filter(id => {
    if (!isEiPersonaLinkIdentifier(id)) return true;
    if (!survivingValues.has(id.value) || emittedValues.has(id.value)) return false;
    emittedValues.add(id.value);
    return true;
  });

  return { person: { ...candidate, identifiers: newIdentifiers }, refusals };
}

/**
 * Strips every `Ei Persona` identifier pointing at `personaId` from every
 * Person record, in place. Called when a Persona is actually deleted
 * (ADR-010 clause 5: going forward, a delete must not leave a fresh
 * orphan behind it — pre-existing orphans from before this guard existed
 * are tolerated and never migrated).
 */
export function removePersonaLinksToId(people: Person[], personaId: string): void {
  const now = new Date().toISOString();
  for (const person of people) {
    const identifiers = person.identifiers ?? [];
    const filtered = identifiers.filter(i => !(isEiPersonaIdentifierType(i.type) && i.value === personaId));
    if (filtered.length !== identifiers.length) {
      person.identifiers = filtered;
      person.last_updated = now;
    }
  }
}

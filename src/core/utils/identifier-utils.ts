import type { PersonIdentifier, Person } from "../types/data-items.js";
import type { PersonaEntity } from "../types/entities.js";
import { isReservedPersonaId } from "../types/entities.js";
import type { StateManager } from "../state-manager.js";
import { BUILT_IN_IDENTIFIER_TYPES } from "../constants/built-in-identifier-types.js";

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
}

/**
 * ADR-006's write-time enforcement: a Person carries at most one Ei
 * Persona link, and a Persona is linked from at most one Person. Never
 * repairs existing data (ADR-010 clause 1) — it only decides which of the
 * links PRESENT ON THIS CANDIDATE survive this one write, given what the
 * same Person already had before this write (`priorStored`, `undefined`
 * for a brand-new Person) and what every other CURRENT Person record
 * already claims (`allPeople` — must be authoritative, live state; a
 * stale pre-queue snapshot can pass this check and still collide once
 * applied, see the issue's "Authoritative queued-write correction").
 *
 * `excludeIds` names People being removed as part of this SAME operation
 * (dedup's departing donors) — a link inherited from a departing donor is
 * not a collision with that donor's own not-yet-deleted record (ADR-010's
 * dated note, "the guard must be told what is leaving").
 *
 * Resolution, with NO precedence between two otherwise-valid new links
 * (ADR-010 clause 4a — every tiebreak is a silent guess):
 *   1. At most one Ei-Persona-typed identifier on the candidate → nothing
 *      to resolve; return it unchanged.
 *   2. More than one, and exactly one of them already existed on this same
 *      Person before this write → that one survives (clause 4's "the
 *      offending link" — every newly introduced one is refused).
 *   3. Otherwise (zero pre-existing survivors to prefer, or the
 *      pre-existing shape was already invalid) → none of the candidate's
 *      links survive; this write introduced ambiguity it cannot resolve.
 *   4. Whatever survives step 2 is then checked against every OTHER
 *      Person for the same value (the B-many direction) and refused too
 *      if it collides.
 *
 * Returns the candidate with only the surviving link (if any) in its
 * `identifiers`, plus a refusal entry for every link that did not
 * survive. Reporting the refusal is the caller's job — this function only
 * decides the data.
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

  const refusals: PersonaLinkRefusal[] = [];
  let survivors: PersonIdentifier[];

  if (links.length === 1) {
    // Nothing to resolve on this Person alone — the sole B-many check below decides its fate.
    survivors = links;
  } else {
    const priorValues = new Set(
      (priorStored?.identifiers ?? []).filter(isEiPersonaLinkIdentifier).map(i => i.value)
    );
    const preExisting = links.filter(l => priorValues.has(l.value));
    const introduced = links.filter(l => !priorValues.has(l.value));

    if (preExisting.length === 1 && introduced.length > 0) {
      survivors = preExisting;
      for (const bad of introduced) {
        refusals.push({
          personId: candidate.id,
          personName: candidate.name,
          value: bad.value,
          reason: `already linked to a different Persona (${preExisting[0].value})`,
        });
      }
    } else {
      survivors = [];
      for (const bad of links) {
        refusals.push({
          personId: candidate.id,
          personName: candidate.name,
          value: bad.value,
          reason: "this write introduced more than one Persona link at once",
        });
      }
    }
  }

  const excluded = new Set(excludeIds ?? []);
  const finalSurvivors: PersonIdentifier[] = [];
  for (const link of survivors) {
    const conflict = allPeople.find(p =>
      p.id !== candidate.id &&
      !excluded.has(p.id) &&
      (p.identifiers ?? []).some(i => isEiPersonaLinkIdentifier(i) && i.value === link.value)
    );
    if (conflict) {
      refusals.push({
        personId: candidate.id,
        personName: candidate.name,
        value: link.value,
        reason: `already linked from a different Person ("${conflict.name}", ${conflict.id})`,
      });
    } else {
      finalSurvivors.push(link);
    }
  }

  if (refusals.length === 0) {
    return { person: candidate, refusals: [] };
  }

  const keptValues = new Set(finalSurvivors.map(l => l.value));
  const newIdentifiers = identifiers.filter(id =>
    !isEiPersonaLinkIdentifier(id) || keptValues.has(id.value)
  );

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

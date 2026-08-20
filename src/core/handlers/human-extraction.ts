import { ContextStatus, type LLMResponse, type Fact, type Person, type Message, type PersonaEntity } from "../types.js";
import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";
import type {
  FactFindResult,
  TopicScanResult,
  PersonScanResult,
  TopicScanCandidate,
  ItemMatchResult,
  PersonaSignalScanResult,
  PersonaObservationDraft,
} from "../../prompts/human/types.js";
import { queueTopicMatch, queuePersonUpdate, queuePersonaSignalScan, queuePersonaSignalMatch, type ExtractionContext } from "../orchestrators/index.js";
import { markMessagesExtracted, resolveMessageWindow, getMessageText } from "./utils.js";
import { matchQuoteInMessage } from "./human-matching.js";
import { BUILT_IN_FACT_NAMES } from "../constants/built-in-facts.js";
import { getEmbeddingService, getItemEmbeddingText, cosineSimilarity, getPersonEmbeddingText } from "../embedding-service.js";
import { levenshtein, normalizeForMatch } from "../utils/levenshtein.js";
import { isEiPersonaIdentifierType, resolvePersonaLinkedPeople } from "../utils/identifier-utils.js";
import { stripControlChars } from "../utils/message-refusal.js";
import { classifyObservationLens } from "../utils/persona-signal-lens.js";

export type PersonMatchStrength = 'strong' | 'weak';
export interface PersonMatch { person: Person; strength: PersonMatchStrength; }

const MULTI_MATCH_SIMILARITY_THRESHOLD = 0.75;
const ZERO_MATCH_COSINE_THRESHOLD = 0.80;

// Relationships where a person typically has exactly one instance.
// Only these fire the "sole relationship" uniqueness shortcut when the
// existing record already has a real name (non-Unknown records in non-singleton
// relationships fall through to cosine so we don't merge David into Sisyphus).
const SINGLETON_RELATIONSHIPS = new Set([
  'self',
  'husband', 'wife', 'spouse',
  'father', 'mother',
]);

function sharesNameToken(normalizedCandidateName: string, person: Person): boolean {
  const candidateTokens = new Set(normalizedCandidateName.split(/\s+/).filter(t => t.length >= 3));
  if (candidateTokens.size === 0) return false;
  const personStrings = [normalizeForMatch(person.name), ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value))];
  for (const s of personStrings) {
    for (const tok of s.split(/\s+/)) {
      if (tok.length >= 3 && candidateTokens.has(tok)) return true;
    }
  }
  return false;
}

function matchPersonCandidate(
  candidateName: string,
  candidateIdentifiers: PersonIdentifier[],
  people: Person[]
): PersonMatch[] {
  const normName = normalizeForMatch(candidateName);
  const matched = new Map<Person, PersonMatchStrength>();

  // Step 1: Exact match on any identifier value (type-agnostic)
  for (const person of people) {
    const allValues = [
      ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
      normalizeForMatch(person.name),
    ];
    if (allValues.includes(normName)) matched.set(person, 'strong');
  }
  // Also check scan-extracted identifiers against existing identifier values
  for (const scanId of candidateIdentifiers) {
    const normVal = normalizeForMatch(scanId.value);
    for (const person of people) {
      if ((person.identifiers ?? []).some(i => normalizeForMatch(i.value) === normVal)) {
        // Corroboration gate (#78 C1): a scan-extracted identifier only STRONG-binds when the
        // candidate's name shares a token with the match. A bare identifier hit with zero name
        // overlap is the cross-attribution signature (one person's handle on another's record),
        // so it drops to WEAK and must clear the cosine gate — or become a new record.
        const strength: PersonMatchStrength = sharesNameToken(normName, person) ? 'strong' : 'weak';
        if (matched.get(person) !== 'strong') matched.set(person, strength);
      }
    }
  }

  if (matched.size > 0) return [...matched].map(([person, strength]) => ({ person, strength }));

  // Step 2: Fuzzy match — skip for short names (< 6 chars): "mike"↔"jake" = 2 edits, false positive.
  if (normName.length >= 6) {
    const threshold = normName.length < 10 ? 1 : 2;
    for (const person of people) {
      const allValues = [
        ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
        normalizeForMatch(person.name),
      ];
      if (allValues.some(v => levenshtein(normName, v) <= threshold)) matched.set(person, 'weak');
    }
  }

  if (matched.size > 0) return [...matched].map(([person, strength]) => ({ person, strength }));

  // Step 2.5: First-name match — "Lucas Jeremy Scherer" should find "Lucas".
  // Only fires when first word is >= 4 chars to avoid short-name collisions.
  const candidateFirstWord = normName.split(/\s+/)[0];
  if (candidateFirstWord.length >= 4) {
    for (const person of people) {
      const allNames = [
        normalizeForMatch(person.name),
        ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
      ];
      if (allNames.some(n => n.split(/\s+/)[0] === candidateFirstWord)) matched.set(person, 'weak');
    }
  }

  return [...matched].map(([person, strength]) => ({ person, strength }));
}

export async function handleFactFind(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as FactFindResult | undefined;
  
  // Mark messages as scanned regardless of whether facts were found
  markMessagesExtracted(response, state, "f");
  
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.debug("[handleFactFind] No facts detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  const human = state.getHuman();
  const now = new Date().toISOString();
  let upsertCount = 0;

  for (const factResult of result.facts) {
    // Only upsert facts that match a built-in name
    if (!BUILT_IN_FACT_NAMES.has(factResult.name)) {
      console.warn(`[handleFactFind] Skipping non-built-in fact: "${factResult.name}"`);
      continue;
    }

    // Find the existing fact in state
    const existingFact = human.facts.find(f => f.name === factResult.name);
    if (!existingFact) {
      console.warn(`[handleFactFind] Skipping unknown fact: "${factResult.name}"`);
      continue;
    }

    // Skip facts that already have descriptions (only fill empty ones)
    if (existingFact.description && existingFact.description !== "") {
      console.debug(`[handleFactFind] Skipping fact with existing description: "${factResult.name}"`);
      continue;
    }

    // Skip if the LLM returned a null/empty/non-string value — don't store booleans or nulls
    if (!factResult.value || typeof factResult.value !== 'string') {
      console.warn(`[handleFactFind] Skipping fact with null/empty/non-string value: "${factResult.name}" (got ${typeof factResult.value})`);
      continue;
    }

    // Compute embedding for the updated fact
    let embedding: number[] | undefined;
    try {
      const embeddingService = getEmbeddingService();
      const text = getItemEmbeddingText({ name: factResult.name, description: factResult.value });
      embedding = await embeddingService.embed(text);
    } catch (err) {
      console.warn(`[handleFactFind] Failed to compute embedding for fact "${factResult.name}":`, err);
    }

    const updatedFact: Fact = {
      ...existingFact,
      description: factResult.value,
      last_updated: now,
      last_mentioned: now,
      learned_by: existingFact.learned_by ?? context.personaId,
      last_changed_by: context.personaId,
      interested_personas: [...new Set([...(existingFact.interested_personas ?? []), context.personaId])],
      sources: [...new Set([...(existingFact.sources ?? []), ...(context.sources ?? [])])],
      embedding,
    };

    state.human_fact_upsert(updatedFact);
    upsertCount++;
  }

  console.log(`[handleFactFind] Upserted ${upsertCount} fact(s)`);
}


export async function handleHumanTopicScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as TopicScanResult | undefined;
  
  markMessagesExtracted(response, state, "t");
  
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.debug("[handleHumanTopicScan] No topics detected or invalid result");
    return;
  }

  const context = {
    ...(response.request.data as unknown as ExtractionContext),
    channelDisplayName: (response.request.data as Record<string, unknown>).personaDisplayName as string,
  };
  if (!context?.personaId) return;

  const extractionModel = (response.request.data as Record<string, unknown>).extraction_model as string | undefined;
  for (const candidate of result.topics) {
    await queueTopicMatch(candidate, context, state, extractionModel);
  }
  console.log(`[handleHumanTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

async function confirmMatchByCosine(
  person: Person,
  candidate: { name: string; relationship?: string; description?: string },
  threshold: number
): Promise<Person | null> {
  if (!person.embedding || person.embedding.length === 0) return null;
  try {
    const embeddingService = getEmbeddingService();
    const candidateVector = await embeddingService.embed(getPersonEmbeddingText({
      name: candidate.name, relationship: candidate.relationship, description: candidate.description,
    }));
    const sim = cosineSimilarity(person.embedding, candidateVector);
    if (sim >= threshold) return person;
    console.debug(`[handleHumanPersonScan] Weak single-match "${candidate.name}" → "${person.name}" rejected (cosine ${sim.toFixed(3)} < ${threshold}) — new record`);
    return null;
  } catch (err) {
    console.warn(`[handleHumanPersonScan] Weak-match cosine failed for "${candidate.name}":`, err);
    return null;
  }
}

/**
 * D8/§4.7 soft-alert: a Persona linked to more than one Person record gets
 * neither a first-match pick nor a silent update — it's written to Ei's
 * own conversation as a system message and the observation is dropped.
 * Mirrors the deleted `queueReflectionPhase`'s own multiplicity warning
 * (ADR-038 item 5), adapted to this ingestion branch.
 */
function warnPersonaLinkMultiplicity(state: StateManager, persona: PersonaEntity, people: Person[]): void {
  const names = people.map(p => `"${p.name}"`).join(" and ");
  console.warn(`[handleHumanPersonScan] ${persona.display_name} is linked to multiple person records (${names}) — skipping persona-signal observation, writing Ei warning`);
  const warning: Message = {
    id: crypto.randomUUID(),
    role: "system",
    content: `While processing a conversation, I noticed that **${persona.display_name}** is connected to multiple person records: ${names}. This might be intentional — if you created a composite persona — but if not, you may want to check the identifiers on those records. I've skipped recording new signals for ${persona.display_name} until this is resolved.`,
    timestamp: new Date().toISOString(),
    read: false,
    context_status: ContextStatus.Always,
  };
  state.messages_append("ei", warning);
}

export async function handleHumanPersonScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as PersonScanResult | undefined;
  
  markMessagesExtracted(response, state, "p");
  
  if (!result?.people || !Array.isArray(result.people)) {
    console.debug("[handleHumanPersonScan] No people detected or invalid result");
    return;
  }

  const context = {
    ...(response.request.data as unknown as ExtractionContext),
    channelDisplayName: (response.request.data as Record<string, unknown>).personaDisplayName as string,
  };
  if (!context?.personaId) return;

  const extractionModel = (response.request.data as Record<string, unknown>).extraction_model as string | undefined;

  const { messages_context, messages_analyze } = resolveMessageWindow(response, state);
  const human = state.getHuman();

  for (const candidate of result.people) {
    const candidateIdentifiers: PersonIdentifier[] = (candidate.identifiers ?? []).map(i => ({
      type: i.type,
      value: i.value,
      ...(i.is_primary ? { is_primary: i.is_primary } : {}),
    }));

    const matches = matchPersonCandidate(candidate.name, candidateIdentifiers, human.people);

    let matchedPerson: Person | null = null;

    if (matches.length === 1) {
      const { person, strength } = matches[0];
      if (strength === 'strong') {
        matchedPerson = person;
      } else {
        matchedPerson = await confirmMatchByCosine(person, candidate, MULTI_MATCH_SIMILARITY_THRESHOLD);
      }
    } else if (matches.length > 1) {
      try {
        const embeddingService = getEmbeddingService();
        const candidateText = getPersonEmbeddingText({
          name: candidate.name,
          relationship: candidate.relationship,
          description: candidate.description,
        });
        const candidateVector = await embeddingService.embed(candidateText);
        let bestSimilarity = MULTI_MATCH_SIMILARITY_THRESHOLD;
        for (const { person } of matches) {
          if (person.embedding) {
            const sim = cosineSimilarity(person.embedding, candidateVector);
            if (sim > bestSimilarity) {
              bestSimilarity = sim;
              matchedPerson = person;
            }
          }
        }
        if (!matchedPerson) {
          console.debug(`[handleHumanPersonScan] Multi-match for "${candidate.name}" (${matches.length} hits) — no embedding above threshold, creating new record`);
        }
      } catch (err) {
        console.warn(`[handleHumanPersonScan] Multi-match embedding failed for "${candidate.name}", using first match:`, err);
        matchedPerson = matches[0].person;
      }
    } else {
      // Step 3: relationship filter → uniqueness match or cosine on the relevant subset.
      // Filter first (O(N)), then cosine only on the filtered set (O(K) where K <= N).
      const normRel = candidate.relationship?.toLowerCase();
      const sameRel = normRel && normRel !== 'unknown'
        ? human.people.filter(p => p.relationship?.toLowerCase() === normRel)
        : [];

      if (sameRel.length === 1) {
        const existing = sameRel[0];
        const normExistingName = normalizeForMatch(existing.name);
        const isUnknownPlaceholder = normExistingName === 'unknown' || normExistingName === normRel;
        const isSingleton = SINGLETON_RELATIONSHIPS.has(normRel!);
        if (isSingleton) {
          matchedPerson = existing;
          console.debug(`[handleHumanPersonScan] Relationship unique match: "${candidate.name}" → "${existing.name}" (sole ${candidate.relationship}, singleton relationship)`);
        } else if (isUnknownPlaceholder) {
          // M1 (deferred, #78): a placeholder with no embedding cannot be confirmed here and will fork a new record instead of promoting. Acceptable under the dupe-tolerant policy; revisit with embedding backfill.
          matchedPerson = await confirmMatchByCosine(existing, candidate, ZERO_MATCH_COSINE_THRESHOLD);
          console.debug(`[handleHumanPersonScan] Relationship unique match gated by cosine: "${candidate.name}" → "${existing.name}" (sole ${candidate.relationship}, unnamed placeholder) — ${matchedPerson ? 'confirmed' : 'rejected, new record'}`);
        }
      } else {
        // N>1 same relationship → cosine within that subset.
        // N=0 (unknown relationship or no stored records) → cosine against all people.
        const searchPool = sameRel.length > 1
          ? sameRel.filter(p => p.embedding && p.embedding.length > 0)
          : human.people.filter(p => p.embedding && p.embedding.length > 0);

        const poolLabel = sameRel.length > 1
          ? `${sameRel.length} ${candidate.relationship} records`
          : `all ${human.people.length} people`;

        if (searchPool.length > 0) {
          console.debug(`[handleHumanPersonScan] "${candidate.name}": cosine against ${searchPool.length} embedded (${poolLabel})`);
          try {
            const embeddingService = getEmbeddingService();
            const candidateText = getPersonEmbeddingText({
              name: candidate.name,
              relationship: candidate.relationship,
              description: candidate.description,
            });
            const candidateVector = await embeddingService.embed(candidateText);
            const scores: Array<{ name: string; sim: number }> = [];
            let bestSimilarity = ZERO_MATCH_COSINE_THRESHOLD;
            for (const person of searchPool) {
              const sim = cosineSimilarity(person.embedding!, candidateVector);
              scores.push({ name: person.name, sim });
              if (sim > bestSimilarity) {
                bestSimilarity = sim;
                matchedPerson = person;
              }
            }
            const top3 = scores.sort((a, b) => b.sim - a.sim).slice(0, 3).map(s => `"${s.name}"=${s.sim.toFixed(3)}`).join(', ');
            if (matchedPerson) {
              console.debug(`[handleHumanPersonScan] Cosine matched "${candidate.name}" → "${matchedPerson.name}" (${bestSimilarity.toFixed(3)}) | top3: ${top3}`);
            } else {
              console.debug(`[handleHumanPersonScan] Cosine: no match above ${ZERO_MATCH_COSINE_THRESHOLD} for "${candidate.name}" | top3: ${top3}`);
            }
          } catch (err) {
            console.warn(`[handleHumanPersonScan] Cosine failed for "${candidate.name}":`, err);
          }
        } else {
          console.debug(`[handleHumanPersonScan] "${candidate.name}": no embedded people in pool (${poolLabel}) — new person`);
        }
      }
    }

    if (matchedPerson && response.request.data.reflection_progress === 1) {
      const linkedPersonaId = matchedPerson.identifiers
        ?.find(i => i.type === "Ei Persona")?.value;
      if (linkedPersonaId) {
        console.debug(`[handleHumanPersonScan] Skipping update for "${candidate.name}" — scan marked as reflection drain (reflection_progress=1)`);
        continue;
      }
    }

    const confidence = typeof candidate.confidence === 'number' ? candidate.confidence : null;
    if (confidence !== null && confidence <= 2 && !matchedPerson) {
      console.debug(`[handleHumanPersonScan] Skipping low-confidence new person "${candidate.name}" (confidence=${confidence}, relationship_type=${candidate.relationship_type ?? 'none'})`);
      continue;
    }

    // D2/§4.3 branch point: a matched Person record carrying an `Ei
    // Persona` identifier is a Persona's own observed-identity record —
    // route it into the Observation→Signal reducer pipeline instead of
    // the generic full-record-replace `queuePersonUpdate` path. D8/§4.7:
    // resolve "the linked Person record for this Persona" by
    // enumerate-all, never first-match — a Persona linked to more than
    // one Person record soft-alerts and skips rather than picking either.
    const linkedPersonaId = matchedPerson?.identifiers?.find(i => isEiPersonaIdentifierType(i.type))?.value;
    if (matchedPerson && linkedPersonaId) {
      const subjectPersona = state.persona_getById(linkedPersonaId);
      const linkedPeople = resolvePersonaLinkedPeople(linkedPersonaId, human.people);
      if (subjectPersona && linkedPeople.length > 1) {
        warnPersonaLinkMultiplicity(state, subjectPersona, linkedPeople);
        continue;
      }
      if (subjectPersona && linkedPeople.length === 1) {
        // Forwarded defensively: ordinary in-Ei conversation (this scan's
        // own source) never carries verified execution provenance, so
        // this is always undefined today — classifyObservationLens then
        // correctly resolves to the Persona lens (D6). The field exists
        // here so a future caller that DOES attach provenance to a
        // person-scan request (e.g. a CD2+ ingestion path reusing this
        // same scan/match machinery, per Bolt 009's own design) is never
        // silently dropped at this branch point.
        const agentProvenance = response.request.data.agentProvenance as Parameters<typeof queuePersonaSignalScan>[5];
        queuePersonaSignalScan(
          { ...context, messages_context, messages_analyze },
          subjectPersona,
          linkedPeople[0].id,
          state,
          extractionModel,
          agentProvenance
        );
        console.debug(`[handleHumanPersonScan] person "${candidate.name}": routed to persona-signal pipeline for ${subjectPersona.display_name}`);
        continue;
      }
      // linkedPeople.length === 0 or subjectPersona missing — the
      // identifier didn't resolve to a live persona/person pair. Extremely
      // unlikely (matchedPerson itself just proved at least one link
      // exists), but fall through defensively to the generic path rather
      // than silently dropping this candidate.
    }

    const matchResult: ItemMatchResult = { matched_guid: matchedPerson?.id ?? null };
    queuePersonUpdate(matchResult, {
      ...context,
      messages_context,
      messages_analyze,
      candidateName: candidate.name,
      candidateDescription: candidate.description,
      candidateRelationship: candidate.relationship,
      candidateIdentifiers,
      extraction_model: extractionModel,
    }, state);

    const matched = matchedPerson
      ? `matched "${matchedPerson.name}"`
      : matches.length > 1
        ? `multi-match ambiguous (${matches.length} hits) — new record`
        : "no match (new person)";
    console.debug(`[handleHumanPersonScan] person "${candidate.name}": ${matched}`);
  }
  console.log(`[handleHumanPersonScan] Processed ${result.people.length} person(s)`);
}

export async function handleEventScan(response: LLMResponse, state: StateManager): Promise<void> {
  markMessagesExtracted(response, state, "e");

  const result = response.parsed as { events?: Array<{ name: string; description: string; reason: string }> } | undefined;

  if (!result?.events || !Array.isArray(result.events) || result.events.length === 0) {
    console.debug("[handleEventScan] No epic events detected");
    return;
  }

  const context = {
    ...(response.request.data as unknown as ExtractionContext),
    channelDisplayName: (response.request.data as Record<string, unknown>).personaDisplayName as string,
  };
  if (!context?.personaId) return;

  const extractionModel = (response.request.data as Record<string, unknown>).extraction_model as string | undefined;

  for (const event of result.events) {
    const candidate: TopicScanCandidate = {
      name: event.name,
      description: event.description,
      category: "Event",
      reason: event.reason,
    };
    await queueTopicMatch(candidate, context, state, extractionModel);
  }

  console.log(`[handleEventScan] Queued ${result.events.length} event(s) for matching`);
}

const VALID_SIGNAL_DIMENSIONS = new Set(["identity", "values", "relationship", "behavior", "voice"]);
const VALID_SIGNAL_DIRECTIONS = new Set(["novel", "confirms", "challenges"]);
const VALID_OBSERVER_KINDS = new Set(["human", "subject_self", "other_persona"]);

/**
 * Rejects a drafted observation whose shape, scalar/enum fields, or
 * `other_persona` attribution don't hold up — never persisted as-is (P0
 * review finding, hardened further per a second review pass). `draft` is
 * treated as `unknown`, not `PersonaObservationDraft`: `response.parsed`
 * is an `as`-asserted cast over untrusted LLM JSON, so a compile-time
 * type guarantees nothing about the runtime shape of any one array
 * element — `null`, a number, or a value with the wrong field types must
 * all be caught here before anything downstream reads a property off it.
 *
 * Beyond the enum/id checks: `quote_text`/`claim` must be non-empty
 * strings (a non-string `claim` would reach `PersonaObservation.claim` —
 * typed `string` everywhere downstream — and crash the first
 * `.toLowerCase()` call `claimsMatch` makes during a later dismissed-
 * signal reopen check); `extraction_confidence` must additionally fall
 * within the prompt's own declared 0.0-1.0 range, not merely be finite
 * (a stray `-5` or `100` is still "a number" but never a valid
 * confidence). An unvalidated `observer_persona_id` is a promotion
 * exploit, not just a data-quality nit: `observationContextKey` treats
 * each distinct `other_persona` id as its own independent witness, so a
 * forged, missing-but-required, or self-referential id can manufacture
 * false independence (D9) or let self-testimony masquerade as
 * corroboration from someone else.
 */
function validatePersonaObservationDraft(
  draft: unknown,
  subjectPersonaId: string,
  state: StateManager
): { ok: true; draft: PersonaObservationDraft } | { ok: false; reason: string } {
  if (!draft || typeof draft !== "object" || Array.isArray(draft)) {
    return { ok: false, reason: `draft is not an object (got ${JSON.stringify(draft)})` };
  }
  const candidate = draft as Record<string, unknown>;

  if (typeof candidate.quote_text !== "string" || candidate.quote_text.length === 0) {
    return { ok: false, reason: `invalid quote_text "${JSON.stringify(candidate.quote_text)}"` };
  }
  if (typeof candidate.claim !== "string" || candidate.claim.length === 0) {
    return { ok: false, reason: `invalid claim "${JSON.stringify(candidate.claim)}"` };
  }
  if (typeof candidate.dimension !== "string" || !VALID_SIGNAL_DIMENSIONS.has(candidate.dimension)) {
    return { ok: false, reason: `invalid dimension "${JSON.stringify(candidate.dimension)}"` };
  }
  if (typeof candidate.direction !== "string" || !VALID_SIGNAL_DIRECTIONS.has(candidate.direction)) {
    return { ok: false, reason: `invalid direction "${JSON.stringify(candidate.direction)}"` };
  }
  if (typeof candidate.observer_kind !== "string" || !VALID_OBSERVER_KINDS.has(candidate.observer_kind)) {
    return { ok: false, reason: `invalid observer_kind "${JSON.stringify(candidate.observer_kind)}"` };
  }
  if (
    typeof candidate.extraction_confidence !== "number" ||
    !Number.isFinite(candidate.extraction_confidence) ||
    candidate.extraction_confidence < 0 ||
    candidate.extraction_confidence > 1
  ) {
    return { ok: false, reason: `invalid extraction_confidence "${JSON.stringify(candidate.extraction_confidence)}" (must be a number in 0.0-1.0)` };
  }
  if (candidate.observer_kind === "other_persona") {
    const observerId = candidate.observer_persona_id;
    if (!observerId || typeof observerId !== "string") {
      return { ok: false, reason: "other_persona observer_kind requires a observer_persona_id" };
    }
    if (observerId === subjectPersonaId) {
      return { ok: false, reason: "observer_persona_id cannot equal the subject persona — self-testimony mislabeled as other_persona" };
    }
    const observerPersona = state.persona_getById(observerId);
    if (!observerPersona || observerPersona.is_archived) {
      return { ok: false, reason: `observer_persona_id "${observerId}" does not resolve to an active persona` };
    }
  }
  return { ok: true, draft: candidate as unknown as PersonaObservationDraft };
}

/**
 * Scan/Extract — step 1 of the Observation→Signal reducer (D1, Spec
 * §4.17). One job: resolve each drafted claim's true speaker (already
 * done by the prompt, per D7) and source message, classify its lens
 * (D6/§4.5), persist it as a durable `PersonaObservation`, then hand it to
 * Match (step 2). No promotion decision, no signal write here.
 */
export async function handlePersonaSignalScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as PersonaSignalScanResult | undefined;
  if (!result?.observations || !Array.isArray(result.observations) || result.observations.length === 0) {
    console.debug("[handlePersonaSignalScan] No persona observations detected");
    return;
  }

  const subjectPersonaId = response.request.data.subjectPersonaId as string;
  const subjectPersonId = response.request.data.subjectPersonId as string;
  const agentProvenance = response.request.data.agentProvenance as Parameters<typeof classifyObservationLens>[0];
  const extractionModel = response.request.data.extraction_model as string | undefined;

  const subjectPersona = state.persona_getById(subjectPersonaId);
  if (!subjectPersona) {
    console.warn(`[handlePersonaSignalScan] Subject persona ${subjectPersonaId} not found — dropping ${result.observations.length} draft(s)`);
    return;
  }

  const { messages_analyze } = resolveMessageWindow(response, state);

  let queued = 0;
  for (const rawDraft of result.observations as unknown[]) {
    const validation = validatePersonaObservationDraft(rawDraft, subjectPersonaId, state);
    if (!validation.ok) {
      console.warn(`[handlePersonaSignalScan] Dropping malformed observation draft: ${validation.reason}`);
      continue;
    }
    const draft = validation.draft;

    const sourceMessage = messages_analyze.find(m => matchQuoteInMessage(draft.quote_text, getMessageText(m)) !== null);
    if (!sourceMessage) {
      console.debug(`[handlePersonaSignalScan] Could not resolve source message for claim "${stripControlChars(draft.claim)}" — dropping`);
      continue;
    }

    const classification = classifyObservationLens(agentProvenance);
    if (classification.lens === "needs_agent_provenance") {
      console.debug(`[handlePersonaSignalScan] Provenance incomplete for ${subjectPersona.display_name} — dropping Agent-lens claim "${stripControlChars(draft.claim)}"`);
      continue;
    }

    // Stint holistic review Bucket 1, finding I1 (2026-08-11): the five
    // derived provenance fields reached `classifyObservationLens` above as
    // transient queue-request data, but nothing persisted them onto the
    // durable record — persist them here, on the same Agent-lens branch
    // that already required them to be complete, never on the Persona
    // lens (which carries no provenance at all).
    const observation = state.observation_add(subjectPersonaId, {
      subject_person_id: subjectPersonId,
      subject_persona_id: subjectPersonaId,
      observer_kind: draft.observer_kind,
      observer_persona_id: draft.observer_kind === "other_persona" ? draft.observer_persona_id : undefined,
      message_id: sourceMessage.id,
      observed_at: sourceMessage.timestamp,
      dimension: draft.dimension,
      direction: draft.direction,
      claim: draft.claim,
      extraction_confidence: draft.extraction_confidence,
      ...(classification.lens === "agent"
        ? {
            harness: classification.provenance.harness,
            agent_id: classification.provenance.agent_id,
            agent_definition_ref: classification.provenance.agent_definition_ref,
            definition_revision: classification.provenance.definition_revision,
            mode: classification.provenance.mode,
          }
        : {}),
    });
    if (!observation) continue;

    queuePersonaSignalMatch(observation, classification.lens, state, extractionModel);
    queued++;
  }

  console.log(`[handlePersonaSignalScan] Queued ${queued} of ${result.observations.length} persona observation(s) for ${subjectPersona.display_name}`);
}

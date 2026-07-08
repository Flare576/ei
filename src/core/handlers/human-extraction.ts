import type { LLMResponse, Fact, Person } from "../types.js";
import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";
import type {
  FactFindResult,
  TopicScanResult,
  PersonScanResult,
  TopicScanCandidate,
  ItemMatchResult,
} from "../../prompts/human/types.js";
import { queueTopicMatch, queuePersonUpdate, type ExtractionContext } from "../orchestrators/index.js";
import { markMessagesExtracted, resolveMessageWindow } from "./utils.js";
import { BUILT_IN_FACT_NAMES } from "../constants/built-in-facts.js";
import { getEmbeddingService, getItemEmbeddingText, cosineSimilarity, getPersonEmbeddingText } from "../embedding-service.js";
import { levenshtein, normalizeForMatch } from "../utils/levenshtein.js";

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

    const matchResult: ItemMatchResult = { matched_guid: matchedPerson?.id ?? null };
    queuePersonUpdate(matchResult, {
      ...context,
      messages_context,
      messages_analyze,
      candidateName: candidate.name,
      candidateDescription: candidate.description,
      candidateRelationship: candidate.relationship,
      candidateIdentifiers,
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


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

function matchPersonCandidate(
  candidateName: string,
  candidateIdentifiers: PersonIdentifier[],
  people: Person[]
): Person[] {
  const normName = normalizeForMatch(candidateName);
  const matched = new Set<Person>();

  // Step 1: Exact match on any identifier value (type-agnostic)
  for (const person of people) {
    const allValues = [
      ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
      normalizeForMatch(person.name),
    ];
    if (allValues.includes(normName)) matched.add(person);
  }
  // Also check scan-extracted identifiers against existing identifier values
  for (const scanId of candidateIdentifiers) {
    const normVal = normalizeForMatch(scanId.value);
    for (const person of people) {
      if ((person.identifiers ?? []).some(i => normalizeForMatch(i.value) === normVal)) {
        matched.add(person);
      }
    }
  }

  if (matched.size > 0) return [...matched];

  // Step 2: Fuzzy match — skip for short names (< 6 chars): "mike"↔"jake" = 2 edits, false positive.
  if (normName.length >= 6) {
    const threshold = normName.length < 10 ? 1 : 2;
    for (const person of people) {
      const allValues = [
        ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
        normalizeForMatch(person.name),
      ];
      if (allValues.some(v => levenshtein(normName, v) <= threshold)) matched.add(person);
    }
  }

  if (matched.size > 0) return [...matched];

  // Step 2.5: First-name match — "Lucas Jeremy Scherer" should find "Lucas".
  // Only fires when first word is >= 4 chars to avoid short-name collisions.
  const candidateFirstWord = normName.split(/\s+/)[0];
  if (candidateFirstWord.length >= 4) {
    for (const person of people) {
      const allNames = [
        normalizeForMatch(person.name),
        ...(person.identifiers ?? []).map(i => normalizeForMatch(i.value)),
      ];
      if (allNames.some(n => n.split(/\s+/)[0] === candidateFirstWord)) matched.add(person);
    }
  }

  return [...matched];
}

export async function handleFactFind(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as FactFindResult | undefined;
  
  // Mark messages as scanned regardless of whether facts were found
  markMessagesExtracted(response, state, "f");
  
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.log("[handleFactFind] No facts detected or invalid result");
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
      console.log(`[handleFactFind] Skipping non-built-in fact: "${factResult.name}"`);
      continue;
    }

    // Find the existing fact in state
    const existingFact = human.facts.find(f => f.name === factResult.name);
    if (!existingFact) {
      console.log(`[handleFactFind] Skipping unknown fact: "${factResult.name}"`);
      continue;
    }

    // Skip facts that already have descriptions (only fill empty ones)
    if (existingFact.description && existingFact.description !== "") {
      console.log(`[handleFactFind] Skipping fact with existing description: "${factResult.name}"`);
      continue;
    }

    // Skip if the LLM returned a null/empty/non-string value — don't store booleans or nulls
    if (!factResult.value || typeof factResult.value !== 'string') {
      console.log(`[handleFactFind] Skipping fact with null/empty/non-string value: "${factResult.name}" (got ${typeof factResult.value})`);
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
    console.log("[handleHumanTopicScan] No topics detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  const extractionModel = (response.request.data as Record<string, unknown>).extraction_model as string | undefined;
  for (const candidate of result.topics) {
    await queueTopicMatch(candidate, context, state, extractionModel);
  }
  console.log(`[handleHumanTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

export async function handleHumanPersonScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as PersonScanResult | undefined;
  
  markMessagesExtracted(response, state, "p");
  
  if (!result?.people || !Array.isArray(result.people)) {
    console.log("[handleHumanPersonScan] No people detected or invalid result");
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
      matchedPerson = matches[0];
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
        for (const person of matches) {
          if (person.embedding) {
            const sim = cosineSimilarity(person.embedding, candidateVector);
            if (sim > bestSimilarity) {
              bestSimilarity = sim;
              matchedPerson = person;
            }
          }
        }
        if (!matchedPerson) {
          console.log(`[handleHumanPersonScan] Multi-match for "${candidate.name}" (${matches.length} hits) — no embedding above threshold, creating new record`);
        }
      } catch (err) {
        console.warn(`[handleHumanPersonScan] Multi-match embedding failed for "${candidate.name}", using first match:`, err);
        matchedPerson = matches[0];
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
        if (isUnknownPlaceholder || isSingleton) {
          matchedPerson = existing;
          const reason = isUnknownPlaceholder ? 'unnamed placeholder' : 'singleton relationship';
          console.log(`[handleHumanPersonScan] Relationship unique match: "${candidate.name}" → "${existing.name}" (sole ${candidate.relationship}, ${reason})`);
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
          console.log(`[handleHumanPersonScan] "${candidate.name}": cosine against ${searchPool.length} embedded (${poolLabel})`);
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
              console.log(`[handleHumanPersonScan] Cosine matched "${candidate.name}" → "${matchedPerson.name}" (${bestSimilarity.toFixed(3)}) | top3: ${top3}`);
            } else {
              console.log(`[handleHumanPersonScan] Cosine: no match above ${ZERO_MATCH_COSINE_THRESHOLD} for "${candidate.name}" | top3: ${top3}`);
            }
          } catch (err) {
            console.warn(`[handleHumanPersonScan] Cosine failed for "${candidate.name}":`, err);
          }
        } else {
          console.log(`[handleHumanPersonScan] "${candidate.name}": no embedded people in pool (${poolLabel}) — new person`);
        }
      }
    }

    if (matchedPerson && response.request.data.reflection_progress === 1) {
      const linkedPersonaId = matchedPerson.identifiers
        ?.find(i => i.type === "Ei Persona")?.value;
      if (linkedPersonaId) {
        console.log(`[handleHumanPersonScan] Skipping update for "${candidate.name}" — scan marked as reflection drain (reflection_progress=1)`);
        continue;
      }
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
    console.log(`[handleHumanPersonScan] person "${candidate.name}": ${matched}`);
  }
  console.log(`[handleHumanPersonScan] Processed ${result.people.length} person(s)`);
}

export async function handleEventScan(response: LLMResponse, state: StateManager): Promise<void> {
  markMessagesExtracted(response, state, "e");

  const result = response.parsed as { events?: Array<{ name: string; description: string; reason: string }> } | undefined;

  if (!result?.events || !Array.isArray(result.events) || result.events.length === 0) {
    console.log("[handleEventScan] No epic events detected");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
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


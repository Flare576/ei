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

    // Skip if the LLM returned a null/empty value — don't store null descriptions
    if (!factResult.value) {
      console.log(`[handleFactFind] Skipping fact with null/empty value: "${factResult.name}"`);
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

  const context = response.request.data as unknown as ExtractionContext;
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


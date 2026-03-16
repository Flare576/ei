import type { LLMResponse, Fact } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type {
  FactFindResult,
  TopicScanResult,
  PersonScanResult,
  TopicScanCandidate,
} from "../../prompts/human/types.js";
import { queueTopicMatch, queuePersonMatch, type ExtractionContext } from "../orchestrators/index.js";
import { markMessagesExtracted } from "./utils.js";
import { BUILT_IN_FACT_NAMES } from "../constants/built-in-facts.js";
import { getEmbeddingService, getItemEmbeddingText } from "../embedding-service.js";

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

  const extractionModel = (response.request.data as Record<string, unknown>).extraction_model as string | undefined;
  for (const candidate of result.people) {
    await queuePersonMatch(candidate, context, state, extractionModel);
  }
  console.log(`[handleHumanPersonScan] Queued ${result.people.length} person(s) for matching`);
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


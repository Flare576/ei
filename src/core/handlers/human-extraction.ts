import type { LLMResponse } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type {
  FactScanResult,
  TraitScanResult,
  TopicScanResult,
  PersonScanResult,
} from "../../prompts/human/types.js";
import { queueItemMatch, type ExtractionContext } from "../orchestrators/index.js";
import { markMessagesExtracted } from "./utils.js";

export async function handleHumanFactScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as FactScanResult | undefined;
  
  // Mark messages as scanned regardless of whether facts were found
  markMessagesExtracted(response, state, "f");
  
  if (!result?.facts || !Array.isArray(result.facts)) {
    console.log("[handleHumanFactScan] No facts detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.facts) {
    await queueItemMatch("fact", candidate, context, state);
  }
  console.log(`[handleHumanFactScan] Queued ${result.facts.length} fact(s) for matching`);
}

export async function handleHumanTraitScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as TraitScanResult | undefined;
  
  markMessagesExtracted(response, state, "r");
  
  if (!result?.traits || !Array.isArray(result.traits)) {
    console.log("[handleHumanTraitScan] No traits detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.traits) {
    await queueItemMatch("trait", candidate, context, state);
  }
  console.log(`[handleHumanTraitScan] Queued ${result.traits.length} trait(s) for matching`);
}

export async function handleHumanTopicScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as TopicScanResult | undefined;
  
  markMessagesExtracted(response, state, "p");
  
  if (!result?.topics || !Array.isArray(result.topics)) {
    console.log("[handleHumanTopicScan] No topics detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.topics) {
    await queueItemMatch("topic", candidate, context, state);
  }
  console.log(`[handleHumanTopicScan] Queued ${result.topics.length} topic(s) for matching`);
}

export async function handleHumanPersonScan(response: LLMResponse, state: StateManager): Promise<void> {
  const result = response.parsed as PersonScanResult | undefined;
  
  markMessagesExtracted(response, state, "o");
  
  if (!result?.people || !Array.isArray(result.people)) {
    console.log("[handleHumanPersonScan] No people detected or invalid result");
    return;
  }

  const context = response.request.data as unknown as ExtractionContext;
  if (!context?.personaId) return;

  for (const candidate of result.people) {
    await queueItemMatch("person", candidate, context, state);
  }
  console.log(`[handleHumanPersonScan] Queued ${result.people.length} person(s) for matching`);
}

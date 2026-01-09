import { Concept, ConceptMap, Message } from "./types.js";
import { callLLM, callLLMForJSON } from "./llm.js";
import {
  loadConceptMap,
  saveConceptMap,
  loadHistory,
  appendMessage,
  getRecentMessages,
  getLastMessageTime,
} from "./storage.js";
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  buildConceptUpdateSystemPrompt,
  buildConceptUpdateUserPrompt,
} from "./prompts.js";
import { validateSystemConcepts, mergeWithOriginalStatics } from "./validate.js";
import { generatePersonaDescriptions } from "./persona-creator.js";

function conceptsChanged(oldConcepts: Concept[], newConcepts: Concept[]): boolean {
  if (oldConcepts.length !== newConcepts.length) return true;
  
  const oldNames = new Set(oldConcepts.map(c => c.name));
  const newNames = new Set(newConcepts.map(c => c.name));
  
  for (const name of oldNames) {
    if (!newNames.has(name)) return true;
  }
  for (const name of newNames) {
    if (!oldNames.has(name)) return true;
  }
  
  for (const newConcept of newConcepts) {
    const oldConcept = oldConcepts.find(c => c.name === newConcept.name);
    if (oldConcept && oldConcept.description !== newConcept.description) {
      return true;
    }
  }
  
  return false;
}

function stripEcho(userMessage: string | null, response: string): string {
  if (!userMessage || !response) return response;
  
  const trimmedUser = userMessage.trim();
  const trimmedResponse = response.trim();
  
  if (trimmedResponse.startsWith(trimmedUser)) {
    const remainder = trimmedResponse.slice(trimmedUser.length).trimStart();
    if (remainder.length > 0) {
      return remainder;
    }
  }
  
  const firstNewline = trimmedResponse.indexOf("\n");
  if (firstNewline > 0) {
    const firstLine = trimmedResponse.slice(0, firstNewline).trim();
    if (firstLine === trimmedUser) {
      return trimmedResponse.slice(firstNewline + 1).trimStart();
    }
  }
  
  return response;
}

export interface ProcessResult {
  response: string | null;
  humanConceptsUpdated: boolean;
  systemConceptsUpdated: boolean;
  aborted: boolean;
}

export async function processEvent(
  humanMessage: string | null,
  persona: string = "ei",
  debug: boolean = false,
  signal?: AbortSignal
): Promise<ProcessResult> {
  const abortedResult: ProcessResult = {
    response: null,
    humanConceptsUpdated: false,
    systemConceptsUpdated: false,
    aborted: true,
  };

  if (signal?.aborted) return abortedResult;

  const humanConcepts = await loadConceptMap("human");
  const systemConcepts = await loadConceptMap("system", persona);
  const history = await loadHistory(persona);
  const recentHistory = getRecentMessages(history);
  const lastMessageTime = getLastMessageTime(history);
  const delayMs = lastMessageTime > 0 ? Date.now() - lastMessageTime : 0;

  if (signal?.aborted) return abortedResult;

  const responseSystemPrompt = buildResponseSystemPrompt(
    humanConcepts,
    systemConcepts
  );
  const responseUserPrompt = buildResponseUserPrompt(
    delayMs,
    recentHistory,
    humanMessage
  );

  if (debug) {
    console.log(`[Debug] Persona: ${persona}`);
    console.log("[Debug] Calling LLM for response...");
  }

  const rawResponse = await callLLM(responseSystemPrompt, responseUserPrompt, { signal, temperature: 0.7 });
  const response = rawResponse ? stripEcho(humanMessage, rawResponse) : null;

  if (signal?.aborted) return abortedResult;

  const conceptUpdateUserPrompt = buildConceptUpdateUserPrompt(
    humanMessage,
    response,
    persona
  );

  if (debug) {
    console.log("[Debug] Updating system concepts...");
  }

  if (signal?.aborted) return abortedResult;

  const systemUpdatePrompt = buildConceptUpdateSystemPrompt(
    "system",
    systemConcepts,
    persona
  );
  const newSystemConcepts = await callLLMForJSON<Concept[]>(
    systemUpdatePrompt,
    conceptUpdateUserPrompt,
    { signal, temperature: 0.3 }
  );

  if (signal?.aborted) return abortedResult;

  if (debug) {
    console.log("[Debug] Updating human concepts...");
  }

  if (signal?.aborted) return abortedResult;

  const humanUpdatePrompt = buildConceptUpdateSystemPrompt(
    "human",
    humanConcepts,
    persona
  );
  const newHumanConcepts = await callLLMForJSON<Concept[]>(
    humanUpdatePrompt,
    conceptUpdateUserPrompt,
    { signal, temperature: 0.3 }
  );

  if (signal?.aborted) return abortedResult;

  // === COMMIT POINT: All LLM calls succeeded, now persist everything ===

  let systemConceptsUpdated = false;
  let humanConceptsUpdated = false;

  if (humanMessage) {
    await appendMessage({
      role: "human",
      content: humanMessage,
      timestamp: new Date().toISOString(),
    }, persona);
  }

  if (response) {
    await appendMessage({
      role: "system",
      content: response,
      timestamp: new Date().toISOString(),
    }, persona);
  }

  if (newSystemConcepts) {
    const proposedMap: ConceptMap = {
      entity: "system",
      aliases: systemConcepts.aliases,
      short_description: systemConcepts.short_description,
      long_description: systemConcepts.long_description,
      last_updated: new Date().toISOString(),
      concepts: newSystemConcepts,
    };

    const validation = validateSystemConcepts(proposedMap, systemConcepts);
    let mapToSave: ConceptMap;

    if (validation.valid) {
      mapToSave = proposedMap;
    } else {
      if (debug) {
        console.log(
          `[Debug] System concept validation failed: ${validation.issues.join(", ")}`
        );
      }
      mapToSave = mergeWithOriginalStatics(proposedMap, systemConcepts);
    }

    const shouldUpdateDescriptions = conceptsChanged(
      systemConcepts.concepts,
      mapToSave.concepts
    );

    if (shouldUpdateDescriptions && !signal?.aborted) {
      if (debug) {
        console.log("[Debug] Concepts changed, regenerating descriptions...");
      }
      const descriptions = await generatePersonaDescriptions(persona, mapToSave, signal);
      if (descriptions) {
        mapToSave.short_description = descriptions.short_description;
        mapToSave.long_description = descriptions.long_description;
      }
    }

    await saveConceptMap(mapToSave, persona);
    systemConceptsUpdated = true;
  }

  if (newHumanConcepts) {
    const proposedMap: ConceptMap = {
      entity: "human",
      last_updated: new Date().toISOString(),
      concepts: newHumanConcepts,
    };
    await saveConceptMap(proposedMap);
    humanConceptsUpdated = true;
  }

  return {
    response,
    humanConceptsUpdated,
    systemConceptsUpdated,
    aborted: false,
  };
}

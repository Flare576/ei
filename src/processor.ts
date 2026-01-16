import { Concept, ConceptMap, Message } from "./types.js";
import { callLLM, callLLMForJSON } from "./llm.js";
import {
  loadConceptMap,
  saveConceptMap,
  loadHistory,
  appendMessage,
  getRecentMessages,
  getLastMessageTime,
  appendDebugLog,
  markMessagesAsRead,
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
  /** @deprecated Concept updates now handled by ConceptQueue */
  humanConceptsUpdated: boolean;
  /** @deprecated Concept updates now handled by ConceptQueue */
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

  if (debug) {
    appendDebugLog(`[Debug] processEvent called with message: ${humanMessage ? humanMessage.substring(0, 50) + '...' : 'null'}`);
  }

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
    appendDebugLog(`[Debug] Persona: ${persona}`);
    appendDebugLog("[Debug] Calling LLM for response...");
  }

  const rawResponse = await callLLM(responseSystemPrompt, responseUserPrompt, { signal, temperature: 0.7 });
  const response = rawResponse ? stripEcho(humanMessage, rawResponse) : null;

  if (signal?.aborted) return abortedResult;

  await markMessagesAsRead(persona);

  if (response) {
    await appendMessage({
      role: "system",
      content: response,
      timestamp: new Date().toISOString(),
      read: false,  // Human hasn't seen this yet
    }, persona);
  }

  if (debug) {
    appendDebugLog("[Debug] Response generated. Concept updates deferred to ConceptQueue.");
  }

  return {
    response,
    humanConceptsUpdated: false,
    systemConceptsUpdated: false,
    aborted: false,
  };
}

export async function updateConceptsForMessages(
  messages: Message[],
  target: "system" | "human",
  persona: string,
  debug: boolean = false,
  signal?: AbortSignal
): Promise<boolean> {
  if (messages.length === 0) {
    if (debug) {
      appendDebugLog(`[Debug] updateConceptsForMessages: No messages to process for ${target}`);
    }
    return false;
  }

  if (signal?.aborted) return false;

  const concepts = target === "system"
    ? await loadConceptMap("system", persona)
    : await loadConceptMap("human");

  if (signal?.aborted) return false;

  const combinedContent = messages.map(m => 
    `[${m.role}]: ${m.content}`
  ).join("\n\n");

  const conceptUpdateUserPrompt = buildConceptUpdateUserPrompt(
    combinedContent,
    null,
    persona
  );

  const conceptUpdateSystemPrompt = buildConceptUpdateSystemPrompt(
    target,
    concepts,
    persona
  );

  if (debug) {
    appendDebugLog(`[Debug] Updating ${target} concepts from ${messages.length} messages...`);
  }

  const newConcepts = await callLLMForJSON<Concept[]>(
    conceptUpdateSystemPrompt,
    conceptUpdateUserPrompt,
    { signal, temperature: 0.3 }
  );

  if (signal?.aborted) return false;

  if (!newConcepts) {
    if (debug) {
      appendDebugLog(`[Debug] No concept updates returned for ${target}`);
    }
    return false;
  }

  if (target === "system") {
    const proposedMap: ConceptMap = {
      entity: "system",
      aliases: concepts.aliases,
      short_description: concepts.short_description,
      long_description: concepts.long_description,
      last_updated: new Date().toISOString(),
      concepts: newConcepts,
    };

    const validation = validateSystemConcepts(proposedMap, concepts);
    let mapToSave: ConceptMap;

    if (validation.valid) {
      mapToSave = proposedMap;
    } else {
      if (debug) {
        appendDebugLog(
          `[Debug] System concept validation failed: ${validation.issues.join(", ")}`
        );
      }
      mapToSave = mergeWithOriginalStatics(proposedMap, concepts);
    }

    const shouldUpdateDescriptions = conceptsChanged(
      concepts.concepts,
      mapToSave.concepts
    );

    if (shouldUpdateDescriptions && !signal?.aborted) {
      if (debug) {
        appendDebugLog("[Debug] Concepts changed, regenerating descriptions...");
      }
      const descriptions = await generatePersonaDescriptions(persona, mapToSave, signal);
      if (descriptions) {
        mapToSave.short_description = descriptions.short_description;
        mapToSave.long_description = descriptions.long_description;
      }
    }

    await saveConceptMap(mapToSave, persona);
    
    if (debug) {
      appendDebugLog(`[Debug] System concepts saved for ${persona}`);
    }
    
    return true;
  }

  const proposedMap: ConceptMap = {
    entity: "human",
    last_updated: new Date().toISOString(),
    concepts: newConcepts,
  };
  
  await saveConceptMap(proposedMap);
  
  if (debug) {
    appendDebugLog("[Debug] Human concepts saved");
  }
  
  return true;
}

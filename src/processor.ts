import { Message, HumanEntity, PersonaEntity } from "./types.js";
import { callLLM, callLLMForJSON } from "./llm.js";
import {
  loadHumanEntity,
  loadPersonaEntity,
  loadHistory,
  appendMessage,
  getRecentMessages,
  getLastMessageTime,
  appendDebugLog,
  markMessagesAsRead,
  loadAllPersonasWithEntities,
} from "./storage.js";
import {
  buildResponseSystemPrompt,
  buildResponseUserPrompt,
  PersonaIdentity,
  getVisiblePersonas,
} from "./prompts.js";
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

  const humanEntity = await loadHumanEntity();
  const personaEntity = await loadPersonaEntity(persona);
  const history = await loadHistory(persona);
  const recentHistory = getRecentMessages(history);
  const lastMessageTime = getLastMessageTime(history);
  const delayMs = lastMessageTime > 0 ? Date.now() - lastMessageTime : 0;

  if (signal?.aborted) return abortedResult;

  const personaIdentity: PersonaIdentity = {
    name: persona,
    aliases: personaEntity.aliases,
    short_description: personaEntity.short_description,
    long_description: personaEntity.long_description,
  };

  const allPersonas = await loadAllPersonasWithEntities();
  const visiblePersonas = getVisiblePersonas(persona, personaEntity, allPersonas);

  const responseSystemPrompt = buildResponseSystemPrompt(
    humanEntity,
    personaEntity,
    personaIdentity,
    visiblePersonas
  );
  const responseUserPrompt = buildResponseUserPrompt(
    delayMs,
    recentHistory,
    humanMessage,
    persona
  );

  if (debug) {
    appendDebugLog(`[Debug] Persona: ${persona}`);
    appendDebugLog(`[Debug] Response system prompt:\n${responseSystemPrompt}`);
    appendDebugLog("[Debug] Calling LLM for response...");
  }

  const rawResponse = await callLLM(responseSystemPrompt, responseUserPrompt, { signal, temperature: 0.7, model: personaEntity.model, operation: "response" });
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

  if (!signal?.aborted && response && humanMessage) {
    const { triggerExtraction } = await import("./extraction-frequency.js");
    
    const messagePair: Message[] = [
      {
        role: "human",
        content: humanMessage,
        timestamp: new Date().toISOString(),
        read: true
      },
      {
        role: "system",
        content: response,
        timestamp: new Date().toISOString(),
        read: false
      }
    ];
    
    triggerExtraction("human", persona, messagePair).catch(err => {
      appendDebugLog(`[Extraction] Failed to trigger for human: ${err}`);
    });
    
    triggerExtraction("system", persona, messagePair).catch(err => {
      appendDebugLog(`[Extraction] Failed to trigger for ${persona}: ${err}`);
    });
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

  const personaConcepts =
    target === "human"
      ? await loadConceptMap("system", persona)
      : concepts;

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
    { signal, temperature: 0.3, model: concepts.model, operation: "concept" }
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
      ...concepts,
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

  const now = new Date().toISOString();
  const personaGroup = personaConcepts.group_primary;
  const reconciledConcepts: Concept[] = [];
  
  for (const updated of newConcepts) {
    const existing = concepts.concepts.find((c: Concept) => c.name === updated.name);
    
    if (existing) {
      const isGlobal = existing.persona_groups?.includes("*") ?? false;
      let personaGroups: string[];
      
      if (isGlobal) {
        personaGroups = ["*"];
      } else {
        const groups = new Set(existing.persona_groups || []);
        if (personaGroup) {
          groups.add(personaGroup);
        }
        personaGroups = Array.from(groups);
      }
      
      reconciledConcepts.push({
        ...updated,
        persona_groups: personaGroups,
        learned_by: existing.learned_by,
        last_updated: now,
      });
    } else {
      reconciledConcepts.push({
        ...updated,
        persona_groups: personaGroup ? [personaGroup] : ["*"],
        learned_by: persona,
        last_updated: now,
      });
    }
  }

  const proposedMap: ConceptMap = {
    entity: "human",
    last_updated: now,
    concepts: reconciledConcepts,
  };
  
  await saveConceptMap(proposedMap);
  
  if (debug) {
    appendDebugLog("[Debug] Human concepts saved");
  }
  
  return true;
}

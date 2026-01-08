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

  if (humanMessage) {
    await appendMessage({
      role: "human",
      content: humanMessage,
      timestamp: new Date().toISOString(),
    }, persona);
  }

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

  const response = await callLLM(responseSystemPrompt, responseUserPrompt, { signal, temperature: 0.7 });

  if (signal?.aborted) return abortedResult;

  if (response) {
    await appendMessage({
      role: "system",
      content: response,
      timestamp: new Date().toISOString(),
    }, persona);
  }

  let systemConceptsUpdated = false;
  let humanConceptsUpdated = false;

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

  if (newSystemConcepts) {
    const proposedMap: ConceptMap = {
      entity: "system",
      aliases: systemConcepts.aliases,
      last_updated: new Date().toISOString(),
      concepts: newSystemConcepts,
    };

    const validation = validateSystemConcepts(proposedMap, systemConcepts);

    if (validation.valid) {
      await saveConceptMap(proposedMap, persona);
      systemConceptsUpdated = true;
    } else {
      if (debug) {
        console.log(
          `[Debug] System concept validation failed: ${validation.issues.join(", ")}`
        );
      }
      const merged = mergeWithOriginalStatics(proposedMap, systemConcepts);
      await saveConceptMap(merged, persona);
      systemConceptsUpdated = true;
    }
  }

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

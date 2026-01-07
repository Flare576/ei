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
  const systemConcepts = await loadConceptMap("system");
  const history = await loadHistory();
  const recentHistory = getRecentMessages(history);
  const lastMessageTime = getLastMessageTime(history);
  const delayMs = lastMessageTime > 0 ? Date.now() - lastMessageTime : 0;

  if (humanMessage) {
    await appendMessage({
      role: "human",
      content: humanMessage,
      timestamp: new Date().toISOString(),
    });
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
    console.log("[Debug] Calling LLM for response...");
  }

  const response = await callLLM(responseSystemPrompt, responseUserPrompt, signal);

  if (signal?.aborted) return abortedResult;

  if (response) {
    await appendMessage({
      role: "system",
      content: response,
      timestamp: new Date().toISOString(),
    });
  }

  let systemConceptsUpdated = false;
  let humanConceptsUpdated = false;

  const conceptUpdateUserPrompt = buildConceptUpdateUserPrompt(
    humanMessage,
    response
  );

  if (debug) {
    console.log("[Debug] Updating system concepts...");
  }

  if (signal?.aborted) return abortedResult;

  const systemUpdatePrompt = buildConceptUpdateSystemPrompt(
    "system",
    systemConcepts
  );
  const newSystemConcepts = await callLLMForJSON<Concept[]>(
    systemUpdatePrompt,
    conceptUpdateUserPrompt,
    signal
  );

  if (signal?.aborted) return abortedResult;

  if (newSystemConcepts) {
    const proposedMap: ConceptMap = {
      entity: "system",
      last_updated: new Date().toISOString(),
      concepts: newSystemConcepts,
    };

    const validation = validateSystemConcepts(proposedMap, systemConcepts);

    if (validation.valid) {
      await saveConceptMap(proposedMap);
      systemConceptsUpdated = true;
    } else {
      if (debug) {
        console.log(
          `[Debug] System concept validation failed: ${validation.issues.join(", ")}`
        );
      }
      const merged = mergeWithOriginalStatics(proposedMap, systemConcepts);
      await saveConceptMap(merged);
      systemConceptsUpdated = true;
    }
  }

  if (debug) {
    console.log("[Debug] Updating human concepts...");
  }

  if (signal?.aborted) return abortedResult;

  const humanUpdatePrompt = buildConceptUpdateSystemPrompt(
    "human",
    humanConcepts
  );
  const newHumanConcepts = await callLLMForJSON<Concept[]>(
    humanUpdatePrompt,
    conceptUpdateUserPrompt,
    signal
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

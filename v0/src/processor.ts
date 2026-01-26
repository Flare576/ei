import { Message, HumanEntity, PersonaEntity } from "./types.js";
import { callLLMWithHistory, ChatMessage } from "./llm.js";
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
} from "./prompts/index.js";

function toNativeMessages(
  history: Message[],
  currentMessage?: string
): ChatMessage[] {
  const messages: ChatMessage[] = history.map(m => ({
    role: m.role === "human" ? "user" : "assistant",
    content: m.content,
  }));
  
  if (currentMessage) {
    messages.push({ role: "user", content: currentMessage });
  }
  
  return messages;
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

  const responseSystemPrompt = await buildResponseSystemPrompt(
    humanEntity,
    personaEntity,
    personaIdentity,
    visiblePersonas
  );
  const contextPrompt = buildResponseUserPrompt(
    delayMs,
    recentHistory,
    humanMessage
  );

  const nativeHistory = toNativeMessages(recentHistory || [], humanMessage || undefined);
  nativeHistory.push({ role: "user", content: contextPrompt });

  if (debug) {
    appendDebugLog(`[Debug] Persona: ${persona}`);
    appendDebugLog(`[Debug] Response system prompt:\n${responseSystemPrompt}`);
    appendDebugLog(`[Debug] Context prompt:\n${contextPrompt}`);
    appendDebugLog(`[Debug] Native history message count: ${nativeHistory.length}`);
    appendDebugLog("[Debug] Calling LLM for response...");
  }

  const rawResponse = await callLLMWithHistory(responseSystemPrompt, nativeHistory, { signal, temperature: 0.7, model: personaEntity.model, operation: "response" });
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
    appendDebugLog("[Debug] Response generated. Extraction deferred to LLM queue.");
  }

  if (!signal?.aborted && response && humanMessage) {
    const { triggerExtraction } = await import("./extraction-frequency.js");
    
    const conversationHistory = await loadHistory(persona);
    const recentMessages = getRecentMessages(conversationHistory, 8, 100);
    
    triggerExtraction("human", persona, recentMessages).catch(err => {
      appendDebugLog(`[Extraction] Failed to trigger for human: ${err}`);
    });
    
    triggerExtraction("system", persona, recentMessages).catch(err => {
      appendDebugLog(`[Extraction] Failed to trigger for ${persona}: ${err}`);
    });
  }

  return {
    response,
    aborted: false,
  };
}

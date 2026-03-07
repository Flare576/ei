import type { Message, LLMResponse } from "../types.js";
import type { StateManager } from "../state-manager.js";

export type ExtractionFlag = "f" | "r" | "p" | "o";

export function splitMessagesByTimestamp(
  messages: Message[], 
  analyzeFromTimestamp: string | null
): { messages_context: Message[]; messages_analyze: Message[] } {
  if (!analyzeFromTimestamp) {
    return { messages_context: [], messages_analyze: messages };
  }
  const splitTime = new Date(analyzeFromTimestamp).getTime();
  const splitIndex = messages.findIndex(m => new Date(m.timestamp).getTime() >= splitTime);
  if (splitIndex === -1) {
    return { messages_context: messages, messages_analyze: [] };
  }
  return {
    messages_context: messages.slice(0, splitIndex),
    messages_analyze: messages.slice(splitIndex),
  };
}

export function markMessagesExtracted(
  response: LLMResponse, 
  state: StateManager, 
  flag: ExtractionFlag
): void {
  const personaId = response.request.data.personaId as string | undefined;
  const messageIds = response.request.data.message_ids_to_mark as string[] | undefined;
  
  if (!personaId || !messageIds?.length) return;
  
  const count = state.messages_markExtracted(personaId, messageIds, flag);
  if (count > 0) {
    console.log(`[markMessagesExtracted] Marked ${count} messages with flag '${flag}' for persona ${personaId}`);
  }
}

/**
 * Returns the combined display text of a message for quote indexing.
 * Mirrors the rendering logic used in the frontends.
 */
export function getMessageText(message: Message): string {
  const parts: string[] = [];
  if (message.action_response) parts.push(`_${message.action_response}_`);
  if (message.verbal_response) parts.push(message.verbal_response);
  return parts.join('\n\n');
}

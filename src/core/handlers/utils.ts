import type { Message, RoomMessage, LLMResponse } from "../types.js";
import type { StateManager } from "../state-manager.js";

export function getMessageContent(msg: { content?: string }): string {
  return msg.content ?? '';
}

export function normalizeRoomMessages(messages: RoomMessage[], state: StateManager): Message[] {
  const human = state.getHuman();
  const humanName =
    human.settings?.name_display ||
    human.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
    "Human";
  return messages.map(m => {
    const speakerName = m.role === "human"
      ? humanName
      : (state.persona_getById(m.persona_id ?? "")?.display_name ?? "Participant");
    return {
      id: m.id,
      role: m.role === "human" ? "human" as const : "system" as const,
      speaker_name: speakerName,
      content: m.content,
      silence_reason: m.silence_reason,
      timestamp: m.timestamp,
      read: m.read,
      context_status: m.context_status,
      f: m.f,
      t: m.t,
      p: m.p,
      e: m.e,
    };
  });
}

export function resolveMessageWindow(
  response: LLMResponse,
  state: StateManager
): { messages_context: Message[]; messages_analyze: Message[] } {
  const roomId = response.request.data.roomId as string | undefined;
  const messageIdsToMark = response.request.data.message_ids_to_mark as string[] | undefined;

  if (roomId) {
    const allRoomMessages = normalizeRoomMessages(state.getRoomMessages(roomId), state);
    if (messageIdsToMark && messageIdsToMark.length > 0) {
      const idSet = new Set(messageIdsToMark);
      const messages_analyze = allRoomMessages.filter(m => idSet.has(m.id));
      const analyzeStartTime = messages_analyze[0]?.timestamp ?? '9999';
      const messages_context = allRoomMessages.filter(m =>
        !idSet.has(m.id) && new Date(m.timestamp).getTime() < new Date(analyzeStartTime).getTime()
      );
      return { messages_context, messages_analyze };
    }
    return { messages_context: [], messages_analyze: allRoomMessages };
  }

  const personaId = response.request.data.personaId as string;
  const allMessages = state.messages_get(personaId);

  if (messageIdsToMark && messageIdsToMark.length > 0) {
    const messageIdSet = new Set(messageIdsToMark);
    const messages_analyze = allMessages.filter(m => messageIdSet.has(m.id));
    const analyzeStartTime = messages_analyze[0]?.timestamp ?? '9999';
    const messages_context = allMessages.filter(m =>
      !messageIdSet.has(m.id) && new Date(m.timestamp).getTime() < new Date(analyzeStartTime).getTime()
    );
    return { messages_context, messages_analyze };
  }

  const analyzeFrom = response.request.data.analyze_from_timestamp as string | null;
  return splitMessagesByTimestamp(allMessages, analyzeFrom);
}

export type ExtractionFlag = "f" | "t" | "p" | "e";

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
  const roomId = response.request.data.roomId as string | undefined;
  const personaId = response.request.data.personaId as string | undefined;
  const messageIds = response.request.data.message_ids_to_mark as string[] | undefined;
  
  if (!messageIds?.length) return;

  if (roomId) {
    const count = state.markRoomMessagesExtracted(roomId, messageIds, flag);
    if (count > 0) {
      console.log(`[markMessagesExtracted] Marked ${count} room messages with flag '${flag}' for room ${roomId}`);
    }
    return;
  }

  if (!personaId) return;
  
  const count = state.messages_markExtracted(personaId, messageIds, flag);
  if (count > 0) {
    console.log(`[markMessagesExtracted] Marked ${count} messages with flag '${flag}' for persona ${personaId}`);
  }
}

export function getMessageText(message: Message): string {
  return getMessageContent(message);
}

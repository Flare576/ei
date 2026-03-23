import { ContextStatus, LLMNextStep, LLMPriority, LLMRequestType, RoomMode } from "./types.js";
import type { RoomCreationInput, RoomEntity, RoomMessage, RoomSummary, EiError } from "./types.js";
import type { StateManager } from "./state-manager.js";
import { buildRoomResponsePromptData } from "./prompt-context-builder.js";
import { buildRoomJudgePrompt } from "../prompts/room/index.js";
import type { RoomHistoryMessage, RoomJudgeCandidate } from "../prompts/room/types.js";

export function getRoomList(sm: StateManager, includeArchived = false): RoomSummary[] {
  return sm.getRoomList(includeArchived);
}

export function getRoom(sm: StateManager, roomId: string): RoomEntity | null {
  return sm.getRoom(roomId);
}

export function getRoomMessages(sm: StateManager, roomId: string): RoomMessage[] {
  return sm.getRoomMessages(roomId);
}

export function getRoomActivePath(sm: StateManager, roomId: string): RoomMessage[] {
  return sm.getRoomActivePath(roomId);
}

export function resolveRoomName(sm: StateManager, nameOrAlias: string): string | null {
  const room = sm.getRoomByName(nameOrAlias);
  return room?.id ?? null;
}

async function queueRoomPersonaResponses(
  sm: StateManager,
  room: RoomEntity,
  isTUI: boolean,
  onRoomMessageQueued: (roomId: string) => void
): Promise<void> {
  for (const personaId of room.persona_ids) {
    const persona = sm.persona_getById(personaId);
    if (!persona || persona.is_archived || persona.is_paused) continue;
    if (room.mode === RoomMode.MessagesAgainstPersona && room.judge_persona_id === personaId) continue;

    const promptOutput = await buildRoomResponsePromptData(sm, room, persona, isTUI);
    const model = persona.model ?? sm.getHuman().settings?.default_model ?? "";

    sm.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Room,
      system: promptOutput.system,
      user: promptOutput.user,
      next_step: LLMNextStep.HandleRoomResponse,
      model,
      data: {
        roomId: room.id,
        personaId,
        personaDisplayName: persona.display_name,
        parentMessageId: room.active_node_id,
      },
    });
    onRoomMessageQueued(room.id);
  }
}

export async function createRoom(
  sm: StateManager,
  input: RoomCreationInput,
  isTUI: boolean,
  onError: (err: EiError) => void,
  onRoomMessageAdded: (roomId: string) => void,
  onRoomMessageQueued: (roomId: string) => void
): Promise<string> {
  if (!input.persona_ids.length) {
    onError({ code: "ROOM_NO_PARTICIPANTS", message: "A room needs at least one persona." });
    return "";
  }
  if (input.mode === RoomMode.MessagesAgainstPersona && !input.judge_persona_id) {
    onError({ code: "ROOM_NO_JUDGE", message: "MAP mode requires a judge persona." });
    return "";
  }

  const room = sm.addRoom(input);
  onRoomMessageAdded(room.id);

  await queueRoomPersonaResponses(sm, room, isTUI, onRoomMessageQueued);
  return room.id;
}

export async function activateRoom(
  sm: StateManager,
  roomId: string,
  humanContent: string | null,
  silenceReason: string | undefined,
  isTUI: boolean,
  onError: (err: EiError) => void,
  onRoomUpdated: (roomId: string) => void,
  onRoomMessageAdded: (roomId: string) => void,
  onRoomMessageQueued: (roomId: string) => void
): Promise<void> {
  const room = sm.getRoom(roomId);
  if (!room) {
    onError({ code: "ROOM_NOT_FOUND", message: `Room ${roomId} not found.` });
    return;
  }

  const now = new Date().toISOString();
  const human = sm.getHuman();

  const humanMsg: RoomMessage = {
    id: crypto.randomUUID(),
    parent_id: room.active_node_id,
    role: "human",
    verbal_response: humanContent ?? undefined,
    silence_reason: humanContent ? undefined : (silenceReason ?? "passed"),
    timestamp: now,
    read: true,
    context_status: ContextStatus.Default,
  };
  sm.appendRoomMessage(roomId, humanMsg);
  onRoomMessageAdded(roomId);

  if (room.mode === RoomMode.FreeForAll) {
    sm.setRoomActiveNode(roomId, humanMsg.id);
    onRoomUpdated(roomId);
    const updatedRoom = sm.getRoom(roomId)!;
    await queueRoomPersonaResponses(sm, updatedRoom, isTUI, onRoomMessageQueued);
    return;
  }

  if (room.mode === RoomMode.MessagesAgainstPersona) {
    const judgePersonaId = room.judge_persona_id;
    const judgePersona = judgePersonaId ? sm.persona_getById(judgePersonaId) : null;
    if (!judgePersona) {
      onError({ code: "ROOM_JUDGE_NOT_FOUND", message: "MAP judge persona not found." });
      return;
    }

    const allMessages = sm.getRoomMessages(roomId);
    const currentRound = allMessages.filter(m => m.parent_id === room.active_node_id);

    const context: RoomHistoryMessage[] = sm.getRoomActivePath(roomId).map(m => ({
      speaker_name: m.role === "human"
        ? (human.settings?.name_display ?? "Human")
        : (sm.persona_getById(m.persona_id ?? "")?.display_name ?? "Unknown"),
      speaker_id: m.role === "human" ? "human" : (m.persona_id ?? ""),
      verbal_response: m.verbal_response,
      action_response: m.action_response,
      silence_reason: m.silence_reason,
    }));

    const candidates: RoomJudgeCandidate[] = [...currentRound, humanMsg].map(m => ({
      message_id: m.id,
      speaker_name: m.role === "human"
        ? (human.settings?.name_display ?? "Human")
        : (sm.persona_getById(m.persona_id ?? "")?.display_name ?? "Unknown"),
      speaker_id: m.role === "human" ? "human" : (m.persona_id ?? ""),
      verbal_response: m.verbal_response,
      action_response: m.action_response,
      silence_reason: m.silence_reason,
    }));

    const judgePrompt = buildRoomJudgePrompt({
      room: { display_name: room.display_name },
      judge_persona: {
        name: judgePersona.display_name,
        short_description: judgePersona.short_description,
        long_description: judgePersona.long_description,
        traits: judgePersona.traits,
      },
      context,
      candidates,
    });

    const model = judgePersona.model ?? sm.getHuman().settings?.default_model ?? "";
    sm.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Judge,
      system: judgePrompt.system,
      user: judgePrompt.user,
      next_step: LLMNextStep.HandleRoomJudge,
      model,
      data: {
        roomId,
        judgePersonaId,
        judgePersonaDisplayName: judgePersona.display_name,
      },
    });
    onRoomMessageQueued(roomId);
    return;
  }

  onRoomUpdated(roomId);
}

export async function selectCYPBranch(
  sm: StateManager,
  roomId: string,
  messageId: string,
  isTUI: boolean,
  onError: (err: EiError) => void,
  onRoomUpdated: (roomId: string) => void,
  onRoomMessageQueued: (roomId: string) => void
): Promise<void> {
  const ok = sm.setRoomActiveNode(roomId, messageId);
  if (!ok) {
    onError({ code: "ROOM_NODE_NOT_FOUND", message: `Message ${messageId} not found in room ${roomId}.` });
    return;
  }
  onRoomUpdated(roomId);
  const room = sm.getRoom(roomId)!;
  await queueRoomPersonaResponses(sm, room, isTUI, (id) => onRoomMessageQueued(id));
}

export function archiveRoom(sm: StateManager, roomId: string): boolean {
  return sm.archiveRoom(roomId);
}

export function deleteRoom(sm: StateManager, roomId: string): boolean {
  return sm.deleteRoom(roomId);
}

export function markAllRoomMessagesRead(sm: StateManager, roomId: string): number {
  return sm.markAllRoomMessagesRead(roomId);
}

import { ContextStatus, LLMNextStep, LLMPriority, LLMRequestType, RoomMode } from "./types.js";
import type { RoomCreationInput, RoomEntity, RoomMessage, RoomSummary, EiError } from "./types.js";
import type { StateManager } from "./state-manager.js";
import { buildRoomResponsePromptData } from "./prompt-context-builder.js";
import { buildRoomJudgePrompt } from "../prompts/room/index.js";
import type { RoomHistoryMessage, RoomJudgeCandidate } from "../prompts/room/types.js";
import { getMessageContent } from "./handlers/utils.js";

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
  const personaIds = room.mode === RoomMode.FreeForAll
    ? [...room.persona_ids].sort(() => Math.random() - 0.5)
    : room.persona_ids;

  for (const personaId of personaIds) {
    const persona = sm.persona_getById(personaId);
    if (!persona || persona.is_archived || persona.is_paused) continue;
    if (room.mode === RoomMode.MessagesAgainstPersona && room.judge_persona_id === personaId) continue;

    const promptOutput = await buildRoomResponsePromptData(sm, room, persona, isTUI);
    const model = persona.model ?? sm.getHuman().settings?.default_model ?? "";

    sm.queue_enqueue({
      type: LLMRequestType.Raw,
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

export function submitHumanRoomMessage(
  sm: StateManager,
  roomId: string,
  content: string | null,
  silenceReason: string | undefined,
  onError: (err: EiError) => void,
  onRoomMessageAdded: (roomId: string) => void
): string | null {
  const room = sm.getRoom(roomId);
  if (!room) {
    onError({ code: "ROOM_NOT_FOUND", message: `Room ${roomId} not found.` });
    return null;
  }

  const now = new Date().toISOString();
  const existing = sm.getRoomMessages(roomId).find(
    m => m.role === "human" && m.parent_id === room.active_node_id
  );

  if (existing) {
    sm.updateRoomMessage(roomId, existing.id, {
      verbal_response: content ?? undefined,
      silence_reason: content ? undefined : (silenceReason ?? "passed"),
      timestamp: now,
    });
    onRoomMessageAdded(roomId);
    return existing.id;
  }

  const msg: RoomMessage = {
    id: crypto.randomUUID(),
    parent_id: room.active_node_id,
    role: "human",
    verbal_response: content ?? undefined,
    silence_reason: content ? undefined : (silenceReason ?? "passed"),
    timestamp: now,
    read: true,
    context_status: ContextStatus.Default,
  };
  sm.appendRoomMessage(roomId, msg);
  onRoomMessageAdded(roomId);
  return msg.id;
}

export async function sendFfaMessage(
  sm: StateManager,
  roomId: string,
  content: string | null,
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
  const existing = sm.getRoomMessages(roomId).find(
    m => m.role === "human" && m.parent_id === room.active_node_id
  );

  let humanMsgId: string;
  if (existing) {
    sm.updateRoomMessage(roomId, existing.id, {
      verbal_response: content ?? undefined,
      silence_reason: content ? undefined : (silenceReason ?? "passed"),
      timestamp: now,
    });
    humanMsgId = existing.id;
  } else {
    const msg: RoomMessage = {
      id: crypto.randomUUID(),
      parent_id: room.active_node_id,
      role: "human",
      verbal_response: content ?? undefined,
      silence_reason: content ? undefined : (silenceReason ?? "passed"),
      timestamp: now,
      read: true,
      context_status: ContextStatus.Default,
    };
    sm.appendRoomMessage(roomId, msg);
    humanMsgId = msg.id;
  }
  onRoomMessageAdded(roomId);

  sm.setRoomActiveNode(roomId, humanMsgId);
  onRoomUpdated(roomId);

  const updatedRoom = sm.getRoom(roomId)!;
  const alreadyQueued = new Set(
    sm.queue_getAllActiveItems()
      .filter(q =>
        q.next_step === LLMNextStep.HandleRoomResponse &&
        (q.data.roomId as string) === roomId &&
        (q.state === "pending" || q.state === "processing")
      )
      .map(q => q.data.personaId as string)
  );

  const shuffledIds = [...updatedRoom.persona_ids].sort(() => Math.random() - 0.5);

  for (const personaId of shuffledIds) {
    if (alreadyQueued.has(personaId)) continue;
    const persona = sm.persona_getById(personaId);
    if (!persona || persona.is_archived || persona.is_paused) continue;

    const promptOutput = await buildRoomResponsePromptData(sm, updatedRoom, persona, isTUI, true);
    const model = persona.model ?? sm.getHuman().settings?.default_model ?? "";

    sm.queue_enqueue({
      type: LLMRequestType.Raw,
      priority: LLMPriority.Room,
      system: promptOutput.system,
      user: promptOutput.user,
      next_step: LLMNextStep.HandleRoomResponse,
      model,
      data: {
        roomId,
        personaId,
        personaDisplayName: persona.display_name,
        parentMessageId: humanMsgId,
      },
    });
    onRoomMessageQueued(roomId);
  }
}

export function recallHumanRoomMessage(
  sm: StateManager,
  roomId: string,
  onRoomUpdated: (roomId: string) => void
): boolean {
  const room = sm.getRoom(roomId);
  if (!room) return false;
  const humanMsg = sm.getRoomMessages(roomId).find(
    m => m.role === "human" && m.parent_id === room.active_node_id
  );
  if (!humanMsg) return false;
  sm.removeRoomMessages(roomId, [humanMsg.id]);
  onRoomUpdated(roomId);
  return true;
}

export async function activateRoom(
  sm: StateManager,
  roomId: string,
  isTUI: boolean,
  onError: (err: EiError) => void,
  onRoomUpdated: (roomId: string) => void,
  onRoomMessageQueued: (roomId: string) => void
): Promise<void> {
  const room = sm.getRoom(roomId);
  if (!room) {
    onError({ code: "ROOM_NOT_FOUND", message: `Room ${roomId} not found.` });
    return;
  }

  const allMessages = sm.getRoomMessages(roomId);
  const humanMsg = allMessages.find(
    m => m.role === "human" && m.parent_id === room.active_node_id
  );
  if (!humanMsg) {
    onError({ code: "ROOM_NO_HUMAN_MESSAGE", message: "Submit a response first before activating." });
    return;
  }

  const human = sm.getHuman();

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

    const currentRound = allMessages.filter(m => m.parent_id === room.active_node_id);

    const context: RoomHistoryMessage[] = sm.getRoomActivePath(roomId).map(m => ({
      speaker_name: m.role === "human"
        ? (human.settings?.name_display ?? "Human")
        : (sm.persona_getById(m.persona_id ?? "")?.display_name ?? "Unknown"),
      speaker_id: m.role === "human" ? "human" : (m.persona_id ?? ""),
      verbal_response: getMessageContent(m) || undefined,
      silence_reason: m.silence_reason,
    }));

    const candidates: RoomJudgeCandidate[] = currentRound.map(m => ({
      message_id: m.id,
      speaker_name: m.role === "human"
        ? (human.settings?.name_display ?? "Human")
        : (sm.persona_getById(m.persona_id ?? "")?.display_name ?? "Unknown"),
      speaker_id: m.role === "human" ? "human" : (m.persona_id ?? ""),
      verbal_response: getMessageContent(m) || undefined,
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
  const allMessages = sm.getRoomMessages(roomId);

  const alreadyAnswered = new Set(
    allMessages
      .filter(m => m.parent_id === messageId && m.role === "persona" && m.persona_id)
      .map(m => m.persona_id!)
  );

  const alreadyQueued = new Set(
    sm.queue_getAllActiveItems()
      .filter(q =>
        q.next_step === LLMNextStep.HandleRoomResponse &&
        (q.data.roomId as string) === roomId &&
        (q.data.parentMessageId as string) === messageId &&
        (q.state === "pending" || q.state === "processing")
      )
      .map(q => q.data.personaId as string)
  );

  const needsQueue = room.persona_ids.filter(id =>
    !alreadyAnswered.has(id) && !alreadyQueued.has(id)
  );

  if (needsQueue.length === 0) return;

  for (const personaId of needsQueue) {
    const persona = sm.persona_getById(personaId);
    if (!persona || persona.is_archived || persona.is_paused) continue;

    const promptOutput = await buildRoomResponsePromptData(sm, room, persona, isTUI);
    const model = persona.model ?? sm.getHuman().settings?.default_model ?? "";

    sm.queue_enqueue({
      type: LLMRequestType.Raw,
      priority: LLMPriority.Room,
      system: promptOutput.system,
      user: promptOutput.user,
      next_step: LLMNextStep.HandleRoomResponse,
      model,
      data: {
        roomId,
        personaId,
        personaDisplayName: persona.display_name,
        parentMessageId: messageId,
      },
    });
    onRoomMessageQueued(roomId);
  }
}

export function archiveRoom(sm: StateManager, roomId: string): boolean {
  return sm.archiveRoom(roomId);
}

export function unarchiveRoom(sm: StateManager, roomId: string): boolean {
  return sm.updateRoom(roomId, { is_archived: false });
}

export function deleteRoom(sm: StateManager, roomId: string): boolean {
  return sm.deleteRoom(roomId);
}

export function markAllRoomMessagesRead(sm: StateManager, roomId: string): number {
  return sm.markAllRoomMessagesRead(roomId);
}

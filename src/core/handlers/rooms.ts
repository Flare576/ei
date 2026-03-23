/**
 * Room Response Handlers
 */

import { ContextStatus, LLMNextStep, LLMPriority, LLMRequestType } from "../types.js";
import type { LLMResponse, RoomMessage } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";
import type { RoomJudgeResult } from "../../prompts/room/index.js";
import { buildRoomResponsePromptData } from "../prompt-context-builder.js";

export function handleRoomResponse(response: LLMResponse, state: StateManager): void {
  const roomId = response.request.data.roomId as string;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const parentMessageId = response.request.data.parentMessageId as string | null ?? null;

  if (!roomId || !personaId) {
    console.error("[handleRoomResponse] Missing roomId or personaId in request data");
    return;
  }

  const now = new Date().toISOString();

  if (response.parsed !== undefined) {
    const result = response.parsed as PersonaResponseResult;

    if (!result.should_respond) {
      const reason = result.reason;
      console.log(`[handleRoomResponse] ${personaDisplayName} chose silence in room ${roomId}: ${reason ?? "(no reason)"}`);
      if (reason) {
        const msg: RoomMessage = {
          id: crypto.randomUUID(),
          parent_id: parentMessageId,
          role: "persona",
          persona_id: personaId,
          silence_reason: reason,
          timestamp: now,
          read: false,
          context_status: ContextStatus.Default,
        };
        state.appendRoomMessage(roomId, msg);
      }
      return;
    }

    const verbal = result.verbal_response || undefined;
    const action = result.action_response || undefined;

    if (!verbal && !action) {
      console.log(`[handleRoomResponse] ${personaDisplayName} returned should_respond=true but no content`);
      return;
    }

    const msg: RoomMessage = {
      id: crypto.randomUUID(),
      parent_id: parentMessageId,
      role: "persona",
      persona_id: personaId,
      verbal_response: verbal,
      action_response: action,
      timestamp: now,
      read: false,
      context_status: ContextStatus.Default,
    };
    state.appendRoomMessage(roomId, msg);
    console.log(`[handleRoomResponse] Appended response from ${personaDisplayName} to room ${roomId}`);
    return;
  }

  if (!response.content) {
    console.log(`[handleRoomResponse] ${personaDisplayName} no response (empty content)`);
    return;
  }

  const msg: RoomMessage = {
    id: crypto.randomUUID(),
    parent_id: parentMessageId,
    role: "persona",
    persona_id: personaId,
    verbal_response: response.content,
    timestamp: now,
    read: false,
    context_status: ContextStatus.Default,
  };
  state.appendRoomMessage(roomId, msg);
  console.log(`[handleRoomResponse] Appended plain-text response from ${personaDisplayName} to room ${roomId}`);
}

export async function handleRoomJudge(response: LLMResponse, state: StateManager): Promise<void> {
  const roomId = response.request.data.roomId as string;
  const judgeDisplayName = response.request.data.judgePersonaDisplayName as string;

  if (!roomId) {
    console.error("[handleRoomJudge] Missing roomId in request data");
    return;
  }

  if (!response.parsed) {
    console.error(`[handleRoomJudge] No parsed result from judge ${judgeDisplayName}`);
    return;
  }

  const result = response.parsed as RoomJudgeResult;
  if (!result.winner_message_id) {
    console.error(`[handleRoomJudge] Judge ${judgeDisplayName} returned no winner_message_id`);
    return;
  }

  const allMessages = state.getRoomMessages(roomId);
  const winner = allMessages.find(m => m.id === result.winner_message_id);
  if (!winner) {
    console.error(`[handleRoomJudge] Winner message ${result.winner_message_id} not found in room ${roomId}`);
    return;
  }

  const ok = state.setRoomActiveNode(roomId, result.winner_message_id);
  if (!ok) {
    console.error(`[handleRoomJudge] Could not set active node ${result.winner_message_id} in room ${roomId}`);
    return;
  }

  if (result.reason) {
    console.log(`[handleRoomJudge] ${judgeDisplayName} chose ${result.winner_message_id}: ${result.reason}`);
  }

  const losers = allMessages
    .filter(m => m.parent_id === winner.parent_id && m.id !== winner.id)
    .map(m => m.id);
  if (losers.length > 0) {
    state.removeRoomMessages(roomId, losers);
    console.log(`[handleRoomJudge] Removed ${losers.length} non-winning candidate(s) from room ${roomId}`);
  }

  const room = state.getRoom(roomId);
  if (!room) return;

  for (const personaId of room.persona_ids) {
    const persona = state.persona_getById(personaId);
    if (!persona) continue;

    const isTUI = false;
    const promptData = await buildRoomResponsePromptData(state, room, persona, isTUI);
    const model = persona.model ?? state.getHuman().settings?.default_model ?? "";

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Room,
      system: promptData.system,
      user: promptData.user,
      next_step: LLMNextStep.HandleRoomResponse,
      model,
      data: {
        roomId,
        personaId,
        personaDisplayName: persona.display_name,
        parentMessageId: result.winner_message_id,
      },
    });
  }
}

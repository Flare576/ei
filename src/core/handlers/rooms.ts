/**
 * Room Response Handlers
 */

import { ContextStatus, LLMNextStep, LLMPriority, LLMRequestType } from "../types.js";
import type { LLMResponse, RoomMessage } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { PersonaResponseResult } from "../../prompts/response/index.js";
import type { RoomJudgeResult } from "../../prompts/room/index.js";
import { buildRoomResponsePromptData } from "../prompt-context-builder.js";
import { cleanResponseContent } from "../llm-client.js";
import { qualifyEiMessage } from "../utils/message-id.js";

export function handleRoomResponse(response: LLMResponse, state: StateManager): void {
  const roomId = response.request.data.roomId as string;
  const personaId = response.request.data.personaId as string;
  const personaDisplayName = response.request.data.personaDisplayName as string;
  const parentMessageId = response.request.data.parentMessageId as string | null ?? null;

  if (!roomId || !personaId) {
    throw new Error("[handleRoomResponse] Missing roomId or personaId in request data");
  }

  const now = new Date().toISOString();
  const raw = cleanResponseContent(response.content ?? "").trim();

  if (raw.length > 0) {
    const lines = raw.split('\n');
    const isNoResponse = lines[0].replace(/[^a-zA-Z]/g, '').toLowerCase() === 'noresponse';

    if (isNoResponse) {
      const reason = lines.slice(1).join('\n').trim();
      console.log(`[silence] ${personaDisplayName}: ${reason || "(no reason given)"}`);
      const msg: RoomMessage = {
        id: qualifyEiMessage(crypto.randomUUID()),
        parent_id: parentMessageId,
        role: "persona",
        persona_id: personaId,
        silence_reason: reason || undefined,
        timestamp: now,
        read: false,
        context_status: ContextStatus.Default,
      };
      state.appendRoomMessage(roomId, msg);
    } else {
      const msg: RoomMessage = {
        id: qualifyEiMessage(crypto.randomUUID()),
        parent_id: parentMessageId,
        role: "persona",
        persona_id: personaId,
        content: raw,
        timestamp: now,
        read: false,
        context_status: ContextStatus.Default,
      };
      state.appendRoomMessage(roomId, msg);
      console.log(`[handleRoomResponse] Appended Markdown response from ${personaDisplayName} to room ${roomId}`);
    }
    return;
  }

  if (response.parsed !== undefined) {
    const result = response.parsed as PersonaResponseResult;

    if (!result.should_respond) {
      const reason = result.reason;
      console.log(`[silence] ${personaDisplayName}: ${reason ?? "(no reason given)"}`);
      if (reason) {
        const msg: RoomMessage = {
          id: qualifyEiMessage(crypto.randomUUID()),
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

    const content = result.content || undefined;

    if (!content) {
      console.log(`[handleRoomResponse] ${personaDisplayName} returned should_respond=true but no content`);
      return;
    }

    const msg: RoomMessage = {
      id: qualifyEiMessage(crypto.randomUUID()),
      parent_id: parentMessageId,
      role: "persona",
      persona_id: personaId,
      content,
      timestamp: now,
      read: false,
      context_status: ContextStatus.Default,
    };
    state.appendRoomMessage(roomId, msg);
    console.log(`[handleRoomResponse] Appended structured response from ${personaDisplayName} to room ${roomId}`);
    return;
  }

  console.warn(`[silence] ${personaDisplayName}: empty response after cleaning`);
}

export async function handleRoomJudge(response: LLMResponse, state: StateManager): Promise<void> {
  const roomId = response.request.data.roomId as string;
  const judgeDisplayName = response.request.data.judgePersonaDisplayName as string;

  if (!roomId) {
    throw new Error("[handleRoomJudge] Missing roomId in request data");
  }

  if (!response.parsed) {
    throw new Error(`[handleRoomJudge] No parsed result from judge ${judgeDisplayName}`);
  }

  const result = response.parsed as RoomJudgeResult;
  if (!result.winner_message_id) {
    throw new Error(`[handleRoomJudge] Judge ${judgeDisplayName} returned no winner_message_id`);
  }

  const judgePersonaId = response.request.data.judgePersonaId as string;

  const allMessages = state.getRoomMessages(roomId);
  const winner = allMessages.find(m => m.id === result.winner_message_id);
  if (!winner) {
    throw new Error(`[handleRoomJudge] Winner message ${result.winner_message_id} not found in room ${roomId}`);
  }

  const verdictParentId = winner.parent_id;

  const ok = state.setRoomActiveNode(roomId, result.winner_message_id);
  if (!ok) {
    throw new Error(`[handleRoomJudge] Could not set active node ${result.winner_message_id} in room ${roomId}`);
  }

  const losers = allMessages
    .filter(m => m.parent_id === verdictParentId && m.id !== winner.id)
    .map(m => m.id);
  if (losers.length > 0) {
    state.removeRoomMessages(roomId, losers);
  }

  if (result.reason) {
    console.log(`[handleRoomJudge] ${judgeDisplayName} verdict: ${result.reason}`);
    const verdictMsg = {
      id: qualifyEiMessage(crypto.randomUUID()),
      parent_id: verdictParentId,
      role: "persona" as const,
      persona_id: judgePersonaId,
      silence_reason: result.reason,
      timestamp: new Date().toISOString(),
      read: false,
      context_status: "default" as import("../types.js").ContextStatus,
    };
    state.appendRoomMessage(roomId, verdictMsg);
  }

  const room = state.getRoom(roomId);
  if (!room) return;

  for (const personaId of room.persona_ids) {
    if (room.judge_persona_id === personaId) continue;
    const persona = state.persona_getById(personaId);
    if (!persona || persona.is_archived || persona.is_paused) continue;

    const isTUI = false;
    const promptData = await buildRoomResponsePromptData(state, room, persona, isTUI);
    const model = persona.model ?? state.getHuman().settings?.default_model ?? "";

    state.queue_enqueue({
      type: LLMRequestType.Raw,
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

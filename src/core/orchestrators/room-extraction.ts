import { LLMNextStep, LLMPriority, LLMRequestType, RoomMode } from "../types.js";
import type { Message } from "../types.js";
import type { StateManager } from "../state-manager.js";
import {
  buildHumanTopicScanPrompt,
  buildHumanPersonScanPrompt,
  buildEventScanPrompt,
  type ParticipantContext,
} from "../../prompts/human/index.js";
import { chunkExtractionContext } from "./extraction-chunker.js";
import { buildEventWindows } from "../utils/event-windows.js";
import { resolveTokenLimit } from "../llm-client.js";
import { normalizeRoomMessages } from "../handlers/utils.js";
import {
  queueTopicScan,
  queuePersonScan,
  queueEventSummary,
  type ExtractionContext as HumanExtractionContext,
} from "./human-extraction.js";
import { queuePersonaTopicRating, type PersonaTopicContext } from "./persona-topics.js";

const EXTRACTION_BUDGET_RATIO = 0.75;
const MIN_EXTRACTION_TOKENS = 10000;

function getExtractionMaxTokens(state: StateManager): number {
  const human = state.getHuman();
  const tokenLimit = resolveTokenLimit(human.settings?.default_model, human.settings?.accounts);
  return Math.max(MIN_EXTRACTION_TOKENS, Math.floor(tokenLimit * EXTRACTION_BUDGET_RATIO));
}

function buildRoomParticipantContext(roomId: string, state: StateManager): ParticipantContext {
  const room = state.getRoom(roomId);
  const human = state.getHuman();
  const humanName = human.settings?.name_display;

  const fullNameFact = human.facts.find(f => f.name === "Full Name");
  const nicknameFact = human.facts.find(f => f.name === "Nickname/Preferred Name");
  const fullName = fullNameFact?.description || "";
  const nickname = nicknameFact?.description || "";
  let human_name: string | undefined;
  if (fullName && nickname) human_name = `${fullName} (${nickname})`;
  else if (fullName) human_name = fullName;
  else if (nickname) human_name = nickname;
  else if (humanName) human_name = humanName;

  const participantNames = (room?.persona_ids ?? [])
    .map(id => state.persona_getById(id)?.display_name)
    .filter(Boolean)
    .join(", ");

  return {
    persona_name: room?.display_name ?? roomId,
    persona_description: participantNames
      ? `A conversation room with participants: ${participantNames}`
      : "A multi-persona conversation room",
    human_name,
    human_age: undefined,
  };
}

function getRoomVisibleMessages(state: StateManager, roomId: string): Message[] {
  const room = state.getRoom(roomId);
  if (!room) return [];
  const rawMessages = room.mode === RoomMode.FreeForAll
    ? [...state.getRoomMessages(roomId)].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    : state.getRoomActivePath(roomId);
  return normalizeRoomMessages(rawMessages, state);
}

function queueRoomTopicScan(
  roomId: string,
  roomDisplayName: string,
  messages_context: Message[],
  messages_analyze: Message[],
  state: StateManager,
  participantContext: ParticipantContext
): void {
  const context: HumanExtractionContext = {
    personaId: roomId,
    personaDisplayName: roomDisplayName,
    messages_context,
    messages_analyze,
    extraction_flag: "t",
  };
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state));
  if (chunks.length === 0) return;

  state.markRoomMessagesExtracted(roomId, messages_analyze.map(m => m.id), "t");

  for (const chunk of chunks) {
    const prompt = buildHumanTopicScanPrompt({
      persona_name: roomDisplayName,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
      participant_context: participantContext,
    });
    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanTopicScan,
      data: {
        roomId,
        personaId: (state.getRoom(roomId)?.persona_ids ?? []).join("|"),
        personaDisplayName: roomDisplayName,
        message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
      },
    });
  }
}

function queueRoomPersonScan(
  roomId: string,
  roomDisplayName: string,
  messages_context: Message[],
  messages_analyze: Message[],
  state: StateManager
): void {
  const context: HumanExtractionContext = {
    personaId: roomId,
    personaDisplayName: roomDisplayName,
    messages_context,
    messages_analyze,
    extraction_flag: "p",
  };
  const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state));
  if (chunks.length === 0) return;

  state.markRoomMessagesExtracted(roomId, messages_analyze.map(m => m.id), "p");

  for (const chunk of chunks) {
    const prompt = buildHumanPersonScanPrompt({
      persona_name: roomDisplayName,
      messages_context: chunk.messages_context,
      messages_analyze: chunk.messages_analyze,
    });
    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleHumanPersonScan,
      data: {
        roomId,
        personaId: (state.getRoom(roomId)?.persona_ids ?? []).join("|"),
        personaDisplayName: roomDisplayName,
        message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
      },
    });
  }
}

function queueRoomEventScan(
  roomId: string,
  roomDisplayName: string,
  allMessages: Message[],
  state: StateManager,
  participantContext: ParticipantContext
): void {
  const unextracted = allMessages.filter(m => !m.e);
  if (unextracted.length === 0) return;

  const human = state.getHuman();
  const gapHours = human.settings?.ceremony?.event_window_hours ?? 8;
  const sorted = [...unextracted].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const windows = buildEventWindows(sorted, gapHours);

  state.markRoomMessagesExtracted(roomId, sorted.map(m => m.id), "e");

  for (const windowMessages of windows) {
    if (windowMessages.length === 0) continue;
    const windowStartTime = new Date(windowMessages[0].timestamp).getTime();
    const messages_context = allMessages.filter(
      m => m.e === true && new Date(m.timestamp).getTime() < windowStartTime
    );
    const context: HumanExtractionContext = {
      personaId: roomId,
      personaDisplayName: roomDisplayName,
      messages_context,
      messages_analyze: windowMessages,
      extraction_flag: "e",
    };
    const { chunks } = chunkExtractionContext(context, getExtractionMaxTokens(state));
    for (const chunk of chunks) {
      const prompt = buildEventScanPrompt({
        persona_name: roomDisplayName,
        messages_context: chunk.messages_context,
        messages_analyze: chunk.messages_analyze,
        participant_context: participantContext,
      });
      state.queue_enqueue({
        type: LLMRequestType.JSON,
        priority: LLMPriority.Low,
        system: prompt.system,
        user: prompt.user,
        next_step: LLMNextStep.HandleEventScan,
        data: {
          roomId,
          personaId: (state.getRoom(roomId)?.persona_ids ?? []).join("|"),
          personaDisplayName: roomDisplayName,
          message_ids_to_mark: chunk.messages_analyze.map(m => m.id),
        },
      });
    }
  }
}

export function checkAndQueueRoomExtraction(state: StateManager, roomId: string): void {
  const room = state.getRoom(roomId);
  if (!room || room.mode === RoomMode.ChooseYourPath) return;

  const N = room.persona_ids.length + 1;
  const threshold = room.mode === RoomMode.FreeForAll ? 5 * N : 10;

  const allVisible = getRoomVisibleMessages(state, roomId);
  const unextractedT = allVisible.filter(m => !m.t);
  const unextractedP = allVisible.filter(m => !m.p);

  if (unextractedT.length < threshold && unextractedP.length < threshold) return;

  const participantContext = buildRoomParticipantContext(roomId, state);
  const roomDisplayName = room.display_name;

  if (unextractedT.length >= threshold) {
    const analyzeStart = unextractedT[0].timestamp;
    const messages_contextT = allVisible.filter(
      m => m.t === true && new Date(m.timestamp).getTime() < new Date(analyzeStart).getTime()
    );
    queueRoomTopicScan(roomId, roomDisplayName, messages_contextT, unextractedT, state, participantContext);
  }

  if (unextractedP.length >= threshold) {
    const analyzeStart = unextractedP[0].timestamp;
    const messages_contextP = allVisible.filter(
      m => m.p === true && new Date(m.timestamp).getTime() < new Date(analyzeStart).getTime()
    );
    queueRoomPersonScan(roomId, roomDisplayName, messages_contextP, unextractedP, state);
  }

  console.log(`[checkAndQueueRoomExtraction] Auto-triggered extraction for room ${roomDisplayName} (threshold: ${threshold})`);
}

export function queueRoomCapture(state: StateManager, roomId: string): void {
  const room = state.getRoom(roomId);
  if (!room) return;

  const allVisible = getRoomVisibleMessages(state, roomId);
  if (allVisible.length === 0) return;

  const participantContext = buildRoomParticipantContext(roomId, state);
  const roomDisplayName = room.display_name;

  const unextractedT = allVisible.filter(m => !m.t);
  const unextractedP = allVisible.filter(m => !m.p);
  const analyzeStartT = unextractedT[0]?.timestamp ?? "9999";
  const messages_contextT = allVisible.filter(
    m => m.t === true && new Date(m.timestamp).getTime() < new Date(analyzeStartT).getTime()
  );
  const analyzeStartP = unextractedP[0]?.timestamp ?? "9999";
  const messages_contextP = allVisible.filter(
    m => m.p === true && new Date(m.timestamp).getTime() < new Date(analyzeStartP).getTime()
  );

  if (unextractedT.length > 0) {
    queueRoomTopicScan(roomId, roomDisplayName, messages_contextT, unextractedT, state, participantContext);
  }
  if (unextractedP.length > 0) {
    queueRoomPersonScan(roomId, roomDisplayName, messages_contextP, unextractedP, state);
  }
  queueRoomEventScan(roomId, roomDisplayName, allVisible, state, participantContext);

  for (const personaId of room.persona_ids) {
    const shortId = personaId.slice(0, 8);
    const unprocessedRaw = state.getRoomUnextractedMessagesForPersona(roomId, shortId);
    if (unprocessedRaw.length === 0) continue;
    const personaForRoom = state.persona_getById(personaId);
    if (!personaForRoom) continue;
    const processedIds = new Set(allVisible.filter(m => !!m.persona_extracted?.[shortId]).map(m => m.id));
    const personaTopicContext: PersonaTopicContext = {
      personaId,
      personaDisplayName: personaForRoom.display_name,
      messages_context: allVisible.filter(m => processedIds.has(m.id)),
      messages_analyze: normalizeRoomMessages(unprocessedRaw, state),
      topics: personaForRoom.topics,
    };
    queuePersonaTopicRating(personaTopicContext, state, { roomId: roomId });
    console.log(`[queueRoomCapture] Queued persona topic scan: ${personaForRoom.display_name} (${unprocessedRaw.length} messages)`);
  }

  console.log(`[queueRoomCapture] Queued extraction for room ${roomDisplayName}`);
}

export function queuePersonaCapture(state: StateManager, personaId: string): void {
  const persona = state.persona_getById(personaId);
  if (!persona) return;

  const allMessages = state.messages_get(personaId);
  if (allMessages.length === 0) return;

  const unextractedT = state.messages_getUnextracted(personaId, "t");
  const unextractedP = state.messages_getUnextracted(personaId, "p");
  const model = state.getHuman().settings?.default_model;
  const options = { extraction_model: model };

  if (unextractedT.length > 0) {
    const analyzeStart = unextractedT[0].timestamp;
    const messages_context = allMessages.filter(
      m => m.t === true && new Date(m.timestamp).getTime() < new Date(analyzeStart).getTime()
    );
    const context: HumanExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context,
      messages_analyze: unextractedT,
    };
    queueTopicScan(context, state, options);
  }

  if (unextractedP.length > 0) {
    const analyzeStart = unextractedP[0].timestamp;
    const messages_context = allMessages.filter(
      m => m.p === true && new Date(m.timestamp).getTime() < new Date(analyzeStart).getTime()
    );
    const context: HumanExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context,
      messages_analyze: unextractedP,
    };
    queuePersonScan(context, state, options);
  }

  queueEventSummary(personaId, state, options);

  const shortId = personaId.slice(0, 8);
  const unprocessedForPersona = state.messages_getUnextractedForPersona(personaId, shortId);
  if (unprocessedForPersona.length > 0) {
    const processedIds = new Set(allMessages.filter(m => !!m.persona_extracted?.[shortId]).map(m => m.id));
    const personaTopicContext: PersonaTopicContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => processedIds.has(m.id)),
      messages_analyze: unprocessedForPersona,
      topics: persona.topics,
    };
    queuePersonaTopicRating(personaTopicContext, state);
    console.log(`[queuePersonaCapture] Queued persona topic scan for ${persona.display_name} (${unprocessedForPersona.length} messages)`);
  }

  console.log(`[queuePersonaCapture] Queued extraction for persona ${persona.display_name}`);
}

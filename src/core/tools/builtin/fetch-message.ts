import type { ToolExecutor } from "../types.js";
import type { Message } from "../../types.js";
import type { RoomMessage, RoomSummary } from "../../types/rooms.js";
import type { PersonaEntity } from "../../types/entities.js";
import { classifyRefusedMessageId, classifyMalformedRoomPrimary } from "../../utils/message-refusal.js";

interface CleanMessage {
  id: string;
  role: string;
  content?: string;
  silence_reason?: string;
  timestamp: string;
  speaker_name?: string;
}

type GetAllPersonas = () => PersonaEntity[];
type GetPersonaMessages = (personaId: string) => Message[];
type GetRoomList = () => RoomSummary[];
type GetRoomMessages = (roomId: string) => RoomMessage[];
type GetRoomDisplayName = (roomId: string) => string | null;
type ResolveExternalMessage = (id: string, before: number, after: number) => Promise<Record<string, unknown> | null>;

function stripMessage(m: Message): CleanMessage {
  return {
    id: m.id,
    role: m.role,
    ...(m.content !== undefined ? { content: m.content } : {}),
    ...(m.silence_reason !== undefined ? { silence_reason: m.silence_reason } : {}),
    timestamp: m.timestamp,
    ...(m.speaker_name !== undefined ? { speaker_name: m.speaker_name } : {}),
  };
}

function stripRoomMessage(m: RoomMessage, personaDisplayName?: string): CleanMessage {
  return {
    id: m.id,
    role: m.role,
    ...(m.content !== undefined ? { content: m.content } : {}),
    ...(m.silence_reason !== undefined ? { silence_reason: m.silence_reason } : {}),
    timestamp: m.timestamp,
    ...(personaDisplayName !== undefined ? { speaker_name: personaDisplayName } : {}),
  };
}

export function createFetchMessageExecutor(
  getAllPersonas: GetAllPersonas,
  getPersonaMessages: GetPersonaMessages,
  getRoomList: GetRoomList,
  getRoomMessages: GetRoomMessages,
  getRoomDisplayName: GetRoomDisplayName,
  resolveExternalMessage?: ResolveExternalMessage
): ToolExecutor {
  return {
    name: "fetch_message",

    async execute(args: Record<string, unknown>): Promise<string> {
      const id = typeof args.id === "string" ? args.id.trim() : "";
      const before = typeof args.before === "number" && args.before > 0 ? Math.floor(args.before) : 0;
      const after = typeof args.after === "number" && args.after > 0 ? Math.floor(args.after) : 0;

      console.log(`[fetch_message] called with id="${id}", before=${before}, after=${after}`);

      if (!id) {
        console.warn("[fetch_message] missing id argument");
        return JSON.stringify({ error: "Missing required argument: id" });
      }

      // I3 (round 2): a browser-safe terminal-refusal check, run before
      // ANY local scan or resolver call, on both runtime registrations —
      // see src/core/utils/message-refusal.ts. TUI's resolver (below)
      // would classify these three id formats identically, but running
      // this first means browser (which gets no resolver at all) refuses
      // them too, instead of silently falling through to the local scan.
      const formatRefusal = classifyRefusedMessageId(id);
      if (formatRefusal) {
        console.log(`[fetch_message] refused id="${id}": ${formatRefusal.reason}`);
        return JSON.stringify(formatRefusal);
      }

      if (resolveExternalMessage) {
        const external = await resolveExternalMessage(id, before, after);
        if (external) {
          console.log(`[fetch_message] resolved id="${id}" via resolver`);
          return JSON.stringify(external);
        }
      }

      const personas = getAllPersonas();

      // TODO: add persona access gate when calling context is available —
      // the execute() signature has no requestingPersonaId, so we search all personas.
      for (const persona of personas) {
        const messages = getPersonaMessages(persona.id);
        const idx = messages.findIndex(m => m.id === id);
        if (idx === -1) continue;

        const msg = messages[idx];
        const beforeMsgs = messages.slice(Math.max(0, idx - before), idx).map(stripMessage);
        const afterMsgs = messages.slice(idx + 1, idx + 1 + after).map(stripMessage);

        console.log(`[fetch_message] found in persona "${persona.display_name}" at idx=${idx}`);
        return JSON.stringify({
          message: stripMessage(msg),
          before: beforeMsgs,
          after: afterMsgs,
          persona: persona.display_name,
        });
      }

      // TODO: add persona access gate when calling context is available.
      const rooms = getRoomList();
      for (const roomSummary of rooms) {
        const messages = getRoomMessages(roomSummary.id);
        const idx = messages.findIndex(m => m.id === id);
        if (idx === -1) continue;

        const msg = messages[idx];

        // I3 (round 2): a malformed room-persona-primary message (role
        // "persona", no persona_id at all) is refused here — using data
        // this scan already has locally, no resolver needed — instead of
        // silently falling back to the Participant-name legacy envelope.
        const roomRefusal = classifyMalformedRoomPrimary(msg);
        if (roomRefusal) {
          console.log(`[fetch_message] refused room message id="${id}": ${roomRefusal.reason}`);
          return JSON.stringify(roomRefusal);
        }

        const roomDisplayName = getRoomDisplayName(roomSummary.id) ?? roomSummary.display_name;

        const resolvePersonaName = (m: RoomMessage): string | undefined => {
          if (m.role !== "persona" || !m.persona_id) return undefined;
          const p = personas.find(pe => pe.id === m.persona_id);
          return p?.display_name ?? "Participant";
        };

        const beforeMsgs = messages
          .slice(Math.max(0, idx - before), idx)
          .map(m => stripRoomMessage(m, resolvePersonaName(m)));
        const afterMsgs = messages
          .slice(idx + 1, idx + 1 + after)
          .map(m => stripRoomMessage(m, resolvePersonaName(m)));

        console.log(`[fetch_message] found in room "${roomDisplayName}" at idx=${idx}`);
        return JSON.stringify({
          message: stripRoomMessage(msg, resolvePersonaName(msg)),
          before: beforeMsgs,
          after: afterMsgs,
          persona: roomDisplayName,
        });
      }

      console.log(`[fetch_message] message not found for id="${id}"`);
      return JSON.stringify({ error: "Message not found" });
    },
  };
}

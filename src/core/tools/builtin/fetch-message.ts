import type { ToolExecutor } from "../types.js";
import type { Message } from "../../types.js";
import type { RoomMessage, RoomSummary } from "../../types/rooms.js";
import type { PersonaEntity } from "../../types/entities.js";
import type { OpenCodeMessageWindow } from "../../../integrations/opencode/types.js";

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
type GetOpenCodeMessage = (id: string, before: number, after: number) => Promise<OpenCodeMessageWindow | null>;

const OPENCODE_MESSAGE_ID = /^msg_[a-zA-Z0-9]+$/;

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
  getOpenCodeMessage?: GetOpenCodeMessage
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

      if (OPENCODE_MESSAGE_ID.test(id)) {
        if (!getOpenCodeMessage) {
          return JSON.stringify({ error: "OpenCode message lookup not available in this runtime", id });
        }
        const window = await getOpenCodeMessage(id, before, after);
        if (!window) {
          return JSON.stringify({
            error: "OpenCode message not found on this machine. It may exist on another device.",
            id,
            hint: "Check the linked topic's sources for the originating machine and session.",
          });
        }
        return JSON.stringify({
          message: { id: window.message.id, role: window.message.role, content: window.message.content, timestamp: window.message.timestamp, agent: window.message.agent },
          before: window.before.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
          after: window.after.map(m => ({ id: m.id, role: m.role, content: m.content, timestamp: m.timestamp, agent: m.agent })),
          session: { id: window.session.id, title: window.session.title, directory: window.session.directory },
          source: "opencode",
        });
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
        const roomDisplayName = getRoomDisplayName(roomSummary.id) ?? roomSummary.display_name;

        const resolvePersonaName = (m: RoomMessage): string | undefined => {
          if (m.role !== "persona" || !m.persona_id) return undefined;
          const p = personas.find(pe => pe.id === m.persona_id);
          return p?.display_name;
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

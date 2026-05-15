import type { ToolExecutor } from "../types.js";
import type { PersonaEntity } from "../../types.js";

export const NOTES_MAX = 20;

type GetPersona = (id: string) => PersonaEntity | null;
type UpdatePersona = (id: string, updates: Partial<PersonaEntity>) => boolean;

export function createAddNoteExecutor(getPersona: GetPersona, updatePersona: UpdatePersona): ToolExecutor {
  return {
    name: "add_note",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      const text = typeof args.text === "string" ? args.text.trim() : "";
      console.log(`[add_note] persona="${personaId}" text="${text.slice(0, 60)}"`);

      if (!personaId) {
        return JSON.stringify({ error: "Tool misconfigured: missing persona_id" });
      }
      if (!text) {
        return JSON.stringify({ error: "Missing required argument: text" });
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return JSON.stringify({ error: "Persona not found" });
      }

      const notes = [...(persona.notes ?? [])];

      if (notes.length >= NOTES_MAX) {
        notes.shift();
      }

      notes.push(text);
      updatePersona(personaId, { notes });

      const index = notes.length;
      console.log(`[add_note] added note at position ${index}/${NOTES_MAX}`);
      return JSON.stringify({ added: true, index, total: notes.length });
    },
  };
}

export function createClearNoteExecutor(getPersona: GetPersona, updatePersona: UpdatePersona): ToolExecutor {
  return {
    name: "clear_note",

    async execute(args: Record<string, unknown>, config?: Record<string, string>): Promise<string> {
      const personaId = config?.persona_id ?? "";
      const index = typeof args.index === "number" ? args.index : NaN;
      console.log(`[clear_note] persona="${personaId}" index=${index}`);

      if (!personaId) {
        return JSON.stringify({ error: "Tool misconfigured: missing persona_id" });
      }
      if (!Number.isInteger(index) || index < 1) {
        return JSON.stringify({ error: "index must be an integer >= 1" });
      }

      const persona = getPersona(personaId);
      if (!persona) {
        return JSON.stringify({ error: "Persona not found" });
      }

      const notes = [...(persona.notes ?? [])];
      const zeroIdx = index - 1;

      if (zeroIdx >= notes.length) {
        return JSON.stringify({ error: `No note at index ${index} (total: ${notes.length})` });
      }

      notes.splice(zeroIdx, 1);
      updatePersona(personaId, { notes });

      console.log(`[clear_note] removed note at index ${index}, remaining=${notes.length}`);
      return JSON.stringify({ cleared: true, index, remaining: notes.length });
    },
  };
}

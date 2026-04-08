import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sanitizeEiPersonaIdentifiers(
  identifiers: PersonIdentifier[],
  state: StateManager
): PersonIdentifier[] {
  return identifiers.map(id => {
    if (id.type !== 'Ei Persona' && id.type !== 'AI Persona') return id;
    if (UUID_REGEX.test(id.value)) return { ...id, type: 'Ei Persona' };
    const matched = state.persona_getAll().find(p =>
      p.display_name === id.value || p.aliases?.includes(id.value)
    );
    if (matched) return { ...id, type: 'Ei Persona', value: matched.id };
    return id.type === 'AI Persona' ? id : { ...id, type: 'Nickname' };
  });
}

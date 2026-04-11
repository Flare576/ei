import type { PersonIdentifier } from "../types/data-items.js";
import type { StateManager } from "../state-manager.js";
import { BUILT_IN_IDENTIFIER_TYPES } from "../constants/built-in-identifier-types.js";

export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function toNormalizedKey(s: string): string {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

// Fuzzy-matches LLM-provided type against built-in + in-use types (strip non-alphanumeric, lowercase).
// "nickname" -> "Nickname", "full_name" -> "Full Name", "EMAIL" -> "Email", "Slack RNP" -> "Slack RNP" (custom, no match)
export function normalizeIdentifierType(llmType: string, state: StateManager): string {
  const inUseTypes = state.getHuman().people.flatMap(p =>
    (p.identifiers ?? []).map(i => i.type)
  );

  const canonicalMap = new Map<string, string>();
  for (const t of [...BUILT_IN_IDENTIFIER_TYPES, ...inUseTypes]) {
    const key = toNormalizedKey(t);
    if (!canonicalMap.has(key)) {
      canonicalMap.set(key, t);
    }
  }

  const normalized = toNormalizedKey(llmType);
  return canonicalMap.get(normalized) ?? llmType;
}

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

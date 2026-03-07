import {
  RESERVED_PERSONA_NAMES,
  isReservedPersonaName,
  type PersonaSummary,
  type PersonaEntity,
  type PersonaCreationInput,
} from "./types.js";
import { StateManager } from "./state-manager.js";
import { orchestratePersonaGeneration } from "./orchestrators/index.js";

export async function getPersonaList(sm: StateManager): Promise<PersonaSummary[]> {
  return sm.persona_getAll().map((entity) => ({
    id: entity.id,
    display_name: entity.display_name,
    aliases: entity.aliases ?? [],
    short_description: entity.short_description,
    is_paused: entity.is_paused,
    is_archived: entity.is_archived,
    unread_count: sm.messages_countUnread(entity.id),
    last_activity: entity.last_activity,
    context_boundary: entity.context_boundary,
  }));
}

export async function resolvePersonaName(sm: StateManager, nameOrAlias: string): Promise<string | null> {
  const persona = sm.persona_getByName(nameOrAlias);
  return persona?.id ?? null;
}

export async function getPersona(sm: StateManager, personaId: string): Promise<PersonaEntity | null> {
  return sm.persona_getById(personaId);
}

export async function createPersona(
  sm: StateManager,
  input: PersonaCreationInput,
  onPersonaUpdated: (id: string) => void
): Promise<string> {
  if (isReservedPersonaName(input.name)) {
    throw new Error(
      `Cannot create persona with reserved name "${input.name}". Reserved names: ${RESERVED_PERSONA_NAMES.join(", ")}`
    );
  }
  const now = new Date().toISOString();
  const DEFAULT_GROUP = "General";
  const personaId = crypto.randomUUID();
  const placeholder: PersonaEntity = {
    id: personaId,
    display_name: input.name,
    entity: "system",
    aliases: input.aliases ?? [input.name],
    short_description: input.short_description,
    long_description: input.long_description,
    model: input.model,
    group_primary: input.group_primary ?? DEFAULT_GROUP,
    groups_visible: input.groups_visible ?? [DEFAULT_GROUP],
    traits: [],
    topics: [],
    tools: input.tools && input.tools.length > 0 ? input.tools : undefined,
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: now,
    last_activity: now,
  };
  sm.persona_add(placeholder);

  orchestratePersonaGeneration(
    { ...input, id: personaId },
    sm,
    () => onPersonaUpdated(placeholder.display_name)
  );

  return personaId;
}

export async function archivePersona(sm: StateManager, personaId: string): Promise<boolean> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return false;
  sm.persona_archive(personaId);
  return true;
}

export async function unarchivePersona(sm: StateManager, personaId: string): Promise<boolean> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return false;
  sm.persona_unarchive(personaId);
  return true;
}

export async function deletePersona(
  sm: StateManager,
  personaId: string,
  _deleteHumanData: boolean
): Promise<boolean> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return false;
  sm.persona_delete(personaId);
  return true;
}

export async function updatePersona(
  sm: StateManager,
  personaId: string,
  updates: Partial<PersonaEntity>
): Promise<boolean> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return false;
  sm.persona_update(personaId, updates);
  return true;
}

export async function getGroupList(sm: StateManager): Promise<string[]> {
  const personas = sm.persona_getAll();
  const groups = new Set<string>();
  for (const p of personas) {
    if (p.group_primary) groups.add(p.group_primary);
    for (const g of p.groups_visible || []) groups.add(g);
  }
  return [...groups].sort();
}

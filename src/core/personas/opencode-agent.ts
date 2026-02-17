import type { PersonaEntity, Ei_Interface } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { OpenCodeReader } from "../../integrations/opencode/reader.js";

const OPENCODE_GROUP = "OpenCode";
const TWELVE_HOURS_MS = 43200000;

export interface EnsureAgentPersonaOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: OpenCodeReader;
}

export async function ensureAgentPersona(
  agentName: string,
  options: EnsureAgentPersonaOptions
): Promise<PersonaEntity> {
  const { stateManager, interface: eiInterface, reader } = options;

  const existing = stateManager.persona_getByName(agentName);
  if (existing) {
    return existing;
  }

  const agentReader = reader ?? new OpenCodeReader();
  const agentInfo = await agentReader.getAgentInfo(agentName);

  const now = new Date().toISOString();
  const personaId = crypto.randomUUID();
  const persona: PersonaEntity = {
    id: personaId,
    display_name: agentName,
    entity: "system",
    aliases: [agentName],
    short_description: agentInfo?.description ?? "OpenCode coding agent",
    long_description: "An OpenCode agent that assists with coding tasks.",
    group_primary: OPENCODE_GROUP,
    groups_visible: [OPENCODE_GROUP],
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    heartbeat_delay_ms: TWELVE_HOURS_MS,
    last_heartbeat: now,
    last_updated: now,
    last_activity: now,
  };

  stateManager.persona_add(persona);
  eiInterface?.onPersonaAdded?.();

  return persona;
}

export async function ensureAllAgentPersonas(
  agentNames: string[],
  options: EnsureAgentPersonaOptions
): Promise<Map<string, PersonaEntity>> {
  const result = new Map<string, PersonaEntity>();

  for (const name of agentNames) {
    const persona = await ensureAgentPersona(name, options);
    result.set(name, persona);
  }

  return result;
}

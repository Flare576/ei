import type { PersonaEntity, Ei_Interface } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { OpenCodeReader } from "../../integrations/opencode/reader.js";

const OPENCODE_GROUP = "OpenCode";

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

  const existing = stateManager.persona_get(agentName);
  if (existing) {
    return existing;
  }

  const agentReader = reader ?? new OpenCodeReader();
  const agentInfo = await agentReader.getAgentInfo(agentName);

  const now = new Date().toISOString();
  const persona: PersonaEntity = {
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
    is_static: true,
    heartbeat_delay_ms: 0,
    last_updated: now,
    last_activity: now,
  };

  stateManager.persona_add(agentName, persona);
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

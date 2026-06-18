import type { PersonaEntity, Ei_Interface } from "../types.js";
import type { PersonaTrait } from "../types.js";
import type { StateManager } from "../state-manager.js";
import type { IOpenCodeReader } from "../../integrations/opencode/types.js";
import { AGENT_ALIASES } from "../../integrations/opencode/types.js";
import { DEFAULT_SEED_TRAITS } from "../constants/seed-traits.js";

const OPENCODE_GROUP = "OpenCode";
const TWELVE_HOURS_MS = 43200000;

export interface EnsureAgentPersonaOptions {
  stateManager: StateManager;
  interface?: Ei_Interface;
  reader?: IOpenCodeReader;
}

export function resolveCanonicalAgent(agentName: string): { canonical: string; aliases: string[] } {
  // Strip Unicode whitespace (\p{Z}) AND zero-width characters (\u200B, \u200C, \u200D, \u2060, \uFEFF).
  // The \u200B strip is not decorative — oh-my-openagent intentionally prefixes agent display
  // names with zero-width spaces (U+200B) as a sort hack to float them to the top of the agent
  // picker list (1 ZWS = Sisyphus, 2 = Hephaestus, 3 = Prometheus, 4 = Atlas). Those prefixed
  // names end up stored verbatim in OpenCode's SQLite message rows and come back to us here.
  // \p{Z} alone does NOT catch \u200B (Unicode category Cf, not Zs), so we must be explicit.
  agentName = agentName.replace(/^[\p{Z}\u200B\u200C\u200D\u2060\uFEFF]+|[\p{Z}\u200B\u200C\u200D\u2060\uFEFF]+$/gu, "");
  for (const [canonical, variants] of Object.entries(AGENT_ALIASES)) {
    if (variants.includes(agentName)) {
      return { canonical, aliases: variants };
    }
  }

  let name = agentName;
  name = name.replace(/^ai-sdlc[:-]/, "");
  name = name.replace(/\s*\([^)]+\)\s*$/, "").trim();
  name = name.replace(/\s{2,}\S+.*$/, "").trim();
  name = name.replace(/-/g, " ");
  const canonical = name.replace(/\b\w/g, (c) => c.toUpperCase());

  return { canonical, aliases: [agentName] };
}

export async function ensureAgentPersona(
  agentName: string,
  options: EnsureAgentPersonaOptions
): Promise<PersonaEntity> {
  const { stateManager, interface: eiInterface, reader } = options;

  const { canonical, aliases } = resolveCanonicalAgent(agentName);

  const existing = stateManager.persona_getByName(canonical);
  if (existing) {
    return existing;
  }

  const agentInfo = reader ? await reader.getAgentInfo(canonical) : null;

  const now = new Date().toISOString();
  const personaId = crypto.randomUUID();
  const seedTraits: PersonaTrait[] = DEFAULT_SEED_TRAITS.map((t) => ({
    id: crypto.randomUUID(),
    name: t.name,
    description: t.description,
    sentiment: t.sentiment,
    strength: t.strength,
    last_updated: now,
    learned_on: now,
  }));
  const persona: PersonaEntity = {
    id: personaId,
    display_name: canonical,
    entity: "system",
    aliases,
    short_description: agentInfo?.description ?? "OpenCode coding agent",
    long_description: "An OpenCode agent that assists with coding tasks.",
    group_primary: OPENCODE_GROUP,
    groups_visible: [OPENCODE_GROUP],
    traits: seedTraits,
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    heartbeat_delay_ms: TWELVE_HOURS_MS,
    last_heartbeat: now,
    last_updated: now,
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

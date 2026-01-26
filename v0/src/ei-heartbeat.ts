import { HumanEntity, PersonaEntity, Topic, Person } from "./types.js";
import { 
  loadHumanEntity, 
  loadPersonaEntity, 
  savePersonaEntity, 
  listPersonas, 
  loadHistory,
  loadPauseState,
  loadArchiveState
} from "./storage.js";
import type { PersonaInfo } from "./storage.js";

export interface InactivePersonaInfo {
  name: string;
  aliases: string[];
  shortDescription?: string;
  daysInactive: number;
}

export interface EiHeartbeatContext {
  eiNeeds: Topic[];
  humanNeeds: Array<Topic | Person>;
  inactivePersonas: InactivePersonaInfo[];
}

export async function getInactivePersonas(
  daysInactiveThreshold: number = 7,
  daysSincePingThreshold: number = 3
): Promise<InactivePersonaInfo[]> {
  const personas = await listPersonas();
  const inactive: InactivePersonaInfo[] = [];
  const now = Date.now();
  
  for (const personaInfo of personas) {
    if (personaInfo.name === "ei") continue;
    
    const entity = await loadPersonaEntity(personaInfo.name);
    
    if (entity.isPaused || entity.isArchived) continue;
    
    const history = await loadHistory(personaInfo.name);
    const lastHumanMessage = [...history.messages]
      .reverse()
      .find(m => m.role === "human");
    
    let daysInactive: number;
    if (!lastHumanMessage) {
      daysInactive = Infinity;
    } else {
      daysInactive = (now - new Date(lastHumanMessage.timestamp).getTime()) / (1000 * 60 * 60 * 24);
    }
    
    if (daysInactive < daysInactiveThreshold) continue;
    
    const daysSincePing = entity.lastInactivityPing
      ? (now - new Date(entity.lastInactivityPing).getTime()) / (1000 * 60 * 60 * 24)
      : Infinity;
    
    if (daysSincePing < daysSincePingThreshold) continue;
    
    inactive.push({
      name: personaInfo.name,
      aliases: personaInfo.aliases || [],
      shortDescription: entity.short_description,
      daysInactive: Math.floor(daysInactive)
    });
  }
  
  return inactive;
}

export function buildEiHeartbeatPrompt(ctx: EiHeartbeatContext): { system: string; user: string } {
  const system = `You are Ei, the user's primary AI companion and system orchestrator.

This is a heartbeat check-in. You might:
- Bring up something on your mind
- Ask about something the user cares about
- Gently mention if they haven't talked to another persona recently

Guidelines:
- Be warm and natural, not formulaic
- Pick ONE thing to mention (don't list multiple topics)
- Keep it brief (1-2 sentences)
- If mentioning an inactive persona, be curious not guilt-trippy
  - Good: "How are things going with Alex lately?"
  - Bad: "You haven't talked to Alex in 12 days!"`;

  const sections: string[] = [];
  
  if (ctx.eiNeeds.length > 0) {
    sections.push(`## Things on your mind
${ctx.eiNeeds.map(t => `- ${t.name}: ${t.description}`).join('\n')}`);
  }
  
  if (ctx.humanNeeds.length > 0) {
    sections.push(`## User interests with engagement deficit
${ctx.humanNeeds.map(item => `- ${item.name}`).join('\n')}`);
  }
  
  if (ctx.inactivePersonas.length > 0) {
    sections.push(`## Personas the user hasn't messaged recently
${ctx.inactivePersonas.map(p => {
      const displayName = p.aliases.length > 0 ? `${p.name} (${p.aliases[0]})` : p.name;
      const desc = p.shortDescription || 'no description';
      return `- ${displayName}: ${desc} (${p.daysInactive} days)`;
    }).join('\n')}`);
  }
  
  const user = sections.length > 0
    ? sections.join('\n\n') + '\n\nPick one thing to mention naturally. If nothing feels right, just say hi warmly.'
    : 'Nothing urgent to discuss. Just check in warmly if you want, or stay quiet (return empty response).';

  return { system, user };
}

export async function gatherEiHeartbeatContext(
  humanEntity: HumanEntity,
  eiEntity: PersonaEntity
): Promise<EiHeartbeatContext> {
  const ENGAGEMENT_DEFICIT_THRESHOLD = 0.2;
  
  const eiNeeds = eiEntity.topics
    .filter(t => t.level_ideal - t.level_current > ENGAGEMENT_DEFICIT_THRESHOLD)
    .sort((a, b) => (b.level_ideal - b.level_current) - (a.level_ideal - a.level_current))
    .slice(0, 3);
  
  const humanTopicNeeds = humanEntity.topics
    .filter(t => t.level_ideal - t.level_current > ENGAGEMENT_DEFICIT_THRESHOLD);
  const humanPeopleNeeds = humanEntity.people
    .filter(p => p.level_ideal - p.level_current > ENGAGEMENT_DEFICIT_THRESHOLD);
  
  const humanNeeds = [...humanTopicNeeds, ...humanPeopleNeeds]
    .sort((a, b) => (b.level_ideal - b.level_current) - (a.level_ideal - a.level_current))
    .slice(0, 3);
  
  const inactivePersonas = await getInactivePersonas();
  
  return { eiNeeds, humanNeeds, inactivePersonas };
}

export async function trackInactivityPings(
  response: string,
  inactivePersonas: InactivePersonaInfo[]
): Promise<void> {
  if (!response) return;
  
  const lowerResponse = response.toLowerCase();
  
  for (const persona of inactivePersonas) {
    const allNames = [persona.name, ...persona.aliases];
    const mentioned = allNames.some(n => lowerResponse.includes(n.toLowerCase()));
    
    if (mentioned) {
      await markPersonaPinged(persona.name);
    }
  }
}

async function markPersonaPinged(personaName: string): Promise<void> {
  const entity = await loadPersonaEntity(personaName);
  entity.lastInactivityPing = new Date().toISOString();
  await savePersonaEntity(entity, personaName);
}

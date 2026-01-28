import type { CeremonyConfig } from "../types.js";
import type { StateManager } from "../state-manager.js";

export function isNewDay(lastCeremony: string | undefined, now: Date): boolean {
  if (!lastCeremony) return true;
  
  const last = new Date(lastCeremony);
  return last.toDateString() !== now.toDateString();
}

export function isPastCeremonyTime(ceremonyTime: string, now: Date): boolean {
  const [hours, minutes] = ceremonyTime.split(":").map(Number);
  const ceremonyMinutes = hours * 60 + minutes;
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  return nowMinutes >= ceremonyMinutes;
}

export function shouldRunCeremony(config: CeremonyConfig, now: Date = new Date()): boolean {
  if (!config.enabled) return false;
  if (!isNewDay(config.last_ceremony, now)) return false;
  return isPastCeremonyTime(config.time, now);
}

export function startCeremony(state: StateManager): void {
  console.log("[ceremony] Starting ceremony...");
  
  const human = state.getHuman();
  const now = new Date();
  
  const personas = state.persona_getAll();
  const activePersonas = personas.filter(p => 
    !p.is_paused && 
    !p.is_archived && 
    !p.is_static
  );
  
  const eiIndex = activePersonas.findIndex(p => 
    (p.aliases?.[0] ?? "").toLowerCase() === "ei"
  );
  
  if (eiIndex > -1) {
    const ei = activePersonas.splice(eiIndex, 1)[0];
    activePersonas.push(ei);
  }
  
  const lastCeremony = human.ceremony_config?.last_ceremony 
    ? new Date(human.ceremony_config.last_ceremony).getTime() 
    : 0;
  
  const personasWithActivity = activePersonas.filter(p => {
    const lastActivity = p.last_activity ? new Date(p.last_activity).getTime() : 0;
    return lastActivity > lastCeremony;
  });
  
  console.log(`[ceremony] Processing ${personasWithActivity.length} personas with activity (of ${activePersonas.length} active)`);
  
  for (let i = 0; i < personasWithActivity.length; i++) {
    const persona = personasWithActivity[i];
    const personaName = persona.aliases?.[0] ?? "Unknown";
    const isLast = i === personasWithActivity.length - 1;
    
    console.log(`[ceremony] Queueing Exposure phase for ${personaName} (${i + 1}/${personasWithActivity.length})${isLast ? " (last)" : ""}`);
    queueExposurePhase(personaName, state);
  }
  
  state.setHuman({
    ...human,
    ceremony_config: {
      ...human.ceremony_config!,
      last_ceremony: now.toISOString(),
    },
  });
  
  console.log("[ceremony] Ceremony initiated, phases will execute via queue");
}

export function queueExposurePhase(personaName: string, _state: StateManager): void {
  console.log(`[ceremony:exposure] Queueing extraction scans for ${personaName}`);
}

export function queueDecayPhase(personaName: string, _state: StateManager): void {
  console.log(`[ceremony:decay] Queueing decay for ${personaName}`);
}

export function queueExpirePhase(personaName: string, _state: StateManager): void {
  console.log(`[ceremony:expire] Queueing expire for ${personaName}`);
}

export function queueExplorePhase(personaName: string, _state: StateManager): void {
  console.log(`[ceremony:explore] Queueing explore for ${personaName}`);
}

export function queueDescriptionCheck(personaName: string, _state: StateManager): void {
  console.log(`[ceremony:description] Queueing description check for ${personaName}`);
}

export function runHumanCeremony(_state: StateManager): void {
  console.log("[ceremony:human] Running Human ceremony (decay)...");
}

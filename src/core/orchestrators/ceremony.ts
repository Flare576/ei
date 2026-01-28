import { LLMRequestType, LLMPriority, LLMNextStep, type CeremonyConfig, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { applyDecayToValue } from "../utils/decay.js";
import {
  queueFactScan,
  queueTraitScan,
  queueTopicScan,
  queuePersonScan,
  type ExtractionContext,
} from "./human-extraction.js";
import { buildPersonaExpirePrompt, buildPersonaExplorePrompt, buildDescriptionCheckPrompt } from "../../prompts/ceremony/index.js";

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
  const startTime = Date.now();
  console.log(`[ceremony] Starting ceremony at ${new Date().toISOString()}`);
  
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
    
    console.log(`[ceremony] Processing ${personaName} (${i + 1}/${personasWithActivity.length})${isLast ? " (last)" : ""}`);
    queueExposurePhase(personaName, state);
  }
  
  runHumanCeremony(state);
  
  state.setHuman({
    ...human,
    ceremony_config: {
      ...human.ceremony_config!,
      last_ceremony: now.toISOString(),
    },
  });
  
  const duration = Date.now() - startTime;
  console.log(`[ceremony] Ceremony initiated in ${duration}ms, phases will execute via queue`);
}

export function queueExposurePhase(personaName: string, state: StateManager): void {
  console.log(`[ceremony:exposure] Starting for ${personaName}`);
  
  if (personaName.toLowerCase() === "ei") {
    const human = state.getHuman();
    const lastCeremony = human.ceremony_config?.last_ceremony;
    const messages = state.messages_get(personaName);
    
    const messagesSinceCeremony = lastCeremony 
      ? messages.filter(m => new Date(m.timestamp) > new Date(lastCeremony))
      : messages.slice(-20);
    
    if (messagesSinceCeremony.length > 0) {
      const context: ExtractionContext = {
        personaName,
        messages_context: messages.slice(0, -messagesSinceCeremony.length),
        messages_analyze: messagesSinceCeremony,
      };
      queueFactScan(context, state);
      queueTraitScan(context, state);
      queueTopicScan(context, state);
      queuePersonScan(context, state);
      console.log(`[ceremony:exposure] Queued human extraction scans for ${messagesSinceCeremony.length} messages`);
    }
  }
  
  applyDecayPhase(personaName, state);
}

function applyDecayPhase(personaName: string, state: StateManager): void {
  console.log(`[ceremony:decay] Applying decay for ${personaName}`);
  
  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[ceremony:decay] Persona not found: ${personaName}`);
    return;
  }
  
  if (persona.topics.length === 0) {
    console.log(`[ceremony:decay] ${personaName} has no topics, skipping decay`);
    queueExpirePhase(personaName, state);
    return;
  }
  
  const now = new Date();
  const human = state.getHuman();
  const K = human.ceremony_config?.decay_rate ?? 0.1;
  
  let decayedCount = 0;
  const updatedTopics = persona.topics.map(topic => {
    const result = applyDecayToValue(
      topic.exposure_current,
      topic.last_updated,
      now,
      K
    );
    
    if (Math.abs(result.newValue - topic.exposure_current) > 0.001) {
      decayedCount++;
    }
    
    return {
      ...topic,
      exposure_current: result.newValue,
      last_updated: now.toISOString(),
    };
  });
  
  state.persona_update(personaName, { 
    topics: updatedTopics,
    last_updated: now.toISOString(),
  });
  
  console.log(`[ceremony:decay] Applied decay to ${decayedCount}/${updatedTopics.length} topics for ${personaName}`);
  
  queueExpirePhase(personaName, state);
}

export function queueDecayPhase(personaName: string, state: StateManager): void {
  applyDecayPhase(personaName, state);
}

export function queueExpirePhase(personaName: string, state: StateManager): void {
  console.log(`[ceremony:expire] Queueing for ${personaName}`);
  
  const persona = state.persona_get(personaName);
  if (!persona || persona.topics.length === 0) {
    console.log(`[ceremony:expire] ${personaName} has no topics, skipping to description check`);
    queueDescriptionCheck(personaName, state);
    return;
  }
  
  const prompt = buildPersonaExpirePrompt({
    persona_name: personaName,
    topics: persona.topics,
  });
  
  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaExpire,
    data: { personaName },
  });
}

export function queueExplorePhase(personaName: string, state: StateManager): void {
  console.log(`[ceremony:explore] Queueing for ${personaName}`);
  
  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[ceremony:explore] Persona not found: ${personaName}`);
    queueDescriptionCheck(personaName, state);
    return;
  }
  
  const messages = state.messages_get(personaName);
  const recentMessages = messages.slice(-20);
  const themes = extractConversationThemes(recentMessages);
  
  const prompt = buildPersonaExplorePrompt({
    persona_name: personaName,
    traits: persona.traits,
    remaining_topics: persona.topics,
    recent_conversation_themes: themes,
  });
  
  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaExplore,
    data: { personaName },
  });
}

function extractConversationThemes(messages: { content: string; role: string }[]): string[] {
  const humanMessages = messages.filter(m => m.role === "human");
  if (humanMessages.length === 0) return [];
  
  const words = humanMessages
    .map(m => m.content.toLowerCase())
    .join(" ")
    .split(/\s+/)
    .filter(w => w.length > 4);
  
  const frequency: Record<string, number> = {};
  for (const word of words) {
    frequency[word] = (frequency[word] || 0) + 1;
  }
  
  return Object.entries(frequency)
    .filter(([_, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word]) => word);
}

export function queueDescriptionCheck(personaName: string, state: StateManager): void {
  console.log(`[ceremony:description] Queueing for ${personaName}`);
  
  const persona = state.persona_get(personaName);
  if (!persona) {
    console.error(`[ceremony:description] Persona not found: ${personaName}`);
    return;
  }
  
  const prompt = buildDescriptionCheckPrompt({
    persona_name: personaName,
    current_short_description: persona.short_description,
    current_long_description: persona.long_description,
    traits: persona.traits,
    topics: persona.topics,
  });
  
  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleDescriptionCheck,
    data: { personaName },
  });
}

export function runHumanCeremony(state: StateManager): void {
  console.log("[ceremony:human] Running Human ceremony (decay)...");
  
  const human = state.getHuman();
  const now = new Date();
  const K = human.ceremony_config?.decay_rate ?? 0.1;
  
  let topicDecayCount = 0;
  const updatedTopics: Topic[] = human.topics.map(topic => {
    const result = applyDecayToValue(
      topic.exposure_current,
      topic.last_updated,
      now,
      K
    );
    
    if (Math.abs(result.newValue - topic.exposure_current) > 0.001) {
      topicDecayCount++;
    }
    
    return {
      ...topic,
      exposure_current: result.newValue,
      last_updated: now.toISOString(),
    };
  });
  
  let personDecayCount = 0;
  const updatedPeople = human.people.map(person => {
    const result = applyDecayToValue(
      person.exposure_current,
      person.last_updated,
      now,
      K
    );
    
    if (Math.abs(result.newValue - person.exposure_current) > 0.001) {
      personDecayCount++;
    }
    
    return {
      ...person,
      exposure_current: result.newValue,
      last_updated: now.toISOString(),
    };
  });
  
  const lowExposureTopics = updatedTopics.filter(t => t.exposure_current < 0.2);
  const lowExposurePeople = updatedPeople.filter(p => p.exposure_current < 0.2);
  
  state.setHuman({
    ...human,
    topics: updatedTopics,
    people: updatedPeople,
  });
  
  console.log(`[ceremony:human] Decayed ${topicDecayCount} topics, ${personDecayCount} people`);
  if (lowExposureTopics.length > 0 || lowExposurePeople.length > 0) {
    console.log(`[ceremony:human] Low exposure items: ${lowExposureTopics.length} topics, ${lowExposurePeople.length} people`);
  }
}

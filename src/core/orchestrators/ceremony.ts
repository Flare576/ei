import { LLMRequestType, LLMPriority, LLMNextStep, type CeremonyConfig, type PersonaTopic, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { applyDecayToValue } from "../utils/decay.js";
import {
  queueFactScan,
  queueTraitScan,
  queueTopicScan,
  queuePersonScan,
  type ExtractionContext,
} from "./human-extraction.js";
import { queuePersonaTopicScan, type PersonaTopicContext } from "./persona-topics.js";
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

/**
 * Flare Note: if we wanted to run the ceremony every 24h _or_, say "1 hour after the user has 'gone idle' after using
 * the system", this is where you'd add that condition. Bear in mind that the prompts an flow were written for
 * 1-per-day, so you'll want to revist them carefully.
 */
export function shouldRunCeremony(config: CeremonyConfig, now: Date = new Date()): boolean {
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
  
  const lastCeremony = human.settings?.ceremony?.last_ceremony 
    ? new Date(human.settings.ceremony.last_ceremony).getTime() 
    : 0;
  
  const personasWithActivity = activePersonas.filter(p => {
    const lastActivity = p.last_activity ? new Date(p.last_activity).getTime() : 0;
    return lastActivity > lastCeremony;
  });
  
  console.log(`[ceremony] Processing ${personasWithActivity.length} personas with activity (of ${activePersonas.length} active)`);
  
  for (let i = 0; i < personasWithActivity.length; i++) {
    const persona = personasWithActivity[i];
    const isLast = i === personasWithActivity.length - 1;
    
    console.log(`[ceremony] Processing ${persona.display_name} (${i + 1}/${personasWithActivity.length})${isLast ? " (last)" : ""}`);
    queueExposurePhase(persona.id, state);
  }
  
  runHumanCeremony(state);
  
  state.setHuman({
    ...human,
    settings: {
      ...human.settings,
      ceremony: {
        ...human.settings?.ceremony,
        time: human.settings?.ceremony?.time ?? "09:00",
        last_ceremony: now.toISOString(),
      },
    },
  });
  
  const duration = Date.now() - startTime;
  console.log(`[ceremony] Ceremony initiated in ${duration}ms, phases will execute via queue`);
}

export function queueExposurePhase(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:exposure] Persona not found: ${personaId}`);
    return;
  }
  
  console.log(`[ceremony:exposure] Starting for ${persona.display_name}`);
  
  const allMessages = state.messages_get(personaId);
  
  const unextractedFacts = state.messages_getUnextracted(personaId, "f");
  if (unextractedFacts.length > 0) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.f === true),
      messages_analyze: unextractedFacts,
      extraction_flag: "f",
    };
    queueFactScan(context, state);
  }
  
  const unextractedTraits = state.messages_getUnextracted(personaId, "r");
  if (unextractedTraits.length > 0) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.r === true),
      messages_analyze: unextractedTraits,
      extraction_flag: "r",
    };
    queueTraitScan(context, state);
  }
  
  const unextractedTopics = state.messages_getUnextracted(personaId, "p");
  if (unextractedTopics.length > 0) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.p === true),
      messages_analyze: unextractedTopics,
      extraction_flag: "p",
    };
    queueTopicScan(context, state);
  }
  
  const unextractedPeople = state.messages_getUnextracted(personaId, "o");
  if (unextractedPeople.length > 0) {
    const context: ExtractionContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.o === true),
      messages_analyze: unextractedPeople,
      extraction_flag: "o",
    };
    queuePersonScan(context, state);
  }
  
  const totalUnextracted = unextractedFacts.length + unextractedTraits.length + unextractedTopics.length + unextractedPeople.length;
  if (totalUnextracted > 0) {
    console.log(`[ceremony:exposure] Queued human extraction scans (f:${unextractedFacts.length}, r:${unextractedTraits.length}, p:${unextractedTopics.length}, o:${unextractedPeople.length})`);
  }

  const unextractedForPersonaTopics = state.messages_getUnextracted(personaId, "p");
  if (unextractedForPersonaTopics.length > 0) {
    const personaTopicContext: PersonaTopicContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.p === true),
      messages_analyze: unextractedForPersonaTopics,
    };
    queuePersonaTopicScan(personaTopicContext, state);
    console.log(`[ceremony:exposure] Queued persona topic scan for ${persona.display_name}`);
  }
  
  applyDecayPhase(personaId, state);
}

function applyDecayPhase(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:decay] Persona not found: ${personaId}`);
    return;
  }
  
  console.log(`[ceremony:decay] Applying decay for ${persona.display_name}`);
  
  if (persona.topics.length === 0) {
    console.log(`[ceremony:decay] ${persona.display_name} has no topics, skipping decay`);
    queueExpirePhase(personaId, state);
    return;
  }
  
  const now = new Date();
  const human = state.getHuman();
  const K = human.settings?.ceremony?.decay_rate ?? 0.1;
  
  let decayedCount = 0;
  const updatedTopics = persona.topics.map((topic: PersonaTopic) => {
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
  
  state.persona_update(personaId, { 
    topics: updatedTopics,
    last_updated: now.toISOString(),
  });
  
  console.log(`[ceremony:decay] Applied decay to ${decayedCount}/${updatedTopics.length} topics for ${persona.display_name}`);
  
  queueExpirePhase(personaId, state);
}

export function queueDecayPhase(personaId: string, state: StateManager): void {
  applyDecayPhase(personaId, state);
}

export function queueExpirePhase(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:expire] Persona not found: ${personaId}`);
    return;
  }
  
  console.log(`[ceremony:expire] Queueing for ${persona.display_name}`);
  
  if (persona.topics.length === 0) {
    console.log(`[ceremony:expire] ${persona.display_name} has no topics, skipping to description check`);
    queueDescriptionCheck(personaId, state);
    return;
  }
  
  const prompt = buildPersonaExpirePrompt({
    persona_name: persona.display_name,
    topics: persona.topics,
  });
  
  state.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandlePersonaExpire,
    data: { personaId, personaDisplayName: persona.display_name },
  });
}

export function queueExplorePhase(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:explore] Persona not found: ${personaId}`);
    queueDescriptionCheck(personaId, state);
    return;
  }
  
  console.log(`[ceremony:explore] Queueing for ${persona.display_name}`);
  
  const messages = state.messages_get(personaId);
  const recentMessages = messages.slice(-20);
  const themes = extractConversationThemes(recentMessages);
  
  const prompt = buildPersonaExplorePrompt({
    persona_name: persona.display_name,
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
    data: { personaId, personaDisplayName: persona.display_name },
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

export function queueDescriptionCheck(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:description] Persona not found: ${personaId}`);
    return;
  }
  
  console.log(`[ceremony:description] Queueing for ${persona.display_name}`);
  
  const prompt = buildDescriptionCheckPrompt({
    persona_name: persona.display_name,
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
    data: { personaId, personaDisplayName: persona.display_name },
  });
}

export function runHumanCeremony(state: StateManager): void {
  console.log("[ceremony:human] Running Human ceremony (decay)...");
  
  const human = state.getHuman();
  const now = new Date();
  const K = human.settings?.ceremony?.decay_rate ?? 0.1;
  
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

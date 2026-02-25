import { LLMRequestType, LLMPriority, LLMNextStep, MESSAGE_MIN_COUNT, MESSAGE_MAX_AGE_DAYS, type CeremonyConfig, type PersonaTopic, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { applyDecayToValue } from "../utils/index.js";
import {
  queueFactScan,
  queueTraitScan,
  queueTopicScan,
  queuePersonScan,
  type ExtractionContext,
  type ExtractionOptions,
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
 * the system", this is where you'd add that condition. Bear in mind that the prompts and flow were written for
 * 1-per-day, so you'll want to revisit them carefully.
 */
export function shouldStartCeremony(config: CeremonyConfig, state: StateManager, now: Date = new Date()): boolean {
  if (!isNewDay(config.last_ceremony, now)) return false;
  if (!isPastCeremonyTime(config.time, now)) return false;
  // Don't start ceremony while import extraction or other queued work is pending.
  // Archive scan injects messages that need extraction — pruning before extraction
  // completes would lose knowledge.
  if (state.queue_length() > 0) return false;
  return true;
}

/**
 * Start the ceremony by queuing Exposure scans for all active personas with recent activity.
 * 
 * IMPORTANT: Sets last_ceremony FIRST to prevent re-triggering from the processor loop.
 * The actual Decay → Prune → Expire → Explore phases happen later via handleCeremonyProgress
 * once all exposure scans have completed.
 */
export function startCeremony(state: StateManager): void {
  const startTime = Date.now();
  console.log(`[ceremony] Starting ceremony at ${new Date().toISOString()}`);
  
  const human = state.getHuman();
  const now = new Date();
  
  // Set last_ceremony FIRST — this is our start gate.
  // Prevents the processor loop from re-triggering startCeremony.
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
  
  const personas = state.persona_getAll();
  const activePersonas = personas.filter(p => 
    !p.is_paused && 
    !p.is_archived && 
    !p.is_static
  );
  
  const lastCeremony = human.settings?.ceremony?.last_ceremony 
    ? new Date(human.settings.ceremony.last_ceremony).getTime() 
    : 0;
  
  const personasWithActivity = activePersonas.filter(p => {
    const lastActivity = p.last_activity ? new Date(p.last_activity).getTime() : 0;
    return lastActivity > lastCeremony;
  });
  
  console.log(`[ceremony] Processing ${personasWithActivity.length} personas with activity (of ${activePersonas.length} active)`);
  
  const options: ExtractionOptions = { ceremony_progress: true };
  
  for (let i = 0; i < personasWithActivity.length; i++) {
    const persona = personasWithActivity[i];
    const isLast = i === personasWithActivity.length - 1;
    
    console.log(`[ceremony] Queuing exposure for ${persona.display_name} (${i + 1}/${personasWithActivity.length})${isLast ? " (last)" : ""}`);
    queueExposurePhase(persona.id, state, options);
  }
  
  const duration = Date.now() - startTime;
  console.log(`[ceremony] Exposure phase queued in ${duration}ms`);
  
  // Check immediately — if zero messages were queued (no unextracted messages for any persona),
  // this will see an empty queue and proceed directly to Decay → Expire.
  handleCeremonyProgress(state);
}

/**
 * Queue all extraction scans for a persona's unextracted messages.
 * Called during ceremony with ceremony_progress option to flag queue items.
 */
function queueExposurePhase(personaId: string, state: StateManager, options?: ExtractionOptions): void {
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
    queueFactScan(context, state, options);
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
    queueTraitScan(context, state, options);
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
    queueTopicScan(context, state, options);
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
    queuePersonScan(context, state, options);
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
}

/**
 * Called after every LLM response that had ceremony_progress in its data,
 * AND at the end of startCeremony (for the zero-messages edge case).
 * 
 * If any ceremony_progress items remain in the queue, does nothing — more work pending.
 * If the queue is clear of ceremony items, advances to Decay → Prune → Expire.
 */
export function handleCeremonyProgress(state: StateManager): void {
  if (state.queue_hasPendingCeremonies()) {
    return; // Still processing exposure scans
  }
  
  console.log("[ceremony:progress] All exposure scans complete, advancing to Decay");
  
  const personas = state.persona_getAll();
  const activePersonas = personas.filter(p => 
    !p.is_paused && 
    !p.is_archived && 
    !p.is_static
  );
  
  const eiIndex = activePersonas.findIndex(p => 
    (p.aliases?.[0] ?? "").toLowerCase() === "ei"
  );
  
  // Ei's topics don't change
  if (eiIndex > -1) {
    activePersonas.splice(eiIndex, 1);
  }
  
  // Decay phase: apply decay + prune for ALL active personas
  for (const persona of activePersonas) {
    applyDecayPhase(persona.id, state);
    prunePersonaMessages(persona.id, state);
  }
  
  // Human ceremony: decay topics + people
  runHumanCeremony(state);
  
  // Expire phase: queue LLM calls for each active persona
  // handlePersonaExpire already chains to Explore → DescriptionCheck
  for (const persona of activePersonas) {
    queueExpirePhase(persona.id, state);
  }
  
  console.log("[ceremony:progress] Ceremony Decay complete, Expire queued");
}

// =============================================================================
// DECAY PHASE (synchronous)
// =============================================================================

function applyDecayPhase(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) {
    console.error(`[ceremony:decay] Persona not found: ${personaId}`);
    return;
  }
  
  if (persona.topics.length === 0) {
    console.log(`[ceremony:decay] ${persona.display_name} has no topics, skipping decay`);
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
}

// =============================================================================
// PRUNE PHASE (synchronous, runs as part of Decay)
// =============================================================================

export function prunePersonaMessages(personaId: string, state: StateManager): void {
  // Sort first — injected messages (session update, archive scan) may be out of order.
  state.messages_sort(personaId);
  const messages = state.messages_get(personaId);
  if (messages.length <= MESSAGE_MIN_COUNT) return;
  
  const cutoffMs = Date.now() - (MESSAGE_MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  
  // Messages are sorted by timestamp (oldest first from messages_sort)
  const toRemove: string[] = [];
  for (const m of messages) {
    if (messages.length - toRemove.length <= MESSAGE_MIN_COUNT) break;
    
    const msgMs = new Date(m.timestamp).getTime();
    if (msgMs >= cutoffMs) break; // Sorted by time, no more old ones
    
    const fullyExtracted = m.p && m.r && m.o && m.f;
    if (fullyExtracted) {
      toRemove.push(m.id);
    }
  }
  
  if (toRemove.length > 0) {
    state.messages_remove(personaId, toRemove);
    const persona = state.persona_getById(personaId);
    console.log(`[ceremony:prune] Removed ${toRemove.length} old messages from ${persona?.display_name ?? personaId}`);
  }
}

// =============================================================================
// EXPIRE PHASE (queues LLM calls)
// =============================================================================

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

// =============================================================================
// EXPLORE PHASE (queues LLM calls — chained from handlePersonaExpire in handlers)
// =============================================================================

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

// =============================================================================
// HUMAN CEREMONY (synchronous — runs during Decay phase)
// =============================================================================

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

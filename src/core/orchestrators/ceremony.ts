import { LLMRequestType, LLMPriority, LLMNextStep, RoomMode, ContextStatus, type CeremonyConfig, type PersonaTopic, type Topic } from "../types.js";
import type { StateManager } from "../state-manager.js";
import { normalizeRoomMessages } from "../handlers/utils.js";
import { applyDecayToValue } from "../utils/index.js";
import {
  queueFactFind,
  queueTopicScan,
  queuePersonScan,
  queueEventSummary,
  type ExtractionContext,
  type ExtractionOptions,
} from "./human-extraction.js";
import { queuePersonaTopicRating, type PersonaTopicContext, type PersonaTopicOptions } from "./persona-topics.js";
import { getRoomVisibleMessages, queueRoomHumanExtraction } from "./room-extraction.js";
import { type RewriteItemType } from "../../prompts/ceremony/index.js";
import { buildPersonRewriteScanPrompt } from "../../prompts/ceremony/people-rewrite.js";
import { buildTopicRewriteScanPrompt } from "../../prompts/ceremony/topic-rewrite.js";
import { buildReflectionCriticPrompt } from "../../prompts/reflection/index.js";
import { getModelForPersona } from "../heartbeat-manager.js";

const PERSON_LOG_REFLECTION_THRESHOLD = 3000;

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
 * The actual Decay → Person Rewrite → Topic Rewrite phases happen later via handleCeremonyProgress
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
  
  // Check if migration work was queued
  if (!state.queue_hasPendingCeremonies()) {
    // No migration work found → immediately advance to Expose phase
    console.log("[ceremony] No migration work, advancing to Expose phase");
    handleCeremonyProgress(state, 1);
  }
  
  const duration = Date.now() - startTime;
  console.log(`[ceremony] Dedup phase queued in ${duration}ms`);
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
      channelDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.f === true),
      messages_analyze: unextractedFacts,
      extraction_flag: "f",
    };
    queueFactFind(context, state, options);
  }
  
  
  const unextractedTopics = state.messages_getUnextracted(personaId, "t");
  if (unextractedTopics.length > 0) {
    const context: ExtractionContext = {
      personaId,
      channelDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.t === true),
      messages_analyze: unextractedTopics,
      extraction_flag: "t",
    };
    queueTopicScan(context, state, options);
  }
  
  const unextractedPeople = state.messages_getUnextracted(personaId, "p");
  if (unextractedPeople.length > 0) {
    const context: ExtractionContext = {
      personaId,
      channelDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => m.p === true),
      messages_analyze: unextractedPeople,
      extraction_flag: "p",
    };
    const personScanOptions = persona.pending_update
      ? { ...options, reflection_progress: 1 }
      : options;
    queuePersonScan(context, state, personScanOptions);
  }
  
  const totalUnextracted = unextractedFacts.length + unextractedTopics.length + unextractedPeople.length;
  if (totalUnextracted > 0) {
    console.log(`[ceremony:exposure] Queued human extraction scans (f:${unextractedFacts.length}, t:${unextractedTopics.length}, p:${unextractedPeople.length})`);
  }

  const shortId = personaId.slice(0, 8);
  const forPersonaTopics = state.messages_getUnextractedForPersona(personaId, shortId);
  if (forPersonaTopics.length > 0) {
    const personaTopicContext: PersonaTopicContext = {
      personaId,
      personaDisplayName: persona.display_name,
      messages_context: allMessages.filter(m => !!m.persona_extracted?.[shortId]),
      messages_analyze: forPersonaTopics,
      topics: persona.topics,
    };
    const personaTopicOptions: PersonaTopicOptions = { ceremony_progress: options?.ceremony_progress };
    queuePersonaTopicRating(personaTopicContext, state, personaTopicOptions);
    console.log(`[ceremony:exposure] Queued persona topic rating for ${persona.display_name} (${forPersonaTopics.length} messages)`);
  }
}

/**
 * Called after every LLM response that had ceremony_progress in its data,
 * AND at the end of startCeremony (for the zero-messages edge case).
 * 
 * If any ceremony_progress items remain in the queue, does nothing — more work pending.
 * Phase 1: Dedup → Phase 2: Expose → Phase 3: EventSummary → Decay → Phase 4: Person Rewrite → Topic Rewrite (fire-and-forget)
 */
export function handleCeremonyProgress(state: StateManager, lastPhase: number): void {
  if (state.queue_hasPendingCeremonies()) {
    return; // Still processing ceremony items
  }
  
  if (lastPhase === 1) {
    // Dedup phase complete → start Expose phase
    console.log("[ceremony:progress] Dedup complete, starting Expose phase");
    
    const personas = state.persona_getAll();
    const activePersonas = personas.filter(p => 
      !p.is_paused && 
      !p.is_archived && 
      !p.is_static
    );
    
    // Find personas with unprocessed messages (any message with p/r/o/f = false)
    const personasWithUnprocessed = activePersonas.filter(p => {
      const messages = state.messages_get(p.id);
      return messages.some(msg => 
        !msg.t || 
        !msg.p || 
        !msg.f
      );
    });
    
    console.log(`[ceremony:expose] Found ${activePersonas.length} active personas, ${personasWithUnprocessed.length} with unprocessed messages`);
    
    const options: ExtractionOptions = { ceremony_progress: 2 };
    for (const persona of personasWithUnprocessed) {
      queueExposurePhase(persona.id, state, options);
    }

    const rooms = state.getRoomList();
    for (const room of rooms) {
      if (room.mode === RoomMode.ChooseYourPath) continue;

      // Human extraction (t/p) — straggler scan for messages that never hit the
      // per-send threshold in checkAndQueueRoomExtraction
      queueRoomHumanExtraction(state, room.id, 2);

      // Persona topic rating — uses getRoomVisibleMessages so FFA rooms get all
      // messages, not just the active path chain
      const allRoomMessages = getRoomVisibleMessages(state, room.id);
      for (const personaId of room.persona_ids) {
        const shortId = personaId.slice(0, 8);
        const unprocessedRaw = state.getRoomUnextractedMessagesForPersona(room.id, shortId);
        if (unprocessedRaw.length === 0) continue;
        const personaForRoom = state.persona_getById(personaId);
        if (!personaForRoom) continue;
        const processedIds = new Set(allRoomMessages.filter(m => !!m.persona_extracted?.[shortId]).map(m => m.id));
        const unprocessedNormalized = normalizeRoomMessages(unprocessedRaw, state);
        const personaTopicContext: PersonaTopicContext = {
          personaId,
          personaDisplayName: personaForRoom.display_name,
          messages_context: allRoomMessages.filter(m => processedIds.has(m.id)),
          messages_analyze: unprocessedNormalized,
          topics: personaForRoom.topics,
        };
        const roomScanOptions: PersonaTopicOptions = { ceremony_progress: 2, roomId: room.id };
        queuePersonaTopicRating(personaTopicContext, state, roomScanOptions);
        console.log(`[ceremony:expose] Queued room persona topic rating: ${personaForRoom.display_name} in "${room.display_name}" (${unprocessedRaw.length} messages)`);
      }
    }
    return;
  }

  if (lastPhase === 4) {
    console.log("[ceremony:progress] Person Rewrite complete, starting Topic Rewrite");
    queueTopicRewritePhase(state);
    return;
  }

  if (lastPhase === 2) {
    console.log("[ceremony:progress] Expose complete, starting EventSummary phase");
    const options: ExtractionOptions = { ceremony_progress: 3 };
    queueEventSummaryForAll(state, options);

    // Zero-work guard: same pattern as DeDupe phase
    if (!state.queue_hasPendingCeremonies()) {
      console.log("[ceremony:progress] No event summary work, advancing to Decay");
      handleCeremonyProgress(state, 3);
    }
    return;
  }
  
  // Phase 3 (EventSummary) complete → advance to Decay/Prune then Person Rewrite (phase 4)
  console.log("[ceremony:progress] EventSummary complete, advancing to Decay");
  
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

  // Person Rewrite phase (phase 4): scan bloated Person records, extract Topics from them.
  // Gated via ceremony_progress so Topic Rewrite can run after — Topics created here
  // need to be visible before Topic Rewrite snapshots the threshold.
  queuePersonRewritePhase(state);

  // Zero-work guard: if no person rewrites queued, advance to topic rewrite immediately
  if (!state.queue_hasPendingCeremonies()) {
    console.log("[ceremony:progress] No person rewrite work, advancing to Topic Rewrite");
    handleCeremonyProgress(state, 4);
  }

  // Reflection phase: fire-and-forget critic calls for persona person records above threshold
  queueReflectionPhase(state);

  console.log("[ceremony:progress] Ceremony Decay complete");
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
  const human = state.getHuman();
  const minCount = human.settings?.message_min_count ?? 200;
  const maxAgeDays = human.settings?.message_max_age_days ?? 14;
  if (messages.length <= minCount) return;
  
  const cutoffMs = Date.now() - (maxAgeDays * 24 * 60 * 60 * 1000);
  
  // Messages are sorted by timestamp (oldest first from messages_sort)
  const toRemove: string[] = [];
  for (const m of messages) {
    if (messages.length - toRemove.length <= minCount) break;
    
    const msgMs = new Date(m.timestamp).getTime();
    if (msgMs >= cutoffMs) break; // Sorted by time, no more old ones
    
    const fullyExtracted = m.t && m.p && m.f; // r intentionally excluded — trait extraction deprecated
    if (fullyExtracted && m.context_status !== ContextStatus.Always) {
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

// =============================================================================
// REWRITE PHASE (fire-and-forget — queues Low-priority Phase 1 scans)
// =============================================================================

const REWRITE_DESCRIPTION_THRESHOLD = 750;

/**
 * Forces an unconditional, threshold-bypassing Person scan on Apply/Dismiss.
 * Cannot be replaced by checkAndQueueHumanExtraction — that function gates on
 * MIN(10, people_count) and would silently skip messages if the threshold isn't
 * met, leaving reflection-era noise unprocessed and ungated.
 */
export function queueReflectionDrain(personaId: string, state: StateManager): void {
  const persona = state.persona_getById(personaId);
  if (!persona) return;

  const allMessages = state.messages_get(personaId);
  const unextractedPeople = state.messages_getUnextracted(personaId, "p");

  if (unextractedPeople.length === 0) {
    console.log(`[reflection:drain] No unextracted messages for ${persona.display_name} — drain complete`);
    return;
  }

  const context: ExtractionContext = {
    personaId,
    channelDisplayName: persona.display_name,
    messages_context: allMessages.filter(m => m.p === true),
    messages_analyze: unextractedPeople,
    extraction_flag: "p",
  };
  queuePersonScan(context, state, { reflection_progress: 1 });
  console.log(`[reflection:drain] Queued Person scan for ${persona.display_name} (${unextractedPeople.length} messages) — clears on completion`);
}

function getRewriteModel(state: StateManager): string | undefined {
  return state.getHuman().settings?.rewrite_model;
}

export function queuePersonRewritePhase(state: StateManager): void {
  const rewriteModel = getRewriteModel(state);
  if (!rewriteModel) {
    console.log("[ceremony:rewrite] rewrite_model not set — skipping person rewrite phase");
    return;
  }

  const human = state.getHuman();
  const personsToScan = human.people.filter(person => {
    const isPersonaLinked = (person.identifiers ?? []).some(
      i => i.type.toLowerCase() === 'ei persona'
    );
    return !isPersonaLinked
      && (person.description?.length ?? 0) > REWRITE_DESCRIPTION_THRESHOLD
      && !person.rewrite_checked;
  });

  if (personsToScan.length === 0) {
    console.log("[ceremony:rewrite] No persons above threshold — skipping person rewrite phase");
    return;
  }

  console.log(`[ceremony:rewrite] Found ${personsToScan.length} person(s) above ${REWRITE_DESCRIPTION_THRESHOLD} chars — queueing person rewrite scans`);

  for (const person of personsToScan) {
    const prompt = buildPersonRewriteScanPrompt({ item: person, itemType: "person" });
    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleRewriteScan,
      model: rewriteModel,
      data: {
        itemId: person.id,
        itemType: "person" as RewriteItemType,
        rewriteModel,
        ceremony_progress: 4,
      },
    });
  }

  console.log(`[ceremony:rewrite] Queued ${personsToScan.length} person rewrite scan(s)`);
}

export function queueTopicRewritePhase(state: StateManager): void {
  const rewriteModel = getRewriteModel(state);
  if (!rewriteModel) {
    console.log("[ceremony:rewrite] rewrite_model not set — skipping topic rewrite phase");
    return;
  }

  const human = state.getHuman();
  const topicsToScan = human.topics.filter(topic =>
    (topic.description?.length ?? 0) > REWRITE_DESCRIPTION_THRESHOLD
    && !topic.rewrite_checked
  );

  if (topicsToScan.length === 0) {
    console.log("[ceremony:rewrite] No topics above threshold — skipping topic rewrite phase");
    return;
  }

  console.log(`[ceremony:rewrite] Found ${topicsToScan.length} topic(s) above ${REWRITE_DESCRIPTION_THRESHOLD} chars — queueing topic rewrite scans`);

  for (const topic of topicsToScan) {
    const prompt = buildTopicRewriteScanPrompt({ item: topic, itemType: "topic" });
    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleRewriteScan,
      model: rewriteModel,
      data: {
        itemId: topic.id,
        itemType: "topic" as RewriteItemType,
        rewriteModel,
      },
    });
  }

  console.log(`[ceremony:rewrite] Queued ${topicsToScan.length} topic rewrite scan(s)`);
}

function queueEventSummaryForAll(state: StateManager, options?: ExtractionOptions): void {
  const personas = state.persona_getAll();
  const activePersonas = personas.filter(p =>
    !p.is_paused &&
    !p.is_archived &&
    !p.is_static
  );

  let totalQueued = 0;
  for (const persona of activePersonas) {
    totalQueued += queueEventSummary(persona.id, state, options);
  }
  console.log(`[ceremony:event] Queued event summary scans for ${activePersonas.length} personas (${totalQueued} total chunks)`);
}

function queueReflectionPhase(state: StateManager): void {
  const personas = state.persona_getAll().filter(p =>
    !p.is_paused && !p.is_archived && !p.is_static && p.id !== "ei"
  );

  let queued = 0;
  for (const persona of personas) {
    const personRecord = state.human_person_getByIdentifier("Ei Persona", persona.id);
    if (!personRecord || (personRecord.description?.length ?? 0) <= PERSON_LOG_REFLECTION_THRESHOLD) continue;

    const prompt = buildReflectionCriticPrompt({
      persona_identity: {
        name: persona.display_name,
        long_description: persona.long_description ?? '',
        short_description: persona.short_description ?? '',
        traits: persona.traits,
        topics: persona.topics,
      },
      person_log: personRecord.description ?? '',
    });

    state.queue_enqueue({
      type: LLMRequestType.JSON,
      priority: LLMPriority.Low,
      system: prompt.system,
      user: prompt.user,
      next_step: LLMNextStep.HandleReflectionCritic,
      model: getModelForPersona(state, persona.id),
      data: { personaId: persona.id, personaDisplayName: persona.display_name },
    });

    queued++;
    console.log(`[ceremony:reflection] Queued critic for ${persona.display_name} (person log: ${personRecord.description?.length} chars)`);
  }

  if (queued === 0) {
    console.log("[ceremony:reflection] No persona person records above threshold — skipping");
  }
}

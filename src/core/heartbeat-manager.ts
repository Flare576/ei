import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  type HumanEntity,
  type Message,
} from "./types.js";
import { StateManager } from "./state-manager.js";
import { getMessageContent } from "./handlers/utils.js";
import {
  buildHeartbeatCheckPrompt,
  buildEiHeartbeatPrompt,
  type HeartbeatCheckPromptData,
  type EiHeartbeatPromptData,
  type EiHeartbeatItem,
} from "../prompts/index.js";
import { filterMessagesForContext } from "./context-utils.js";
import { filterHumanDataByVisibility } from "./prompt-context-builder.js";

// =============================================================================
// MODEL HELPERS
// =============================================================================

export function getModelForPersona(sm: StateManager, personaId?: string): string | undefined {
  const human = sm.getHuman();
  if (personaId) {
    const persona = sm.persona_getById(personaId);
    return persona?.model || human.settings?.default_model;
  }
  return human.settings?.default_model;
}

export function getOneshotModel(sm: StateManager): string | undefined {
  const human = sm.getHuman();
  return human.settings?.oneshot_model || human.settings?.default_model;
}

// =============================================================================
// TRAILING MESSAGE COUNT (heartbeat spam prevention)
// =============================================================================

export function countTrailingPersonaMessages(history: Message[]): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const msg = history[i];
    if (msg.role === "human") break;
    if (msg.role === "system" && getMessageContent(msg) && msg.silence_reason === undefined) {
      count++;
    }
  }
  return count;
}

// =============================================================================
// EI HEARTBEAT
// =============================================================================

export async function queueEiHeartbeat(
  sm: StateManager,
  human: HumanEntity,
  history: Message[],
  isTUI: boolean
): Promise<void> {
  const now = Date.now();
  const engagementGapThreshold = 0.2;
  const cooldownMs = 7 * 24 * 60 * 60 * 1000;
  const personas = sm.persona_getAll();
  const items: EiHeartbeatItem[] = [];

  const unverifiedFacts = human.facts
    .filter(
      (f) =>
        f.description !== '' &&
        f.validated_date === ''
    )
    .slice(0, 5);
  for (const fact of unverifiedFacts) {
    const quote = human.quotes.find((q) => q.data_item_ids.includes(fact.id));
    items.push({
      id: fact.id,
      type: "Fact Check",
      name: fact.name,
      description: fact.description,
      quote: quote?.text,
    });
  }

  const newPeople = human.people
    .filter(p => !p.validated_date)
    .slice(0, 3);
  for (const person of newPeople) {
    const quote = human.quotes.find((q) => q.data_item_ids.includes(person.id));
    items.push({
      id: person.id,
      type: "New Person",
      name: person.name,
      description: person.description ?? '',
      quote: quote?.text,
    });
  }

  const underEngagedPeople = human.people
    .filter(
      (p) =>
        p.exposure_desired - p.exposure_current > engagementGapThreshold &&
        (!p.last_ei_asked || now - new Date(p.last_ei_asked).getTime() > cooldownMs)
    )
    .sort((a, b) => b.exposure_desired - b.exposure_current - (a.exposure_desired - a.exposure_current))
    .slice(0, 5);
  for (const person of underEngagedPeople) {
    const gap = Math.round((person.exposure_desired - person.exposure_current) * 100);
    const quote = human.quotes.find((q) => q.data_item_ids.includes(person.id));
    items.push({
      id: person.id,
      type: "Low-Engagement Person",
      engagement_delta: `${gap}%`,
      relationship: person.relationship,
      name: person.name,
      description: person.description,
      quote: quote?.text,
    });
  }

  const underEngagedTopics = human.topics
    .filter(
      (t) =>
        t.exposure_desired - t.exposure_current > engagementGapThreshold &&
        (!t.last_ei_asked || now - new Date(t.last_ei_asked).getTime() > cooldownMs)
    )
    .sort((a, b) => b.exposure_desired - b.exposure_current - (a.exposure_desired - a.exposure_current))
    .slice(0, 5);
  for (const topic of underEngagedTopics) {
    const gap = Math.round((topic.exposure_desired - topic.exposure_current) * 100);
    const quote = human.quotes.find((q) => q.data_item_ids.includes(topic.id));
    items.push({
      id: topic.id,
      type: "Low-Engagement Topic",
      engagement_delta: `${gap}%`,
      name: topic.name,
      description: topic.description,
      quote: quote?.text,
    });
  }

  const activePersonas = personas
    .filter((p) => !p.is_archived && !p.is_paused && !p.is_static && p.id !== "ei")
    .map((p) => {
      const msgs = sm.messages_get(p.id);
      const lastHuman = [...msgs].reverse().find((m) => m.role === "human");
      const lastTs = lastHuman?.timestamp ? new Date(lastHuman.timestamp).getTime() : 0;
      return { persona: p, lastHumanTs: lastTs };
    })
    .filter(({ lastHumanTs }) => {
      const daysSince = (now - lastHumanTs) / (1000 * 60 * 60 * 24);
      return daysSince >= 3;
    })
    .sort((a, b) => a.lastHumanTs - b.lastHumanTs)
    .slice(0, 3);
  for (const { persona: p, lastHumanTs } of activePersonas) {
    const daysSince =
      lastHumanTs > 0 ? Math.floor((now - lastHumanTs) / (1000 * 60 * 60 * 24)) : 999;
    items.push({
      id: p.id,
      type: "Inactive Persona",
      name: p.display_name,
      short_description: p.short_description,
      days_inactive: daysSince,
    });
  }

  const personasWithPendingUpdate = personas.filter(
    (p) => !p.is_archived && !p.is_paused && !p.is_static && p.id !== "ei" && p.pending_update?.critique
  );
  for (const p of personasWithPendingUpdate) {
    items.push({
      id: p.id,
      type: "Persona Reflection Alert",
      persona_name: p.display_name,
      critique: p.pending_update!.critique,
    });
  }

  if (items.length === 0) {
    console.log("[queueEiHeartbeat] No items to address, skipping");
    return;
  }

  const recentHistory = history.slice(-10);
  const promptData: EiHeartbeatPromptData = {
    items,
    recent_history: recentHistory,
    system_messages: recentHistory.filter(m => m.role === "system"),
  };

  const prompt = buildEiHeartbeatPrompt(promptData);

  sm.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleEiHeartbeat,
    model: getModelForPersona(sm, "ei"),
    data: { personaId: "ei", isTUI, newPersonIds: newPeople.map(p => p.id) },
  });
}

// =============================================================================
// HEARTBEAT CHECK
// =============================================================================

export async function queueHeartbeatCheck(sm: StateManager, personaId: string, isTUI: boolean): Promise<void> {
  const persona = sm.persona_getById(personaId);
  if (!persona) return;
  sm.persona_update(personaId, { last_heartbeat: new Date().toISOString() });
  const model = getModelForPersona(sm, personaId);
  console.log(`[HeartbeatCheck ${persona.display_name}] Queueing heartbeat check (model: ${model})`);
  const human = sm.getHuman();
   const history = sm.messages_get(personaId);
   const contextWindowMs = persona.context_window_ms ?? human.settings?.default_context_window_ms ?? 28800000;
   const contextHistory = filterMessagesForContext(history, persona.context_boundary, contextWindowMs);

  if (personaId === "ei") {
    await queueEiHeartbeat(sm, human, contextHistory, isTUI);
    return;
  }

  const filteredHuman = await filterHumanDataByVisibility(human, persona, []);
  const lastActivity = sm.messages_getLastActivity(persona.id);
  const inactiveDays = lastActivity
    ? Math.floor((Date.now() - lastActivity) / (1000 * 60 * 60 * 24))
    : 0;

  const sortByEngagementGap = <T extends { exposure_desired: number; exposure_current: number }>(
    items: T[]
  ): T[] =>
    [...items].sort(
      (a, b) =>
        b.exposure_desired - b.exposure_current - (a.exposure_desired - a.exposure_current)
    );

  const promptData: HeartbeatCheckPromptData = {
    persona: {
      name: persona.display_name,
      traits: persona.traits,
      topics: persona.topics,
      pending_update: persona.pending_update,
    },
    human: {
      topics: sortByEngagementGap(filteredHuman.topics).slice(0, 5),
      people: sortByEngagementGap(filteredHuman.people).slice(0, 5),
    },
    recent_history: contextHistory.slice(-10),
    inactive_days: inactiveDays,
  };

  const prompt = buildHeartbeatCheckPrompt(promptData);
  console.log(`[HeartbeatCheck ${persona.display_name}] Prompt data - topics: ${promptData.human.topics.length}, people: ${promptData.human.people.length}, inactive_days: ${inactiveDays}`);

  sm.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleHeartbeatCheck,
    model: getModelForPersona(sm, personaId),
    data: { personaId, personaDisplayName: persona.display_name },
  });
  console.log(`[HeartbeatCheck ${persona.display_name}] Request queued`);
}

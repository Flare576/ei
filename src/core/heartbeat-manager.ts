import {
  LLMRequestType,
  LLMPriority,
  LLMNextStep,
  ContextStatus,
  type HumanEntity,
  type Message,
  type EmergentSignal,
} from "./types.js";
import { StateManager } from "./state-manager.js";
import { PROMOTION_INDEPENDENCE_THRESHOLD } from "./state/index.js";
import { getMessageContent } from "./handlers/utils.js";
import {
  buildHeartbeatCheckPrompt,
  buildEiHeartbeatPrompt,
  type HeartbeatCheckPromptData,
  type EiHeartbeatPromptData,
  type EiHeartbeatItem,
  type TemporalAnchor,
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
    return persona?.model || human.settings?.conversation_model;
  }
  return human.settings?.conversation_model;
}

export function getOneshotModel(sm: StateManager): string | undefined {
  const human = sm.getHuman();
  return human.settings?.oneshot_model || human.settings?.conversation_model;
}

// =============================================================================
// TEMPORAL ANCHOR HELPERS
// =============================================================================

function buildTemporalAnchorsFromHistory(
  history: Message[],
  contextWindowMs: number,
  contextBoundary: string | undefined
): { temporalAnchors: TemporalAnchor[]; prunedHistory: Message[] } {
  const windowStartMs = Date.now() - contextWindowMs;
  const contextBoundaryMs = contextBoundary ? new Date(contextBoundary).getTime() : 0;

  const temporalAnchors: TemporalAnchor[] = [];
  const prunedHistory: Message[] = [];

  for (const m of history) {
    if (
      m.context_status === ContextStatus.Always &&
      (new Date(m.timestamp).getTime() < windowStartMs ||
        (contextBoundaryMs > 0 && new Date(m.timestamp).getTime() < contextBoundaryMs))
    ) {
      temporalAnchors.push({
        id: m.id,
        role: m.role === "human" ? "human" : "system",
        content: m.content,
        silence_reason: m.silence_reason,
        timestamp: m.timestamp,
        _synthesis: m._synthesis,
      });
    } else {
      prunedHistory.push(m);
    }
  }

  return { temporalAnchors, prunedHistory };
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
// SIGNAL CANDIDATE ASSEMBLY (Bolt 005, D4)
// =============================================================================

/**
 * Assembles `personaId`'s heartbeat-eligible signal candidate list (D2/D4):
 * reads every `candidate`-status `EmergentSignal` with `recurrence_count >= 2`
 * across both lenses (persona + agent — Spec §4.9 draws no lens distinction
 * for surfacing) — the gentle-surface floor that excludes a raw
 * one-observation candidate (D6/R4) — excludes any
 * whose resurfacing cooldown hasn't cleared, then stamps `last_surfaced_at`
 * on every signal it returns. Assembling the candidate list IS the surfacing
 * event — the stamp lands whether or not the caller's model reply ends up
 * naming the signal, since the freeform `should_respond`/`topic`/`message`
 * result has no field naming which shown item was picked.
 *
 * Gentle-surface band ceiling: derived explicitly from
 * `PROMOTION_INDEPENDENCE_THRESHOLD[dimension]` — the SAME table Bolt 004's
 * promotion arithmetic uses — rather than trusting the invariant that a
 * `candidate`-status signal's `recurrence_count` is already below its own
 * dimension's threshold (true today, since `promoteIfEligible` flips
 * `status` to `recurring` the instant that threshold is reached, but this
 * function checks it directly instead of depending on that invariant
 * holding forever). For a threshold-2 dimension (`behavior`/`voice`) the
 * band is empty by construction — no `recurrence_count` value is both
 * above the raw-single-observation floor and below a threshold of 2 — so
 * those dimensions never gentle-surface, which is correct, not a gap. A
 * future change to any dimension's threshold widens or narrows the gentle
 * band automatically, with no second number to keep in sync.
 *
 * Cooldown: a signal whose `last_surfaced_at` is unset is always eligible
 * (never yet surfaced); one whose `last_surfaced_at` IS set is eligible
 * again only once `last_observed_at` has moved past it — new corroborating
 * evidence arrived since the last surfacing (D2/R2).
 *
 * A standalone, exported function — never inlined into `queueHeartbeatCheck`
 * — so the analogous Ei-heartbeat candidate producer can call this exact
 * eligibility/cooldown/stamp policy from `queueEiHeartbeat` instead of
 * re-deriving it (D4) — enforced by `queueEiHeartbeat`'s own test coverage
 * below, not by a second implementation.
 */
export function assembleHeartbeatSignalCandidates(sm: StateManager, personaId: string): EmergentSignal[] {
  const { persona, agent } = sm.signals_get(personaId);
  const now = new Date().toISOString();
  const eligible = [...persona, ...agent].filter(
    (signal) =>
      signal.status === "candidate" &&
      signal.recurrence_count >= 2 &&
      signal.recurrence_count < PROMOTION_INDEPENDENCE_THRESHOLD[signal.dimension] &&
      (!signal.last_surfaced_at || signal.last_observed_at > signal.last_surfaced_at)
  );
  for (const signal of eligible) {
    sm.signal_stampSurfaced(personaId, signal.id, now);
    signal.last_surfaced_at = now;
  }
  return eligible;
}

// =============================================================================
// EI HEARTBEAT
// =============================================================================

export async function queueEiHeartbeat(
  sm: StateManager,
  human: HumanEntity,
  history: Message[],
  isTUI: boolean,
  temporalAnchors: TemporalAnchor[] = []
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

  // bolt-persona-emergence-signals-011, D1/D3: the missing producer for
  // Bolt 006's crossFind/handleEiHeartbeat signal-choice consumer. Calls
  // Bolt 005's own shared assembly function once per persona -- the exact
  // eligibility/cooldown/stamp policy `queueHeartbeatCheck` uses for that
  // persona's own heartbeat, never a second Ei-only reimplementation
  // (R4/AT4). Stamping is a side effect of the call itself, so whichever
  // surface (Ei's or the subject persona's own heartbeat) assembles first
  // in a cycle stamps `last_surfaced_at` once and the other's later call
  // naturally excludes the signal via the same cooldown check (D3/R3/AT3)
  // -- no separate coordination needed here.
  for (const p of personas) {
    for (const signal of assembleHeartbeatSignalCandidates(sm, p.id)) {
      items.push({
        id: signal.id,
        type: "Signal",
        persona_name: p.display_name,
        dimension: signal.dimension,
        claim: signal.claim,
      });
    }
  }

  // 2026-08-20 fix (S9, independent review finding): `temporalAnchors` is
  // now a caller-supplied parameter, not built here. The 2026-08-19 fix
  // below reordered the emptiness check against already-extracted
  // anchors, but that reordering alone was moot: this function used to
  // call `buildTemporalAnchorsFromHistory` on its own `history` parameter
  // AFTER `queueHeartbeatCheck` had already run `filterMessagesForContext`
  // on it -- that filter has no exemption for `ContextStatus.Always`, so
  // any genuinely old anchor was already discarded before it ever reached
  // this function. Anchor extraction now happens once, in
  // `queueHeartbeatCheck`, on RAW history, BEFORE that window filter runs
  // -- see the comment there. `history` here is already the final,
  // anchor-extracted-and-window-filtered list.
  if (items.length === 0 && temporalAnchors.length === 0) {
    console.log("[queueEiHeartbeat] No items or temporal anchors to address, skipping");
    return;
  }

  const recentHistory = history.slice(-10);
  const promptData: EiHeartbeatPromptData = {
    items,
    recent_history: recentHistory,
    system_messages: recentHistory.filter(m => m.role === "system"),
    temporal_anchors: temporalAnchors,
  };

  const prompt = buildEiHeartbeatPrompt(promptData);

  sm.queue_enqueue({
    type: LLMRequestType.JSON,
    priority: LLMPriority.Low,
    system: prompt.system,
    user: prompt.user,
    next_step: LLMNextStep.HandleEiHeartbeat,
    model: getModelForPersona(sm, "ei"),
    data: { personaId: "ei", isTUI, newPersonIds: newPeople.map(p => p.id), offeredIds: items.map(i => i.id) },
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

  // 2026-08-20 fix (S9, independent review finding): Temporal Anchors must
  // be extracted from RAW history BEFORE the generic context-window
  // filter runs. An `Always`-status anchor is specifically exempt from
  // the window/boundary age check by design -- that's the entire point of
  // "Always" -- but `filterMessagesForContext`'s own filter has no such
  // exemption, so running it first silently discarded any genuinely old
  // anchor before `buildTemporalAnchorsFromHistory` ever got a chance to
  // rescue it. This shared setup fed BOTH branches below (Ei's own
  // heartbeat and every ordinary persona's) -- the bug was here, not in
  // either branch, so fixing only one would have left the other with the
  // identical defect.
  const { temporalAnchors, prunedHistory: rawPruned } = buildTemporalAnchorsFromHistory(
    history,
    contextWindowMs,
    persona.context_boundary
  );
  const contextHistory = filterMessagesForContext(rawPruned, persona.context_boundary, contextWindowMs);

  if (personaId === "ei") {
    await queueEiHeartbeat(sm, human, contextHistory, isTUI, temporalAnchors);
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

  const signals = assembleHeartbeatSignalCandidates(sm, personaId);

  const promptData: HeartbeatCheckPromptData = {
    persona: {
      name: persona.display_name,
      traits: persona.traits,
      topics: persona.topics,
    },
    human: {
      topics: sortByEngagementGap(filteredHuman.topics).slice(0, 5),
      people: sortByEngagementGap(filteredHuman.people).slice(0, 5),
    },
    recent_history: contextHistory.slice(-10),
    temporal_anchors: temporalAnchors,
    inactive_days: inactiveDays,
    signals,
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

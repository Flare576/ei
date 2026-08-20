import type { PersonaEntity, Message, ContextStatus, PersonaObservation, PersonaSignalCollections, EmergentSignal, SignalDimension, PersonaIdentityDelta } from "../types.js";
import { levenshtein, normalizeForMatch } from "../utils/levenshtein.js";

/** A persisted persona record as it may exist on disk — `observations`/
 * `signals` are optional here because a record persisted before Bolt 003
 * shipped has neither key (D4). */
type PersistedPersonaRecord = {
  entity: PersonaEntity;
  messages: Message[];
  observations?: PersonaObservation[];
  signals?: PersonaSignalCollections;
};

export interface PersonaData {
  entity: PersonaEntity;
  messages: Message[];
  observations: PersonaObservation[];
  signals: PersonaSignalCollections;
  contextWindow?: { start: string; end: string };
}

/**
 * Update/Reduce's own outcome (Bolt 004, D4/D9/§4.17 step 3) — what
 * `signal_reduce` actually did with a freshly-recorded observation, so its
 * caller (the Match handler) can log it and decide whether any further
 * bounded `Person.description` synthesis is warranted (R1/AT1: this Bolt
 * always leaves it unchanged — no synthesis algorithm is specified
 * anywhere the Spec names, and D4 forbids an LLM call for this step, so
 * "unchanged" is the correct branch of AT1's "unchanged or synthesized"
 * contract, not an omission).
 */
export interface SignalReduceResult {
  outcome: "attached" | "created" | "reopened" | "stayed_dismissed";
  signal: EmergentSignal;
  /** Set only for `"reopened"` — the dismissed signal's own id, mirrored
   * onto the new signal's `supersedes_signal_id` (D9). */
  supersededSignalId?: string;
}

/**
 * D9/§4.8's corroboration bar: how many INDEPENDENT contexts (see
 * `observationContextKey` below) a `candidate` signal needs before it
 * promotes to `recurring`. `identity`/`values`/`relationship` claims need
 * harder corroboration than `behavior`/`voice` claims (ADR-038 item 3) —
 * the exact numbers are a Bolt-generation-time tuning choice (ADR-038 item
 * 11 deliberately fixes no number), chosen here to satisfy every property
 * ADR-038 item 11 lists: 2 independent contexts promotes a `behavior`/
 * `voice` claim; that same 2-context evidence set does NOT promote an
 * `identity`/`values`/`relationship` claim, which needs a 3rd.
 *
 * Exported: `heartbeat-manager.ts`'s `assembleHeartbeatSignalCandidates` (Bolt 005) derives the
 * gentle-surface band's own ceiling from this SAME table rather than a
 * second hardcoded number — a `candidate`-status signal's `recurrence_count`
 * is already guaranteed below its own dimension's threshold here
 * (`promoteIfEligible` flips status to `recurring` the instant it's
 * reached), so referencing this table directly there is belt-and-suspenders
 * against that invariant ever drifting, not merely decoration.
 */
export const PROMOTION_INDEPENDENCE_THRESHOLD: Record<SignalDimension, number> = {
  behavior: 2,
  voice: 2,
  identity: 3,
  values: 3,
  relationship: 3,
};

/**
 * The unit of "independence" promotion counts (D9/§4.8: "independent
 * observer_kinds / genuinely separate contexts or time-windows, never
 * evidence_ids.length"). Two observations from the same witness identity
 * on the same calendar day are one context — five same-day mentions from
 * one observer are still one witness, never five. A different witness
 * identity, or the same witness on a materially later day, is a
 * genuinely separate context.
 *
 * Computes the SAME key regardless of `direct_write` — the D11 exclusion
 * (a self-attested Bolt-008 `other_persona` observation must not drive
 * automatic promotion) is scoped narrowly to the promotion-facing tally,
 * `independentContextCount` below, not to this function. The dismissed-
 * signal reopen check (`signal_reduce`'s own `priorContexts`/`observationContextKey(observation)`
 * comparison) is dedup logic, not promotion arithmetic, and stays
 * unaffected: a direct-write replay in the same claimed context still
 * counts as a replay for THAT purpose.
 */
function observationContextKey(observation: PersonaObservation): string {
  const witness = observation.observer_kind === "other_persona" && observation.observer_persona_id
    ? `other_persona:${observation.observer_persona_id}`
    : observation.observer_kind;
  return `${witness}|${observation.observed_at.slice(0, 10)}`;
}

/**
 * Near-duplicate claim text check used to decide whether a "new" Match
 * decision is actually a reopen of a dismissed signal (D9/§4.8) — plain
 * string comparison, matching this module's "deterministic code, no LLM
 * call" contract (D4). Exact match after normalization, or a normalized
 * edit distance within 20% of the longer string's length (near-identical
 * wording), counts as the same underlying claim.
 */
function claimsMatch(a: string, b: string): boolean {
  const normalizedA = normalizeForMatch(a);
  const normalizedB = normalizeForMatch(b);
  if (normalizedA === normalizedB) return true;
  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  if (maxLength === 0) return true;
  return levenshtein(normalizedA, normalizedB) / maxLength <= 0.2;
}

export class PersonaState {
  private personas: Map<string, PersonaData> = new Map();

  /** Hydrates from a persisted record. A record loaded without an
   * `observations` key or a `signals` key defaults to `[]` and
   * `{ persona: [], agent: [] }` respectively — never a migration
   * failure or missing-data error (D4).
   *
   * A record still carrying `external_reflection_only` from before
   * ADR-007's sunset (ADR-038, Bolt 002 D2) is silently dropped here —
   * not a named migration with logging, just the hydration rule itself:
   * the schema no longer declares the field, nothing replaces what it
   * did, and there is no error and no warning for a value that predates
   * this. */
  load(personas: Record<string, PersistedPersonaRecord>): void {
    this.personas = new Map(
      Object.entries(personas).map(([id, data]) => {
        const entity = data.entity as PersonaEntity & { external_reflection_only?: unknown };
        if ("external_reflection_only" in entity) {
          delete entity.external_reflection_only;
        }
        return [
          id,
          {
            entity,
            messages: data.messages,
            observations: data.observations ?? [],
            signals: data.signals ?? { persona: [], agent: [] },
          },
        ];
      })
    );
  }

  export(): Record<string, { entity: PersonaEntity; messages: Message[]; observations: PersonaObservation[]; signals: PersonaSignalCollections }> {
    const result: Record<string, { entity: PersonaEntity; messages: Message[]; observations: PersonaObservation[]; signals: PersonaSignalCollections }> = {};
    for (const [id, data] of this.personas) {
      result[id] = {
        entity: data.entity,
        messages: data.messages,
        observations: data.observations,
        signals: data.signals,
      };
    }
    return result;
  }

  getAll(): PersonaEntity[] {
    return Array.from(this.personas.values()).map((p) => p.entity);
  }

  getById(id: string): PersonaEntity | null {
    return this.personas.get(id)?.entity ?? null;
  }

   getByName(nameOrAlias: string): PersonaEntity | null {
    // Same ZWS strip as resolveCanonicalAgent — see that function for the full explanation.
    const searchTerm = nameOrAlias.replace(/^[\p{Z}\u200B\u200C\u200D\u2060\uFEFF]+|[\p{Z}\u200B\u200C\u200D\u2060\uFEFF]+$/gu, "").toLowerCase();
    
    // Priority 1: Exact display_name match
    for (const data of this.personas.values()) {
      if (data.entity.display_name.toLowerCase() === searchTerm) {
        return data.entity;
      }
    }
    
    // Priority 2: Exact alias match
    for (const data of this.personas.values()) {
      if (data.entity.aliases?.some(alias => alias.toLowerCase() === searchTerm)) {
        return data.entity;
      }
    }
    
    // Priority 3: Unambiguous partial match
    const partialMatches: PersonaEntity[] = [];
    for (const data of this.personas.values()) {
      const displayNameLower = data.entity.display_name.toLowerCase();
      const aliasesLower = data.entity.aliases?.map(a => a.toLowerCase()) ?? [];
      
      const matchesDisplayName = displayNameLower.includes(searchTerm);
      const matchesAlias = aliasesLower.some(alias => alias.includes(searchTerm));
      
      if (matchesDisplayName || matchesAlias) {
        partialMatches.push(data.entity);
      }
    }
    
    return partialMatches.length === 1 ? partialMatches[0] : null;
  }

  add(entity: PersonaEntity): void {
    this.personas.set(entity.id, { entity, messages: [], observations: [], signals: { persona: [], agent: [] } });
  }

  update(personaId: string, updates: Partial<PersonaEntity>): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity = { ...data.entity, ...updates, last_updated: new Date().toISOString() };
    return true;
  }

  /** Full replace of a persona's entity (not a merge) — used by the live-drain path for corrections-queue upserts, where record.record is already a complete PersonaEntity and any field genuinely absent from it must NOT survive from the prior value. Preserves .messages, .observations, and .signals untouched, same as update() — D2's separate-storage guarantee that an ordinary full-record Persona correction cannot silently overwrite either collection. */
  replace(personaId: string, entity: PersonaEntity): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity = { ...entity, last_updated: new Date().toISOString() };
    return true;
  }

  archive(personaId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity.is_archived = true;
    data.entity.archived_at = new Date().toISOString();
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  unarchive(personaId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.entity.is_archived = false;
    data.entity.archived_at = undefined;
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  delete(personaId: string): boolean {
    return this.personas.delete(personaId);
  }

  messages_get(personaId: string): Message[] {
    const messages = this.personas.get(personaId)?.messages ?? [];
    return messages.map(m => ({ ...m }));
  }

  messages_getAlways(personaId: string): Message[] {
    const messages = this.personas.get(personaId)?.messages ?? [];
    return messages
      .filter(m => m.context_status === "always")
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(m => ({ ...m }));
  }

  /** Returns true when `personaId` exists and the message was appended; false (a silent no-op) when it doesn't — the caller must check this rather than assume delivery (I3, .sisyphus/reviews/tonight-post-audit-fix-queue.md). */
  messages_append(personaId: string, message: Message): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    data.messages.push(message);
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  messages_update(personaId: string, messageId: string, updates: Partial<Message>): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    Object.assign(msg, updates);
    data.entity.last_updated = new Date().toISOString();
    return true;
  }

  messages_sort(personaId: string): void {
    const data = this.personas.get(personaId);
    if (!data) return;
    data.messages.sort((a, b) => 
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }

  messages_setContextStatus(
    personaId: string,
    messageId: string,
    status: ContextStatus
  ): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.context_status = status;
    return true;
  }

  messages_markRead(personaId: string, messageId: string): boolean {
    const data = this.personas.get(personaId);
    if (!data) return false;
    const msg = data.messages.find((m) => m.id === messageId);
    if (!msg) return false;
    msg.read = true;
    return true;
  }

  messages_markPendingAsRead(personaId: string): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    let count = 0;
    for (const msg of data.messages) {
      if (msg.role === "human" && !msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  messages_countUnread(personaId: string): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    return data.messages.filter(m => m.role === "system" && !m.read).length;
  }

  messages_markAllRead(personaId: string): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    let count = 0;
    for (const msg of data.messages) {
      if (!msg.read) {
        msg.read = true;
        count++;
      }
    }
    return count;
  }

  messages_remove(personaId: string, messageIds: string[]): Message[] {
    const data = this.personas.get(personaId);
    if (!data) return [];
    const idsSet = new Set(messageIds);
    const removed: Message[] = [];
    data.messages = data.messages.filter((m) => {
      if (idsSet.has(m.id)) {
        removed.push(m);
        return false;
      }
      return true;
    });
    return removed;
  }

  messages_getUnextracted(
    personaId: string,
    flag: "f" | "t" | "p" | "e",
    limit?: number,
    external_filter?: "include" | "exclude" | "only"
  ): Message[] {
    const data = this.personas.get(personaId);
    if (!data) return [];
    let unextracted = data.messages.filter(m => m[flag] !== true);
    if (external_filter === "exclude") {
      unextracted = unextracted.filter(m => m.external !== true);
    } else if (external_filter === "only") {
      unextracted = unextracted.filter(m => m.external === true);
    }
    if (limit && unextracted.length > limit) {
      return unextracted.slice(0, limit).map(m => ({ ...m }));
    }
    return unextracted.map(m => ({ ...m }));
  }

  messages_markExtracted(personaId: string, messageIds: string[], flag: "f" | "t" | "p" | "e"): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    const idsSet = new Set(messageIds);
    let count = 0;
    for (const msg of data.messages) {
      if (idsSet.has(msg.id) && msg[flag] !== true) {
        msg[flag] = true;
        count++;
      }
    }
    return count;
  }

  messages_getUnextractedForPersona(personaId: string, shortId: string): Message[] {
    const data = this.personas.get(personaId);
    if (!data) return [];
    return data.messages
      .filter(m => !m.persona_extracted?.[shortId])
      .map(m => ({ ...m }));
  }

  messages_markPersonaExtracted(personaId: string, messageIds: string[], shortId: string): number {
    const data = this.personas.get(personaId);
    if (!data) return 0;
    const idsSet = new Set(messageIds);
    let count = 0;
    for (const msg of data.messages) {
      if (idsSet.has(msg.id) && !msg.persona_extracted?.[shortId]) {
        msg.persona_extracted = { ...msg.persona_extracted, [shortId]: true };
        count++;
      }
    }
    return count;
  }

  /** Every observation ever recorded for this persona, one flat durable
   * collection addressed by its own `id` (D2) — never split by lens. Returns
   * shallow copies, same defensive convention as messages_get. */
  observations_get(personaId: string): PersonaObservation[] {
    const observations = this.personas.get(personaId)?.observations ?? [];
    return observations.map(o => ({ ...o }));
  }

  /** Records a new observation, minting its stable `id` (D1) here — same
   * "collection owns id generation" convention as QueueState.enqueue().
   * Returns the full persisted observation (with id), or null when
   * `personaId` doesn't exist (a silent no-op the caller must check). */
  observation_add(personaId: string, observation: Omit<PersonaObservation, "id">): PersonaObservation | null {
    const data = this.personas.get(personaId);
    if (!data) return null;
    const full: PersonaObservation = { ...observation, id: crypto.randomUUID() };
    data.observations.push(full);
    return full;
  }

  /** The two non-overlapping lens buckets a persona's signals live in (D2).
   * Deep-copies both buckets and their signals (D6's read-boundary
   * guarantee) so a mutation of the returned value can never reach
   * persisted state. */
  signals_get(personaId: string): PersonaSignalCollections {
    const signals = this.personas.get(personaId)?.signals;
    if (!signals) return { persona: [], agent: [] };
    return structuredClone(signals);
  }

  /** Persists a fully-formed signal into the given lens bucket, minting its
   * stable `id` here — same "collection owns id generation" convention as
   * `observation_add` (D5; `id` is never caller-supplied). Classifying which
   * observations warrant a signal, and what its other fields should be, is
   * Bolt 004's job (Scan/Match/Update/Validate) — this is the bare write
   * primitive that lets it (and this Bolt's own tests) do so.
   *
   * Rejects (a no-op: no mutation, no minted id) when `personaId` doesn't
   * exist, or when any `evidence_ids` member fails to resolve against that
   * same persona's own `observations` — a `message_id`, a `quote_id`, an
   * unknown string, or another persona's observation id all fail this check
   * (D6). On acceptance, the caller-supplied `signal` is deep-copied before
   * the minted id is attached and the copy is stored, so no later mutation
   * of the caller's original object can reach persisted state (D6's
   * write-boundary guarantee; the read-boundary half lives in
   * `signals_get`). Returns the persisted signal (with its minted id), or
   * `null` on rejection — the caller must check this rather than assume the
   * write landed. */
  signal_add(personaId: string, lens: "persona" | "agent", signal: Omit<EmergentSignal, "id">): EmergentSignal | null {
    const data = this.personas.get(personaId);
    if (!data) return null;
    const observationIds = new Set(data.observations.map((o) => o.id));
    if (!signal.evidence_ids.every((evidenceId) => observationIds.has(evidenceId))) return null;
    const full: EmergentSignal = { ...structuredClone(signal), id: crypto.randomUUID() };
    data.signals[lens].push(full);
    return full;
  }

  /** Stamps `last_surfaced_at` on an already-persisted signal, found by
   * `signalId` across both lens buckets — Bolt 005's own write primitive
   * (D2/D4): assembling a heartbeat's candidate list IS the surfacing
   * event, so every signal an assembly includes gets this stamp regardless
   * of whether the model's freeform reply ends up naming it. Mutates the
   * persisted signal in place (same convention as `attachEvidence`).
   * Returns a deep-copied snapshot (D6's read-boundary guarantee), or
   * `null` if `personaId`/`signalId` doesn't resolve to an existing
   * signal in either lens — a silent no-op the caller must check. */
  signal_stampSurfaced(personaId: string, signalId: string, timestamp: string): EmergentSignal | null {
    const data = this.personas.get(personaId);
    if (!data) return null;
    for (const lens of ["persona", "agent"] as const) {
      const signal = data.signals[lens].find((s) => s.id === signalId);
      if (signal) {
        signal.last_surfaced_at = timestamp;
        return structuredClone(signal);
      }
    }
    return null;
  }

  /** How many mutually-independent contexts (see `observationContextKey`)
   * back `signal`'s current evidence — the promotion arithmetic's own
   * count, exposed as a private helper so both `attachEvidence` and
   * `signal_merge` share one implementation.
   *
   * D11 (Sisyphus's ruling on the caller-attribution needs-ruling issue,
   * `.sisyphus/issues/persona-signal-caller-attribution-needs-ruling.md`):
   * a self-attested `other_persona` observation submitted through Bolt
   * 008's Add Observation (`observation.direct_write === true`) is
   * excluded from this tally ENTIRELY — chosen over the ruling's other
   * acceptable option (capping direct-write witness-diversity credit at
   * one shared context) as the simpler implementation: it contributes no
   * context at all here, rather than contributing a bounded one, so
   * promotion for evidence built only from such claims requires an
   * explicit human `signal.confirm` (D2/R2), never automatic promotion,
   * full stop. It still counts fully everywhere else — `evidence_ids`,
   * `observer_kinds`, `first_observed_at`/`last_observed_at` in
   * `attachEvidence` below, and citability on the signal — only the
   * INDEPENDENCE-TALLY strength of its claimed witness identity is
   * discounted, because a bare assertion with no analyzed-message anchor
   * (`message_id` defaults to a synthesized `correction:<uuid>` pointer)
   * is strictly weaker evidence than an extraction-derived `other_persona`
   * claim, which IS grounded in a real analyzed message
   * (`human-extraction.ts`'s `validatePersonaObservationDraft`).
   * `human`/`subject_self` direct-write observations are unaffected —
   * `observationContextKey` already collapses those two kinds to a fixed
   * bucket regardless of caller, so they carry no equivalent
   * fabricate-a-witness exploit. */
  private independentContextCount(data: PersonaData, signal: EmergentSignal): number {
    const contexts = new Set<string>();
    for (const evidenceId of signal.evidence_ids) {
      const observation = data.observations.find((o) => o.id === evidenceId);
      if (!observation) continue;
      if (observation.direct_write && observation.observer_kind === "other_persona") continue;
      contexts.add(observationContextKey(observation));
    }
    return contexts.size;
  }

  /** Promotes `signal` from `candidate` to `recurring` in place when its
   * current evidence clears the dimension-scaled independence bar
   * (D9/§4.8) — a no-op for any other status, including a signal already
   * `recurring` (promotion is one-directional; nothing here ever demotes). */
  private promoteIfEligible(data: PersonaData, signal: EmergentSignal): void {
    if (signal.status !== "candidate") return;
    if (this.independentContextCount(data, signal) >= PROMOTION_INDEPENDENCE_THRESHOLD[signal.dimension]) {
      signal.status = "recurring";
    }
  }

  /** Attaches `observation` as evidence on the already-stored `signal`
   * object (found by reference in `data.signals[lens]`), mutating it in
   * place — same in-place-mutation convention as `update()`/`archive()`.
   * Never removes or overwrites prior evidence (D9's "contradictory
   * evidence" guarantee: a `direction: "challenges"` observation is
   * recorded as its own new evidence entry, never as a replacement).
   * `recurrence_count` is recomputed as the independent-context count
   * (never `evidence_ids.length`) — a same-context reinforcing
   * observation grows `evidence_ids` but leaves `recurrence_count` (and
   * therefore `status`) unchanged (AT-R16 #1: "reinforcing evidence → no
   * signal/profile change"), matching D9's "independence over raw count."
   * Returns a deep-copied snapshot (D6's read-boundary guarantee). */
  private attachEvidence(data: PersonaData, signal: EmergentSignal, observation: PersonaObservation): EmergentSignal {
    if (!signal.evidence_ids.includes(observation.id)) {
      signal.evidence_ids.push(observation.id);
    }
    if (!signal.observer_kinds.includes(observation.observer_kind)) {
      signal.observer_kinds.push(observation.observer_kind);
    }
    if (observation.observed_at > signal.last_observed_at) signal.last_observed_at = observation.observed_at;
    if (observation.observed_at < signal.first_observed_at) signal.first_observed_at = observation.observed_at;
    signal.recurrence_count = this.independentContextCount(data, signal);
    this.promoteIfEligible(data, signal);
    return structuredClone(signal);
  }

  /**
   * Update/Reduce — step 3 of the Observation→Signal reducer (D4/D9,
   * Spec §4.17). Deterministic code, no LLM call: given Match's decision
   * for `observation` (an existing open signal's id, or `"new"`), either
   * attaches it as evidence (promoting `candidate`→`recurring` when the
   * dimension-scaled independence bar clears), creates a brand-new
   * `candidate`, or — when the "new" claim actually restates a `dismissed`
   * signal in this lens — reopens it: a materially-different-context
   * observation creates a new `candidate` whose `supersedes_signal_id`
   * names the dismissed signal, transitioning that signal `dismissed` →
   * `superseded`; a verbatim replay in the SAME context leaves the
   * dismissed signal untouched and mints nothing (D5's own dismissed-never-
   * touched guarantee holds even here, since "stayed_dismissed" performs
   * no write at all).
   *
   * `matchDecision` must be an id from the SAME lens's open
   * (`candidate`/`recurring`) list, or the literal string `"new"` — an id
   * naming a `dismissed`/`reviewed`/`superseded` signal, or one that
   * doesn't exist, is rejected (`null`) rather than silently treated as a
   * match, mirroring `signal_add`'s own no-op-on-invalid-input contract.
   */
  signal_reduce(
    personaId: string,
    lens: "persona" | "agent",
    observation: PersonaObservation,
    matchDecision: string | "new"
  ): SignalReduceResult | null {
    const data = this.personas.get(personaId);
    if (!data) return null;
    const bucket = data.signals[lens];

    if (matchDecision !== "new") {
      const existing = bucket.find((s) => s.id === matchDecision && (s.status === "candidate" || s.status === "recurring"));
      if (!existing) return null;
      return { outcome: "attached", signal: this.attachEvidence(data, existing, observation) };
    }

    const dismissedMatch = bucket.find((s) => s.status === "dismissed" && claimsMatch(s.claim, observation.claim));
    if (dismissedMatch) {
      const priorContexts = new Set<string>();
      for (const evidenceId of dismissedMatch.evidence_ids) {
        const priorObservation = data.observations.find((o) => o.id === evidenceId);
        if (priorObservation) priorContexts.add(observationContextKey(priorObservation));
      }
      if (priorContexts.has(observationContextKey(observation))) {
        // Verbatim replay in the same context — stays dismissed, no new signal (D9).
        return { outcome: "stayed_dismissed", signal: structuredClone(dismissedMatch) };
      }
      const reopened = this.signal_add(personaId, lens, {
        subject_persona_id: personaId,
        claim: observation.claim,
        dimension: observation.dimension,
        status: "candidate",
        evidence_ids: [observation.id],
        first_observed_at: observation.observed_at,
        last_observed_at: observation.observed_at,
        observer_kinds: [observation.observer_kind],
        recurrence_count: 1,
        supersedes_signal_id: dismissedMatch.id,
      });
      if (!reopened) return null;
      dismissedMatch.status = "superseded";
      return { outcome: "reopened", signal: reopened, supersededSignalId: dismissedMatch.id };
    }

    const created = this.signal_add(personaId, lens, {
      subject_persona_id: personaId,
      claim: observation.claim,
      dimension: observation.dimension,
      status: "candidate",
      evidence_ids: [observation.id],
      first_observed_at: observation.observed_at,
      last_observed_at: observation.observed_at,
      observer_kinds: [observation.observer_kind],
      recurrence_count: 1,
    });
    if (!created) return null;
    return { outcome: "created", signal: created };
  }

  /**
   * Validate's own write primitive — step 4 of the reducer (D5, Spec
   * §4.17). Absorbs `mergeId`'s evidence into `keepId` and drops `mergeId`
   * from the bucket. Both signals must currently be `candidate`/
   * `recurring` in the same lens — a `dismissed`/`reviewed`/`superseded`
   * id on either side rejects the whole merge (`null`, no mutation),
   * structurally preventing Validate from ever touching a dismissed
   * signal (D5), even if a hallucinated id named one.
   */
  signal_merge(personaId: string, lens: "persona" | "agent", keepId: string, mergeId: string): EmergentSignal | null {
    if (keepId === mergeId) return null;
    const data = this.personas.get(personaId);
    if (!data) return null;
    const bucket = data.signals[lens];
    const isOpen = (s: EmergentSignal) => s.status === "candidate" || s.status === "recurring";
    const keep = bucket.find((s) => s.id === keepId && isOpen(s));
    const mergeIndex = bucket.findIndex((s) => s.id === mergeId && isOpen(s));
    if (!keep || mergeIndex < 0) return null;
    const merged = bucket[mergeIndex];
    // D9/R5: the corroboration bar scales BY DIMENSION specifically so an
    // identity/values/relationship claim needs harder corroboration than
    // a behavior/voice one. Merging across dimensions would launder a
    // harder-to-promote claim's evidence into an easier-to-promote
    // sibling's bucket (promoting under the WRONG threshold) while
    // permanently destroying the other dimension's distinct claim via
    // the splice below — refused outright, no mutation.
    if (keep.dimension !== merged.dimension) return null;

    keep.evidence_ids = [...new Set([...keep.evidence_ids, ...merged.evidence_ids])];
    keep.observer_kinds = [...new Set([...keep.observer_kinds, ...merged.observer_kinds])];
    keep.first_observed_at = keep.first_observed_at < merged.first_observed_at ? keep.first_observed_at : merged.first_observed_at;
    keep.last_observed_at = keep.last_observed_at > merged.last_observed_at ? keep.last_observed_at : merged.last_observed_at;
    keep.recurrence_count = this.independentContextCount(data, keep);
    this.promoteIfEligible(data, keep);

    bucket.splice(mergeIndex, 1);
    return structuredClone(keep);
  }

  /**
   * Apply Signal — confirm (Bolt 008 D2/D3/D5, Spec §4.12). Sets
   * `status: "reviewed"` + `reviewed_by` on `signalId`, found by id
   * across BOTH lens buckets (a signal's own id is unique regardless of
   * which bucket it lives in). Throws — never a silent no-op or a
   * partial mutation — when: `personaId` doesn't resolve; `signalId`
   * doesn't resolve on that persona in either lens; the signal is
   * already terminal (`dismissed`/`reviewed`, D5); or `delta` is
   * supplied for a Persona-lens signal whose `PersonaEntity` already has
   * a `pending_update` set (D3's collision policy — the caller must
   * resolve the existing proposal first, via the existing apply/dismiss
   * UI, before retrying). Every check above runs BEFORE any mutation, so
   * a thrown rejection never leaves the signal half-transitioned.
   *
   * An Agent-lens signal's `delta` (if any) is silently ignored — D2:
   * "no PersonaEntity write of any kind, for any Agent-lens confirm
   * regardless of any delta the caller supplies." For a Persona-lens
   * signal with a delta and no collision, the same atomic step also
   * writes a `pending_update` PROPOSAL (never applies the delta
   * directly — `Processor.finalizeReflection` remains the only path
   * that ever writes identity fields onto `PersonaEntity`, unchanged by
   * this Bolt).
   */
  signal_confirm(personaId: string, signalId: string, actor: string, timestamp: string, delta?: PersonaIdentityDelta): EmergentSignal {
    const data = this.personas.get(personaId);
    if (!data) throw new Error(`Cannot confirm signal ${signalId}: persona ${personaId} not found`);
    let found: { lens: "persona" | "agent"; signal: EmergentSignal } | undefined;
    for (const lens of ["persona", "agent"] as const) {
      const signal = data.signals[lens].find((s) => s.id === signalId);
      if (signal) { found = { lens, signal }; break; }
    }
    if (!found) throw new Error(`Cannot confirm signal ${signalId}: not found on persona ${personaId}`);
    const { lens, signal } = found;
    if (signal.status !== "candidate" && signal.status !== "recurring") {
      throw new Error(`Cannot confirm signal ${signalId}: already "${signal.status}" (terminal)`);
    }
    if (lens === "persona" && delta && data.entity.pending_update) {
      throw new Error(`Cannot confirm signal ${signalId} with a delta: persona ${personaId} already has a pending_update — resolve it first`);
    }

    signal.status = "reviewed";
    signal.reviewed_by = { actor, timestamp };
    if (lens === "persona" && delta) {
      data.entity = {
        ...data.entity,
        pending_update: {
          short_description: delta.short_description,
          long_description: delta.long_description,
          traits: delta.traits,
          topics: delta.topics,
          critique: `Confirmed via CLI/MCP from signal ${signal.id}: ${signal.claim}`,
          created_at: timestamp,
        },
        last_updated: timestamp,
      };
    }
    return structuredClone(signal);
  }

  /**
   * Apply Signal — dismiss (Bolt 008 D4/D5, Spec §4.12). Sets
   * `status: "dismissed"` + `dismissed_by` on `signalId`, found by id
   * across both lens buckets, for either lens — zero `PersonaEntity`
   * write in either case (unlike confirm, dismiss never takes a delta).
   * Throws — never a silent no-op — when `personaId`/`signalId` doesn't
   * resolve, or when the signal is already terminal
   * (`dismissed`/`reviewed`, D5); the terminal check runs before any
   * mutation.
   */
  signal_dismiss(personaId: string, signalId: string, actor: string, timestamp: string): EmergentSignal {
    const data = this.personas.get(personaId);
    if (!data) throw new Error(`Cannot dismiss signal ${signalId}: persona ${personaId} not found`);
    let found: EmergentSignal | undefined;
    for (const lens of ["persona", "agent"] as const) {
      found = data.signals[lens].find((s) => s.id === signalId);
      if (found) break;
    }
    if (!found) throw new Error(`Cannot dismiss signal ${signalId}: not found on persona ${personaId}`);
    if (found.status !== "candidate" && found.status !== "recurring") {
      throw new Error(`Cannot dismiss signal ${signalId}: already "${found.status}" (terminal)`);
    }
    found.status = "dismissed";
    found.dismissed_by = { actor, timestamp };
    return structuredClone(found);
  }
}

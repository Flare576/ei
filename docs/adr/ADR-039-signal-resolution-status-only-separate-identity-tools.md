# ADR-039: Signal Resolution Is Status-Only; Identity Editing Is a Separate Native Tool Set

## Status

Accepted

## Date

2026-09-11

## Context

ADR-038 replaced the automatic Reflection Critic with attributed observations and signals, but its own
item 7 kept one piece of the Critic's mechanism alive: a Persona-lens `signal.confirm` didn't write
`PersonaEntity.traits`/`long_description`/etc. directly — it wrote a `pending_update` proposal, refusing
outright if one was already unresolved, applied only by `Processor.finalizeReflection` (reachable
exclusively from the TUI's `/reflect` command and the Web's Persona Reflection modal). That framing
doesn't match what the observation/signal system exists to do. Its whole purpose is signal-to-noise:
catching subtle drift a human or the acting agent might miss — a slipped pronoun, a conversational tone
shift — through repetition and independent corroboration, not through validating whether a caller is
trustworthy. The old Critic's staging step existed because a single unattributed append-only log needed
a human to sanity-check it before anything happened; that risk doesn't exist here — every signal already
carries its own observers, sources, and an independence-scaled corroboration bar (ADR-038 item 3) before
a human ever sees it. Gating the write anyway, to TUI/Web alone, encodes a distinction between "UI
callers" and "non-UI callers" with no basis in this system's design — a human whose only surface is
CLI/MCP is exactly as present as one typing into the TUI.

A second, deeper problem surfaced once the staging gate was removed as a design question on its own:
even a direct write still needed something to construct `PersonaTrait`-shaped content — a `name`, a
`description`, a `sentiment`, an optional `strength` — from a signal's own evidence. Checked directly
against the types (`src/core/types/signals.ts`, `src/core/types/data-items.ts`): `EmergentSignal` and
`PersonaTrait` are not the same shape. A signal's `claim` is one free-text sentence; a trait needs
separate structured fields no signal carries, and no signal links to an existing trait it might be
adjusting. Moving the manual-authoring burden from a human/CLI caller to a native tool call doesn't
close that gap — it just relocates it.

The resolution: stop coupling "this signal is accurate" to "and here's the trait content" at all. Give
Native personas the same introspection and editing capability a CLI-driven agent already effectively
has, and let signal resolution mean exactly what it says — a status change — while identity editing
becomes a separate, ordinary act a Persona performs with full conversational context, whenever it
decides to.

## Decision

### 1. `signal.confirm`/`signal.dismiss` are pure status-transition bookkeeping — no delta, ever, for either lens

Both operations set `status`/`reviewed_by` or `status`/`dismissed_by` — an actor, a timestamp — and
nothing else, symmetrically across the Persona lens and the Agent lens. No delta parameter exists on
either operation, for any caller (native, CLI, MCP). Neither lens's confirm has ever been able to write
`PersonaEntity` directly; now neither can even *propose* one.

### 2. Ingress is not a trust tier

Native conversation, CLI, and MCP are equally legitimate "a human is present" channels. There is no
privileged surface, and there never needed to be one: nothing about *how* a signal gets confirmed
changes how trustworthy the confirmation is — the evidence backing the signal was already vetted before
a human ever saw it (ADR-038 item 3).

### 3. Identity editing AND signal resolution are both native tools — five tools, ten capabilities

A Native persona gets a genuinely new capability: a read tool returning its own full identity **with
ids** for every trait and topic (nothing today gives a Persona its own trait/topic ids), plus
`edit_trait{action: add|remove|update}` (by id), `edit_topic{action: add|remove|update}` (by id),
`update_description` (short and/or long), and `resolve_signal{action: confirm|dismiss}` — a Native
persona does get its own tool to invoke item 1's status-only confirm/dismiss, not a CLI/MCP-only
operation. Five tools cover ten capabilities. These mirror `persona-notes.ts`'s direct in-process write
pattern, not a corrections queue.

**Interface shape settled by measurement, not preference.** Ten separate discrete tools (one per
capability) were considered and measured against this five-tool, action-parameterized design: 1097
tokens versus 822 tokens for an equivalent tool-call schema (`gpt-tokenizer`, see
`evidence/native-tool-token-measurement.md`) — 25% smaller. The discrete-tool design is rejected on that
basis, not on aesthetic grounds.

**Deliberately not mirrored into CLI/MCP.** CLI/MCP callers keep editing identity exactly as they always
have, via `ei update persona`'s existing whole-array merge-patch (ADR-029) — unrelated to
`signal.confirm`. Per-element CLI subcommands were considered and rejected for CLI specifically: one
subcommand covering every mutation shape doesn't work, and one subcommand per mutation type bloats
`--help` past what's usable there. This is an ergonomics difference between a human typing a command and
an LLM calling a named tool, not a capability or trust gap.

### 4. No write tool of any kind is available during heartbeat

A heartbeat pass may surface a signal gently (ADR-038 item 3's lower notice bar) but may never invoke
any write-capable tool — not `resolve_signal`, `edit_trait`, `edit_topic`, or `update_description` (the
four write-capable tools from item 3), not the already-shipped `add_note`/`clear_note`
(`persona-notes.ts`). `get_my_identity` is read-only and stays available during heartbeat like any
other lookup tool — nothing about reading identity needs a human present. Resolving or editing anything
requires an actual live exchange — a conversational turn, or an interactive CLI/MCP call a human is
driving. "Write tool," for this purpose, means any tool with an authoring or persistence side effect —
not narrowly a tool that mutates Ei's own state. If a tool could reasonably be described as writing
something on the persona's behalf, it's excluded; if it only reads or looks something up, it's allowed.

Verified directly: `src/core/processor.ts:658-708` currently gives `HandleHeartbeatCheck` the full
standard tool set, meaning `add_note`/`clear_note` are reachable from heartbeat today. This isn't a
pre-existing bug — no "no writes during heartbeat" rule existed before this decision, because this is
the first time a Native tool writes anything of real consequence; `add_note`/`clear_note` write only
hidden, agent-only notes, not identity. But the rule is being adopted now, uniformly, so it applies to
those two tools going forward the same as the new ones — an explicit read/write classification on the
tool registry is required, not a per-tool exclusion list, so a future write tool can't become
heartbeat-callable by omission.

### 5. `pending_update`, `PersonaIdentityDelta`, and `has_pending_update` are deleted, not kept inert

Mirroring ADR-038 item 2's own precedent for `external_reflection_only`: the field, its type, its schema
entry, and the derived `PersonaSummary.has_pending_update` flag are removed entirely. Hydration rule: a
persisted `PersonaEntity.pending_update` of any shape loads cleanly, is ignored, and drops off on the
persona's next write. No migration target — there is nothing to migrate it to.

### 6. `Processor.finalizeReflection` is deleted; the embedding-recompute guarantee moves with `update_description`

`finalizeReflection` has exactly two callers today, both retired by item 7. It is deleted along with
them. `src/core/persona-manager.ts` already recomputes the description embedding when `long_description`
changes, via `updatePersona` (ADR-022). `update_description` must route through that same call — or
reuse its recompute logic — rather than introduce a second write path that silently drops the guarantee.
Trait/topic-only tools need no embedding involvement at all, consistent with ADR-022's own scope
(embedding excludes traits).

### 7. Both existing reflection UIs are retired outright

The TUI's entire `/reflect` command (generate/update/apply/dismiss/overlay) and the inline
reflection-review affordance inside `/persona`'s edit flow; the Web's `PersonaReflectionModal`, its
`useReflection` hook, and its `App.tsx`/`PersonaPanel` wiring — all deleted, not deprecated in place. Both
surfaces' "✦ reflection ready" indicators go with them, since there is no longer any reflection state to
indicate. No replacement UI is scoped here — the replacement is the native tool set (item 3) plus the
already-first-class CLI/MCP surface.

### 8. Three orphaned consumers are deleted, not silently left behind

None of these are part of either retired UI, but each exists solely to serve a staging window that no
longer exists:

- **The extraction lock** (`human-extraction.ts`'s reflection-gated Person-scan skip; `ceremony.ts`'s
  `queueReflectionDrain` lock release) is structurally unreachable once confirm resolves in one atomic
  step. Deleted.
- **Ambient prompt-injection self-awareness** of a "proposed" description/traits
  (`prompts/response/sections.ts`'s `buildPendingUpdateSection`, `prompts/heartbeat/check.ts`'s "Pending
  Identity Changes" section) — deleted; there is nothing pending to be ambiently aware of.
- **The heartbeat's "Self Reflection Alert" / pending-reflection nudge** (`heartbeat-manager.ts`) —
  deleted; an already-applied identity is just the persona's identity.

### 9. Agent-lens confirm's write-authority split remains deferred, not decided here

An Agent-lens confirm only ever transitions status — an identity delta was never accepted for that lens
and still isn't, now uniformly true for both lenses (item 1). The dimension-vs-lens distinction itself
(ADR-038 item 4 — Agent signals describe how a persona *does* things, Persona signals describe how it
*is*) is reaffirmed as the correct semantic split. What's genuinely open: whether an Agent-lens confirm
should ever drive an edit to a harness-definition file, symmetric to item 3's Persona-lens tool set — and
it can't today, because no such write target/mechanism exists. ADR-001 already establishes that an
agent's operating contract lives in harness-native files, some of which are structurally unreachable by
any file-based tool in every harness examined. Building that mechanism is a separate, larger design
problem than this record resolves.

**Owner: Flare. Checkpoint: the design review that actually proposes an Agent-lens write mechanism to a
harness-definition file.**

### 10. `ei-reflect` is retired, but its external-agent guidance must be replaced, not merely deleted

The skill's whole purpose — managing a staging step, teaching a manual confirm/dismiss workflow — has no
subject once items 1–3 land. But something still has to teach an external-harness agent how to handle a
signal raised in its own system prompt. That guidance must land somewhere (rewritten elsewhere, or an
explicit pointer to a successor resource) in the same body of work that deletes the skill — not as an
unowned follow-up.

### 11. CLI/MCP's "a human is present" expectation is an accepted honor-system boundary, not a mechanically enforced one

No flag, no gate, no technical distinction between an interactive CLI/MCP invocation and a scripted one
is being built. Two reasons: a concern about local models being measurably worse at tool-calling than
frontier models during genuinely unattended periods is already addressed structurally by item 4
(heartbeat gets no write tools at all, regardless of model); and Ei's state is a plain JSON file any
process on the machine can already read or modify directly, with or without going through a CLI verb —
there is no real boundary left to enforce once that's true.

## Alternatives Considered

### Alternative A: Keep `pending_update`, widen who can write into it

- **Description**: Let CLI/MCP (and a future native tool) write into `pending_update` too, adding a
  fast-path flag that skips review for a trusted caller.
- **Cons**: Keeps the actual defect — an interstitial step nobody asked for — and just widens who can
  route around it.
- **Why not chosen**: Decorates the problem instead of fixing it.

### Alternative B: Direct write for conversational callers, staged `pending_update` for automated ones

- **Description**: Direct-write only when a live human exchange is detectable; keep staging as a safety
  net for anything else.
- **Cons**: Reintroduces exactly the ingress-based trust tiering item 2 repudiates.
- **Why not chosen**: Same defect as the original design, narrower target.

### Alternative C: Retain both UIs as inert, unreachable secondary surfaces

- **Description**: Leave `/reflect` and the Web modal in place even though nothing produces a
  `pending_update` for them to show.
- **Cons**: Dead UI invites a future maintainer to "fix" something structurally unreachable, for a
  scenario nobody asked for.
- **Why not chosen**: ADR-012's "sunset with a path forward" discipline argues for clean retirement over
  an inert husk.

### Alternative D: Confirm carries the identity delta directly (no staging, no decoupling)

- **Description**: `signal.confirm` accepts a delta and writes it straight onto `PersonaEntity`, in the
  same step — the direct-write idea considered first, before the shape mismatch was traced through.
- **Pros**: Fewer moving parts than a separate tool set; one call does both jobs.
- **Cons**: Never actually answers the shape question — the caller still has to hand-construct a
  complete replacement trait object from a signal's unstructured `claim`. Also needlessly couples "I've
  decided this signal is accurate" to "and here's the exact trait content," which are different
  judgments a Persona might want to make at different times.
- **Why not chosen**: Solves nothing the shape mismatch actually asked; just relocates who does the
  manual work.

### Alternative E: Ei derives trait content mechanically from a signal's own evidence

- **Description**: Extend the deterministic Update/Reduce reducer step (ADR-037) to compute a candidate
  `strength`/`sentiment` from `dimension`/`recurrence_count`/evidence, attaching it for a caller to accept
  or override.
- **Cons**: Pure code can compute a *number* defensibly, but not a `name`/`description` — a signal's
  `claim` is anecdotal prose from one Scan/Extract call, not settled trait-quality prose. Real derived
  prose would need a genuine new LLM reducer step, not a tweak.
- **Why not chosen**: More new machinery than the problem needs, once native read/write tools exist to
  make manual editing cheap and well-informed instead.

### Alternative F (chosen): Full decoupling — status-only resolution, separate native editing tools, blanket heartbeat exclusion

- **Description**: Items 1–11 above.
- **Pros**: Eliminates the shape-conversion question entirely; no ingress is treated as second-class;
  symmetric across both lenses by construction; gives Native personas real parity with what a CLI-driven
  agent could already do; deletes real dead-weight surface (a TUI command, a Web modal and hook, three
  prompt/heartbeat renderers, a now-pointless extraction lock).
- **Cons**: Large blast radius (comparable to ADR-038's own Critic removal) and five native tools to
  design, build, and register correctly.
- **Why chosen**: The staging step's problem was never *which* surface could resolve it, and the shape
  mismatch was never going to be solved by moving the manual-authoring burden around. Removing the
  coupling that created both problems is the fix.

## Consequences

### Positive

- A confirmed signal takes effect in one step, matching the system's original stated purpose.
- No calling surface is treated as a lesser trust tier.
- The `EmergentSignal`/`PersonaTrait` shape mismatch stops being a problem to solve, because nothing
  ever needs to convert one into the other.
- Native personas gain genuine introspection/editing parity with CLI-driven agents.
- Deletes a meaningful amount of dead-weight surface: an entire TUI command, an entire Web modal and hook,
  three prompt/heartbeat renderers, and an extraction lock nothing needs once confirmation is atomic.

### Negative

- Large deletion blast radius across TUI, Web, prompts, heartbeat, extraction gating, schema, and tests.
- Four new write-capable native tools (plus the read tool, five total) instead of one combined
  operation — more registry surface than a single confirm/dismiss call, though measurement (item 3)
  kept it well below the ten-tool discrete alternative.
- No structured pause before an identity write lands, for any caller — the system trusts the acting call
  itself as the decision point, the same trust `ei update persona` already carries today.
- `ei-reflect`'s existing instructions go stale the instant this lands; must be replaced, not left behind.
- Surfaces (without resolving) two more real gaps: native tool-call error-info richness and TUI/Web
  tool-call/result visibility — both tracked as separate local issues, both real trust-model dependencies
  even though neither is this decision's own scope.

### Risks

- **Atomicity assumption.** Deleting the extraction lock assumes confirm resolution is genuinely
  atomic/immediate at the point state actually changes. If the real implementation retains any async
  window, a race the lock used to prevent could resurface. Mitigation: whoever implements item 1 must
  confirm the write path preserves the same atomic-at-drain-time guarantee the old producer had.
- **The heartbeat write-exclusion is only as real as its enforcement mechanism.** Item 4's blanket rule
  is a policy statement until the tool registry actually classifies read vs. write tools; until that
  lands, a new tool can leak into heartbeat's assembled list by omission, exactly like `add_note`/
  `clear_note` do today.
- **Agent-lens scope creep.** Item 9's deferral is deliberately narrow. A future change to Agent-lens
  write authority should re-read item 2 rather than assume ingress-neutrality automatically extends to a
  harness-file write target — a file-based tool's actual reach is a real, separate constraint ADR-001
  already documents.
- **Measurement reproducibility.** The token-cost comparison behind item 3's five-tool design is
  recorded in `evidence/native-tool-token-measurement.md` — a future re-measurement against final
  implementation wording (rather than this record's own drafted schema text) may shift the exact
  numbers, though the structural ~25% saving from action-parameterization should hold.

## Reversibility

**Nothing here is cheap to reverse.** Restoring `pending_update`, both UIs, and their orphaned consumers
means re-authoring a deleted TUI command, a deleted Web modal and hook, deleted prompt/heartbeat
renderers, and a deleted extraction lock — the same scope of work ADR-038 spent building the Web/TUI half
of, except this time with no Critic-era plumbing left underneath to build on top of. The five native
tools are individually additive and could be pulled back without reverting the decoupling principle
itself.

**Effectively one-way in practice.** Once real usage relies on an identity change landing immediately —
and on editing being a Persona's own separate, deliberate act rather than bundled into a signal
confirmation — a human who has come to expect that will notice, and object to, a reversion. That makes
reverting a product regression to be renegotiated, not merely a code revert to perform.

## References

- ADR-038 — item 7 **superseded** by this ADR's items 1, 3, and 6 (confirm no longer proposes or applies
  anything; identity editing is a wholly separate tool set). Items 1–6, 8–12 are unaffected and
  reaffirmed.
- ADR-029 — clause 5 (`pending_update` clearable but not settable) has no remaining subject once the
  field itself is deleted (item 5); ADR-029's general merge-patch discipline for every other field —
  including how CLI/MCP continues to edit identity — is untouched.
- ADR-022 — the embedding-recompute guarantee item 6 requires `update_description` to preserve.
- ADR-001 — the reason item 9's Agent-lens write-authority question stays deferred.
- ADR-014, ADR-031 — the provenance-narrowing precedent the original 2026-08-11 design leaned on;
  no longer load-bearing once the field it protected is deleted.
- ADR-032 — already contains a stale reference to "the reflection critic's `pending_update`," predating
  this record; pre-existing staleness, not introduced here.
- ADR-012 — "Sunset With a Path Forward," the discipline behind outright retirement over an inert husk.
- ADR-037 — the deterministic Update/Reduce reducer step Alternative E would have extended.
- Code this record is pinned against, at the baseline it was written from (local `main`,
  `5c1fc14eab43874356d207e2953679ededcabc0e`): `src/core/state/personas.ts:703-729` (`signal_confirm`'s
  sole remaining `pending_update` producer, to be deleted), `src/core/processor.ts:1436-1471`
  (`finalizeReflection`), `src/core/processor.ts:658-708` (heartbeat's current full-tool-set assembly),
  `src/core/persona-manager.ts:123-151` (the existing embedding-recompute call site),
  `src/core/types/entities.ts:161-196` (`PersonaIdentityDelta`, `PersonaEntity.pending_update`),
  `src/core/types/integrations.ts:62-64` (`PersonaSummary.has_pending_update`),
  `src/core/tools/builtin/persona-notes.ts` (the native direct-write precedent this ADR's tool set
  mirrors), `src/core/orchestrators/human-extraction.ts:76-77,208-215,384-391` and
  `src/core/orchestrators/ceremony.ts:452-473` (the extraction lock), `src/prompts/response/sections.ts:
  165-178` and `src/prompts/heartbeat/check.ts:163-168` (ambient prompt-injection renderers),
  `src/core/heartbeat-manager.ts:272-291,410-412` (the heartbeat nudge), `tui/src/commands/reflect.tsx`
  (whole file) and `tui/src/commands/persona.tsx:205-283` (the TUI surfaces), `web/src/components/
  EntityEditor/PersonaReflectionModal.tsx` and `web/src/hooks/useReflection.ts` (whole files, the Web
  surface).

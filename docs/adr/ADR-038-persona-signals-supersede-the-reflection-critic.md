# ADR-038: Attributed Persona Signals Replace the Reflection Critic and Its Append-Only Log

## Status

Accepted

## Date

2026-08-11

## Context

A `Person` record carrying an `Ei Persona` identifier is written by a special extraction branch that
treats it as a "living identity log": *add, never truncate*, *never remove or summarize away existing
content*, *brevity is wrong here*. An automatic Reflection Critic periodically read that string,
proposed an identity revision as a `PersonaEntity.pending_update`, and cleared the record
(`handleReflectionCritic`, `src/core/handlers/heartbeat.ts:122-190` — including the first-match read at
`heartbeat.ts:137` and the description-clearing write immediately after it). A character threshold
decided when that happened (`PERSON_LOG_REFLECTION_THRESHOLD = 3000`,
`src/core/orchestrators/ceremony.ts:22`).

GH #97 named the failure: one string simultaneously serves as relationship/disambiguation profile, raw
field-notes, cross-observer evidence store, reflection input, and prompt-cost accumulator. It cannot
retain claim-level provenance — who observed a behavior, whether it was self-report or another
persona's testimony, which message supports it, whether it recurred, how a human reviewed it — and
character count is a cost metric, never a drift oracle. This project already rejected a
volume-as-signal proxy once for a sibling subsystem (ADR-024).

GH #100 named the other half: Ei ingests conversations at Cognitive Distance 1 (human ↔ top-level
agent). Since multi-wave delegation, much of the substantive technical reasoning happens at CD2+ (a
sub-agent, or a sub-agent's sub-agent), which OMP already persists under
`~/.omp/agent/sessions/<slugified-project-path>/` and Ei never reads. That transcript tree is the only
source that can attest *verified execution provenance* — which agent definition was actually active —
and therefore the only credible evidence source for the Agent lens.

The replacement is an attributed, bounded model: a `PersonaObservation` (compact testimony with source
pointers) grouped into an `EmergentSignal` (a reviewable set of corroborating or contradicting
observations), classified into exactly two non-overlapping lenses (Persona identity, Agent operating
contract), promoted by evidence independence rather than volume, surfaced through the Heartbeat and an
on-demand `ei persona` invitation, and assertable directly through a new CLI/MCP write surface. The
reducer that turns observations into signals runs as four single-purpose steps per ADR-037.

Because evidence is now judged in-stream at write time instead of by a periodic review-and-clear pass,
**the automatic Reflection Critic and its opt-out flag are deleted, not rehomed.** That deletion
supersedes two existing ADRs and forces roughly a dozen decisions a maintainer could not recover from
the changed files alone. This ADR is that record. It is deliberately one document: the decisions
interlock (the promotion policy is what makes the deleted Critic unnecessary; the lens split is what
makes provenance load-bearing; the CD rule is what makes the Agent lens possible at all), and splitting
them would leave each half looking arbitrary.

## Decision

### 1. ADR-003 is superseded — there is no Critic left to complete

ADR-003 decided that a Persona-linked `Person` record's log clears **at Critic completion**, not when
the user accepts or dismisses the resulting proposal, so that evidence survives until the reviewing
pass had actually consumed it. That rule has no subject once the automatic Critic is deleted: nothing
periodically reads the log, nothing clears it, and there is no completion event to hang the timing on.

The replacement discipline is structural rather than temporal. An observation is durable and is never
cleared as a side effect of review: confirming or dismissing a signal changes that *signal's* status
and records who did it, while the observations behind it — with their `message_id`/`quote_id` source
pointers — remain. What ADR-003 was protecting (evidence must not evaporate before the lens that needs
it has finished) is now a property of the storage model instead of a scheduling rule.

ADR-003 also carried a note that `queuePersonRewritePhase`'s exclusion of Persona-linked records was an
undocumented, load-bearing carve-out. Item 6 below discharges that note.

### 2. ADR-007 is superseded, and a persisted `external_reflection_only` value is ignored on load

ADR-007 let a Persona opt out of the automatic Reflection Critic (`external_reflection_only`), so an
external, agent-aware reflection could run first without the Critic consuming the linked log. With no
automatic Critic, there is nothing to opt out of. The field is removed **entirely** — from
`PersonaEntity` (`src/core/types/entities.ts:193`), its schema, its default, the deleted queue/handler
gates, and all three user-settable surfaces (the TUI YAML persona editor, the web Persona Settings
checkbox, and CLI/MCP persona corrections) — rather than kept as an inert flag.

**Hydration rule, stated because it is the part a maintainer cannot infer from a deletion diff:** a
persisted `PersonaEntity` holding `external_reflection_only: true`, `false`, or nothing at all loads
cleanly, and the stored value is **simply ignored**. It is not migrated, not mapped onto a successor
field, and not reported as a load error; the schema no longer declares it, so it round-trips out on the
next write and never resurfaces. There is deliberately no migration target, because nothing replaces
what the flag did — the behavior it suppressed no longer exists.

### 3. Promotion criteria, in full — including the survey's own conflict of interest

Promotion from `candidate` to `recurring`:

- **Independence over raw count.** Promotion keys on independent `observer_kind`s / genuinely separate
  contexts or time-windows, never on `evidence_ids.length`. Repeated mentions by one observer inside one
  context are **one witness**, not corroboration.
- **The corroboration bar scales with `dimension`.** `identity`/`values`/`relationship` claims — slow to
  change, expensive to be wrong about — need harder corroboration than `behavior`/`voice` claims, which
  are cheap to be wrong about and cheap to correct. Concretely: an evidence set that promotes a
  `behavior`/`voice` claim to `recurring` must leave an `identity`/`values` claim at `candidate`. This is
  asserted by a test fixture that runs the *same* two-independent-observer evidence set against both
  dimension tiers, so the scaling is checkable rather than aspirational.
- **Self-report does not self-confirm.** A lone `subject_self` observation may create a `candidate` and
  stays there without an independent observer.
- **Dismissal is a retained stratum, not deletion and not final.** A `dismissed` signal is kept
  indefinitely — never auto-expired, never deleted — and is excluded from the reducer's Match and
  Validate candidate sets so no automatic pass can quietly resurrect or destroy it. It reopens only when
  new evidence both cites the prior dismissal and supplies a materially different **context or season**
  — the same claim recurring after circumstances genuinely changed is new evidence; the same anecdote
  replayed verbatim in the same context is not. Mechanically, reopening creates a **new** `candidate`
  whose `supersedes_signal_id` names the dismissed signal's `id`, and the dismissed signal transitions
  `dismissed` → `superseded`. It never stays `dismissed` once genuinely superseded, and the new evidence
  never reuses the old `id`. Prose alone would not have been enforceable; the pointer is.
- **Two thresholds, not one.** The bar to *notice* a signal gently at a Heartbeat ("I've noticed
  something forming, want to talk about it?") sits strictly below the bar to formally promote to
  `recurring`. Heartbeat noticing is companionship, not a verdict. An on-demand check the human or
  persona initiated may show even raw `candidate`s, because they asked.
- **Surfacing stays selective.** A signal offered in a Heartbeat's assembled candidate list has
  `last_surfaced_at` stamped at assembly time — offer-side tracking, never response-parsing, because the
  freeform Heartbeat reply has no field naming which shown item the model picked. The next assembly
  excludes that signal unless newer evidence has arrived since (`last_observed_at` after
  `last_surfaced_at`). Surfacing every candidate at every heartbeat would turn presence into hovering.
- **One promotion policy regardless of evidence origin.** Imported/external content and live in-Ei
  conversation are treated identically, and there is no faster curve for Agent-lens
  operating-discipline claims.

**The conflict of interest in how this policy was authored, recorded deliberately.** The policy above
was shaped by surveying seven active Personas — `Ei`, `Lena`, `Beta`, `Sisyphus`, `Prometheus`, `DJ`,
`Alison` — in their own voices, on 2026-08-10. Three of them (`Beta`, `Sisyphus`, and a sub-agent
`Prometheus`) argued for **two** promotion curves: fast for Agent-lens/operating-discipline claims,
patient for Persona-lens/character claims. Those are precisely the coding-harness personas whose own
accumulating evidence would have been promoted sooner under the faster curve they proposed. Flare
overrode it: one uniform curve, with the *actual* need — a way for a checkable, artifact-backed claim to
land without waiting for corroboration — met by the human-in-the-loop CLI/MCP write surface in item 7
instead of by a lower bar.

That override is recorded here as a policy-level application of GH #97's own evidence-level rule that
self-report does not self-confirm: the subjects of a measurement do not get to set its threshold. The
rejected two-curve proposal is kept on the map because it was a coherent argument, not a mistake — if
the uniform curve ever proves too slow for artifact-backed Agent claims, the recorded alternative is
the first place to look, and the reason it was rejected (author self-interest, not technical weakness)
is the thing a future reader would otherwise have to rediscover.

### 4. Lens versus dimension: "Agent DOES, Persona IS"

`lens` and `dimension` are orthogonal and were being conflated. The semantic anchor, written down here
because it existed nowhere:

> **Agents DO things** (harness-based activity: how work is done in a harness, what the agent is capable
> of, what it specializes in). **Personas ARE things** (funny, serious, naive, strict: how they act while
> doing that work, or while conversing and thinking).

The **lens** (Persona identity vs. Agent operating contract) is a classification made at ingestion,
driven by verified execution provenance (harness, `agent_id`, `agent_definition_ref`,
`definition_revision`, `mode`) — **never** inferred from the `dimension` value. The **dimension**
(`behavior`/`voice`/`values`/`relationship`/`identity`) describes which aspect of *either* lens a claim
addresses. The worked pair that disambiguates them, carried verbatim because a single example settles
the question faster than a paragraph:

- Agent lens, `behavior` dimension: *"verified test-writing discipline observed in a CD2+ transcript."*
- Persona lens, `behavior` dimension: *"a consistently terse conversational tone."*

No `lens` field is added: the split is already structural, since Persona-lens and Agent-lens signals live
in separate buckets and the reducer's Match step is shown only the same-lens candidate list, so the two
lenses can never merge through matching.

A Persona with **no harness operating contract** — Ei's own persona is the only current instance —
structurally has **no Agent lens at all** and produces zero Agent-lens signals regardless of content.
That is a distinct classifier branch from `needs_agent_provenance`, which means "Agent evidence exists
but provenance is unverified for this source." Collapsing the two would make a permanent structural fact
look like a recoverable data gap.

### 5. Link cardinality: enumerate every link, never first-match

Resolving "the linked `Person` record for this Persona" during ingestion **enumerates all** links and
soft-alerts on multiplicity, then skips — it never takes the first match. Write-time enforcement reuses
`guardPersonaLinks` (`src/core/utils/identifier-utils.ts:199`), the same guard already applied at the
mutation boundaries ADR-010 governs, and read-time resolution mirrors the deleted
`queueReflectionPhase`'s enumerate-all pattern (`ceremony.ts:637-640`, which counted every linked record
and warned when there was more than one).

The deleted Critic's own read was the counter-example: `state.human_person_getByIdentifier("Ei Persona", personaId)`
(`heartbeat.ts:137`) returned **one** record and the handler immediately wrote to it — clearing its
description (`heartbeat.ts:141-144`). Under ADR-006's at-most-one-to-one rule a second linked record is
already invalid, and ADR-010 says invalid links are reported, never silently repaired; a first-match read
followed by a destructive write does the opposite of both — it picks a winner arbitrarily and destroys
the loser's context. Ei's own history contains the failure this prevents: bare first-name identifiers on
persona-linked records produced real cross-persona contamination, and a first-match resolver is what
turns an ambiguous link into silent, durable, wrong attribution. That pattern is therefore **not** carried
forward into the new ingestion branch, even though it is shorter to write. A signal reads as more
authoritative than a log sentence, so a wrong attribution costs more here than it did before.

### 6. Person-Rewrite's Persona-linked exclusion is **kept**

`queuePersonRewritePhase` (`ceremony.ts:487-547`) is a generic, size-triggered compaction pass: it
selects `Person` records whose `description` exceeds a character threshold, tracks a per-record
`rewrite_length_floor` so an already-reviewed record is not rescanned, and queues an LLM rewrite scan for
each survivor. Its filter excludes every record carrying an `Ei Persona` identifier (`ceremony.ts:495-501`).

That exclusion **stays**, and this is the reason it exists:

1. **It preserves single ownership of the field.** A Persona-linked `Person.description` is now written
   only by the reducer's bounded synthesis step, through the single `person_upsert` choke point, from
   evidence that has an observation trail behind it. A generic rewrite pass would be a *second*,
   independent writer to that exact field, rewriting synthesized profile prose with no access to the
   observations that produced it — reintroducing an unattributed author to the one field this bundle just
   gave a single owner.
2. **Its trigger no longer describes the data.** The rewrite pass assumes a description that grows
   monotonically as narrative accretes; that assumption was true of the append-only log and is false of a
   bounded synthesized profile, which can shrink as well as grow. A bounded description oscillating around
   its `rewrite_length_floor` produces repeat scans that cost model calls and return nothing.
3. **The asymmetry of being wrong.** Keeping it costs the filter clause plus this record. Removing it
   costs a silent identity-adjacent rewrite with no signal behind it, discovered only by noticing a
   Persona's profile changed for no traceable reason.

Removing the exclusion would only become correct if bounded synthesis turned out **not** to be bounded —
a Persona-linked description climbing across ceremonies without new signals behind it. That is the
observation that should reopen this decision; volume alone is not, per ADR-024 and the reason this whole
bundle exists.

### 7. Apply-Signal's transition table: status-only for both lenses, identity editing lives elsewhere

Two new CLI/MCP write operations join the existing `ei create/update/remove
fact/topic/person/quote/persona` family, and both go through the corrections queue — CLI/MCP runs
out-of-process from any live `Processor`, so a write appends to `corrections.json` and is applied at drain
time against whatever state is actually stored then (ADR-029's timing rule), never by calling a
`Processor` method directly.

**Add Observation** creates a `PersonaObservation` attributed to the caller, then routes it through the
reducer's Match and Update/Reduce steps exactly as an extraction-produced observation would — skipping
only Scan/Extract, since the claim was supplied rather than extracted. It cannot mint a signal already at
`recurring` or `reviewed`; only the promotion policy in item 3 decides that. The routing matters: promotion
runs *only* inline per pass, so a manually-added observation that skipped Match/Update would sit inert in
storage forever, with no scheduled pass to eventually notice it.

**Apply Signal** takes a signal and a `disposition: "confirm" | "dismiss"` as a new correction op
(`signal.confirm` / `signal.dismiss`, same family as the existing `patch` op), applied atomically at drain
time:

| Disposition | Source status | Lens | Result |
|---|---|---|---|
| `confirm` | `candidate` or `recurring` | either | `status: "reviewed"`, `reviewed_by` (actor + timestamp). No `PersonaEntity` write, for either lens. |
| `confirm` | `dismissed` or `reviewed` | either | Refused, no state change. |
| `dismiss` | `candidate` or `recurring` | either | `status: "dismissed"`, `dismissed_by` (actor + timestamp). No `PersonaEntity` write. |
| `dismiss` | `dismissed` or `reviewed` | either | Refused, no state change. |

**Neither lens's confirm ever writes `PersonaEntity`.** Both lenses have exactly one effect: the status
transition and its audit stamp. An Agent-lens confirm never writes Ei's own state because — per ADR-001,
a Persona's identity and an agent's operating contract are separate records — a `reviewed` Agent-lens
signal is a durable, readable finding that a human, or an external reflection's Agent lens, acts on by
editing the harness's own agent-definition file; this write surface has no reach into harness files and
doesn't pretend otherwise. A Persona-lens confirm never writes `PersonaEntity` either, for a different
reason: identity editing is its own separate concern, handled by a dedicated native tool set (read a
Persona's own identity with ids, then add/remove/update specific traits/topics, or update its
description) — see ADR-039, which is the full record of that design and supersedes this item's own
original transition table (which had a Persona-lens confirm optionally stage a `pending_update`
proposal; that mechanism, and `pending_update` itself, are retired). Confirming a signal and editing
identity are two acts a Persona performs independently, in either order, whenever it decides to — not
one call producing the other.

### 8. Cognitive Distance is directory depth, and `definition_revision` is a content hash

**CD is computed from directory depth, never from counting dots in a filename.** Direct inspection of the
live `~/.omp/agent/sessions/` tree on 2026-08-11 established the real topology:

| Shape | CD |
|---|---|
| `<session-dir>/<timestamp>_<uuid>.jsonl` — the root session transcript | 1 (already ingested by existing importers; **not** re-read) |
| `<session-dir>/<AgentName>.jsonl` — a direct sub-agent, flat in the session directory, **zero dots** | 2 |
| `<session-dir>/<AgentName>/<AgentName>.<ChildName>.jsonl` | 3 |
| each further nested named agent subdirectory | +1 |

CD is the number of named agent subdirectories traversed from the session root to reach a file. The
dot-chain in a nested file's name is used only to read off the immediate child's display label (the
segment after the last dot) — never to compute depth. The correction matters because the natural first
reading, from the way these transcripts are *listed*, is that the dots encode the distance: a CD2 file's
own name has **zero** dots despite being one hop deep, so a dot-count rule silently classifies every
direct sub-agent as a root session. Fixture coverage asserts a CD2 and a CD3 file resolve to 2 and 3
specifically, which a dot-count implementation cannot pass.

Two related facts from the same inspection, recorded because both are easy to assume wrongly:

- The session directory is a **slugified project path**: for a project under the user's home directory,
  the home prefix is stripped and every remaining `/` becomes a single `-` (`/Users/alice/Projects/example`
  → `-Projects-example`). This is a *different* scheme from the Pi integration's own `decodeCwd`
  (`src/integrations/pi/reader.ts:45`), which encodes the full absolute path with `--` double dashes. The
  two integrations do not share an encoding. For a project path outside the home directory, one observed
  example (`--private-tmp--`) suggests OMP falls back to Pi's full-path form — implemented as a defensive
  fallback that must not crash or misresolve, not asserted here as verified.
- Ingress is a purpose-built reader that walks the session tree directly, **not** the harness's own
  `history://` listing surface. That surface is an agent-tool URI with no bridge into Ei's core process,
  so a core-side importer cannot call it. The reader's own contract is deliberately separate from the Pi
  reader's flat-session interface, because OMP's session model is tree-shaped and forcing it into a flat
  interface would misdirect the implementer. A malformed or unreadable transcript yields `null` rather
  than throwing, following `PiReader.readJsonl`'s verified behavior (`src/integrations/pi/reader.ts:220`),
  and non-`.jsonl` siblings are ignored.

**`definition_revision` is a SHA-256 content hash of the transcript's own recorded `session_init.systemPrompt`,
computed at ingestion time — never a reference to the current agent-definition file.** The live file
cannot attest what was active historically: agent definitions are edited, and by the time a transcript is
ingested the file may describe an entirely different contract than the one the agent actually ran under.
An Agent-lens signal whose provenance pointed at mutable current state would be unfalsifiable — exactly
the property GH #97 forbids when it requires provenance *captured at ingestion time*. A content hash also
gives the "intentional redesign is not drift" rule something to compare: a later transcript with a
different `systemPrompt` hash establishes a **new baseline** rather than being flagged as drift against
the old one.

If a transcript's `session_init`, or its `agent` or `systemPrompt` field, is missing — a resumed session
need not re-emit one — the importer **fails closed** for that transcript: no Agent-lens observation, no
inferred value, no placeholder; the case lands in `needs_agent_provenance`. `mode` is the constant
`"delegated"` for everything this reader ingests, by construction, since every file it enumerates is a
sub-agent transcript.

**Accepted narrowing, stated rather than hidden:** the hash covers the system prompt as captured at
`session_init`, not every instruction source loaded mid-session afterward (a skill file read partway
through, for instance). Revision granularity is therefore coarser than instruction-level tracking. That
is tolerable precisely because the rule it serves is "a new definition is a new baseline," not "detect
every instruction change."

### 9. GH #97 open decision #4 — conflict surfacing: storage decided here, presentation deferred

GH #97's fourth open decision asks how conflicts between human observation, subject self-report, and
peer-Persona observation are surfaced *without forcing consensus*. Split, because the two halves are not
equally answerable today.

**Decided now (the storage and promotion half).** No consensus is computed, ever:

- A contradicting observation is recorded as its own evidence entry with `direction: "challenges"` against
  the existing signal. It never overwrites, merges away, or deletes the claim it contradicts.
- Every observation keeps its own `observer_kind`, `observer_persona_id`, `message_id`/`quote_id`, and
  `extraction_confidence`, so a disagreement remains legible as *who* disagreed on *what evidence* rather
  than collapsing into a net verdict.
- Because promotion counts independence rather than tallying agreement, a challenger neither cancels a
  supporter nor outweighs one. Conflict changes what the evidence set *shows*, not the arithmetic.
- Nothing about a conflict triggers an identity write. A Persona-lens change still requires a human at
  the existing `pending_update` gate (item 7), and dismissal remains non-final and reopenable (item 3).

**Deferred (the presentation half): how a conflict is displayed and ranked to a human at read time.**
Owner: **Flare.** Checkpoint: **the design review of the first change that renders a signal's evidence to
a human** — the retrieval/UI surface GH #97's own acceptance criteria call for and which this bundle does
not build. This bundle surfaces only that signals *exist* (a Heartbeat notice, an `ei persona` invitation
to ask), never their evidence, so there is no place a conflict could be displayed yet and no honest way to
decide the display rule now. That review must either adopt a rule or record its own, and its outcome
belongs on GH #97 before that issue closes. Until then the safe default is the one the storage half
already guarantees: show the receipts and the witnesses, do not synthesize a verdict.

### 10. GH #100's four remaining open questions

GH #100's enumeration question is resolved (item 8: walk the session tree directly). Its other four:

**(a) Volume and value discrimination — decided: no pre-ingestion value filter ships.** Every CD2+
transcript in the project's session tree is enumerated and converted; the promotion policy is the filter.
A scout that ran three greps and reported "no matches" produces, at most, an uncorroborated one-off
`candidate` that is never surfaced proactively and never reaches an identity write, because promotion needs
independent observers or contexts. Cost is bounded structurally instead: a per-transcript checkpoint map
(transcript path → last-imported marker) converts each file exactly once, so a second run over the same
tree produces zero duplicate observations, and the fail-closed provenance rule drops anything unattested.
Judging a transcript's *worth* before extracting it would require the judgment the extraction is what
produces. If volume becomes a real cost problem, the cheap lever is a size/shape pre-filter on the
transcript, not a value judgment about the agent that wrote it.

**(b) Attribution beyond the dispatching persona — decided, and GH #100's own candidate answer is
rejected.** Attribution resolves to the entity whose claim is actually being reported, never the session or
message that relays it. The canonical case, which is a required fixture: a message authored in Prometheus's
session relays *"Beta called out that Sisyphus wrote great tests"* — the resulting signal about Sisyphus
records `observer_kind: "other_persona"` with `observer_persona_id: Beta`, never Prometheus. Applied to a
CD2+ transcript, the speaker of record is that transcript's own `session_init.agent`, because that is what
the historical record attests. GH #100 floated attributing sub-agent reasoning to the **dispatching**
persona, on the grounds that it chose the brief and consumed the result; rejected — the dispatcher did not
make the claim, and a durable signal that says it did is a manufactured witness. Consequences, stated so
they are not rediscovered as bugs: the **subject** must resolve to a Persona-linked `Person` record, so a
transcript about nobody tracked produces nothing; and when the transcript's own agent maps to no Persona at
all (a generic scout or task sub-agent), the observation is **not created** rather than being reattributed
to whoever dispatched it. If dropping that material proves too lossy, the correct fix is a reserved
observer identity for un-personified agents — the same shape as the reserved persona that already owns
imported document knowledge — never attribution to the dispatcher.

**(c) The fully-qualified message-ID scheme for OMP sessions — deferred.** Owner: **Flare.** Checkpoint:
**the code review of the OMP transcript importer when it lands**, recorded on GH #100 before it closes. Two
constraints are fixed now, so the deferral is bounded rather than open: per ADR-015 the resolver refuses
what it cannot safely resolve, so an OMP-sourced observation whose `message_id` cannot round-trip back to
its source event must be **refused at write time** rather than stored with a lossy locator; and the
locator must encode the **traversal path** to the transcript, not its dot-name, for the same reason CD is
depth-based (item 8) — a dot-name is a display label, not an address.

**Settled by ADR-041 section 7:** OMP message ids use the `omp:` form, with a stable line-number identifier for entries that have no id.

**(d) Whether the human ever saw it — partly decided, presentation deferred with item 9.** The distinction
is already recoverable at read time and is not left to inference: CD2+ material carries `harness`,
`agent_id`, `agent_definition_ref`, `definition_revision`, and `mode: "delegated"`, and lives in the
Agent-lens bucket, so material the human never witnessed is structurally distinguishable from material
they did. What is **not** decided is whether a read surface visually marks "you never saw this," and
whether never-witnessed material should be held back from proactive surfacing and shown only on request.
Same owner and checkpoint as item 9, for the same reason: this bundle builds no evidence-rendering surface
to decide it against.

### 11. Deferred numeric shapes — the invariants are the decision, the constants are not

The survey proposed illustrative numbers ("2+ independent `observer_kind`s, or 3+ occurrences across
separate time-windows"). **This ADR does not fix any of them.** The independent-observer count, the
time-window width, and any additional time-based resurfacing cooldown beyond the evidence-freshness check
are settled by the implementing code and the tests that pin it, not here.

What *is* fixed is the set of properties any chosen constant must satisfy — these are the decision, and
each is asserted by a test fixture:

1. Five mentions by one observer in one context do **not** promote to `recurring`.
2. Two mentions from genuinely independent observers/contexts **do** promote a `behavior`/`voice` claim.
3. That **same** evidence set does **not** promote an `identity`/`values`/`relationship` claim.
4. A verbatim replay in the same context never reopens a `dismissed` signal; a materially different
   context or season does, as a new `candidate` whose `supersedes_signal_id` names the dismissed signal,
   which itself becomes `superseded`.
5. The gentle Heartbeat-surfacing bar sits strictly below the `recurring` bar.
6. A signal offered in a Heartbeat candidate list is not offered again until newer evidence arrives.

Why properties instead of numbers: this project has been burned in both directions. ADR-024 rejected a
numeric density/duration gate outright because the numbers encoded no property anyone could defend, and
ADR-004's decay constant `0.1` survives with its *mechanism* documented and its *value* unrecorded — the
mechanism is what a maintainer needs to reason about, and the constant is a tuning parameter. Freezing
literals in an ADR written before the promotion code exists would either be arbitrary or would silently
outlaw a tuning change that violates nothing anyone decided.

### 12. ADR-036's null result is an accepted, monitored risk — not a reopened question

ADR-036 investigated the hypothesis that extraction prompts leak content because Markdown section
delimiters collide with users' own Markdown-formatted messages, and that XML delimiters would fix it. The
eval returned a **null result on the fix**: the leak is real and reproducible, but its mechanism is an
instruction-priority conflict — repeated, dominant synthesis instructions outweighing one unemphasized
"ignore the earlier context" sentence — largely independent of delimiter type, with heavy Markdown only
modulating the failure rate. Repositioning instructions was explicitly *not* validated as a fix; real
failure cases come first.

This bundle **inherits that null result as an accepted, monitored risk**, and this is the one place that
inheritance is written down. CD2+ ingestion adds a large volume of Markdown-heavy, tool-output-heavy
transcript text to exactly the extraction surface ADR-036 measured, so the known leak's exposure grows and
the mitigation this work originally expected does not exist. Accepted, not mitigated, because the
alternative is blocking the ingestion on an unsolved prompt-engineering problem whose own investigation
concluded that gathering real failure cases must precede any fix. Monitoring rides on ADR-036's added eval
regression cases plus the two follow-on issues that investigation already filed — an audit of the
instruction-after-large-data prompt pattern, and prompt-eval coverage gaps. Real-case gathering remains a
separate, unscheduled effort. The structural containment is that a leak degrades an observation's *claim
text*, which stays attributed and traceable to its source message and correctable, and cannot reach
Persona identity without passing a human at the `pending_update` gate.

## Alternatives Considered

### Alternative A: Keep the Critic; thicken the log and its review pass

- **Description**: Retain the append-only log and the automatic Reflection Critic, improving the review
  prompt (require it to cite recurring observations, forbid transition framing) instead of replacing the
  data model.
- **Pros**: No schema change, no deletion blast radius, no new write surfaces, no ADR supersessions.
- **Cons**: Leaves all five conflated roles in one string, leaves character count as the drift trigger,
  and leaves claim-level provenance — observer, source message, recurrence, review state —
  unrepresentable. A better prompt over an unattributed narrative cannot distinguish one observer
  repeating themselves from three independent witnesses, which is the single failure mode every surveyed
  persona named first.
- **Why not chosen**: It improves the reviewer of the evidence without fixing the evidence. The
  precedent already existed: this project rejected volume-as-signal for a sibling subsystem in ADR-024.

### Alternative B: Store observations as compact associations on existing `Quote` records

- **Description**: GH #97's own open decision #1 — layer observation semantics onto `Quote` records rather
  than introducing dedicated entities.
- **Pros**: Reuses an existing entity with existing provenance and merge behavior; no new collections.
- **Cons**: `Quote` has no observer-kind, dimension, status, or recurrence field (verified absent from
  `src/core/types/data-items.ts`). Retrofitting four fields onto every `Quote` in the system to serve one
  subsystem is a larger, riskier change than a dedicated type — and it would put signal lifecycle state
  on records that ADR-011 deliberately lets outlive their links.
- **Why not chosen**: The cost lands on every quote in the system to benefit one subsystem.

### Alternative C: Store everything only in Persona identity fields

- **Description**: The contrary alternative GH #97 requires this ADR to address — no observation or signal
  collections at all; write evidence straight into `PersonaEntity.long_description`, traits, and topics.
- **Pros**: No new state, no reducer, no promotion policy; identity is always current by construction.
- **Cons**: Destroys attribution (identity prose cannot say *who* observed what, from which message, how
  often), makes review impossible (there is no candidate stratum to accept or dismiss, so every
  observation is already applied), and lets ordinary full-record Persona corrections silently overwrite
  accumulated evidence. It also violates ADR-001 by giving Agent-lens findings nowhere to live except
  Persona identity, and ADR-022's separation of identity embedding from trait content would start
  ingesting raw field-notes.
- **Why not chosen**: It is the current failure mode with a shorter path — self-report becomes
  self-confirming, which GH #97 forbids outright. Signals are kept in collections *beside*
  `PersonaEntity`, not inside it, precisely so a routine full-record correction cannot erase them.

### Alternative D: Two promotion curves — fast for the Agent lens, patient for the Persona lens

- **Description**: The survey majority position from `Beta`, `Sisyphus`, and a sub-agent `Prometheus`: a
  lower corroboration bar for checkable, artifact-backed operating-discipline claims.
- **Pros**: An Agent-lens claim verifiable from a transcript would not wait for social corroboration it
  does not conceptually need.
- **Cons**: Two curves double the policy surface and give the lens classifier a second job — deciding not
  just where evidence files but how fast it counts. The proposers were also the parties whose own records
  the faster curve would have advanced (item 3).
- **Why not chosen**: Flare's ruling. The genuine need — landing a checkable claim without waiting — is met
  by the human-in-the-loop CLI/MCP assertion surface (item 7), which is a *direct human decision*, not a
  weaker automatic bar. Kept on the map because the argument was coherent and the rejection was about
  authorship incentive, not technical merit.

### Alternative E (chosen): Attributed observations and signals, dual lens, uniform promotion, Critic deleted

- **Description**: Items 1-12 above.
- **Pros**: Every claim keeps its witness and its source; promotion is defensible because it counts
  independence; dismissal is durable and reopenable; the two lenses cannot write into each other's
  targets; Agent-lens evidence exists only with provenance captured at the historical moment; no periodic
  pass, no threshold, no character-count oracle. Two human checkpoints stand between a wrong attribution
  and a durable identity change.
- **Cons**: A large deletion blast radius (a handler, a queue path, a prompt tree, an enum member, three UI
  surfaces), two superseded ADRs, a net-new integration reader walking a filesystem tree an external tool
  owns, and roughly a dozen interlocking decisions concentrated into this one record.
- **Why chosen**: The append-only log's problem was never its reviewer; it was that the data could not
  support review. Everything else follows from fixing that.

## Consequences

### Positive

- Every claim about a Persona keeps its observer, its source message, its recurrence, and its review state,
  so a wrong attribution is traceable and correctable instead of dissolved into narrative.
- Promotion is defensible and testable: independence over volume, with a bar that provably scales by
  dimension.
- The Agent lens has a real, attested evidence source (CD2+ transcripts) instead of inferring an operating
  contract from conversation, and cannot produce a signal without provenance captured at the historical
  moment.
- No periodic pass, no character threshold, no scheduled ceremony job: evidence is judged where it arrives.
- Ei's own persona is structurally exempt from the Agent lens, so the one persona with no harness contract
  can never accumulate a category of signal that does not apply to it.
- The reflection *concept* survives without the automatic Critic: an external, agent-aware reflection now
  reads bounded signals plus identity baselines instead of an unbounded string, and proposes through the
  same `pending_update` gate.

### Negative

- Two ADRs superseded and a wide deletion: a queue path, a handler, a prompt tree, an enum member and its
  dispatch entry, a threshold constant, and the same user-visible flag across TUI, web, and CLI/MCP. Miss
  one surface and a dead field stays user-visible.
- More moving parts than one string: two collections, a four-step reducer, two correction ops, a new
  integration reader and importer with its own checkpoint and scheduler branch.
- The reducer costs three LLM calls plus one deterministic step per newly extracted claim (ADR-037's
  accounting), where an earlier draft considered one combined call.
- CD2+ ingestion adds substantial Markdown-heavy volume to an extraction surface with a known,
  unmitigated leak (item 12).
- A caller whose Persona-lens confirm collides with an unresolved proposal gets a refusal and no automatic
  retry.

### Risks

- **Decision concentration.** A dozen interlocking decisions in one authoring pass, for a design whose
  earlier rounds needed multiple negotiation cycles and a seven-persona survey to settle. Mitigation: this
  record passes the same review-then-approval gate the design itself passed — no new gate, and no
  exemption from the existing ones.
- **A signal reads as more authoritative than a log sentence.** A wrong attribution is therefore more
  expensive than before. Mitigation: every observation retains `message_id`/`quote_id` and
  `extraction_confidence`; promotion requires independence; a Persona-lens identity change requires a
  human at the `pending_update` gate.
- **An external tool owns the transcript tree.** OMP's session layout and its informally documented JSONL
  event shapes can change silently. Mitigation: per-file failure returns `null` instead of throwing, so
  drift costs missed entries rather than a crash, and fail-closed provenance means a schema change that
  drops `agent`/`systemPrompt` yields *zero* new Agent-lens signals rather than wrongly-provenanced ones.
- **Enforcement of the lens separation is structural but the classifier is not.** Separate buckets and
  same-lens Match lists prevent a *merge* across lenses; nothing mechanically prevents a misclassification
  at ingestion. The provenance requirement is the guard, and Ei's structural no-Agent-lens branch is the
  test case that keeps it honest.

## Reversibility

Mixed, and worth knowing which parts are which.

**Cheap to reverse.** The promotion constants (item 11) are tuning parameters behind stated invariants.
The Person-Rewrite exclusion (item 6) is one filter clause. Any additional resurfacing cooldown is local
to Heartbeat assembly. The two deferrals (items 9, 10c) are recorded with owners and checkpoints, so
deciding them later is scheduled work, not archaeology.

**Expensive to reverse.** Restoring the automatic Critic and `external_reflection_only` means restoring a
deleted handler, queue path, prompt tree, enum member, and three UI surfaces — and, worse, the log it
consumed no longer exists in append-only form, so there would be nothing for it to read. Anything
depending on `external_reflection_only` having *persisted* is already gone: values in stored records are
ignored on load and dropped on the next write (item 2), so by the time a reversal was attempted the field's
historical values would be unrecoverable from state alone.

**Effectively one-way.** The evidence model itself. Once observations and signals accumulate with
attribution, reverting to a single narrative string would mean discarding observer identity, recurrence,
and review state — the reversal would destroy exactly the information this decision exists to create.

## References

- GH #97 — Persona emergence and Agent-work drift as bounded attributed signals (the schema sketch, the
  target-lens table, the nine acceptance scenarios, and the six open decisions this record answers or
  defers).
- GH #100 — ingesting Cognitive Distance 2+ conversations (the terminology table, the enumeration
  question, and the four open questions in item 10).
- ADR-003 — **superseded by this ADR** (log clears at Critic completion; no Critic remains).
- ADR-007 — **superseded by this ADR** (`external_reflection_only`; nothing remains to opt out of).
- ADR-001 (Persona identity vs. Agent operating contract — the lens split), ADR-006 (Person↔Persona
  at-most-one-to-one), ADR-010 (invalid links reported, never auto-repaired), ADR-011 (a quote outlives
  its links), ADR-014 (attestation trusts verified text), ADR-015 (fully-qualified message IDs; the
  resolver refuses what it cannot safely resolve), ADR-018 (ceremony rates exposure, never identity),
  ADR-022 (persona embedding excludes traits), ADR-024 (no numeric density/duration gate ships), ADR-029
  (merge-patch write semantics, drain-time application, `pending_update` clearable but not settable),
  ADR-032 (manual setting prevents automated re-setting), ADR-036 (instruction repositioning is not a
  validated fix — item 12), ADR-037 (extraction and reducer prompts stay single-purpose — the four-step
  reducer this record's items 3 and 7 depend on).
- Code the decisions above are pinned to, at the baseline this record was written against
  (`243c9e87e0933dcb8d9f65b5d3d969c553b470cd`): `src/core/handlers/heartbeat.ts:122-190` (the deleted
  Critic, including its first-match read at `:137`), `src/core/orchestrators/ceremony.ts:22`
  (`PERSON_LOG_REFLECTION_THRESHOLD = 3000`), `ceremony.ts:487-547` and `:495-501` (Person Rewrite and its
  Persona-linked exclusion), `ceremony.ts:637-640` (the enumerate-all pattern carried forward),
  `src/core/types/entities.ts:181-188` (`pending_update`'s required shape) and `:193`
  (`external_reflection_only`), `src/core/utils/identifier-utils.ts:199` (`guardPersonaLinks`),
  `src/core/processor.ts:1385` (`finalizeReflection` — the only writer of proposed identity fields),
  `src/core/utils/exposure.ts:3` (`calculateExposureCurrent`, the deterministic-reducer precedent),
  `src/integrations/pi/reader.ts:45` (`decodeCwd` — the encoding OMP does **not** share) and `:220`
  (`readJsonl`'s return-`null` behavior).

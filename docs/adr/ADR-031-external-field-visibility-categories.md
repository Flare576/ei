# ADR-031: External Callers See Four Field Categories, Not the Whole Entity

## Status

Accepted

## Date

2026-08-04

## Context

Ei's CLI and MCP surfaces let an external caller — an agent in a coding harness, a shipped skill, or a human
running `ei` — read and write knowledge-base records. Until now there was **no stated rule about which fields
that caller may see or set.** The input schemas accepted roughly whatever the entity carried, and the read paths
returned roughly everything.

That produced three separate classes of problem, all found within one release cycle:

**1. A caller could assert provenance.** `learned_by`, `last_changed_by`, `interested_personas`, `sources`,
`learned_on`, `last_mentioned` are all accepted on external input today
(`src/cli/corrections-endpoints.ts:66-154`), and `last_changed_by` is unvalidated passthrough (`:82-87`). So an
external caller can claim *who* learned a fact and *when* — exactly the class of claim ADR-014 spent its whole
argument refusing to let callers make about quotes: trust comes from the system deriving a value, never from the
caller asserting it.

**2. A caller could set values the system immediately overwrites.** `exposure_current` is accepted with a default
of `0`, and the ceremony recomputes it every cycle (`src/core/orchestrators/ceremony.ts:385-430`, `:299-341`).
Accepting it is a promise the system does not keep.

**3. Two representations of one field met at the boundary.** `PersonaEntity.tools` is stored as `string[]` but
exposed externally as a nested `{provider: {tool: boolean}}` map. That divergence blocked a merge-patch design
(ADR-029) because there is no single schema producing a whole `PersonaEntity` — every input schema infers a
narrower type, and `tools` is where the two shapes are incompatible.

### This formalises mechanisms that already existed unnamed

The codebase had already grown three of these ideas without a name for any of them:

| Existing mechanism | Location | Category it turns out to be |
|---|---|---|
| `PERSONA_ROUND_TRIP_FIELDS` strips fields on write, keeps them on read | `src/cli/persona-corrections.ts:178` | **System Visible** |
| `description_embedding` never accepted, explicitly deleted from output | `src/cli/retrieval.ts` (`lookupById`) | **System Hidden** |
| The external tools path is *"deliberately stricter"* than the TUI's lenient one | `src/cli/persona-corrections.ts:216-220` | the external/in-harness split this whole ADR rests on |

That third comment is the important precedent: the code already distinguished an external caller from the
in-harness TUI, and explained why. This ADR names that distinction and applies it consistently.

## Decision

**Every field on every externally-reachable entity belongs to exactly one of four categories.**

| Category | External caller may | Test |
|---|---|---|
| **Full Access** | read, create, update | The property has **external meaning** — it describes or affects something outside Ei's own runtime |
| **Clearable** | read, delete (send `null`) | It is system-authored, but a caller has a legitimate need to *dismiss* it |
| **System Visible** | read | No external meaning, but a caller can usefully **reason** about it |
| **System Hidden** | nothing — absent from reads, ignored on writes | Neither |

### The two tests are different, and both are needed

**Editable is decided by external meaning.** `external_reflection_only` says so in its own name: it exists so an
*external* agent can opt a persona out of Ei's automatic critic (ADR-007). By contrast `tools` only affects what a
persona can do *inside* the harness; `heartbeat_delay_ms` only affects how often Ei acts on its own; `model` only
affects which LLM Ei dispatches to.

**Visible-vs-Hidden is decided by whether a caller can reason from it.** `is_static` tells an agent whether a
persona may be deleted. `group_primary` answers *"what can PersonaA see, in the app."* Neither is settable, both
are worth knowing. Whereas `last_heartbeat` is *"useful debugging info, but that's not what the CLI/MCP is for —
if you need that, `state.json` is right there."*

**That last point generalises, and settles future cases without another conversation: debugging data is not a
CLI/MCP concern. `state.json` is the debugging surface.**

### Hidden means not caller-**supplied** — not not-**written**

A Hidden field may still be written, by the system, during an external write. `description_embedding` is
recomputed on every update. `rewrite_length_floor` **must** be recomputed on external update, or the next ceremony
re-flags a record the user just finished editing (see ADR-032).

Read naively, "Hidden" implies "untouched," and an implementer acting on that reintroduces exactly that bug. The
category governs the **caller's** access, not the system's.

### Scope: this governs DATA, not the APP

This model covers managing the knowledge base — Personas, People, Topics, Facts, Quotes. It deliberately does
**not** provide a way to configure Ei itself. That is why five real settings (`model`, `heartbeat_delay_ms`,
`context_window_ms`, `include_message_timestamps`, `context_boundary`) are **Hidden rather than absent**: they
exist, they matter, and they are simply not this surface's business.

App and settings management is expected to arrive as its own surface — likely a `conf` sub-command, which will
need Providers and models-as-sub-elements — with its own contract. A future reader should not conclude this ADR
should have covered them.

## The categorisation

### PersonaEntity

| Field | Category | Note |
|---|---|---|
| `display_name`, `aliases` | Full Access | |
| `short_description`, `long_description` | Full Access | Identity; see ADR-032 — automation may propose but not apply |
| `traits`, `topics` | Full Access | Complex nested; arrays replace wholesale under ADR-029 |
| `avatar_emoji`, `avatar_image`, `preferred_theme` | Full Access | |
| `notes` | Full Access | Max 20, FIFO |
| `external_reflection_only` | **Full Access** | The name is the argument. ADR-007 exists so an external agent sets it |
| `pending_update` | **Clearable** | Read is load-bearing: `skills/ei-persona/references/cli.md` documents that external writers pull first to see it and tell the user. Accepts only `null` |
| `last_updated` | System Visible | Server-stamped every write |
| `is_static` | System Visible | Tells a caller whether the persona may be deleted |
| `group_primary`, `groups_visible` | System Visible | Answers "what can this persona see, in the app." Matters in-app; out-of-app only interpretable |
| `id` | System Visible | Server-assigned on create; stripped on update |
| `type`, `entity` | System Hidden | Discriminators |
| `tools` | **System Hidden** | Only affects in-harness behaviour. Hiding it also removes the dual-representation problem from the external contract entirely |
| `model` | System Hidden | Only affects Ei's own dispatch. The interface is `/provider` in-app |
| `heartbeat_delay_ms`, `context_window_ms` | System Hidden | Scheduling |
| `include_message_timestamps`, `context_boundary` | System Hidden | Prompt shaping |
| `is_paused`, `pause_until` | System Hidden | In-app behaviour |
| `is_archived`, `archived_at` | System Hidden | In-app behaviour. Close to externally meaningful, but not today |
| `last_heartbeat` | System Hidden | Debugging; `state.json` is that surface |
| `description_embedding` | System Hidden | Computed |

### Person, Topic, Fact

| Field | Types | Category |
|---|---|---|
| `name`, `description` | all | Full Access |
| `sentiment` | all | Full Access |
| `identifiers`, `relationship` | Person | Full Access — `identifiers` is what ADR-010's link guard polices |
| `category` | Topic | Full Access |
| `validated_date` | Fact | Full Access — an external curator confirming a fact is the documented `ei-curate` flow |
| `id`, `last_updated` | all | System Visible |
| `last_ei_asked` | Person, Topic | **System Hidden** — bookkeeping. Ei's own record of what it has asked is debug data, and `state.json` is that surface |
| `learned_on`, `last_mentioned` | all | System Visible |
| `learned_by`, `last_changed_by` | all | System Visible — **provenance is never caller-assertable** |
| `interested_personas`, `sources`, `persona_groups` | all | System Visible |
| `exposure_current`, `exposure_desired` | Person, Topic | **System Hidden** — see below |
| `rewrite_length_floor` | all | System Hidden, **but system-written on external update** (ADR-032) |
| `embedding` | all | System Hidden — computed |

**Quotes** are unaffected. Their four dedicated verbs (ADR-012) already implement a stricter version of this
model: `create`/`fix` derive speaker, channel, timestamp, offsets, and embedding server-side and reject
caller-supplied values outright.

### Why both exposure fields are Hidden rather than Visible

**Corrected 2026-08-04.** This passage previously read: *"ADR-018 describes `exposure_current` as 'mechanical'
(computed) and `exposure_desired` as 'constitutive — user-authored at creation only.' **The second half is false in
current code:** `human-matching.ts:150` sets `exposure_desired: result.exposure_desired ?? 0.5` from the LLM result on
every topic update."*

**ADR-018 is not wrong. I was — it governs a different type.** ADR-018's subject is **`PersonaTopic`**
(`src/core/types/data-items.ts:54-57`), written only at creation by `persona-generation.ts:76`, `:93`. Nothing in the
ceremony writes it, exactly as that ADR claims. **Three distinct types carry a field named `exposure_desired` with
three different authorship rules** — see ADR-018's own scope note for the table.

**The observation still holds for the types this ADR's table covers**, which is why the decision is unchanged:
**`Topic`** (`data-items.ts:34-35`) and **`Person`** (`:72-73`) have `exposure_desired` written from the LLM result on
**every extraction pass** — `human-matching.ts:150` and `:322`. And that is *by design*, documented in the prompt
itself: `src/prompts/human/person-update.ts:268-270` defines the field as *"how much the HUMAN USER wants to talk about
this PERSON"* and asks the model to estimate it.

So the accurate statement is not "ADR-018 is false" but **"a model estimates this metric on every pass, for the types
this table covers."** The conclusion below is the same; the attribution was wrong, and an ADR asserting that another
ADR is incorrect is the kind of error that propagates.

Combined with ADR-025 — the exposure system is live but dormant and redundant, carrying three known unfixed
defects and deliberately left to atrophy — the honest position is that this metric does not mean what it claims.
With 1000+ topics the delta is noise, and `exposure_desired` has no coherent authoring story.

**So the rule this establishes: do not expose a metric you do not believe.** A visible-but-meaningless field
invites an agent to reason from it. Read-only would have been the timid answer; it keeps showing a number nobody
should trust. If the exposure system is ever made to work, `exposure_desired` becomes Full Access and
`exposure_current` becomes System Visible — and that will be a deliberate change, recorded here.

## Alternatives Considered

### Alternative A: Keep accepting everything, document what is authoritative
- **Pros**: no code change; a caller retains maximum flexibility.
- **Cons**: this is the status quo, and it is what produced caller-assertable provenance, a promise the system
  breaks on every ceremony, and a type divergence that blocked ADR-029. Documentation cannot make an accepted
  field authoritative.
- **Why not chosen**: the failure mode is silent in all three cases.

### Alternative B: Two categories — writable and not
- **Pros**: simplest possible rule.
- **Cons**: cannot express `pending_update` (a caller must dismiss it but never author it), and cannot distinguish
  "you may reason about this" from "this is none of your business." `is_static` and `last_heartbeat` would land in
  the same bucket despite one being useful to a caller and the other being debug noise.
- **Why not chosen**: collapses two genuinely different questions into one.

### Alternative C: A fifth category for representation transforms
- **Description**: a category for fields stored one way and exposed another — `tools` being the case.
- **Pros**: describes reality without hiding a field.
- **Cons**: `tools` is the only instance, and hiding it removes the transform from the external contract entirely.
  A category with one member that a different decision eliminates is not a category.
- **Why not chosen**: if a transform is genuinely needed later, it belongs in its own CLI signature or
  sub-command — not in a category that makes every field's shape negotiable.

### Alternative D: Make `model` Full Access
- **Description**: let an external agent choose a persona's model — plausibly useful ("use the cheap local model
  for this one").
- **Pros**: a real use case.
- **Cons**: `model` only affects dispatch *inside* Ei, so it fails the external-meaning test. And the in-app
  interface (`/provider`) is already good — one of the few genuinely nice ones.
- **Why not chosen**: it is a setting, and settings belong to the future app-management surface.

## Consequences

### Positive

- **Provenance stops being assertable.** `learned_by` / `last_changed_by` become system-owned, which is also the
  prerequisite for ADR-032's manual-versus-automated rule — that rule is unenforceable while a caller can claim
  any authorship value.
- **ADR-029's blocked validation step becomes tractable.** With `tools` out of the external contract, there is no
  incompatible representation left at the boundary; validation targets the externally-writable projection, which
  the existing input schemas already approximate.
- **The 14-field reset hazard shrinks.** Several of those fields are now Hidden and cannot be supplied at all, so
  they cannot be reset by omission.
- **A new field's category is decidable by an implementer** who has never seen it, using two stated tests.

**Implementation note, 2026-08-07.** This ADR's model was fully enforced on writes when first built, but the
read paths lagged behind: the CLI's `ei --id` output and the MCP `ei_lookup` tool were both still returning
every stored field, including every System Hidden one this ADR names — the write-side categories existed, but
nothing on the read side had been taught to apply them. Caught during implementation review, before any
release shipped it. Fixed by giving both read paths one shared strip function keyed off the same category
table this ADR defines, so a field's category now governs both directions from a single source rather than
needing separate enforcement remembered on each path. Worth recording because it's the same shape of gap this
ADR's own "hand-maintained duplicate enforcement" concerns describe elsewhere — a category model is only as
strong as every surface that's supposed to honour it.

### Negative

- **This removes capability that exists today.** Five settings and `tools` are externally writable right now.
  Nothing appears to depend on it, but that is an assertion about a single-user system, not a guarantee.
- **`ei --id` output changes**, dropping several fields. Shipped skills that reference them need checking.
- **Hidden fields still need server-side writes**, so "Hidden" is not a licence to ignore a field entirely — the
  `rewrite_length_floor` case proves the cost of getting that wrong.

### Risks

- **Every Hidden setting has a verified in-app editing surface — checked, not assumed.** Hiding a setting externally
  is only safe while the TUI or web can still set it, or it is frozen at its default forever. Verified across both
  frontends: `model`, `heartbeat_delay_ms`, `context_window_ms`, and `include_message_timestamps` are editable in
  the TUI YAML editor (`tui/src/util/yaml-persona.ts:150`, `:155-160`, `:198-204`, `:291-321`), and
  `heartbeat_delay_ms` / `context_window_ms` are additionally editable in the web Persona Editor
  (`web/src/components/EntityEditor/tabs/PersonaSettingsTab.tsx:26-41`, `:99`).
  **`context_boundary` is not a settings field at all** — it is set by the `/new` command
  (`tui/src/commands/new.ts:19-23` → `StateManager.setContextBoundary`, `src/core/state-manager.ts:823-824`), which
  is the right surface: it marks "start a fresh conversation here," an action rather than a value someone edits.

  **The residual risk is for future Hidden fields, not current ones.** Any field added to Hidden from here on must
  have its in-app surface named at the time, or it ships unreachable.

- **One field needs a representation transform. The duration fields do not — the suffix is the contract.** The four
  categories describe *who may write a field*, and say nothing about *shape*. That gap is real for exactly one
  field:

  | Field | Stored | CLI / MCP accepts | Human surfaces present |
  |---|---|---|---|
  | `tools` | flat `string[]` of ids | nested `Record<provider, Record<tool, boolean>>` | grouped checkboxes |

  Already known, already handled by `buildPersonaToolsMap` / `resolvePersonaToolsFromMap`. The audit behind this ADR
  called it "Full Access with Representation Transform"; it stands as a genuine one-off.

  **An earlier revision of this section wrongly added `context_window_ms` and `heartbeat_delay_ms` to that table**,
  on the reasoning that storage is uniformly milliseconds while human surfaces show hours or minutes. That is not a
  divergence — **it is a declared naming convention, and the codebase honours it consistently:** a `_ms` suffix
  means the value is stored in milliseconds, a `_hours` suffix means it is stored in hours, and a bare name means
  the base unit. `event_window_hours` (`src/core/types/entities.ts:40`) is a current, live field stored in hours,
  editable in web Settings (`SettingsModal.tsx:317`) and TUI YAML settings (`yaml-settings.ts:111`, `:199`) — so
  `_hours` is not a legacy artefact. `context_window_hours` was itself the stored field name until `2f5620c3`
  (2026-04-29, #48) renamed it to `context_window_ms` across all layers, which is precisely a rename **to make the
  stored unit explicit**. The convention is the mitigation, not the hazard.

  **What survives as a real gap is narrower and unit-independent: no duration field has a lower bound.**
  `persona-corrections.ts:122` validates `z.number().optional()`, which accepts `0` and negatives. A negative
  `context_window_ms` makes `windowStartMs = now - (-n)` a *future* timestamp (`src/core/context-utils.ts:16`), so no
  message is ever in context. That is worth a bound regardless of whether anyone confuses the unit, and it is
  tracked separately rather than resolved here — a visibility category is the wrong tool for it.
- **The external-meaning test has a soft edge.** `is_archived` was judged Hidden while being *"really close"* to
  meaning something outside the system. A future feature could move it, and that would be a contract change rather
  than a clarification.

## Reversibility

High per field, low as a policy. Re-admitting a field to the external contract is additive and safe. Reversing the
*rule* would mean re-accepting provenance and settings wholesale, which reopens all three problems in Context.

## References

- `docs/adr/ADR-007-external-reflection-only.md` — why `external_reflection_only` is Full Access despite being a setting
- `docs/adr/ADR-014-quote-attestation-trusts-verified-text.md` — the never-let-a-caller-assert-provenance discipline this extends from quotes to all entities
- `docs/adr/ADR-018-ceremony-rates-exposure-never-identity.md` — governs **`PersonaTopic`**, where its `exposure_desired` claim **holds**. See its scope note: three types share that field name with three authorship rules. An earlier revision of this ADR wrongly called that claim contradicted
- `docs/adr/ADR-025-exposure-system-left-dormant.md` — why exposure is Hidden rather than Visible
- `docs/adr/ADR-029-merge-patch-write-semantics.md` — depends on this ADR; its validation target is this model's writable projection
- `docs/adr/ADR-032-manual-setting-prevents-automated-resetting.md` — depends on this ADR making provenance system-owned
- `src/cli/persona-corrections.ts:178` — `PERSONA_ROUND_TRIP_FIELDS`, the pre-existing System Visible mechanism
- `src/cli/persona-corrections.ts:216-220` — the pre-existing external/in-harness split
- `src/cli/corrections-endpoints.ts:66-154` — the schemas this narrows; `:82-87` is the unvalidated `last_changed_by` passthrough
- `src/core/persona-tools.ts` — `buildPersonaToolsMap` / `preserveHiddenToolGrants`, which survive for the TUI (`tui/src/util/yaml-persona.ts:322`) after `tools` leaves the external contract

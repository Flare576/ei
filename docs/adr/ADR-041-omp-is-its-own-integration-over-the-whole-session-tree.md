# ADR-041: OMP Is Its Own Integration, Imported as One Pipeline Over the Whole Session Tree

## Status

Accepted

## Date

2026-10-13

## Kind

Current

## Context

This section describes the state before this work; it is kept as the decision-time record. Ei imports oh-my-pi (OMP) sessions through two code paths that were never designed together.

**Path 1 — main sessions ride along with Pi.** `src/integrations/pi/` reads both `~/.pi/agent/sessions`
and `~/.omp/agent/sessions` (`pi/reader.ts` `getDefaultSessionsRoots`) and treats them as one product. It
is gated by `settings.pi.integration`. When no message carries an `agent` field it files everything under
one persona named `Pi` whose aliases include both `pi` and `oh-my-pi`; when messages do carry `agent`
(a field OMP writes) it takes a second, multi-persona branch (`pi/importer.ts`). One session is imported per
queue-drain cycle: the importer picks the oldest unprocessed session, deletes every `external` message
already on the target persona(s), appends the session's messages (older than the last import pre-marked
as already extracted), and queues extraction scans. ADR-026 identified this Pi/OMP conflation and
deliberately deferred it.

**Path 2 — sub-agent transcripts have their own importer.** `src/integrations/omp/` was added for
ADR-038's Agent lens. It reads only transcripts at directory depth two or deeper (the files OMP writes
under `<root-session>/…`), is gated by `settings.omp.integration` (which has no settings UI and is not in
`tui/src/util/yaml-settings.ts`), and differs from Path 1 in almost every operational property:

| | Main sessions (Pi path) | Sub-agent transcripts (OMP path) |
|---|---|---|
| Directory scope | every project directory under both roots | one directory: `slugify(process.cwd())` |
| Extraction | facts, topics, people, event summary | persona-signal scan only |
| In-flight guard | skip if an `omp`/`pi` process is running (`pgrep -x`) and the session's last user/assistant *text* message is younger than 20 minutes | none |
| Change detection | session's last message vs. stored import time; re-imported when it grows | a path is imported once, forever |
| Message handling | delete the persona's `external` messages, then append | append only, never removed |
| Throughput | one session per queue-drain cycle | every new transcript in one tick |
| Persona requirement | none | persona must have exactly one linked Person, else the transcript is skipped *and re-read on every poll* |
| Message IDs | `pi:<machine>:<uuid>:<uuid>/<entry>` | `omp:<machine>:<encoded absolute path>:<entry>` |
| Settings UI / onboarding | `pi` (onboarding ORs Pi and OMP detection into one flag) | none |

Most of these differences are not design choices; they are defects of the second path. Taken together
they mean enabling it would flood state, import partial transcripts permanently, and cover only one
project:

- **Append-only plus all-at-once.** The signal scan resolves its message window against the persona's
  stored messages when the scan *runs* (`handlers/utils.ts` `resolveMessageWindow` filters persona
  state by `message_ids_to_mark`), so a transcript's messages must still be in state when its scan
  executes. Queuing every transcript in one tick makes the wipe-and-replace protocol unsafe, so the
  importer appends and never removes. [INFERRED: the author's reasoning is not written down; the code
  is consistent with it.] A persona that no other importer touches then accumulates external messages
  without bound.
- **Process-cwd scoping.** The reader derives its root from `slugifyProjectPath(process.cwd())`. That is
  whichever directory the TUI was launched from, not a property of the data. No Ei importer or
  resolver for any other integration has a notion of project or working directory: each imports from
  wherever the data is and stores to one place. The resolver for `omp:` IDs (`cli/retrieval.ts`) only trusts paths
  returned by that same cwd-scoped listing, so
  `ei --id omp:…` returns nothing when run from any other directory.
- **No in-flight guard, no change detection.** OMP sub-agents can be resumed (ADR-038 itself notes a
  resumed session need not re-emit `session_init`). A transcript read mid-run, or later resumed, is
  checkpointed once by path and never re-read.
- **Subject-persona gate blocks everything, after side effects.** The one-linked-Person requirement
  exists because the signal scan takes a `subject_person_id`. In the importer the order is: read the
  transcript, require `session_init.agent`, create the persona if missing (`ensureAgentPersona`,
  unarchived), and only then check the Person link. A transcript whose persona has no single linked
  Person is skipped *and never checkpointed*, so it is re-read on every poll — and each distinct agent
  ID still leaves a visible, unarchived persona behind.
- **The Pi in-flight guard does not measure what it appears to.** "Update" is the timestamp of the last
  user/assistant message with non-empty text in the root file (`pi/reader.ts` `parseSession`). Tool
  calls, tool results, and every sub-agent transcript are invisible to it. The other half of the rule is
  `pgrep -x <name>` (`integrations/process-check.ts`), called with `omp` and `pi` by `pi/importer.ts`; it
  matches the exact process name. When OMP is run as a script under another runtime (for example
  `bun …/cli.ts`) no process is named `omp`, the check
  returns nothing while OMP is running, and the rule never defers. During a long run of sub-agents the
  root file's last text message goes stale while the tree is busy, so a live tree is imported
  partway. Sub-agent writes landing well over 20 minutes after the root's last text message occur in
  real sessions.

Shape of real data (observed on one user's session tree; the proportions are the point, not the
figures):

- Sub-agent transcripts outnumber root sessions by more than an order of magnitude and carry more
  conversational text than the root sessions do. They also hold most of the bytes — almost all of it
  tool output, not conversation.
- Tens of distinct agent IDs appear, led by built-in utility agents (`sonic`, `scout`, `task`) rather
  than persona-style agents.
- A bounded set of older transcripts has no `agent` in `session_init`. Their shape matches named
  sub-agents (`systemPrompt`, `task`, `tools`, `spawns`) minus `agent` and `readOnly`, and they stop
  appearing once the named agent `task` starts appearing. [INFERRED: OMP began stamping `agent: "task"`
  on previously unnamed spawns; the harness source was not consulted.]
- Roots in which two or more sub-agent transcripts with the *same* agent name overlapped in time are
  common, not rare, across both built-in and persona-style agents.
- The first user message in a sub-agent transcript is the parent agent's assignment, not the human's
  words.

Two further facts constrain the answer:

- **`messages_sort` orders persona messages by timestamp** (`state/personas.ts` `messages_sort`), and
  every session importer except Slack calls it after appending; the ceremony re-sorts as well. Two
  concurrent transcripts placed in one persona's message list are therefore interleaved, not stored as
  contiguous blocks.
- **Auto-created agent personas are not archived.** `ensureAgentPersona` creates personas with
  `is_archived: false`. Auto-archiving on creation existed and was deliberately removed from five
  importers in `5ade17e2`; the commit message gives no reason. OpenCode avoided sub-agents entirely by
  importing only sessions with no `parentId`.

## Decision

### 1. Pi and OMP are separate integrations

- `src/integrations/pi/` imports vanilla Pi only: root `~/.pi/agent/sessions`; the single `Pi` persona
  with aliases `["pi", "pi coding agent"]`; the multi-agent branch and the `agent` field on its message
  type are deleted; vanilla Pi sessions carry no per-message agent attribution.
- `src/integrations/omp/` owns everything under `~/.omp/agent/sessions`, main sessions and sub-agent
  transcripts alike.
- `settings.pi` and `settings.omp` are independent blocks, each with its own `integration` toggle,
  polling interval, extraction model, `last_sync`, and checkpoint map. This applies ADR-026's
  per-harness reasoning to the pair it flagged and deferred.
- ADR-026's "deliberately deferred" tangent is resolved here, as a recorded decision with alternatives.

### 2. OMP is one importer over the whole session tree, not the current working directory

- Discovery enumerates `~/.omp/agent/sessions/*/` — every project directory — never
  `process.cwd()`.
- Enabling OMP authorizes extraction from every project directory through the configured model, as
  enabling any other integration does. There is no exclusion list, include-list or per-project prompt,
  and none exists for the other integrations either.
- A **tree** is a root session file `<name>.jsonl` together with every `.jsonl` under the sibling
  directory `<name>/` at any depth. (ADR-038 §8 defines cognitive distance as directory depth; that
  definition is unchanged.) A session directory with no root file is not a tree and is not imported;
  nor is a `.jsonl` file whose name has no `_`, since a tree is identified by the text after it (§4).
- The importer has no notion of project or working directory, as no other Ei integration does: it never
  reads a session's `cwd` and never uses one to scope, key or label anything. `slugifyProjectPath` is
  deleted. Pi's `decodeCwd` is not reused.
- The `omp:` resolver's eligibility check changes from "returned by the cwd-scoped listing" to "a regular
  `.jsonl` file whose real path is under `~/.omp/agent/sessions`". It still refuses everything else
  (ADR-015); only the discovery scope changes.
- The reader keeps the browser-safe lazy loading both existing readers use (`path`/`fs` are imported on
  first use on a Node runtime, never statically), because integration code is reachable from
  browser-facing bundles.

### 3. The unit of work is a *block*, processed one at a time

A **block** is the messages one transcript contributes to one persona: the whole of a sub-agent
transcript (one agent, assigned at spawn), or, for a main session, the messages of one persona across
the whole file (the per-persona bucketing the Pi multi-agent branch had before §1 removed it). A main session
whose messages span several personas yields one block per persona; each is a step like any other.

At most one block is in flight at any time, scheduled through the same gate Pi and OpenCode use
(`queue_length() === 0`, which counts pending *and* processing items — `state/queue.ts`). For a block
that has unmarked messages: (a) delete the target persona's existing `external` messages, (b) append
the block, pre-marking messages at or before the tree's previous watermark, (c) queue extraction scans
over the unmarked messages and, for a sub-agent block whose persona is eligible (§6), the signal scan,
(d) wait for the queue to drain, (e) take the next block. A block with no unmarked messages is skipped
entirely: no wipe, no append, no scans. A transcript the reader rejects (see Risks), or one with no
messages, yields no block. Order within a tree: the main session first, then descendants
by first-message timestamp, ties by path. Rewrite phases (`queuePersonRewritePhase`,
`queueTopicRewritePhase`) are queued once per tree that queued at least one block's scans (counting blocks
queued before a restart), after its last block is handled; a tree that queued nothing gets none.

**Invariant: at any instant, a persona's `external` messages written by this integration are exactly
one block.** Another integration writing the same persona can still break it (see Risks).
§"Multiple same-identity sub-agents per session" below explains why the invariant is load-bearing.

Scans that exhaust their retries leave the queue as dead-lettered items, exactly as they do for every
other importer: this importer adds no failure state, retry or recovery protocol of its own, never reads
the dead-letter count, and treats an emptied queue as the end of a block. Dead-lettered items are
inspected and recovered through the existing `/dlq` view.

Every block, sub-agent blocks included, gets the same extraction scans (facts, topics, people, events):
no scan is skipped or reduced for a sub-agent block, and no eligibility rule or hardcoded agent list is
added for extraction. (Signal-scan eligibility, §6, is separate.)

**Pacing, and how it differs from the other importers.** Every other importer imports one whole session per
poll. OMP imports one *block* at a time, and a tree has many blocks, so its pacing is deliberately different:

- The poll interval (`settings.omp.polling_interval_ms`) gates the start of a pass and the start of each
  *tree*. It does not gate the blocks of a tree that is already in progress: after a block queues scans and
  leaves its tree in progress, the next block starts as soon as the queue drains, without waiting out the
  interval. Ei looks for new trees on the interval and drains a known tree as fast as the LLM allows.
- The real throttle is the queue itself. The importer never starts a block while anything is queued, so at
  most one block's scans are ever waiting, and one tree is in progress at a time. A tree's blocks are one
  session's worth of fan-out, no more.
- An OMP backlog therefore keeps the LLM (a local model server in particular) continuously busy instead of
  idling out the remainder of each interval between blocks. Native conversation is not starved: queued
  conversational messages take priority over extraction work. The first run of a large backlog still takes a
  long time (at the default 60 s interval and one tree with work per poll, a few thousand trees that each
  queue scans would take days), but it never queues in bulk.
- A tree's last block ends the run: the next *valid* tree is found on the next poll, where a valid tree is
  one with something to import. A tree with nothing to import (every block skipped or unreadable) is marked
  complete and the pass moves straight on to the next valid tree instead of using up the poll.
- This is a deliberate departure from "one unit of work per interval" and is recorded as an experiment. The
  bypass is a single flag in the scheduler (`ompContinuation` in `core/integration-sync-manager.ts`); making
  the interval gate every block as well means removing that flag and its two assignments, with no change to
  the importer.

### 4. Progress is a watermark per tree, keyed by root session UUID

`settings.omp.processed_sessions[<root session UUID>] = <T_plan ISO>`.

- One entry per root session — the same cardinality `settings.pi.processed_sessions` has today.
  Sub-agent transcripts get **no entry of their own**; the tree's watermark covers every descendant.
  This is the point: per-file checkpoints would add thousands of entries.
- A tree is identified by its root session UUID (the text of the root file's name after the first `_`,
  known from the name alone, without opening the file), not by where it lives. A copy of a session tree under
  another project directory is the same session, as Pi treats a copied session file, and is not
  imported as a new source.
- **Change detection** compares the newest mtime among a tree's files to its watermark (a `stat`, no
  parsing). A tree with newest mtime at or before its watermark is skipped without opening a file. Trees with work are taken oldest first by that same newest mtime: every importer orders its sessions by its own change signal (OpenCode by its database, Claude Code by the root file's mtime, Pi oldest unprocessed first), and no other sort key is introduced.
- **A pass covers the half-open window `(W_prev, T_plan]`**, where `T_plan` is the instant the tree was
  planned. Each block read clamps to `T_plan`; messages written after it belong to the next pass.
  Messages at or before `W_prev` are appended as pre-marked context (same `f`/`t`/`p`/`e` flags the Pi
  path uses). The watermark advances to `T_plan` after every block of the tree has been handled, whether it
  queued scans, was skipped (nothing unmarked) or was rejected by the reader. This
  keeps a transcript resumed or still running at planning time correct without a per-file record.
- **In-flight guard**: a tree is deferred while *any file under it* — the root `.jsonl`, every
  descendant transcript, and the tool-output logs OMP writes beside them — has an mtime within
  `MIN_SESSION_AGE_MS` (20 minutes). This is filesystem-only; no process inspection, because the name
  match above is unreliable for OMP. The same rule is why a sub-agent resumed after its parent went
  quiet defers the tree again. The `omp` name is also removed from the vanilla Pi importer's running
  check. The window above makes a premature read *correct*; the guard reduces churn and partial-context
  scans. A long run of sub-agents therefore defers its whole tree until it has been quiet for 20
  minutes. This is deliberate: a finished sub-agent is not necessarily done — sub-agents are routinely
  resumed later to validate earlier work — so importing each one the moment it yields would repeatedly
  re-import blocks that are about to change. (Most observed sub-agent transcripts end in an assistant
  `yield` tool call, so a completion marker exists, but it marks a pause, not an end.) The cost is
  latency: what a sub-agent learned during a long run reaches Ei after the tree settles.
- **Crash resume**: a persisted cursor `settings.omp.current_tree = { tree: <root UUID>, planned_at:
  <T_plan ISO>, done: [<member key>, …] }`, where a member key identifies one unit of handled work: the
  transcript's path relative to the tree directory for a sub-agent transcript, and `<root file
  name>|<canonical agent name>` for each canonical agent name a main session holds. A persona is never what
  is recorded, because which names group under one persona can change between ticks (an alias added to a
  stored persona, a rename); the keys are stable across a restart, and each plan excludes only the members
  already in `done`, so a group that grows never counts an unhandled member as handled. A member is added to
  `done` once its scans are queued — the queue is itself persisted, so those scans survive a restart — and
  the cursor is cleared in the same `setHuman` call that writes the tree's watermark. Only one tree is in
  progress at a time, so the cursor is bounded by that one tree: `done` holds one key per queued member of
  the tree in progress (a member with nothing to import is never listed) and is cleared with the cursor. On restart the importer resumes
  that tree with its original `planned_at` rather than re-planning, once the tree has been quiet for the guard's window.

### 5. Who is speaking, and which persona it becomes

- **Parent agent.** OMP records `attribution` on each `role: "user"` message of a sub-agent transcript:
  `agent` for the parent's assignment, `user` for what the human typed to the sub-agent directly. A line
  attributed `agent`, or carrying no `attribution`, is imported as `role: "system"` with `speaker_name:
  "Parent agent"`; a line attributed `user` stays the human's. The reader therefore reads `attribution`
  (it ignored it before), and the `omp` case of the resolver in `cli/retrieval.ts` reports the same
  speaker, `{ kind: "agent", display_name: "Parent agent" }`, for a parent-attributed line of a sub-agent transcript. A user line that is not
  parent-attributed is the human's. An assistant line's speaker is
  the persona the importer filed the line under (found with the importer's exact name-or-alias match), or the
  agent's canonical name when there is no saved state or no such persona; on a tree's root file that is the
  agent each message names. Why not
  `human`: every extraction consumer decides "is this the human?" with `Message.role === "human"`
  (prompt renderer, quote speaker, signal observer), so a parent's assignment imported as `human` would
  be credited to the human everywhere. `role: "system"` plus `speaker_name` needs no new field and has
  precedent in the Slack importer. Rejected: a content prefix (the role stays `human`), a typed
  `speaker_kind` field (touches several prompt, handler and signal-schema files), and a new `role` value
  (falls through to silent fallbacks on every `!== "human"` branch). OpenCode drops such messages
  (`AGENT_TO_AGENT_PREFIXES`); this keeps them as context. A depth-two transcript's parent is another
  sub-agent; the generic label is used. A sub-agent transcript the human never typed into has no `human`
  lines.
- **Persona identity.** A main-session block's persona comes from each message's `agent` field; a
  sub-agent transcript's persona comes from `session_init.agent`, resolved through
  `resolveCanonicalAgent`. Aliases that canonicalize to the same name are one identity for every rule in §3.
- **Alias normalization.** `resolveCanonicalAgent` ignores a leading single-letter prefix followed by a
  hyphen (`s-architect`, `p-reviewer`): such prefixes are sorting marks some users put on agent
  definitions. `s-architect` and `architect` become one persona. A persona created for the name records
  the original ID in its alias list once; an existing persona found after the prefix is stripped is returned
  unchanged by `ensureAgentPersona`, and existing alias entries and their casing still win. The rule applies to every user's agent names.
  Personas already stored under the old spelling (`S Architect`) are not merged or renamed. Built-in agents
  and similarly named custom agents (`reviewer`, `code-reviewer`) stay distinct. `Minos-SDLC` is not a
  single-letter prefix and stays its own persona.
- **No `agent`.** A sub-agent transcript whose `session_init` has no `agent`, or an `agent` that leaves no name once control characters are removed and the name is normalized (whitespace-only or zero-width-only, say), is treated as the generic
  `task` agent for extraction and gets no signal scan (there is no identity to attribute one to). No name
  is derived from the system prompt, and the transcript is not skipped.
- **Main-session messages with no `agent`** go to a new persona named `OhMyPi`. The existing `Pi` persona
  is left alone (its stale `omp` and `oh-my-pi` aliases stay), and vanilla Pi keeps writing to it, so a
  user running both integrations needs no new mechanism for OMP's wipe to avoid deleting Pi's messages.
  OMP's lookup never selects `Pi`: a persona created for `OhMyPi` carries only its own name as an alias, and
  an existing persona is found by exact name or alias, never by partial match. The reverse is not
  guaranteed: the vanilla Pi importer still finds `Pi` with the shared `persona_getByName`, which falls back
  to an unambiguous partial match, so when no exact `Pi` persona exists and `OhMyPi` does, Pi can select
  `OhMyPi`. That shared lookup is unchanged and outside this decision; the fallback does not promise
  two-way isolation.
- **Creation state.** A persona first created from a main-session `agent` is a control agent, created
  unarchived. One first created from a sub-agent transcript is created archived: it exists to hold
  `external` messages for extraction, is not conversational, and stays out of the persona list. An import
  never changes an existing persona's archived state (ADR-032). Main sessions of a tree import before its
  sub-agents, so within a tree a persona seen as both takes the control state; across trees an archived
  one stays archived until the user un-archives it.

### 6. Signal-scan eligibility

What OMP adds to the existing signal pipeline for tree blocks:

- **Which blocks.** A direct signal scan is queued only for a sub-agent block whose transcript names an agent and whose persona is
  unarchived. Archived sub-agent personas (`task`, `scout`, specialists, anything the user has not
  promoted) get extraction but no signals, with no hardcoded list. Main-session blocks get no direct
  scan: they carry no `session_init` provenance. The existing route is unchanged for every block: when
  the person scan matches a Person carrying an `Ei Persona` identifier it feeds the signal pipeline
  (`handlers/human-extraction.ts`).
- **Promotion** is un-archiving the persona in the existing archived-persona view. It is forward-only:
  earlier blocks were already wiped and the tree watermark has passed them.
- **Considered and not built, recorded for later.** Options weighed and left out for promotion: a count or
  notice of how many archived-persona blocks were skipped, a back-scan of earlier blocks when a persona is
  promoted, a lighter "signals on" flag short of un-archiving, and refusing to import until a Person is
  linked. Any of them can be revisited if forward-only promotion proves too quiet.
- **Person link.** The direct scan needs a `subject_person_id` (a required field of
  `PersonaObservation`). That is a precondition of the direct scan only: a missing or ambiguous link
  skips that scan for the block and never blocks import or extraction. Removing the field is ADR-038
  territory and is not decided here.
- **Provenance per transcript.** The scan records the transcript's own provenance: `agent_id` and
  `definition_revision` from its first `session_init` (the revision is a hash of that record's base prompt,
  as ADR-038 defines it). OMP appends another `session_init` when the recorded base prompt changes; this
  importer does not split a transcript at it, so a transcript whose base prompt changed part-way is scanned
  once, under its first revision. Per-revision windows are not built.
- **Both lenses may count the same text.** Agent signals describe how an agent does its job; Persona
  signals describe how an agent or persona acts or is. They are told apart by intent, not origin, so a
  block with a direct scan can also yield a routed Persona signal. Nothing de-duplicates them.
  ADR-038 is silent on this; it is recorded here, not as a change to it.

### 7. Message IDs

- **All new OMP imports, main and sub-agent, use `omp:<machine>:<encoded absolute path>:<entry id>`**
  (`qualifyOmpMessage`). The locator encodes the traversal path to the transcript, as ADR-038 requires.
- **Stored `pi:` IDs for OMP sessions are not kept resolvable, and no conversion is built.** OMP was never
  a Pi plugin; conflating the two was a mistake, and no legacy resolver branch is kept for it: the `pi`
  branch of the resolver reads vanilla Pi only. Converting the `pi:` IDs already stored for OMP sessions to
  their `omp:` form is outside this work and no code does it, so such a stored ID no longer resolves. This
  is a deliberate exception to ADR-012's "sunset with a path forward"; leaving stored IDs unrewritten is
  consistent with ADR-015.
- **Message IDs must be stable across reads.** The earlier reader assigned a random UUID to a message
  entry that has no `id`, so such an entry would get a different ID on every poll. An entry with no
  string `id` is identified as `line-<n>`, where `n` is its 1-based physical line number in the file (every
  line counts: header, blank and non-message lines included), never a random value.

### 8. No migration

- Nothing is carried over from Pi. `settings.pi.processed_sessions` is left exactly as it is, and the
  OMP importer starts with an empty `settings.omp.processed_sessions`, so every tree it sees is imported
  from the beginning, as every other importer does on its first run. No Pi checkpoint is moved, copied or
  read.
- Any pre-existing path-keyed `settings.omp.processed_sessions` entries from the old sub-agent importer
  are ignored: the keying scheme changes, and enabling that importer required editing `state.json` by
  hand.
- Any hand adjustment of the one existing user's own settings and stored data is that user's own activity,
  separate from this work: no code exists for it and nothing here depends on it.

### 9. Settings and onboarding

- This adds OMP to settings and onboarding. `tui/src/util/yaml-settings.ts` gains an `omp` block mirroring `pi`: the YAML shape (`integration`,
  `polling_interval_ms`, `extraction_model`, and the shown `last_sync`), settings → YAML, and YAML →
  settings, which starts from the original object's `omp` block so every runtime-managed field
  (`last_sync`, `processed_sessions`, and the cursor) is carried through and `/settings` never wipes it. The
  `/settings` save parses the edited YAML against the settings as they are when it is saved, not as they
  were when the editor opened, because the importer keeps writing its cursor while the editor is open.
- The first-run onboarding wizard (`OnboardingOverlay.tsx`) detects Pi and OMP separately and writes
  `settings.pi` and `settings.omp` independently. The stale "HumanSettings has no separate `omp` field"
  comment is removed (`HumanEntity.settings.omp` exists).
- OMP is enabled the way every other integration is: onboarding detects it and offers it, and the
  `omp` block in `/settings` carries the toggle. `settings.omp.integration` is an ordinary boolean like
  `settings.pi.integration`; there is no tri-state and no startup prompt for existing users, because
  there is no migration to confirm and no existing user to protect. Pi is not disabled by enabling OMP.
- Turning OMP off is a pause, not a gap. Checkpoints stay as they are, no "enabled since" point is
  recorded, and the user is not asked anything when OMP is turned back on: the next pass imports
  whatever changed while it was off, which is each tree whose newest file is later than its watermark,
  and, from the beginning, each tree with no watermark.
- The README integration tables split the "Pi / OMP" row.

## Multiple same-identity sub-agents per session

This is the case the design has to get right. Two or more transcripts resolve to the same persona —
for example three `reviewer` sub-agents spawned by one root session, two of which run at the same
time, or a `Sisyphus` sub-agent spawned while the main persona is also `Sisyphus`. Persona identity is
the persona, not the transcript, so the system has one place to put these and no natural boundary
between them.

**Why sharing a persona at one time is unsafe.** Place both blocks in the persona's message list at
once, and every existing code path that reads that list misbehaves:

1. **Order.** `messages_sort` (`state/personas.ts`) sorts by timestamp and every session importer
   but Slack calls it. Two
   concurrent blocks (09:01–09:04 each) interleave: an assistant reply from thread 2 follows a user
   message from thread 1. The ceremony (`orchestrators/ceremony.ts`) re-sorts too, so any
   append-order trick is undone later.
2. **Context window.** Importers compute `messages_context` as everything in state before the first
   analyzed message (`allInState.slice(0, analyzeStartIndex)`). With two blocks present, "before"
   includes the other thread's messages.
3. **Event summary.** `queueEventSummary` reads `messages_getUnextracted(personaId, "e", …)` at queue
   time — all unextracted external messages for the persona, not the ones this scan was queued for.
   (The earlier sub-agent importer never called it; the importer now runs `queueAllScans` for every block,
   so it applies.)
4. **Scan-time window resolution.** `resolveMessageWindow` filters the persona's stored messages by
   `message_ids_to_mark` when the scan runs. A wipe while another block's scan is still queued makes that
   scan find nothing.
5. **Provenance.** A signal scan carries a single `agentProvenance` (one `agent_id`, one
   `definition_revision` from that transcript's `session_init.systemPrompt`). A merged window has no
   single correct provenance.
6. **Timestamp rewriting is not available.** Shifting timestamps to force contiguous blocks would
   falsify the `timestamp` that quotes and `earliestMessageTimestamp` are derived from.

**How blocks are handled instead.** Each transcript's block is imported alone, one at a time, with
wipe-and-replace in between:

```
tree T (root session: Sisyphus, plus Reviewer#1, Reviewer#2 overlapping, Reviewer#3 later)

step 0  main        Sisyphus persona:  wipe externals → append → scans → drain
step 1  Reviewer#1  Reviewer persona:  wipe externals → append → scans → drain
step 2  Reviewer#2  Reviewer persona:  wipe externals (Reviewer#1) → append → scans → drain
step 3  Reviewer#3  Reviewer persona:  wipe externals (Reviewer#2) → append → scans → drain
```

At every step the persona holds exactly one block, so (1) `messages_sort` is a no-op over a single
transcript's order, (2) the context window is that transcript's own earlier messages (plus the
persona's real chat history if it is a live persona, as today), (3) event summary sees only this
block's unextracted messages, (4) the wipe happens only after the previous step's items have left the
queue — `queue_length()` counts pending and processing items, and every follow-up the scans spawn is
itself a queue item — and (5) each signal scan has one transcript's provenance. Message IDs
(`omp:<machine>:<encoded path>:<entry>`) are unique per transcript, so two `reviewer` blocks never
collide. Aliased agent IDs (`architect`, `s-architect`) resolve to one persona and take the same path.

This is the protocol Pi, OpenCode, and Cursor already follow for *sessions*; the decision applies it
to *blocks*. The new constraint it creates is scan count: a block costs the same extraction scans
(four, by Pi's own accounting) regardless of how few messages it holds. Blocks with no unmarked
messages are skipped. The existing minimum-token constant does not skip small blocks: it only sets a
floor on the extraction budget (`MIN_EXTRACTION_TOKENS` in `src/core/orchestrators/human-extraction.ts`),
so every block with unmarked messages is scanned, however small. Cost at that scale is not measured here.

## Alternatives Considered

### Alternative A: Keep Pi as the shared importer for main sessions; keep the OMP sub-agent importer separate

- **Description**: Status quo plus fixes to the sub-agent importer's defects.
- **Why not chosen**: It keeps two readers, two settings blocks, two ID schemes, and two checkpoint
  schemes for one product, and leaves the Pi/OMP conflation ADR-026 flagged. The sub-agent importer's
  defects (append-only, all-at-once, cwd-scoped, no guard) are fixed by adopting the main-session
  protocol, which then makes the two paths structurally the same — at which point they are one
  pipeline.

### Alternative B: One block per (tree, persona), with all of a persona's transcripts concatenated

- **Description**: Group a tree's transcripts by persona and import each group once.
- **Why not chosen**: Fails points 1–5 above whenever two transcripts overlap in time, which the
real sessions show is common. It is cheaper in scans and wrong in content.

### Alternative C: Shift or synthesize timestamps so blocks are contiguous

- **Why not chosen**: Falsifies provenance data (point 6). Rejected outright.

### Alternative D: Stop sorting external messages

- **Description**: Make `messages_sort` skip `external` messages so append order stands.
- **Why not chosen**: Changes a global behavior used by the ceremony and every other importer to
  accommodate one integration, and still leaves points 2–5.

### Alternative E: One persona per transcript instance

- **Why not chosen**: Destroys identity (the premise is that these are the same agent) and multiplies
  personas by transcript count.

### Alternative F: Make extraction and signal scans block-aware

- **Description**: Extend `resolveMessageWindow`, `queueEventSummary`, and the extraction handlers to
  select by block, so many blocks could coexist.
- **Why not chosen (for now)**: Correct and larger — it touches shared extraction code every
  integration depends on. Block-at-a-time reaches the same result using only existing protocol. This
  can be revisited if scan count becomes the bottleneck.

### Alternative G: Move checkpoints to per-machine local state

- **Description**: Store watermarks in a per-machine file instead of `settings`.
- **Why not chosen (for now)**: With one entry per root session, the size concern that motivated it is
  gone. It remains a correctness argument — the data describes one machine's disk — but it affects every
  integration's checkpoint pattern and is deferred as its own decision.
  The risk this leaves open is accepted for now: see "Checkpoints follow synced state" under Risks.

## Consequences

### Positive

- One reader, one settings block, one checkpoint scheme, one ID scheme for OMP; vanilla Pi becomes
  small and honest.
- The concurrent same-identity case and the main-plus-sub same-identity case are handled by
  the protocol already used elsewhere, with no new interleaving logic.
- Resumed or still-running transcripts are correct without per-file state; checkpoint cardinality
  stays at one per root session.
- Sub-agent discoveries (research, audits) reach topic and person extraction.
- `ei --id omp:…` resolves from any working directory.

### Negative

- Extraction cost scales with transcript count. A user enabling OMP gets a large first run: every tree
  under the sessions root, sub-agents included, is processed from the beginning, with no token-floor or
  skip effect.
- Nothing older than a tree's watermark is extracted, however it arrives: a session resumed from before
  the watermark, replicated entries that keep earlier timestamps, or a clock set back all produce
  messages at or before the watermark, which come in pre-marked and are never extracted. No back-fill
  or special handling is built; losing that older data is an accepted cost of not adding timestamp
  tracking machinery.
- Extraction runs the human-dialogue scans over transcripts in which no human speaks, at a cost and with
  a known side effect. A trial run of the real scans on the local model over 60 sub-agent blocks (30 from
  the last week, 30 older) and 10 of the author's own main-session blocks, with every proposed record
  labelled by independent model reviewers (not by the author), found: about 44% of sub-agent records
  kept, all of them knowledge about the author's projects and tools; about 13% credited to the human
  although only the parent's assignment or the agent's own work supports them, against about 10% in the
  author's own sessions; about 37% noise, against about 18%; and 59 of 60 blocks yielding at least one
  keepable record. Nearly all of the misattributed records are `Self` person records the person scan
  writes from blocks in which the human never spoke. At the sampled rate the 2,239 blocks that qualify
  cost about 29 million tokens, about 16 hours on the local model; the 83% of sub-agent transcripts
  under five messages were not run. This is accepted as written: no scan is reduced and no mechanism is
  added. The `Self`-record behavior is a property of the shared person scan, shows up in main sessions
  too, and is outside this decision.
- A newly imported session usually yields facts, topics and people but no event summary for its last
  window: the shared event-summary step skips a window whose newest message is younger than the event
  gap, and the next block's wipe can remove the unsummarized messages before a later pass reaches them.
  No OMP-specific handling is added and no option is added to force a summary. Whether that skip was
  ever intended for session importers generally is a separate question outside this decision.
- Per-block wipe-and-replace means a persona holds only its most recent block of `external` messages.
  This is not a visible loss: `external` messages are never shown in the native chat history or sent to a
  model (`src/core/message-manager.ts:41`, `src/core/context-utils.ts:20`), and an import only starts when
  the queue is empty, so the messages it replaces have already been processed. The wipe also removes
  other integrations' `external` messages on a shared persona, exactly as every importer's wipe does today;
  no source tag or scoped wipe is built.
- One new state in settings, the tree cursor, and the new `omp` block are carried through a `/settings` save
  from the live settings (§9), so an edit saved while an import runs does not roll them back.

### Risks

- **Concurrent importers from different integrations are not coordinated.** Several importers may pass
  the `queue_length() === 0` gate in the same tick and run concurrently; a wipe by one can still
  remove messages another has pending. This is pre-existing for Pi, OpenCode, Claude Code, Cursor and
  Codex, and is neither introduced nor fixed here.
- **A persona first seen only as a sub-agent is created archived** and receives no signal scans until
  the user un-archives it. This is intended, but it is a quiet outcome for a user expecting
  behavior-tracking on, say, a reviewer agent they care about.
- **Transcripts with no `agent` are filed under the generic `task` persona.** A missing `agent` more
  likely means the file was written before OMP recorded the field than that the spawn was unnamed, so
  some of these transcripts may belong to named agents and are attributed to the generic bucket
  instead (extraction only; no signal scan is at risk). This is accepted: Pi files a message with no
  agent under its generic persona the same way.
- **OMP owns the transcript format** and can change it without notice (ADR-038). Per-file failure
  yielding `null` rather than throwing remains the mitigation. A transcript with any unparseable line is
  rejected whole, never imported in part, and has no block; the tree's watermark still advances once its other
  blocks are handled, so a rejected transcript is retried only when its tree changes again.
- **Checkpoints follow synced state, not the machine.** The watermarks and the tree cursor live in
  settings, and the restore paths (silent pull, "server wins") apply a peer's settings wholesale. If OMP
  is used on two machines that sync, one machine's watermarks and cursor can be applied to a machine
  whose disk differs, so trees can be skipped or imported partially. This is accepted for now, with no
  machine tag and no per-machine store added; moving checkpoints (Alternative G) is its own later
  decision.

## Reversibility

Moderate. Settings keys and the importer split can be reverted with a settings migration. New `omp:`
message IDs, once stored in quotes and observations, are as permanent as any other qualified ID
(ADR-015): reverting would require keeping the `omp` resolver branch. No Pi data is moved, so nothing
else is one-way.

No undo, downgrade or disable protocol is built for OMP; it gets what every importer has today. A bad
first run is cleaned up by hand with the existing `/unsource` command. Downgrading to an earlier build
after the first import is unsupported, and no reverse pass is built. Disabling OMP takes effect at the
next poll, as for every other importer. The extraction pipeline is not redesigned for any of this.

## Rationale Provenance

- **STATED** (verified in source at the baseline of this record): the two paths' operational
  differences in the table above; the order of operations inside the OMP importer (read the
  transcript, require an agent, create the persona, then check the Person link); `messages_sort` and
  its callers (every session importer except Slack); `queue_length()` counting pending and processing
  items; `resolveMessageWindow` reading persona state when the scan runs and `queueEventSummary` reading
  it when the scan is queued; `ensureAgentPersona` creating personas unarchived; OpenCode importing
  only sessions with no `parentId`; `yaml-settings.ts` knowing only `pi`; the onboarding wizard folding
  OMP into `pi`; the route from a matched Person carrying an `Ei Persona` identifier into the signal
  pipeline.
- **STATED** (verified in git history): commit `5ade17e2`, "do not auto-archive agent-mapped personas on
  creation", touching five importers; its message gives no reason.
- **STATED** (observed on one machine): the proportions in the Context section; the first user
  message of a sub-agent transcript being the parent's assignment; `pgrep -x omp` returning nothing
  while OMP ran as a script under another runtime; most sub-agent transcripts ending in an assistant
  `yield` tool call; no inspected session file containing an unparseable line.
- **STATED** (traced in source, not run): `Message.role === "human"` as the speaker test in the prompt
  renderer, the quote speaker, and the resolver; `speaker_name` used by the renderer and the quote
  speaker only for non-human roles; `observer_kind` validated as an enum (with an observer ID required
  for `other_persona`) and used in the witness key; the `external_filter` option read only by
  `queueEventSummary`.
- **INFERRED**: why the sub-agent importer appends instead of replacing; that the unnamed spawns became
  `agent: "task"`; why `5ade17e2` removed auto-archiving (presumably so control agents are visible);
  that `role: "system"` plus `speaker_name`
  produces acceptable extraction output (consumers were traced, behavior was not run).
- **NOT VERIFIED**: how the signal-scan prompt behaves on a transcript
  with no human speaker, beyond the eval results under Verification; the promotion threshold a human witness counts toward.

## Open Questions

None. Resolved and folded into the Decision: the crash cursor is persisted (§4); the parent-agent representation is `role: "system"` plus `speaker_name`
(§5); alias normalization ignores a single-letter prefix (§5); a tree is imported only after the whole
tree has been quiet, with no early import of finished sub-agents (§4); a persona first seen as a
sub-agent stays archived until the user un-archives it, even if later used as a control agent (§5).

## Verification the Implementation Must Pass

Checks to run, not decisions to make. Accepting this ADR is the owner's decision and is not gated on them.

- Run the persona-signal-scan eval (`tests/evals/persona-signal-scan.eval.ts`) against a transcript
  whose only speakers are the parent agent and the sub-agent, and confirm it never emits a `human`
  observer.
  The check also confirms the scan still records the sub-agent's own behaviour, since a scan that emits
  nothing would pass the negative half. It runs on the local model and on a paid model (Anthropic's
  `claude-haiku-5-5`, priced at $0.10 per million input tokens and $0.50 per million output tokens for
  prompts up to 100k tokens), keeping the test input under 100k tokens so the paid run stays cheap, with a
  spending limit of $10; both results are reported. The eval runner records token usage but not cost, and
  no cost reporting is added to it: the cost is estimated from the recorded tokens. The test input is a
  synthetic transcript shaped like a real one, never a private session.
  Recorded result for the parent-line case: on the local model (`google/gemma-4-26b-a4b-qat`) it passes 3 of
  5 runs (in the other 2 the scan read the parent's note as a human's testimony), and the same input with the
  parent's line imported as `human` fails every run; on `claude-haiku-5-5` it passes 5 of 5 and the `human`
  control fails 5 of 5. The local model's 3 of 5 is a known limitation of that model on this scan: the
  `role: "system"` plus `speaker_name` representation stands, and the case is not expected to reach 5 of 5
  there. The eval runner omits `temperature` for a model its known-limits list says rejects it (as the app
  does), so the paid model runs.
- Unit cases for alias normalization: a prefixed ID and its bare form resolve to one persona; a persona
  created for the name records the original ID in its alias list; distinct names (`reviewer`,
  `code-reviewer`) stay distinct; a persona already stored under a prefixed spelling (`S Architect`) is
  neither merged into nor renamed, and an existing persona found after the prefix is stripped is returned
  unchanged.

## References

- ADR-001 (Persona identity vs. agent operating contract), ADR-012 (sunset with a path forward),
  ADR-015 (fully-qualified message IDs), ADR-026 (per-harness integrations; its deferred Pi/OMP
  tangent is resolved here), ADR-032 (manual setting prevents automated re-setting), ADR-038 (persona
  signals; this record supersedes its scope of the OMP reader but not its signal model — its item
  "(c)" message-ID question is answered by this record's §7; its cognitive-distance definition,
  ADR-038 §8, is unchanged).
- `src/integrations/pi/importer.ts`, `src/integrations/pi/reader.ts`, `src/integrations/omp/importer.ts`,
  `src/integrations/omp/reader.ts` — the two paths.
- `src/core/state/personas.ts` (`messages_sort`), `src/core/state/queue.ts` (`length`),
  `src/core/handlers/utils.ts` (`resolveMessageWindow`),
  `src/core/orchestrators/human-extraction.ts` (`queueAllScans`, `queueEventSummary`,
  `queuePersonaSignalScan`), `src/core/personas/opencode-agent.ts` (`ensureAgentPersona`),
  `src/core/integration-sync-manager.ts` (the sync gate), `src/cli/retrieval.ts` (resolver).
- `tui/src/util/yaml-settings.ts`, `tui/src/components/OnboardingOverlay.tsx`,
  `tui/src/util/upgrade-prompt.ts` — settings, onboarding, and the existing startup-prompt pattern.

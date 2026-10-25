# Changelog

All notable changes to Ei are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning
convention is in [README.md → Versioning](./README.md#versioning): `v1` is an extension of
`v0`, so breaking changes ride the minor until `v2` is earned.

This file starts where it was added and is deliberately not backfilled. For anything earlier,
read `git log`, or the per-document changelog tables in `CONTRACTS.md`.

## [Unreleased]

## [1.11.2] — 2026-10-25

### Fixed

- **1.11.0 and 1.11.1 were tagged but never reached npm; 1.11.2 is the first published 1.11
  build.** The release pipeline's unit tests failed on a clean runner because one test needed
  the real embedding model: its download races across test workers and comes out corrupt, so
  the test timed out. The test now replaces the persona description embedding with a
  deterministic function, so it no longer depends on the model. Nothing user-visible differs
  from 1.11.0, so the 1.11.0 notes below, including *Upgrading to 1.11.0*, apply as written.

## [1.11.0] — 2026-10-25

### Upgrading to 1.11.0

If you are coming back after months, read this before the first launch.

- **Copy `state.json` first.** Migrations run in place on every launch, before the loop starts.
  There is no pre-upgrade backup and no downgrade path.
- **OMP is its own integration now, and nothing copies the Pi toggle.** If you imported OMP
  through Pi, enable `omp.integration` in `/settings`. The first OMP run re-imports every
  session tree from the beginning, creates an `OhMyPi` persona and archived personas for
  sub-agents, and can be large: it takes a long time and uses LLM calls. Old `pi:` ids for OMP
  sessions no longer resolve; Pi itself reads only `~/.pi`.
- **Check your heartbeat settings before launching.** The new 5-minute minimum and the
  zero/negative-duration checks apply only when you save; values already stored are read as they
  are at runtime. Check `default_heartbeat_ms` and each persona's `heartbeat_delay_ms` in
  `/settings`: a stored `0` queues a heartbeat on every loop pass (static personas are skipped by
  the scheduler).
- **Idle personas may message you first.** On the first launch, a heartbeat fires for every
  persona that is not archived, static or paused and whose last message is older than its delay.
- **The ceremony does not catch up.** It runs only at its configured time, while Ei is running.
- **Retired reflection data is dropped.** See *Removed*. If you had a pending reflection
  proposal, it is gone after the upgrade.
- **The TUI will offer to install the latest skills, hooks and integrations on first launch if
  your install has no version record, and you should know what accepting does.** An existing
  install with no `installed_version` in `local.json` (set up before the record existed, or with an
  older `ei --install`) is prompted, as is one recorded at a different version. Accepting runs the
  same install as `ei --install`: it removes the `ei` MCP entry from your Claude Code, Cursor and
  Codex configs (add it back by hand if you used MCP), and it does not delete retired skills such
  as `ei-reflect`: remove any stale `ei-reflect` directory from the skills folders you use
  (`~/.claude/skills`, `~/.agents/skills`, `~/.omp/agent/skills`, `~/.config/opencode/skills`).
  Dismissing it asks again next launch.
- **Rolling backups are opt-in and each one is a full copy of `state.json`.** They are TUI-only
  and apply once `backup.enabled` is on; by default one is taken at most every hour and 24 are
  kept, so disk use scales with the size of your state.
- **The startup quote-id migration runs every launch.** It does not re-verify quote ids that are
  already fully qualified, so quotes mis-sourced under 1.10.0 stay as they are.
- **Custom tools without a `kind` count as write tools.** They are not offered to Personas in
  Rooms; mark a tool `kind: "read"` to keep it there.
- **`show_thinking` absent means on.** Every existing persona shows thinking once you upgrade.

### Fixed

- **`ei --install` now records the installed version, and existing installs with no record are
  offered the skills/hooks refresh after an upgrade.** The version was written only by the TUI
  (onboarding wizard, upgrade prompt), so installs done with `ei --install`, or set up before the
  record existed, were never prompted after an upgrade. `ei --install` now writes
  `installed_version` to `local.json` once the install succeeds (a failed install records
  nothing), and the TUI treats an existing user with no record as out of date and shows the
  upgrade prompt.
- **Pantheon's `P-Sisyphus` agent id now resolves to the existing `Sisyphus` persona.** Pi/OMP
  sessions attributed to `P-Sisyphus` were creating a separate `P Sisyphus` persona on import;
  `p-sisyphus`/`P-Sisyphus` are now `Sisyphus` aliases alongside the other OpenCode variants.
- **`/settings` saves keep importer progress made while the editor was open.** Saving no longer
  rolls an importer's progress back to what it was when the editor opened.
- **The eval runner no longer sends `temperature` to models that reject it.**
- **Personas now tell you when a tool fails and what to do about it.** A dead Spotify login or a
  missing Tavily key used to be invisible to the persona, which carried on as if the tool had
  worked. It now explains what broke and where to fix it (for example Settings → Toolkits).
- **OpenCode and Pi importers no longer file a new agent's messages under an unrelated
  persona.** A persona whose name merely contained the agent name (`Architect` under `Software
  Architect`, `Pi` under `Spider`) used to catch them; names and aliases are now matched exactly.
  Refreshing an archived persona's aliases keeps its existing aliases and adds the new ones
  instead of replacing them. Name lookup in TUI commands is unchanged.
- **A scanned name that matches several existing people no longer merges into the first one
  when the embedding service fails.** The scan now creates a new person instead.
- **Settings that make no operational sense are now rejected.** Heartbeat intervals below 5
  minutes are refused for the global default (TUI `/settings` and web settings) and for
  per-persona heartbeats (TUI persona editor and web persona settings; static personas are
  exempt). In the TUI `/settings` editor, a zero, negative or non-numeric default context window,
  rolling-backup interval or backup count, or integration polling interval is refused too.
  Previously a `0` could blank conversation history, delete every rolling backup, or queue a
  heartbeat on every loop pass. Settings already stored with such values are not migrated; the
  `/settings` editor won't save until they are fixed.
- **The web settings modal no longer shows a phantom default for message rolloff.** Unset
  `message_max_age_days` and `message_min_count` display 0 (never prune), which is what applies.
- **The `<ei-relationship>` block given to harness agents now lists every trait of the
  persona.** That includes the "never do this" guardrail traits (strength 0) and moderate ones,
  not only traits at strength 0.7 or above.

### Changed

- **Personas in Rooms no longer have tools that write.** In a Room a Persona can still look things
  up, but tools that edit its identity or notes (traits, topics, description, notes, signals) are
  withheld; make those edits in a 1:1 conversation.
- **A single-letter prefix and a hyphen on an agent name now fold into the bare name.** For every
  integration's persona lookup, `s-architect` resolves like `architect`.
- **Pi now reads only `~/.pi`.** OMP sessions are no longer picked up through the Pi integration.
- **Stored `pi:` message ids that belong to OMP sessions no longer resolve.** OMP ids now start
  with `omp:`, and `ei --id omp:...` resolves from any directory.

### Added

- **OMP (oh-my-pi) is its own integration.** It has its own `omp.integration` setting in
  `/settings` and its own onboarding entry, separate from Pi. Its importer reads whole session
  trees, including sub-agent transcripts, block by block with a per-tree watermark; the first run
  imports every tree from the beginning. Sub-agent lines written by the parent agent are stored as
  system messages from "Parent agent"; the human's own lines stay the human's.
- **See which tools a persona called to answer you.** A persona message whose turn called tools
  now carries an icon: 🔧 when every call went to a tool classified as read-only (it only reads or
  looks something up), 🧧 when at least one call went to a tool classified as a write — one that
  can change something, such as the persona's own traits, topics, description, or notes, or the
  status of one of its signals. The icon describes the tools that were called, not what the calls
  did: a call is listed whenever it got a result, including a call to a tool that doesn't exist,
  one refused because the tool had used up its calls for the turn, and one that failed, so 🧧
  doesn't mean anything was actually written. A tool with no classification — an unknown tool, or
  a custom tool without a `kind` — counts as a write; a custom tool marked `kind: "read"` stays
  read-only.
  - **Web**: the icon sits in the message's action row. Clicking it opens a dialog listing every
    call in order — tool name, its `action` when it has one, each argument in full, the saved
    result, and its error flag. The flag is passed through exactly as the tool layer set it and
    can be off even when the result describes an error, so read the result too. Escape, the ✕
    button, or a click outside the dialog closes it; focus moves into the dialog, Tab and
    Shift+Tab stay inside it, and focus returns to where it was when the dialog closes.
  - **TUI**: the icon sits in the message header. `/toolcalls` opens the same detail for the most
    recent persona message, and `/toolcalls <N>` for message N (the number `/quotes <N>` uses).
    If that message has no tool calls, you get a notice instead; it never falls back to an older
    message.
- **Persona thinking, shown above the reply.** When the model returns its reasoning, the message
  is marked 💭 and the reasoning is shown above the reply. Whether it's shown is a per-persona
  setting, on by default, and applies to all of that persona's messages at once: click 💭 on any
  message in the web app, run `/thinking` in the TUI, or use **Show Thinking** on the web persona
  editor's Settings tab or `show_thinking` in the TUI's `/details` editor. The setting is in-app
  only — `ei --id` and `ei_lookup` never show it, and `ei update persona` rejects it.
- **Tool calls and thinking are saved with the message.** They're written once, on the single
  final message of the whole turn (every tool round included), when the turn finishes — nothing
  is streamed in as it runs. The saved copy of each tool result is cut to 150 characters plus
  `... (truncated)`; the persona itself still sees the full result while the turn runs. Arguments
  are saved in full, and so is thinking: every round's thinking is joined with a blank line and
  kept with no size cap, so saved history grows faster with models that think at length. Neither
  is ever sent back to the model as part of later conversation history — they exist for you to
  read. Rationale: [ADR-040](./docs/adr/ADR-040-tool-calls-and-thinking-are-persisted-for-human-display-only.md).
- **A 1:1 turn that called tools but produced no reply now leaves a message**, shown as "[*name* ran
  tools but sent no reply]" in the web app and "[Persona ran tools but sent no reply]" in the TUI,
  so the tool calls it made have somewhere to appear. A persona that deliberately chooses not to
  respond still shows the usual "chose not to respond" message.
- **Heartbeats and Rooms save the same detail.** A heartbeat that reaches out carries its turn's
  tool calls and thinking on the message it sends; a heartbeat that decides not to reach out still
  writes nothing. Room replies save them too, and a Messages Against Persona verdict saves the
  Judge's thinking — but Rooms don't display any of it yet, and `/toolcalls` and `/thinking` only
  work in 1:1 conversations.
- Restoring or importing a backup made before this release gives each built-in tool its read/write
  classification, so calls made after the restore aren't all marked as writes. Nothing else in
  the restored tool definitions (per-tool config, heartbeat eligibility) is touched.
- **Claude Haiku 5.5 (`claude-haiku-5-5`) is a known model.** Provider auto-detection now picks
  it as the Anthropic extraction model and stamps `temperature_disabled` (the API returns a 400
  for any temperature other than 1, which previously sent every extraction request to the
  dead-letter queue), `max_output_tokens: 128000`, and a `token_limit` of 80k. That limit sits
  below Anthropic's 100k-token prompt-pricing threshold because Ei's character-based token
  estimate runs about 1.5x low for Haiku 5.5's tokenizer. `temperature_disabled` and
  `max_output_tokens` apply to every Haiku 5.5 model, however it was configured; the
  `token_limit` is copied onto a model only when onboarding or provider auto-detection creates
  it, so models configured earlier, or added through `/providers` YAML, keep the default budget
  until you set `token_limit` on them.
- **Claude Sonnet 5.5 and Opus 5.5 (`claude-sonnet-5-5`, `claude-opus-5-5`) are known models.**
  Fresh Anthropic detection already selected them as the chat and bonus models, but neither
  had an entry, so Ei sent `temperature` and the API rejected every chat request with a 400.
  Both now get `temperature_disabled` and `max_output_tokens: 128000`, with a `token_limit` of
  200k matching the other Sonnet/Opus entries. `temperature_disabled` and `max_output_tokens`
  apply to every such model however it was configured; as with Haiku, the `token_limit` is
  copied only onto models created by onboarding or auto-detection, so existing models (and any
  added through `/providers`) need `token_limit` set by hand.
- **Persona identity and signals are now tools, not a review step.** In a 1:1 conversation a
  persona can read and change itself directly: `get_my_identity` shows its full identity, and
  `edit_trait`, `edit_topic` and `update_description` change it. `resolve_signal` settles one of
  its own open signals, and `add_note` / `clear_note` keep its notes. Only `get_my_identity` is
  read-only: the others are classified as writes, so they are withheld in Rooms and are not
  offered during heartbeats.
- **Harness agents can work with a persona's signals from the CLI and MCP.**
  `ei add observation <personaId>` asserts an observation, `ei list signals <personaId>` lists
  every signal (all statuses, both lenses) so you can find the ids, and `ei confirm signal` /
  `ei dismiss signal <personaId> <signalId>` mark one reviewed or dismissed. MCP has the same
  four as `ei_observation_add`, `ei_signal_list`, `ei_signal_confirm` and `ei_signal_dismiss`.
- **Two new skills.** `ei-manage-signals` teaches a harness agent to act on an open signal
  (read the full identity, talk it over with you, then act); it replaces `ei-reflect`.
  `ei-perspective` spins up temporary sub-agents that each embody one of your Personas, so they
  can weigh in on a real open question.

### Removed

- **The reflection workflow is gone.** The `/reflect` TUI command, the web reflection review
  modal and the TUI/web pending-reflection indicators, the automatic reflection critic, the
  reflection-alert heartbeat items, and the `ei-reflect` skill (replaced by `ei-manage-signals`)
  no longer exist. The `external_reflection_only` and `pending_update` persona fields are removed
  from the persona record, and the `<ei-relationship>` block no longer carries the Person Log
  character-count nudge.
- **Nothing is migrated.** On upgrade, any pending reflection proposal and any queued critic
  work is dropped without notice, and the two retired persona fields are deleted from stored
  personas when they load.

## [1.10.0] — 2026-08-09

### Added

- **Four dedicated quote verbs.** A quote asserts that a real person said a specific thing, so
  the commands that touch one are now split by whether they make that claim:
  - `ei create quote --message-id <id> --text "<text>" [--start N --end N]`
    (MCP: `ei_quote_create`) — attests a new quote by matching the supplied text against the
    resolved source message. `speaker`, `channel`, `timestamp`, the offsets, and the embedding
    are all derived from that message, and are rejected if a caller supplies them.
  - `ei fix quote --quote-id <id> --text "<text>" [--start N --end N]`
    (MCP: `ei_quote_fix`) — corrects mistranscribed text by re-verifying it against the quote's
    *existing* source message. Never re-resolves a different source. Links and provenance are
    otherwise untouched — the one exception is the overlap merge described below, which can
    grow `data_item_ids`/`persona_groups` as a side effect, never as something the caller
    directly supplied.
  - `ei relink quote <id> --to <entity-id,...>` (MCP: `ei_quote_relink`) — changes
    `data_item_ids` and nothing else. `--to` is the complete replacement list, and `--to ""`
    clears every link. It asserts nothing about text or origin, so unlike create/fix it also
    works on a quote whose source message no longer resolves, or one whose `message_id` is
    `null` because it predates attestation.
  - `ei remove quote <id>` (MCP: `ei_remove` with `entity_type: "quote"`) — deletes a quote.
    Quote removal was previously unavailable on the public surface entirely.
- **`create quote` and `fix quote` merge into an overlapping quote instead of coexisting
  beside it.** If the verified span overlaps an existing quote already on the same message,
  the two are unioned into one record — widened span, deduplicated `data_item_ids`/
  `persona_groups` — rather than left as two overlapping records that say almost the same
  thing. `create` in that case never inserts a new quote at all; `fix` can absorb a
  neighbouring quote, which then no longer exists. A confirmed merge returns
  `{status: "merged", quote, absorbed, message}` instead of the plain created/fixed record;
  `absorbed` lists every quote id folded into the surviving record. A queued (not-yet-confirmed)
  write is unaffected by this and still returns the existing `{status: "queued", ...}` shape,
  with no `absorbed` field, since a queued write hasn't been evaluated yet and can't honestly
  report what it will absorb.
- `create quote` and `fix quote` either verify the supplied text against a resolved source
  message or refuse — there is no third outcome. The four refusals are `no source message to
  verify against` (the quote predates attestation), `source message could not be found`,
  `quote text not found in source message`, and `offset does not match the resolved text
  location`. A refusal persists nothing.
- `--start`/`--end` on `create quote`/`fix quote` are a consistency check, never a way to
  select a later occurrence of repeated text: supply both, and both must equal the span the
  server independently finds, or the write is refused.
- **`--json-file <path>` on `ei create` and `ei update`.** Takes the same body `--json` takes, read from a
  file instead of argv, so a large or sensitive payload never appears in process listings or shell
  history — persona reflection especially, where the body may carry a whole persona identity or
  PersonLog revision. Exactly one of `--json`/`--json-file` is required; passing both, or neither, is a
  usage error. Ei never creates the file, so the flag adds no predictable-path exposure of its own. The
  quote verbs are unaffected and still take `--json` over their discrete flags.
- **Every harness now gets an identity block at session start, not just OpenCode and OMP.** Claude
  Code (`SessionStart`), Codex (`SessionStart`), Cursor (`sessionStart`, via its `additional_context`
  output), and base Pi (`before_agent_start`, once per session branch) each inject the
  `<ei-relationship>` block for their harness persona — base prompt, strongest traits as **Working
  Style**, topics as **Shared Context**, and the Ei Person Log's reflection notice — from the same
  `ei personas --format prompt` source OpenCode and OMP already used. Previously those four
  harnesses received memory search results and nothing else: the agent had no idea who it was
  supposed to be. Re-run `ei --install` to pick the new hooks up. Codex additionally requires a
  one-time trust approval (`/hooks` inside Codex) before either Ei hook will run at all.
- **The memory hook no longer re-injects memories the session has already seen.** Every harness now
  filters each search against the entity ids it already surfaced this session and injects nothing
  when nothing new survives. Claude Code, Codex, and Cursor keep that record in a per-session state
  file (`~/.claude|.codex|.cursor/ei-hook-state/<session id>.json`, 0700 directory / 0600 files,
  session id validated before it reaches a path, pruned after 30 days); Pi and OMP keep it as
  non-model-visible session-branch entries, so a forked branch inherits what was surfaced before
  the fork and stays blind to its siblings. OMP also stopped re-announcing an unchanged identity
  every turn — it now re-announces only on an actual persona switch, and tracks "no active persona"
  as its own state so clearing and reselecting the same persona is still announced.
- **Cursor's memory injection is per-session again.** Its only per-turn hook has no
  context-injection output, so memory still goes through `~/.cursor/rules/ei-context.mdc` — but the
  accumulated view is now bookkept per `conversation_id` and the shared rules file is a pure render
  target, re-rendered with *this* session's view every time this session's hook fires (capped at 30
  items). Concurrent Cursor sessions — background agents, Side Chats, multiple Composer windows —
  no longer overwrite each other's memory context except for a single bounded, self-correcting turn
  when they interleave. The identity block deliberately rides `additional_context` instead, so it
  never enters the `alwaysApply` rules file and never costs tokens on every model call.
- **The Pi extension actually loads now.** It imported Bun's `$` shell helper, which Pi's
  jiti-based extension loader cannot resolve on any Pi distribution (Node-run or Bun-compiled
  binary) — the generated extension threw at load time on every real install, so no Pi user had
  working injection at all. It now uses `node:child_process`, which every Pi runtime provides.

  Session-boundary races that these hooks accept rather than eliminate (Claude Code's `SessionStart`
  and Cursor's `sessionStart` are fire-and-forget; OMP's Tab-switch can outrun its own persona read)
  are recorded in [ADR-034](./docs/adr/ADR-034-session-boundary-hook-races-accepted.md). Codex, Pi,
  and OMP's `before_agent_start` were each verified to run synchronously before the model request.
- **Two new shipped skills**, installed onto every detected harness by `ei --install` and by the
  onboarding wizard, alongside the existing four:
  - **`ei-rewrite`** — the on-demand counterpart to Ei's automatic Rewrite ceremony. Slims a Topic
    or Person record that has accreted correctly-attributed but off-contract content (a Person
    profile turned project log, a Topic turned catch-all) and redistributes that content into
    existing or new records. Every redistribution target must be found by searching Ei's own data
    first, so a manual rewrite can't fragment memory by minting a record Ei already has under
    different wording. It goes one step beyond the automatic Person-rewrite phase — which only
    ever redistributes into Topics — and may spin off a new Person, but only when the content
    identifies a real, distinct person and recon found no existing one to fold it into.
  - **`ei-generate`** — agent-authored document synthesis from Ei's memory: a runbook, onboarding
    doc, profile/job description, RoboBrain learning note, or period performance review. Distinct
    from the TUI/web `/generate` feature, which enqueues an LLM call and stores the result as an
    Emmett-owned message: this skill is read-only against Ei, the calling agent does the writing
    itself, and the output is a plain untracked file placed wherever the user says. Two gates run
    before any drafting — a names/handles-and-audience gate the moment a third party surfaces, and
    a persona-contamination gate requiring two independent sources for any character claim, since
    Ei's own personas share a knowledge base with the humans they describe.

### Changed

- **Quote corrections no longer use the generic `upsert`/`remove` correction ops.**
  `entity_type: "quote"` now validates against exactly four dedicated ops — `quote.create`,
  `quote.fix`, `quote.relink`, `quote.remove` — each with its own allowed-key set. A
  pre-cutover `{op: "upsert", entity_type: "quote", …}` record left queued by an older binary
  is rejected at all three consumers (the CLI read overlay, the CLI self-drain, and the live
  Processor drain), and rejecting it reports a skip rather than wedging the other pending
  corrections in the same batch.
- **Room attribution.** Message resolution returns a discriminated `ResolvedMessage` carrying
  `origin_kind`, a canonical `source_id`, and a `container.kind` of `persona`/`room`/`session`,
  so a room message is distinguishable from a direct one instead of being flattened into a
  single generic envelope. A room message whose persona has since been deleted now resolves to
  the display name `Participant` instead of `undefined`.
- **Channel derivation.** A quote created through `create quote` takes its `channel` from the
  resolved source's container display name — the persona's name for a direct message, the
  room's name for a room message, the session title for a coding-tool session — instead of
  being left unset.
- `ei remove` and MCP `ei_remove` now accept `quote` as a type, and `ei --help` documents all
  four quote verbs.
- The Release Protocol checklist in `AGENTS.md` gained a step for closing out this file's
  `[Unreleased]` heading before tagging.
- **`ei update` / `ei_update` on a topic, person, or persona is now an RFC 7396 JSON Merge Patch, not a
  full-record replacement.** Send only the fields you're changing. A field you omit is left exactly as
  stored — it is no longer reset to a default, which is what made the old contract require reading the
  whole record back in before every edit. `null` removes a field where the record is still valid without
  it (`topic.category`; `person.name`/`identifiers`/`validated_date`, though not `name` and
  `identifiers` together; a persona's `pending_update`); a `null` that would leave a required field
  missing rejects the whole write and persists nothing. Arrays still replace wholesale when present —
  sending `traits` means "these are all the traits now." See
  [ADR-029](./docs/adr/ADR-029-json-merge-patch-write-semantics.md).
  - `fact` is the one permanent exception: it has no defaults, so there is nothing to merge onto, and
    `ei update fact` / `ei_update` with `entity_type: "fact"` still replace the whole record.
  - **If you have a script or skill that reads a record with `ei --id` and submits the whole thing back,
    it needs updating twice over**: it will now be rejected for echoing back fields that left the write
    contract (below), and where it previously relied on resubmitting everything to avoid resets, that is
    no longer necessary.
  - On the wire this is a new `patch` correction op alongside `upsert`/`remove`. A `patch` carries no
    embedding: the merge that decides what gets written happens at drain time against whichever state is
    actually stored then, and the vector is recomputed there from the merged text. A patch valid by
    grammar but invalid once merged onto stored state is rejected wholesale, and a patch whose target
    does not exist is rejected — there is nothing to merge onto.
- **Rejection messages for unknown fields no longer name the field.** Every create/update path now
  answers with a fixed generic message instead of echoing the offending property names, because a
  property name is caller-controlled text and one carrying terminal control bytes must not reach CLI
  stderr or an MCP response verbatim: `Invalid <type>: unrecognized field(s) present` for
  fact/topic/person/persona create, `Invalid <type> update: unrecognized field(s) present` for their
  update. The three quote verbs (`create`/`fix`/`relink`) keep their own distinct prefix shape —
  `Invalid quote (create|fix|relink): unrecognized field(s) present` — same fixed suffix, same
  never-echo-the-key guarantee. The field lists in the
  [CLI README](./src/cli/README.md#update-semantics-a-merge-patch-except-for-fact) are the reference
  for what to remove from a rejected body.
- `ei-curate` now routes bloated-but-correctly-attributed records to `ei-rewrite` instead of
  handling them, and lists `rewrite_length_floor` among the server-managed fields a caller
  never sets.

### Fixed

- **The startup migration can no longer launder an unverifiable quote into a sourced one.**
  `migrateMessageIds()` rewrites a quote's bare `message_id` into the fully-qualified format
  only when the quote's own text is actually found in that candidate message's content.
  Previously any id that resolved to *some* message was upgraded, which handed an unverifiable
  quote a plausible-looking source pointer — and, as of this release, a `message_id` that
  `fix quote` would then accept as its verification target. A quote that fails the check keeps
  its unqualified id, the same disposition a quote with no candidate match at all always had:
  nothing is deleted, rejected, or logged.
- **A default context window under an hour is refused instead of quietly saved.** The web app's
  Settings → General → "Default Context Window (hours)" field wrote whatever you typed straight
  through, and every persona without its own `context_window_ms` inherits that number. `0` was the
  worst case: the window is computed as `now - value`, so zero starts the window *now* and filters
  out every past message — history blanked for every inheriting persona at once, with no error and
  nothing to connect the blank history back to the number you typed. `0` is also the easiest wrong
  answer to reach, because the neighbouring rolloff settings use `0` to mean "no limit, never
  prune" (`message_min_count`, `message_max_age_days`); here it means the exact opposite.
  Anything below 1 hour, and anything that isn't a number, is now rejected with a message
  naming the minimum and saying outright that `0` does not mean "unlimited" here; the previously
  saved value is kept. This guards that one input — the TUI's `/settings` YAML and a hand-edited
  `state.json` are unchanged, so this is not a new store-wide invariant.
- **A memory search that legitimately found nothing no longer re-runs itself over the network.**
  The generated context-injection hook scripts try your locally installed `ei` first and fall back
  to `bunx ei-tui@latest` only if that fails — but the fallback triggered on *empty output* rather
  than on failure. "No relevant memories" is both the common case and indistinguishable from "`ei`
  isn't installed", so every no-results injection silently paid for a second, networked run that
  was never going to return anything either. The scripts now branch on whether the local call
  actually failed. Affects the hooks for Codex, Claude Code, Cursor, Pi/OMP, and OpenCode. The fix
  is in newly generated scripts, so on a machine where hooks are already installed, re-run
  onboarding (`/onboarding` in the TUI) to pick it up.
- **A rejected write no longer echoes your own field names back at you.** Zod builds its
  "unrecognized key" error by pasting the offending property names into the message text, so an
  extra `--json` or MCP key whose *name* — not value — carried ANSI escapes or control characters
  reached CLI stderr or an MCP response verbatim, able to recolour, overwrite, or forge lines in
  whatever was reading that output. Only the three quote verbs were protected before. All eight
  write paths now share one formatter: `create`/`update` for fact/topic/person, `create`/`update`
  for persona, the corrections-queue re-validation that runs at drain time (reachable through a
  hand-written `corrections.json` even when the CLI-level schema would reject the same key), and
  the three quote verbs. The refusal now reads `Invalid <type>[ update]: unrecognized field(s)
  present` for fact/topic/person/persona (quote's own three verbs keep their existing
  `Invalid quote (create|fix|relink): ...` prefix) — deliberately generic, and no longer naming
  *which* key was unrecognized; the server-owned fields that trigger it are enumerated in
  the [CLI README](./src/cli/README.md#update-semantics-a-merge-patch-except-for-fact). Every other
  kind of validation error is untouched and still names the field and expected type, because those
  messages only ever quote fixed schema names, never caller-supplied text.
- **Editing a record no longer sends it straight back into the ReWrite ceremony.** Every topic and
  person carries a `rewrite_length_floor` — the length its description must outgrow before ReWrite
  will consider it again, which is what stops the ceremony from re-flagging a record it has already
  reviewed. Nothing recomputed that floor when a human edited the description, so growing a
  description past its stored floor through any surface — CLI, MCP, TUI, or web — re-flagged the
  record for rewrite immediately after the edit that grew it. The floor is now resolved in one
  place: the single upsert choke point every writer passes through. A human-facing write recomputes
  it when the description changed and preserves it otherwise, while extraction and ReWrite itself
  pass explicit values through a dedicated channel so automation can still opt out. Implements
  [ADR-032](./docs/adr/ADR-032-manual-setting-prevents-automated-resetting.md), amended in the same
  change: enacting it showed the ADR's original absent/`null`/number vocabulary doesn't survive
  real callers, since every writer spreads over the current record and the field is therefore never
  genuinely absent — only ever the old value riding along or a deliberate overwrite.
- **Three web test suites were silently collecting zero tests and reporting success.** Under jsdom,
  Vite's dependency optimizer resolved zod's named export to `undefined` for any test importing
  `Processor` or `entity-schemas`, so the suite failed during collection and passed with nothing
  run. `server.deps.inline: ['zod']` in `web/vitest.config.ts` fixes the cause.

### Removed

- Nothing. The `update` verb on a quote — CLI `ei update` with a quote type, MCP `ei_update`
  with `entity_type: "quote"` — is **tombstoned, not removed**. Both are still real, still
  registered, and now always reject with a message naming `ei fix quote`, `ei relink quote`,
  and `ei remove quote`, and stating that installed skills instructing you to call it predate
  this version. Deleting it outright would have turned every stale installed skill into an
  unhelpful "unknown type" error instead of a corrective one; see
  [ADR-012](./docs/adr/ADR-012-sunset-with-a-path-forward.md). Scheduled for removal two
  releases after the one that ships that message.
- **System Hidden fields left both the write contract and the external read shape.** No longer
  accepted on create or update — a body containing one is rejected as an unrecognized field rather
  than silently ignored — and no longer present in `ei --id` / `ei_lookup` output or in any
  create/update response. Fact/Topic/Person: `embedding`, `rewrite_length_floor`, and (Topic/Person
  only) `exposure_current`, `exposure_desired`, `last_ei_asked`. Persona: `tools`, `model`,
  `heartbeat_delay_ms`, `context_window_ms`, `include_message_timestamps`, `context_boundary`,
  `is_paused`, `pause_until`, `is_archived`, `archived_at`, `last_heartbeat`, `description_embedding`
  — `is_archived` in particular is no longer settable externally at all, use the TUI's `/archive`
  command. `embedding` and `rewrite_length_floor` are still written for you during an update, just
  never supplied by you.
- **System Visible fields left the write contract only — they are still readable.** `learned_on`,
  `last_mentioned`, `learned_by`, `last_changed_by`, `sources`, `interested_personas`,
  `persona_groups` continue to appear in `ei --id` / `ei_lookup` exactly as before, but submitting
  any of them on create or update is now rejected as an unrecognized field: provenance is never
  caller-assertable. This is the pairing that breaks a script which reads a record and submits the
  whole thing back — the fields it faithfully echoes are readable but not writable.

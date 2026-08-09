# Changelog

All notable changes to Ei are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning
convention is in [README.md → Versioning](./README.md#versioning): `v1` is an extension of
`v0`, so breaking changes ride the minor until `v2` is earned.

This file starts where it was added and is deliberately not backfilled. For anything earlier,
read `git log`, or the per-document changelog tables in `CONTRACTS.md`.

## [Unreleased]

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

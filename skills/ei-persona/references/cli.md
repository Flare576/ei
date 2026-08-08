# reference: the `ei` CLI for persona authoring

The Ei CLI is how you read and write personas. It is a thin wrapper over the local
data store. Everything below was true at time of writing — **always run `ei --help`
first and trust it over this file** if they disagree (the CLI evolves).

## Invocation

- Prefer `ei` (on PATH). If it's not found, use `bunx ei-tui` with the same arguments.
- Successful read/write commands print **JSON** to stdout. Validation and usage failures
  print human-readable text to stderr and exit non-zero.

## Reading (safe, do this constantly)

```bash
ei persona "<Name>"             # find a persona by name — substring match on display_name,
                                 # falls back to semantic search over long_description
ei --id <id>                    # full record for one entity, including a persona
```

`ei persona "<Name>"` (the type-specific search, not the `--persona` filter flag) is how you
find a persona by name. **`--persona "<Name>"` is a different feature** — it filters *other*
entity types (facts/topics/people) down to what a named persona has learned; it never returns
personas themselves, so it cannot be used to find one.

`ei --id <id>` is your workhorse once you have the id. For a persona it returns the **full**
record: every field Ei stores, not just the ones you can write. Read it before writing, for
context — an update no longer needs the whole record sent back (see "Updating" below), but you
still want to see current values before proposing a change.

## The persona record shape — read vs. write are different sets now

`ei --id <id>` returns MORE fields than you can write. The externally **writable** surface —
what `create`/`update` accept — is:

```
display_name,                          # required on create, non-empty; also checked against
                                        # the reserved-name list (see below) on both create and
                                        # update
aliases: [ "…" ],                      # for fuzzy matching (e.g. "/persona Bob")
short_description, long_description,
traits: [ PersonaTrait, … ],
topics: [ PersonaTopic, … ],
external_reflection_only,              # true = Ei's automatic Reflection critic skips this
                                        # persona; defaults to false at create
avatar_emoji, avatar_image,
preferred_theme,
notes: [ "…" ],                        # capped at 20 entries server-side — a write that
                                        # pushes the array past 20 is rejected
pending_update,                        # UPDATE ONLY, and only `null` — see "Server-managed,
                                        # not part of the writable surface" below
```

**Everything else `ei --id` shows you is read-only.** `model`, `group_primary`,
`groups_visible`, `is_paused`, `pause_until`, `is_archived`, `archived_at`,
`heartbeat_delay_ms`, `context_window_ms`, `include_message_timestamps`, `context_boundary`,
and `tools` are all real, live fields on the record — you can (and should) read them for
context — but there is no flag, no JSON field, no way at all to set any of them through this
CLI/MCP path. Submitting one in an `update` payload is rejected as an unrecognized field, not
silently ignored. Every one of them is either an in-app setting (`/provider`, the TUI YAML
editor) or in-app behavior (pause/archive), and the in-app surface is where it belongs — see
`docs/adr/ADR-031-external-field-visibility-categories.md` if you want the full reasoning. If a
user asks you to pause, archive, or grant a tool to a persona, tell them that's a TUI action
now, not something this skill can do on their behalf.

**`PersonaTrait`** — a named character trait:
```
id,            # optional on write — see "auto-assigned ids" below
name,
description,
sentiment,     # -1.0 to 1.0
strength,      # optional, 0.0 to 1.0
```

**`PersonaTopic`** — a subject the persona has a stance on:
```
id,               # optional on write — see "auto-assigned ids" below
name,
perspective,      # their view/opinion on this topic
approach,         # how they prefer to engage with it
personal_stake,   # why it matters to them personally
sentiment,        # -1.0 to 1.0
exposure_current, # 0.0 to 1.0 — how recently/frequently it's come up
exposure_desired, # 0.0 to 1.0 — how much they want to engage with it
```

**Auto-assigned ids.** If a trait or topic in your payload has no `id`, the server
assigns a fresh one before persisting — the same way the top-level persona `id` is
assigned on create. You never need to invent a UUID for a brand-new trait or topic;
just omit `id` and let it be minted.

**No minimum count.** Nothing here enforces a minimum number of traits or topics. (The
reflection ceremony's own convention of "at least 3 traits, at least 3 topics" is guidance
inside a *different* skill for a *different* situation — it is not a rule this path
enforces. Adding a single trait to an otherwise-untouched persona is a completely valid
edit.)

**Server-managed, not part of the writable surface.** Fields set by Ei — read them,
don't invent or hand-edit them:
- `id`, `entity`, `type` — fixed; `entity` is always the literal `"system"`.
- `last_updated` — always stamped to the current time.
- `description_embedding` — always recomputed from whatever `long_description` results
  from your write; never the old value.
- `pending_update` — a proposed identity revision from Ei's automatic Critic. **Clearable,
  not settable**: `update` accepts `pending_update: null` to clear it and rejects any other
  value for it outright. Omitting it from your payload leaves it exactly as it was — this is
  the one thing that changed from the old contract, where every update wiped it as an
  unwanted side effect regardless of your payload. If your write is meant to resolve a
  pending proposal, you must say so: include `"pending_update": null`.
- `is_static`, `last_heartbeat` — never writable, never disappear either; irrelevant to
  merge-patch since you never mention them.

**Reserved names.** `display_name` is checked against a reserved-word list (currently
`new`, `clone` — command keywords that collide with `/persona` subcommands) on **both**
`create` and `update`. Renaming an existing persona *into* a reserved name is rejected
exactly like creating one with that name.

## Tool grants (`tools`) — read-only through this path now

`tools` used to be writable here — grant/revoke via a boolean map. It no longer is
(ADR-031: only affects in-harness behavior, not the external knowledge base this CLI/MCP
surface manages). `ei --id <persona-id>` still shows the current grants as the same
self-documenting `{ "<Provider>": { "<Tool>": true|false } }` map, for context — but there is
nothing you can send back to change it. If a user asks you to grant or revoke a tool for a
persona, tell them to do it in the TUI's persona editor; this skill can't.

## Creating

```bash
ei create persona --json '<json>'
```
- You supply the meaningful fields (at minimum `display_name`); everything else server-
  managed gets sensible defaults, `id` is minted, traits/topics missing an `id` get one
  assigned.
- **Returns `{ "id": "…", "record": { … } }` — capture that `id`.**
- The returned `record` is sanitized for CLI/MCP output hygiene — no `description_embedding`
  is returned even though Ei computed and stored one internally.
- This path does **not** trigger any automatic identity-generation job — you (and the user)
  are authoring the full identity yourselves; there's no "fill in the rest for me" fallback.
  If the user wants a persona with more character than they've specified, work it out with
  them in step 3 (Plan) before you write, not by inventing details silently.

## Updating — a merge patch (read this twice)

```bash
ei update persona <id> --json '<json>'
```

**`update` is RFC 7396 JSON Merge Patch.** Send only the field(s) you mean to change.
Everything you omit is left completely unchanged. Send a field's new value to set it; send
`null` for `pending_update` to clear it (the only field this applies to — every other
writable field is Full Access, not Clearable). Arrays (`traits[]`, `topics[]`, `aliases`,
`notes`) still replace **wholesale** when present — this is unchanged from before and is the
one place "send everything you want to keep" still applies: if you send back a `traits` array
with 3 of the persona's 4 traits, the 4th is gone. The safe pattern:

1. `ei --id <id>` → get the current record, for context and to build array edits against.
2. Build a small JSON object containing **only** the field(s) you intend to change (e.g. one
   new entry appended to a full copy of `traits`, one topic's `sentiment` tweaked, a rewritten
   `long_description`).
3. Send just that to `update`.

Ei recomputes the description embedding automatically on every update — you never manage
it yourself.

The canonical "add a trait":
```bash
# 1) read it        →  ei --id <persona-id>
# 2) build the patch →  copy the existing traits array, push a new
#                        { name, description, sentiment, strength? } onto it (no id needed
#                        — it's auto-assigned) — this is the one field in the patch
# 3) write it back   →  ei update persona <persona-id> --json '{"traits":[...]}'
```

## Removing (destructive) and archiving

```bash
ei remove persona <id>
```
Deletes the persona record permanently.

**Reserved personas (`ei`, `emmet`) cannot be deleted, and — unlike before — they can't be
archived through this CLI/MCP path either.** `remove` is checked **synchronously, before the
correction is ever queued** — you get an immediate error, not a silent no-op some time later:
```
Cannot delete reserved persona "<id>" — reserved personas can't be deleted via this CLI/MCP
path at all; use the TUI's /archive command instead.
```
`is_archived` left the external write contract entirely (ADR-031) — there is no JSON body,
for `ei` or `emmet` or any other persona, that can archive or unarchive one anymore. If a user
wants to "get rid of" a reserved persona, or archive any persona reversibly, tell them to use
the TUI's `/archive` command — this skill has no equivalent action.

Non-reserved personas have no delete restriction — `remove` deletes them outright. Confirm
the user means "permanently gone," not "hide it" (archiving is a TUI-only action now for
every persona, reserved or not — see `references/recipes.md`).

## Passing JSON safely

Inlining JSON with quotes/apostrophes into a shell single-quoted string is a footgun
(descriptions like `the middleware ('MW')`, or a Yoda-style `long_description` full of
inverted syntax and dashes, will break your quoting). Prefer one of:

- **`--json-file <path>`:** write the patch JSON to a file, then
  `ei update persona <id> --json-file /tmp/patch.json`. This is the preferred mode over
  `--json "$(cat ...)"` — same body, but it never puts the JSON on argv, which matters more
  now that a patch can still carry prose-heavy fields like `traits[].description`.
- **A scripting runtime:** build the patch object, `JSON.stringify`, and pass the string as a
  single argument to `--json` (interpolation escaping handles the quotes). This is the most
  robust for multi-step edits and lets you build an array edit (e.g. append one trait to a
  copy of the existing array) without hand-copying fields.

Whatever you do, **do not hand-retype JSON from memory** — fetch the record and build the
patch programmatically, or you *will* drop a trait or field from an array you're replacing.

## There is no undo

Every write is recorded as a correction. `create` and `fact`-shaped full-record writes queue
`{ op: "upsert", entity_type: "persona", id, record, timestamp }`; `update` now queues
`{ op: "patch", entity_type: "persona", id, patch, timestamp }` — a patch object, not a full
record. Where it lands depends on what's running on this machine — don't assume it always sits
in `corrections.json` waiting to be read:

- **A live Ei instance is running** (holds `ei.lock`) → the correction is appended to
  `$EI_DATA_PATH/corrections.json`, and the running Processor drains it into the live state
  within ~100ms.
- **No live instance, but `state.json` exists** → the CLI applies the correction *directly*
  into `state.json` itself, immediately. `corrections.json` is left empty — there is nothing
  sitting in it to inspect, even though the write fully succeeded.
- **No live instance, no `state.json`, but `state.backup.json` exists** (a sync account that
  hasn't opened Ei on this machine yet) → the correction queues in `corrections.json` and is
  applied the next time Ei starts and pulls state.
- **Neither `state.json` nor `state.backup.json` exists** → the write fails outright with an
  error (no Ei data found at that path) — nothing is queued.

Consequences you must design around:
- **No rollback command.** To reverse a change you make *another* write (e.g. `update` it
  back, or re-`create` a removed persona — which gets a **new** id, so it's a different
  persona as far as the rest of the system is concerned).
- **`remove` is the most dangerous op** — for a non-reserved persona it succeeds
  immediately and is permanent. For a reserved persona it's rejected outright (see above).
- **`cat`-ing `corrections.json` is not a reliable way to confirm a write** — in the common
  case (no live Ei instance open while you're running the CLI), the correction is applied and
  the file is already back to `[]` by the time your command returns. Don't treat an empty
  file as "nothing happened."
- Therefore: **plan and get confirmation before writing**, and after writing, **re-read to
  verify** — `ei --id <id>` is the reliable check: every read merges any not-yet-drained
  corrections on top of the last saved state, so it reflects your write immediately no matter
  which of the cases above applied.

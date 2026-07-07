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
ei --persona "<Name>"           # find a persona by (fuzzy) display name
ei --id <id>                    # full record for one entity, including a persona
```

`ei --id <id>` is your workhorse. For a persona it returns the **full** record: identity
fields, every entry in `traits[]` and `topics[]`, and the lifecycle flags. Always read the
full record before writing — you cannot safely change one field of a persona without
seeing the rest (full-record round-trip, below).

## The persona record shape

You must round-trip this on `update` (see "full-record round-trip" below). The writable
surface is:

```
display_name,                          # required, non-empty; also checked against the
                                        # reserved-name list (see below) on both create and update
aliases: [ "…" ],                      # for fuzzy matching (e.g. "/persona Bob")
short_description, long_description,
model,
group_primary, groups_visible: […],
traits: [ PersonaTrait, … ],
topics: [ PersonaTopic, … ],
is_paused, pause_until,
is_archived, archived_at,              # setting is_archived is how you archive/unarchive —
                                        # there is no separate archive verb
heartbeat_delay_ms, context_window_ms,
include_message_timestamps, context_boundary,
tools: { "<Provider>": { "<Tool>": true|false } }, # a map (not an id list) of every tool
                                        # on every currently-enabled provider — see "Tool
                                        # grants" below (not related to your own tool access)
avatar_emoji, avatar_image,
preferred_theme,
notes: [ "…" ],
```

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
- `id`, `entity`, `last_updated`, `last_heartbeat`, `last_extraction`,
  `description_embedding`, `pending_update`, `reflection_last_asked` — silently stripped
  and ignored if present in an `update` payload (the natural result of round-tripping a
  read), never a validation error.
- `is_static` — marks built-in structural personas; not writable through this path at all.
  Don't try to flip it.

**Reserved names.** `display_name` is checked against a reserved-word list (currently
`new`, `clone` — command keywords that collide with `/persona` subcommands) on **both**
`create` and `update`. Renaming an existing persona *into* a reserved name is rejected
exactly like creating one with that name.

## Tool grants (`tools`)

`tools` is a **map you read, flip, and write back** — not a list of ids you have to know
in advance, and there's no separate step to enumerate what exists: a read of the persona
**is** the live menu of what's grantable right now. A real read looks like this:

```json
{
  "Ei Built-ins": { "Web Fetch": false, "Find Memory": true },
  "Spotify": { "Currently Playing Track": false, "Liked Songs": false }
}
```

- **Outer keys** are provider display names — but only for providers that are currently
  **enabled**. A disabled provider (e.g. Spotify before the human finishes OAuth) does not
  appear in the map at all — not present-with-everything-false, just absent. Its tools stay
  invisible, and ungrantable, until the human enables it.
- **Inner keys** are every tool belonging to that enabled provider, `true` if **this
  persona** currently has it granted, `false` if not.
- This has nothing to do with whatever tools *you* (the agent reading this file, via MCP or
  any other mechanism your own harness uses) have access to. A `true` here means: the next
  time a **human** talks to **that persona** inside Ei's TUI or web client, the persona may
  call that tool mid-conversation.
- Trust the map from a fresh read over anything written down anywhere, including this file
  — the set of providers and tools can change over time.

### Writing (grant/revoke)

`create`/`update` take the **exact same map shape** back — the full-record round-trip rule
(below) applied to `tools` specifically:

1. Read the persona; look at its `tools` map.
2. Flip the one boolean you mean to change (`false → true` to grant, `true → false` to
   revoke).
3. Send the **whole** map back, inside the whole record, unchanged apart from that flip.

A key you omit from the map isn't "left unchanged" the way a patch would treat it — but
since a disabled provider was never in your read to begin with, everything you can see on a
read is everything you round-trip; there's no hidden state you can accidentally drop.

**An unresolvable provider or tool display name is rejected, not a silent no-op.** If a name
in your write payload doesn't match anything real — a typo, a renamed tool, a provider that
no longer exists — the write fails with a clear validation error; it does not silently
ignore the bad key and apply the rest. **Never hand-retype a provider or tool name from
memory** — only use names that came from an actual read of this exact persona.

**A grant under a currently-disabled provider survives your update automatically — you don't do anything for this to happen.** If this persona already has a tool granted under a provider that's disabled right now, that grant isn't in your read and doesn't belong in your write either, and it stays intact across the update regardless. Do **not** try to guess-reconstruct a disabled provider's block from memory to "preserve" it — you have no way to know what it actually contains, and a fabricated one is indistinguishable from inventing a brand-new grant under an unknown/disabled provider, so it gets rejected the same way. The rule stays simple: for every provider you *can* see, write back exactly what you read, edited only where you meant to edit; every provider you can't see isn't yours to touch, in either direction. This is not the same as revocation — flipping a visible tool's boolean to `false`, or leaving it out of an otherwise-included enabled provider's block, still removes it for real. Auto-preservation only ever applies to a provider that's invisible to you to begin with.

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

## Updating — FULL-RECORD ROUND-TRIP (read this twice)

```bash
ei update persona <id> --json '<json>'
```

**`update` REPLACES the entire record. Any field you leave out is DELETED.** It is not a
patch/merge. This applies to `traits[]` and `topics[]` as whole arrays too — if you send
back a `traits` array with 3 of the persona's 4 traits, the 4th is gone. The only safe
pattern:

1. `ei --id <id>` → get the current, complete record.
2. Change **only** the field(s) you intend to change (e.g. append one entry to `traits`,
   tweak one topic's `sentiment`, rewrite `long_description`).
3. Send the **whole** record back to `update`.

Ei recomputes the description embedding automatically on every update — you never manage
it yourself.

The canonical "add a trait":
```bash
# 1) read it        →  ei --id <persona-id>
# 2) append          →  push a new { name, description, sentiment, strength? } onto
#                        traits (no id needed — it's auto-assigned), leaving every
#                        existing trait and everything else untouched
# 3) write it back   →  ei update persona <persona-id> --json '<full record with new trait appended>'
```

## Removing (destructive)

```bash
ei remove persona <id>
```
Deletes the persona record permanently.

**Reserved personas (`ei`, `emmet`) cannot be deleted.** This is checked
**synchronously, before the correction is ever queued** — you get an immediate error,
not a silent no-op some time later:
```
Cannot delete reserved persona "<id>". Use archive instead.
```
If a user wants to "get rid of" Ei or Emmet, that means **archive**, not delete:
```bash
ei update persona <id> --json '<full record with "is_archived": true>'
```
Non-reserved personas have no such restriction — `remove` deletes them outright. Confirm
the user means "permanently gone," not "hide it" (archive is the reversible option for
*any* persona, reserved or not — see `references/recipes.md`).

## Passing JSON safely

Inlining JSON with quotes/apostrophes into a shell single-quoted string is a footgun
(descriptions like `the middleware ('MW')`, or a Yoda-style `long_description` full of
inverted syntax and dashes, will break your quoting). Prefer one of:

- **Temp file:** write the JSON to a file, then
  `ei update persona <id> --json "$(cat /tmp/rec.json)"`.
- **A scripting runtime:** read the record, parse it, mutate the object (e.g. push a new
  trait, edit one field), `JSON.stringify`, and pass the string as a single argument
  (interpolation escaping handles the quotes). This is the most robust for multi-step
  edits and lets you round-trip the full record without hand-copying fields.

Whatever you do, **do not hand-retype a record** — fetch it and mutate it
programmatically, or you *will* drop a trait or field.

## There is no undo

Writes are recorded as an **append-only correction log**, typically at
`$EI_DATA_PATH/corrections.json` (default `~/.local/share/ei/corrections.json`). Each
entry is roughly `{ op: "upsert" | "remove", entity_type: "persona", id, record,
timestamp }`. Depending on the install, a `state.json` may or may not exist yet; when it
doesn't, your writes still land in `corrections.json` and take effect on read.

Consequences you must design around:
- **No rollback command.** To reverse a change you make *another* write (e.g. `update` it
  back, or re-`create` a removed persona — which gets a **new** id, so it's a different
  persona as far as the rest of the system is concerned).
- **`remove` is the most dangerous op** — for a non-reserved persona it succeeds
  immediately and is permanent. For a reserved persona it's rejected outright (see above).
- Therefore: **plan and get confirmation before writing**, and after writing, **re-read to
  verify**. You can `cat` the correction log to confirm exactly what was recorded (skip the
  embedding fields — they're noise).

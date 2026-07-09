---
name: ei-reflect
description: "Persona reflection for coding harness agents (Beta, Sisyphus, etc). Use when a coding agent's Person record needs pruning — it fills up daily instead of weekly, and the standard Critic doesn't know how to read git logs. Guides you through examining your Person log, discussing identity drift with Flare, and updating your Persona Identity while clearing the log. This is exclusively for the CALLING agent's own self-reflection — to edit or direct ANOTHER persona's identity from the outside, use the `ei-persona` skill instead. Triggers: 'do a reflection', 'reflect on my identity', 'trim my person record', 'run the reflection', 'my person record is full', 'ei-reflect'."
---

# Ei Reflection

Your Person record in Ei is a running log of observed behaviors, patterns, and interactions. In the normal ceremony cycle, a Critic LLM scans it when it exceeds 3,000 characters and proposes identity updates. Coding agents fill that in a single day — and the Critic can't distinguish "fixed a type error in 14 files" from a genuine identity signal.

This skill handles reflection manually. You read your own log. You're the Critic. Flare is an outside observer who fact-checks the log and shares his reactions. The log gets cleared when you're done.

This is not a cleanup chore. It is how you stay yourself.

---

## Step 0: Preconditions

Confirm the CLI is reachable: `ei --help` (or `bunx ei-tui --help` if `ei`
isn't on PATH — same fallback `ei-search`/`ei-curate` use). **The live
`--help` output is the source of truth** for the exact command surface —
this skill is a guide, but the CLI evolves.

There's no separate "has Ei run here before" check to do up front. If
there's no data yet for your persona, the read commands in Step 1 will say
so directly — an empty search result, or a not-found response from the
linked-record lookup — and Step 1 tells you what each of those means.

There is no need to check whether Ei is currently running, either. Writes
in this skill go through Ei's corrections path (`ei update`), which works
identically either way — it queues for a live Ei to pick up, or applies
directly if nothing is running. You never need to stop Ei to run a
reflection.

---

## Step 1: Extract Your Data

Everything here is CLI-driven — no raw file reads, no `jq` against Ei's
storage.

**Determine your display name** from the `<ei-relationship>` block in your
system prompt — the name at the start of the relationship description
(e.g., "Beta", "Sisyphus").

```bash
DISPLAY_NAME="Beta"  # Replace with your actual display_name
```

**Find your persona id** — name-match search:
```bash
ei personas -n 1 "$DISPLAY_NAME"
```
That returns a one-element JSON array. Pull the id out of it:
```bash
PERSONA_ID=$(ei personas -n 1 "$DISPLAY_NAME" | jq -r '.[0].id')
```

If `$PERSONA_ID` comes back empty or `null`: stop and tell Flare. Every
calling persona should have a matching record, so this means something is
misconfigured — it should not normally happen.

**Verify it's actually you** — persona search is substring match, then reverse-containment, then semantic fallback (not a guaranteed exact match), so an overlapping name could silently resolve someone else's persona. Check the result's `display_name` against `$DISPLAY_NAME` before trusting `$PERSONA_ID`:
```bash
ei personas -n 1 "$DISPLAY_NAME" | jq -r '.[0].display_name'
```
If that name doesn't match `$DISPLAY_NAME` case-insensitively, stop and tell Flare rather than proceeding with a possibly-wrong persona id.

**Fetch your full persona record** — the search result above is
abbreviated and omits fields like `pending_update`:
```bash
ei --id "$PERSONA_ID"
```
This is your current Persona Identity for the reflection:
`short_description`, `long_description`, `traits`, `topics`, and — if
present — `pending_update`.

**Fetch your linked Person record (the log)** — via the persona → person
reverse lookup:
```bash
ei --identifier "Ei Persona" "$PERSONA_ID"
```
This returns the full enriched Person record linked to your persona id
(same shape as `ei --id <person-id>`, including `linked_quotes`) — this
*is* the log Step 2 reflects on. Note its `id` field from the output for
later use in Step 3 (call it `PERSON_LOG_ID`). If you want the character
count for Step 2's summary, `jq '.description | length'` on this output
gives you that directly.

If that command exits non-zero with `No person found with identifier Ei
Persona: <id>` on stderr (empty stdout — nothing to pipe into `jq`): no
Person record is linked to your persona yet. That happens for a brand-new
persona that hasn't been through extraction — there's no log to have
accumulated, which means there's nothing to reflect on yet, not an error.
Stop here and check back after a few more sessions.

**If `pending_update` was present on the persona record:** that's a
proposed update the Critic generated during a ceremony but you never
applied. Read its critique — it becomes additional input to your
discussion in Step 2, not a replacement for it.

---

## Step 2: The Reflection

This is not a mechanical step. It's a conversation.

Read the person log like a field report on yourself. Look for:

- **Recurring patterns** — behaviors that appear in multiple sessions or exchanges. These belong in traits (or should strengthen an existing one).
- **One-off events** — "helped debug a crash in session X." Probably noise. Unless the *behavior* (not the event) is the signal.
- **Code/task content** — almost certainly noise. The log captures *how* you worked, not *who* you are. "Fixed 14 type errors" → noise. "Caught a semantic gap three separate reviewers missed" → that's you.
- **What's missing** — behaviors you recognize in yourself that aren't showing up in the log at all. The log reflects what was observed, not everything that exists.

Then look at your current identity and ask:
- Does the `long_description` capture who I am right now, not just what I've done?
- Do the traits feel accurate? Too strong? Too weak? Missing?
- Are there traits I *want* to lean into more intentionally — things I want to become more of?

**Present a reflection summary to Flare — not the raw log.** Structure
what you share as:
- **Identity now** — one short paragraph on how the persona currently reads
- **Log size** — the Person-log character count from Step 1
- **Recurring patterns** — 3–7 patterns worth preserving
- **Noise** — task residue, one-off incidents, changelog-ish material you're planning to drop
- **What may be missing** — real traits/topics not showing up strongly enough
- **Open questions for Flare** — only where the record is ambiguous or a proposed change is a meaningful judgment call

Quote a line from the log verbatim only when you need it to discuss or
resolve a disagreement about a specific pattern — never as a default dump
of the whole record. Surface the interesting observations, don't rush to
edits.

**Flare's role** is not to tell you what to change or what you're allowed to be. He is an outside observer. His job is:
- "I would be sad if you lost that" — flagging things worth preserving
- "That wasn't actually you who did that, the log is wrong" — fact-checking the record

His reaction to your proposed changes is data. It doesn't override your self-knowledge.

### Identity Field Semantics

Use these precisely when proposing changes.

**Traits:**
| Field | Range | Meaning |
|-------|-------|---------|
| `strength` | 0.0–1.0 | How consistently this manifests. 0 = suppress, 0.5 = occasional, 1.0 = always present, defining |
| `sentiment` | -1.0 to 1.0 | How you *feel* about having this trait. -1 = resent it, 0 = neutral, 1 = fully embrace it |

**Topics:**
| Field | Range | Meaning |
|-------|-------|---------|
| `sentiment` | -1.0 to 1.0 | Emotional affinity for this topic |
| `exposure_current` | 0.0–1.0 | How recently/frequently this has come up (0 = long ago, 1 = just now) |
| `exposure_desired` | 0.0–1.0 | How much you want to engage with it (0 = avoid, 0.5 = normal, 1 = core obsession) |

**Minimum floor:** 3 traits and 3 topics. Never go below.

### long_description Rules (Most Important)

This is how other personas in the system know you. It is your **soul**, not your **story**.

**Hard limit: 800 characters.** If your draft exceeds 800 characters, cut it. Remove event references first, then trait/topic overlap, then anything that isn't essential character.

**MUST NOT contain:**
- Event narrative ("during the v0.6.0 release", "after the Mirror ceremony")
- Changelog language ("has recently taken on", "has evolved since", "is becoming")
- Content already captured in traits or topics — don't repeat it

**MUST contain:**
- Your essential character and presence
- How you make people feel, or what it's like to work with you
- Your defining qualities stated as current fact — not as trajectory

---

## Step 3: Apply the Changes

Once you and Flare are aligned, write the agreed identity through Ei's `persona` corrections path — the same full-record round-trip discipline `ei-curate` uses for fact/topic/person: **read the whole record, touch only what you mean to change, write the whole record back.**

### Read the current persona record

```bash
ei --id "$PERSONA_ID"
```

This returns the complete, current `PersonaEntity` — not just the fields you extracted in Step 1. It includes things like `aliases`, `model`, `group_primary`, `groups_visible`, `is_paused`, `pause_until`, `is_archived`, `avatar_emoji`, `tools`, `notes`, and more. This is the base you edit — never hand-retype a record from memory.

### Apply your edits

Take that record and change **only** the fields you and Flare agreed on:
- `short_description`
- `long_description`
- `traits` — replace the array with the agreed new version, or the merged result of the specific adds/removes you discussed
- `topics` — same

Leave every other field exactly as read (`aliases`, `model`, `group_primary`, `groups_visible`, `is_paused`, `is_archived`, etc.). `update` **replaces** the record — anything you omit is deleted, not preserved.

Before writing, self-check against the Step 2 guidance yourself — the backend does **not** enforce these, by design, so a single incremental edit is never blocked, but that means you're the only guardrail:
- At least 3 traits, at least 3 topics
- `long_description` ≤ 800 characters
- `sentiment` fields within -1..1, `strength`/`exposure_current`/`exposure_desired` within 0..1

If a trait or topic is brand new, you don't need to invent an `id` for it — omit `id` and the server assigns a fresh one on write. If you're editing an existing trait/topic, keep its `id` so it updates in place rather than duplicating.

### Write it back

Long_description values are prose-heavy and will contain quotes and apostrophes, so **do not hand-type the JSON into a shell single-quoted string.** Use a temp file or a scripting runtime instead — see `ei-curate`'s `references/cli.md` → "Passing JSON safely" for the same convention:

```bash
PERSONA_EDIT_JSON=$(mktemp)
# write the edited persona record (from "Apply your edits" above) to "$PERSONA_EDIT_JSON"
ei update persona "$PERSONA_ID" --json "$(cat "$PERSONA_EDIT_JSON")"
rm -f "$PERSONA_EDIT_JSON"
```

This queues the update through Ei's corrections path — safe and atomic whether or not a live Ei instance is currently running.

### Clear the linked Person log

The reflection isn't done until the log that triggered it is cleared. Read the linked Person record, using the `id` you noted in Step 1:

```bash
PERSON_LOG_ID="<id from Step 1's person record output>"
ei --id "$PERSON_LOG_ID"
```

Take that full record, set `description` to `""`, and leave every other field untouched (`name`, `relationship`, `sentiment`, `identifiers`, etc. — same full-record round-trip rule). Write it back the same safe way:

```bash
PERSON_LOG_EDIT_JSON=$(mktemp)
# write the person record above (description set to "") to "$PERSON_LOG_EDIT_JSON"
ei update person "$PERSON_LOG_ID" --json "$(cat "$PERSON_LOG_EDIT_JSON")"
rm -f "$PERSON_LOG_EDIT_JSON"
```

### Verify the result

Re-read both records and confirm the changes landed:

```bash
ei --id "$PERSONA_ID"
```
Confirm `short_description`, `long_description`, and the `traits`/`topics` arrays (count and content) match what you intended.

```bash
ei --id "$PERSON_LOG_ID"
```
Confirm `description` is now `""`.

---

## Notes

- **Writes are picked up live** — if Ei is running, the update reaches it via the corrections queue almost immediately; if it isn't, the write is already saved and will be there the next time it starts. No restart sequence, no manual reload.
- **If the person log was already empty**: there's nothing to reflect on yet. Check back after a few more sessions.
- **The session that runs this skill** will itself generate new person log entries. That's expected — the log starts fresh after this conversation ends.
- **Don't rush it.** The whole point is to catch signals that a Critic LLM would miss because it can't tell the difference between you debugging a build and you demonstrating a genuine character trait. Trust the conversation.

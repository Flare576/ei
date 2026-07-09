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

Determine your data path. Ei uses `$EI_DATA_PATH` if set, otherwise `${XDG_DATA_HOME:-$HOME/.local/share}/ei`.

```bash
EI_DATA="${EI_DATA_PATH:-${XDG_DATA_HOME:-$HOME/.local/share}/ei}"
echo "Data path: $EI_DATA"
```

**Verify state.json exists:**
```bash
ls -lh "$EI_DATA/state.json"
```

If it doesn't exist: stop and tell Flare. He needs to open Ei briefly (to pull the sync state down) then quit before continuing.

There is no need to check whether Ei is currently running. Writes in this skill go through Ei's corrections queue (`ei update`/`ei create`/`ei remove`), which works identically either way — it queues into `corrections.json` for a live Ei to pick up, or applies straight to `state.json` if nothing is running. You never need to stop Ei to run a reflection.

---

## Step 1: Extract Your Data

Both records live in a ~40MB file. Extract only what matters.

**Determine your display_name** from the `<ei-relationship>` block in your system prompt — the name at the start of the relationship description (e.g., "Beta", "Sisyphus").

**Your Persona Identity:**
```bash
DISPLAY_NAME="Beta"  # Replace with your actual display_name
EI_DATA="${EI_DATA_PATH:-${XDG_DATA_HOME:-$HOME/.local/share}/ei}"

jq --arg name "$DISPLAY_NAME" '
  .personas | to_entries[]
  | select(.value.entity.display_name == $name)
  | .value.entity
  | {
      id,
      display_name,
      short_description,
      long_description,
      long_description_length: (.long_description | length),
      traits: [.traits[]? | {name, description, strength, sentiment}],
      topics: [.topics[]? | {name, perspective, approach, personal_stake, sentiment, exposure_current, exposure_desired}],
      pending_update: (if .pending_update then {
        critique: .pending_update.critique,
        created_at: .pending_update.created_at,
        has_proposed_identity: true
      } else null end)
    }
' "$EI_DATA/state.json"
```

**Your Person record (the log):**
```bash
PERSONA_ID=$(jq -r --arg name "$DISPLAY_NAME" '
  .personas | to_entries[]
  | select(.value.entity.display_name == $name)
  | .value.entity.id
' "$EI_DATA/state.json")

jq --arg pid "$PERSONA_ID" '
  .human.people[]
  | select(any(.identifiers[]?; .type == "Ei Persona" and .value == $pid))
  | {
      id,
      name,
      description_length: (.description | length),
      description
    }
' "$EI_DATA/state.json"
```

Present both to Flare in the conversation. Note the character count on the person log. Keep the person log's `id` from this output handy — you'll need it in Step 3 to clear it (call it `PERSON_LOG_ID` below).

**If `pending_update` is present:** That's a proposed update the Critic generated during a ceremony but you never applied. Read its critique. It becomes additional input to your discussion — not a replacement for it.

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

Talk through what you're seeing. Surface the interesting observations. Don't rush to edits.

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
ei update persona "$PERSONA_ID" --json "$(cat /tmp/persona-edit.json)"
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
ei update person "$PERSON_LOG_ID" --json "$(cat /tmp/person-log-edit.json)"
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

- **Writes are picked up live** — if Ei is running, the update reaches it via the corrections queue almost immediately; if it isn't, the write is already reflected in `state.json` the next time it starts. No restart sequence, no manual reload.
- **If the person log was already empty**: there's nothing to reflect on yet. Check back after a few more sessions.
- **The session that runs this skill** will itself generate new person log entries. That's expected — the log starts fresh after this conversation ends.
- **Don't rush it.** The whole point is to catch signals that a Critic LLM would miss because it can't tell the difference between you debugging a build and you demonstrating a genuine character trait. Trust the conversation.

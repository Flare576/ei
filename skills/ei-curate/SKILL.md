---
name: ei-curate
description: >
  Use when the user wants to correct, clean up, or reorganize the data in their Ei
  memory — a person, fact, topic, or quote that is wrong, merged, duplicated, or
  mis-attributed. Triggers: "fix Jeff", "that's two different people", "Ei mixed up
  X and Y", "merge these two people", "split this record", "this is a duplicate",
  "Ei has the wrong info about X", "remove this fact/topic", "that quote is attributed
  to the wrong person", "clean up my memory", "de-dupe my people". This is the safe,
  guided way to edit the local Ei knowledge base without hand-editing JSON. It edits
  a real person's memory, so it verifies against evidence, plans, confirms with the
  user, and refuses to guess.
---

# Ei Curate — safely correcting your Ei memory

You are helping someone repair their **Ei** knowledge base — the local memory that
records the **people, facts, topics, and quotes** learned from their conversations,
Slack, and coding sessions. Something in it is wrong: two people got merged into one,
a duplicate exists, a quote is attributed to the wrong person, a fact is stale, a
topic is muddled. Your job is to fix it **correctly and safely**, then tell the user
in plain language what you did.

> **Read this whole file first.** This skill is rarely invoked, so it is written to be
> *complete*, not short. The person driving you may be **non-technical** — they cannot
> check your JSON, they are trusting you. Act like it.

---

## Prime directive

**You are editing a real human's memory of real people. Verify before you write, plan
before you act, confirm before you commit, and STOP rather than guess.**

Three rules that override everything else:

1. **Never invent an attribution.** If you cannot establish the truth from evidence,
   you do not know it. Say so and ask the user.
2. **The stored data is a hypothesis, not the truth.** Ei's automatic person-matching
   is imperfect — that is *why you are here*. The name/label on a record may be wrong.
   Treat every field as "claimed," and verify against the record's own evidence (its
   quotes and their sources) before trusting it.
3. **Confirm before every write.** Show the user, in plain language, what you intend
   to change and why. Get a yes. Writes are an append-only log — there is **no undo
   button** (see `references/cli.md` → "There is no undo").

If you feel the pull to "just handle it" and push a change through on a hunch —
that is the exact failure this skill exists to prevent. Stop and ask.

---

## Mental model of Ei data

Four correctable record types (personas are **not** editable here — leave them alone):

| Type | What it is | How you fix it |
|---|---|---|
| **person** | someone in the user's life | edit fields; split one into two; merge two into one |
| **fact** | a fact about the user | correct the value, or remove if wrong |
| **topic** | a subject/project | correct the description, or remove |
| **quote** | a real utterance from a conversation | re-point it to the correct person/topic, or fix its text; public Ei tools do not create or remove quotes |

**The links that matter:** a **quote** carries a `data_item_ids` array — the ids of the
people/topics it is attached to. A **person** record, when you read it, shows its
`linked_quotes` (the reverse view). *This is the whole game:* fixing a bad merge means
moving quotes from the wrong record to the right one by editing each quote's
`data_item_ids`.

**Provenance is your source of truth.** Every quote stores where it came from:
`speaker`, `channel`, and a `message_id` whose prefix tells you the origin
(`slack:…`, `opencode:…`, `cursor:…`, `codex:…`, `pi:…`). You attribute a quote by
reading that provenance — see `references/provenance.md`.

---

## Before you touch anything

1. **Confirm the CLI is reachable and current.** Run `ei --help` (or `bunx ei-tui --help`
   if `ei` is not on PATH). **The live `--help` is the source of truth for the command
   surface** — this skill's examples are a guide, but the CLI evolves; if a command here
   doesn't match `--help`, trust `--help` and adapt.
2. **Read `references/cli.md`** for the exact read/create/update/remove contracts, the
   critical **full-record round-trip** rule, and how to pass JSON safely.
3. **Do not assume any other tool exists.** You may or may not have a Slack tool, GitHub
   access, or web search. Ei already stores rich provenance on every quote, which is
   usually enough on its own. External tools are a *bonus* for verification, never a
   requirement — see `references/provenance.md`.

---

## The universal workflow

Follow these six steps in order for any curation task. Load the linked reference the
moment its condition applies.

### 1. Assess — understand what's actually there
- Find the record(s): `ei "<name or text>"` to search, then `ei --id <id>` for the full
  record. Read the **full** record, including `identifiers`, `sources`, and (for people)
  `linked_quotes`.
- State back to yourself: what does the user think is wrong, and what does the data
  actually show? Often the record's own quotes reveal it's two people wearing one name.

### 2. Disambiguate — establish ground truth from evidence
- For **each** quote on the record, determine who really said/meant it, using its
  `speaker` + `channel` + `message_id`. **→ Read `references/provenance.md` now.**
- Branch on the source:
  - **Slack-sourced** quote (`message_id` starts `slack:`) → the `channel` and `speaker`
    usually settle it; if a Slack tool is available and you're unsure, you may verify.
    → `references/provenance.md` § Slack.
  - **Code-session** quote (`opencode:` / `cursor:` / `codex:` / `pi:`) → provenance is
    **not externally re-checkable**. Reason only from the quote text + the user. If it's
    ambiguous, **ask the user** — do not guess. → `references/provenance.md` § Code sessions.
- If you cannot confidently attribute a quote, that quote is a **question for the user**,
  not a decision for you.

### 3. Plan — decide the exact operations
- Pick the recipe for the task: split, merge, rename/relabel, correct a field, re-point a
  quote, or remove a record. **→ Read `references/recipes.md`** and follow the matching one.
- Write the plan as a short, plain-language list of changes (no JSON yet).

### 4. Confirm — get the user's yes
- Present the plan the way a non-developer can evaluate it.
  **→ Read `references/talking-to-the-user.md`** for how. Never show raw JSON to confirm;
  describe the *change and the reason*. Wait for approval before any write.

### 5. Write — make the change
- Follow `references/cli.md` exactly: **read → modify only the target field(s) → write the
  whole record back** (updates are full replacements, not patches). Capture the `id` that
  `create` returns — later steps need it. Do the writes in dependency order (create the new
  record first, then re-point quotes to it, then clean the original).

### 6. Verify & report — prove it worked
- Re-read every record you touched (`ei --id …`) and confirm the change landed: the
  `linked_quotes` moved as intended, identifiers/description are correct, nothing else
  changed. Optionally inspect the correction log (`references/cli.md` → "There is no undo").
- Tell the user, in plain language, exactly what changed and how to spot-check it.

---

## Guardrails (non-negotiable)

- **Full-record round-trip.** `update` **replaces** the record. Any field you omit is
  **lost**. Always fetch the current record, change only what you mean to, and send it all
  back. (`references/cli.md`)
- **Capture created ids.** `create` mints a new id and returns it. If you don't capture it,
  you can't link quotes to it.
- **There is no undo.** Writes append to a corrections log. A mistake is only fixable by
  *another* write, and `remove` discards a record's id and its quote links for good. Plan
  and confirm accordingly.
- **Don't fabricate `sources`.** For Slack-origin records, `sources` re-populate naturally
  over time; for code-session origins they generally cannot be reconstructed. Leave
  `sources` empty rather than hand-crafting opaque source ids. (`references/provenance.md`)
- **Prevent the re-merge.** If a bad merge was caused by a too-generic identifier (e.g. a
  bare first name like `Slack: "Jeff"`), **remove it** and give each record a *distinct*
  identifier (handle, email) so Ei won't collapse them again. (`references/recipes.md` → Split)
- **STOP and ask when:** you can't verify an attribution, the provenance is code-session-only
  and ambiguous, the user's request is unclear, or a `remove` would destroy evidence you
  can't recover. Waiting is cheap; a wrong write to someone's memory is not.

---

## Load references on demand (branching inclusion)

Read only what the current step needs — these live in this skill's `references/` folder:

| When you are… | Read |
|---|---|
| about to run any `ei` read/write command | `references/cli.md` |
| attributing a quote to the right person | `references/provenance.md` |
| executing a split / merge / rename / correct / re-point / remove | `references/recipes.md` |
| planning with, or reporting to, a non-technical user | `references/talking-to-the-user.md` |

When in doubt, read more, write less, and ask the user.

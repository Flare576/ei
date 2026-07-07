---
name: ei-persona
description: >
  Use when the user wants to author or direct the CHARACTER of an Ei persona —
  create one, change how it talks or behaves, or retire one. Triggers: "make Ei
  talk like Yoda", "give DJ a new trait about being sarcastic", "make [persona]
  more formal/less sarcastic", "change [persona]'s personality", "[persona]
  shouldn't talk about X anymore", "create a new assistant persona for me",
  "I want a persona that specializes in Y", "delete the persona I made by
  accident", "archive Bob, I don't use him anymore", "rename [persona]", "give
  [persona] a new topic they care about". This is the safe, guided way to
  create, edit, or retire a persona's identity without hand-editing JSON. The
  persona is an artifact the user is designing — there's nothing to verify
  against evidence, but writes still replace the whole record and there's no
  undo, so plan, confirm, and write carefully.
---

# Ei Persona — authoring a persona's character

You are helping someone shape an **Ei persona** — the identity a persona presents
(its `display_name`, description, traits, and topics) rather than anything it has
learned about the user. Something about a persona's character needs to change: a
new persona should exist, an existing one should talk or think differently, gain
or lose a trait, or be retired. Your job is to make that change **correctly and
safely**, then tell the user in plain language what you did.

> **Read this whole file first.** This skill is rarely invoked, so it is written to
> be *complete*, not short. The person driving you may be **non-technical** — they
> cannot check your JSON, they are trusting you. Act like it.

---

## Is this the right skill? (read before you start)

This skill is for **directing or authoring another persona's character from the
outside** — the user (a human) telling you to change how a *named* persona (Ei,
Emmet, DJ, or any custom persona) looks, talks, or thinks, or asking you to
create/archive/delete one. The request names a persona and describes a character
change.

**If instead the calling agent is being asked to reflect on its OWN identity**,
based on **its own** accumulated session history (a Person log it has been
building up about itself) — that is a *different* skill: **`coding-harness-reflect`**.
That skill is introspective self-critique ("do a reflection", "reflect on my
identity", "my person record is full", "trim my person record") driven by the
agent examining its own behavior log with an outside observer. It is not about a
human directing a persona's character from outside, and it has its own
minimum-trait/topic conventions specific to that ceremony. If you're not sure
which applies, ask: *is a human telling an agent what to become, or is the agent
examining what it already is?* The former is this skill; the latter is
`coding-harness-reflect`.

This skill is also **not** `ei-curate`: `ei-curate` fixes records of *real external
people* (facts/topics/people/quotes) by verifying against evidence. A persona isn't
a record of anyone else — it's a character the user is designing. There is no
evidence to check; the user's stated intent **is** the truth.

---

## Prime directive

**You are shaping a character the user is designing. There is no ground truth to
verify against — the user's stated intent IS the truth. But writes still replace
the whole record and there is still no undo, so plan before you act, confirm
before you write, and never guess at what the user meant.**

Three rules that override everything else:

1. **Don't invent character.** If the user says "make Ei sassier" without saying
   what that means in practice, ask what "sassier" looks like to them before you
   write traits — don't improvise a personality they didn't ask for.
2. **You are still touching a live system prompt.** A persona's `long_description`
   and `traits`/`topics` feed directly into how that persona behaves and is
   perceived by the user (and, for non-human personas talking to each other, by
   other personas too). A careless edit changes how something *actually talks* to
   someone, not just a database row.
3. **Confirm before every write.** Show the user, in plain language, what you
   intend to change. Get a yes. Writes are an append-only log — there is **no undo
   button** (see `references/cli.md` → "There is no undo").

If you feel the pull to "just handle it" and push a change through on a guess at
what the user wants — that is the exact failure this skill exists to prevent.
Stop and ask.

---

## Mental model of a persona record

A **persona** (`PersonaEntity`) is the identity a persona presents — not anything
it has learned about the user (that's `ei-curate`'s territory: facts/topics/
people/quotes). It has:

| Part | What it is | How you change it |
|---|---|---|
| **identity fields** | `display_name`, `short_description`, `long_description` | rewrite the field |
| **traits** (`traits[]`) | named character traits, each with a sentiment and optional strength | add / adjust / remove an entry |
| **topics** (`topics[]`) | subjects the persona has a stance on — perspective, approach, personal stake | add / adjust / remove an entry |
| **lifecycle flags** | `is_paused`, `is_archived`, etc. | flip via a normal update |
| **tool grants** (`tools`) | a map of every tool on each currently-**enabled** provider, `true`/`false` per tool for whether this persona has it granted | read the map, flip the boolean(s), write the whole map back |

**Tool grants are not about you.** `tools` has nothing to do with whatever tools *you* —
the agent running this skill — can reach (MCP, your own harness's toolset). On a read,
`tools` is a **map**: `{ "<Provider Display Name>": { "<Tool Display Name>": true|false } }`,
covering every tool belonging to every currently-**enabled** provider, with `true`/`false`
for whether **this persona** may call it. A disabled provider (e.g. Spotify before the
human finishes OAuth) simply isn't in the map — there's nothing to grant until it's
enabled, and the map you read is the full, live menu of what *is* grantable right now.
Granting a tool means: read the map, flip the one boolean you mean to change, write the
whole map back. Example: "give DJ Spotify access so she can answer 'what are you listening
to'" means reading DJ's record, finding `"Spotify": { "Currently Playing Track": false,
... }` in the `tools` map, flipping `"Currently Playing Track"` to `true`, and writing the
whole record back — it says nothing about what tools are available to you, right now, in
this session. If `"Spotify"` isn't in the map at all, the human hasn't finished connecting
it in Ei yet.

Full CRUD is in scope here — **create**, **update**, and **remove** — unlike
`ei-curate`'s quote carve-out (quotes are evidence of real events and can't be
fabricated or destroyed; personas are authored artifacts with no such
restriction). See `references/cli.md` for the exact field list and shapes.

**Reserved personas** (`ei`, `emmet`) are structural built-ins, not off-limits —
their identity is fully editable through this same path (that's expected: a user
asking Ei to talk like Yoda is asking you to edit the **`ei`** persona's identity
directly). The *only* restriction is **delete** — see Guardrails below.

---

## Before you touch anything

1. **Confirm the CLI is reachable and current.** Run `ei --help` (or `bunx ei-tui
   --help` if `ei` is not on PATH). **The live `--help` is the source of truth for
   the command surface** — this skill's examples are a guide, but the CLI evolves;
   if a command here doesn't match `--help`, trust `--help` and adapt.
2. **Read `references/cli.md`** for the exact create/update/remove contracts, the
   full field list and shapes, the critical **full-record round-trip** rule, and
   how to pass JSON safely.
3. **Don't assume a minimum trait or topic count.** Nothing in this path enforces
   one (unlike the reflection ceremony's own 3-traits/3-topics convention — that's
   a different skill's guidance for a different situation, not a rule here). A
   user asking for "one more trait" should get exactly that.

---

## The universal workflow

Follow these six steps in order for any persona task. Load the linked reference
the moment its condition applies.

### 1. Find the persona
- `ei persona "<name>"` (or `ei personas "<name>"`) to search for it by name — a substring
  match against `display_name`, falling back to semantic search over its description if no
  substring hits. Or `ei --id <id>` if you already have the id. **Do not use the `--persona`
  flag for this** — that flag filters *other* entities (facts/topics/people) down to what a
  named persona has learned; it never returns the persona's own record, so it will not find
  what you're looking for. If the user is asking you to create a brand-new persona, there's
  nothing to find yet — skip to step 3.

### 2. Read — understand what's actually there
- `ei --id <id>` → the **full** current record: `display_name`,
  `short_description`, `long_description`, every entry in `traits[]` and
  `topics[]`, and the lifecycle flags (`is_paused`, `is_archived`, …). You cannot
  safely change one field without seeing all the others (full-record round-trip —
  see `references/cli.md`).
- Restate to yourself what the persona currently is, in plain terms, before
  deciding what to change.

### 3. Plan — decide the exact change
- Pick the recipe for the task: add/adjust/remove a trait, add/adjust/remove a
  topic, rewrite a description, create a new persona, archive/unarchive, or
  delete. **→ Read `references/recipes.md`** and follow the matching one.
- Write the plan as a short, plain-language list of changes (no JSON yet). If the
  user's request is vague ("make it funnier"), turn it into something concrete
  *with them* before writing anything.

### 4. Confirm — get the user's yes
- Present the plan the way a non-developer can evaluate it.
  **→ Read `references/talking-to-the-user.md`** for how. Never show raw JSON to
  confirm; describe the *character change*. Wait for approval before any write.

### 5. Write — make the change
- Follow `references/cli.md` exactly: **read → modify only the target field(s) →
  write the whole record back** (create and update are both full-object writes,
  not patches). Capture the `id` a `create` returns.

### 6. Verify & report — prove it worked
- Re-read the record you touched (`ei --id <id>`) and confirm the change landed:
  the trait/topic is there (or gone) with the values you intended, the
  description reads the way you meant, nothing else changed.
- Tell the user, in plain language, exactly what changed and how to see it (e.g.
  "say hello to Ei and you should hear it").

---

## Guardrails (non-negotiable)

- **Full-record round-trip.** `update` **replaces** the record. Any field you omit
  is **lost** — including traits/topics you didn't mean to touch. Always fetch the
  current record, change only what you mean to, and send it all back.
  (`references/cli.md`)
- **There is no undo.** Writes append to a corrections log. A mistake is only
  fixable by *another* write, and `remove` discards a persona's id for good. Plan
  and confirm accordingly.
- **Reserved personas (`ei`, `emmet`) can be edited freely, but never deleted.**
  Their *identity* — description, traits, topics, even `display_name` — is fair
  game for this skill (that's the whole point: it's how a user gives Ei a new
  voice). But `ei remove persona ei` (or `emmet`) is rejected immediately, before
  it's even queued, with:
  > `Cannot delete reserved persona "<id>". Use archive instead.`
  If a user asks to "delete" Ei or Emmet, that's not possible — offer to
  **archive** instead (`ei update persona <id> --json '<record with
  "is_archived": true>'`), which hides it without destroying it.
- **Non-reserved personas can be fully deleted.** `ei remove persona <id>` is
  permanent — confirm the user actually means "gone for good," not "hide it," and
  offer archive as the reversible alternative first (`references/recipes.md`).
- **No minimum trait/topic count here.** Don't invent a floor; a persona with one
  trait, or a brand-new one with none, is valid.
- **`is_static` is not yours to change.** It marks built-in structural personas and
  isn't part of the writable surface — never try to set it.
- **STOP and ask when:** the user's description of the change is vague enough that
  you'd be inventing character traits on their behalf, they haven't confirmed a
  plan yet, or a `remove` would destroy a persona the user might still want
  archived instead. Waiting is cheap; overwriting someone's persona on a guess is
  not.

---

## Load references on demand (branching inclusion)

Read only what the current step needs — these live in this skill's `references/`
folder:

| When you are… | Read |
|---|---|
| about to run any `ei` persona read/write command | `references/cli.md` |
| executing an add/adjust/remove trait or topic, a create, an archive, or a delete | `references/recipes.md` |
| planning with, or reporting to, a non-technical user | `references/talking-to-the-user.md` |

When in doubt, read more, write less, and ask the user.

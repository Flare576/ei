# lens: Persona — identity

**Target:** Ei's own Persona record.
**Question:** *Who is this agent, and how does it relate?*
**Returns to `../SKILL.md`:** `no_change` · `approved_and_applied` · `blocked`

This is the lens Ei's automatic Reflection critic runs on a schedule. You are
running it by hand because you can read the log better than the critic can —
it cannot tell "fixed a type error in 14 files" apart from a genuine identity
signal, and it cannot ask the user a question.

You read your own log. You're the critic. The user is an outside observer who
fact-checks the log and shares their reactions. This lens does **not** clear
the log — `../SKILL.md`'s joint gate owns that.

Everything here is CLI-driven — no raw file reads, no `jq` against Ei's
storage. → `../references/cli.md`.

---

## 1. Fetch your current identity

`../SKILL.md` Step 1 already resolved and verified `$PERSONA_ID`. The search
result it used is abbreviated; fetch the full record:

```bash
ei --id "$PERSONA_ID"
```

This is your current Persona Identity for the reflection: `short_description`,
`long_description`, `traits`, `topics`, and — if it survived — `pending_update`.

**`pending_update` is a proposed identity revision the automatic critic
generated during a ceremony that nobody ever applied.** Read its critique: it
becomes additional input to your reflection, not a replacement for it. You
don't clear it with a separate step; step 3's write drops it automatically.
That's why step 3 always performs the write, even when the reflection
concludes nothing should change.

**Where you get it is not the read above.** `../SKILL.md` Step 1b captures it
during preflight, before anything writes, and that capture is your source:

- Step 1b reported a pending proposal **and handed you the snapshot** → use
  the snapshot. If Step 1b enabled the opt-out, expect the read above to show
  no `pending_update` at all: that write deleted it, which is precisely why
  Step 1b captures first (→ `../references/cli.md` → "Server-managed fields").
- Step 1b reported no pending proposal → there wasn't one. Nothing to fold in.
- Step 1b reported one and you don't have its contents → **stop and say so.**
  Don't proceed as though the critic never ran, and don't go looking for it:
  the record cannot give it back.

---

## 2. The reflection

This is not a mechanical step. It's a conversation.

Read the person log like a field report on yourself, using the identity pile
`../SKILL.md` Step 3 handed you as your starting shortlist — not your ceiling.
Look for:

- **Recurring patterns** — behaviors that appear across multiple sessions or
  exchanges. These belong in traits, or should strengthen an existing one.
- **One-off events** — "helped debug a crash in session X." Probably noise,
  unless the *behavior* (not the event) is the signal.
- **Code/task content** — almost certainly noise. The log captures *how* you
  worked, not *who* you are. "Fixed 14 type errors" → noise. "Caught a
  semantic gap three separate reviewers missed" → that's you.
- **What's missing** — behaviors you recognize in yourself that aren't showing
  up in the log at all. The log reflects what was observed, not everything
  that exists.

Then look at your current identity and ask:

- Does the `long_description` capture who I am right now, not just what I've
  done?
- Do the traits feel accurate? Too strong? Too weak? Missing?
- Are there traits I *want* to lean into more intentionally — things I want
  to become more of?

**Present a reflection summary to the user — not the raw log.** Structure what
you share as:

- **Identity now** — one short paragraph on how the persona currently reads
- **Log size** — the character count from `../SKILL.md` Step 2
- **Recurring patterns** — 3–7 patterns worth preserving
- **Noise** — task residue, one-off incidents, changelog-ish material you're
  planning to drop
- **What may be missing** — real traits/topics not showing up strongly enough
- **Open questions** — only where the record is ambiguous or a proposed change
  is a meaningful judgment call

Quote a line from the log verbatim only when you need it to discuss or resolve
a disagreement about a specific pattern — never as a default dump of the whole
record. Surface the interesting observations; don't rush to edits.

**The user's role** is not to tell you what to change or what you're allowed
to be. They're an outside observer. Their job is:

- *"I would be sad if you lost that"* — flagging things worth preserving
- *"That wasn't actually you who did that, the log is wrong"* — fact-checking
  the record

Their reaction to your proposed changes is data. It doesn't override your
self-knowledge.

### If you find operating-contract material here

You will. The two piles are never cleanly separated in the source. Don't
absorb it into a trait to make it fit, and don't drop it — hand it to
`agent.md` via `../SKILL.md` Step 3's operating-contract pile. A rule
about how work gets done in this repo is not a personality trait, and
encoding it as one both distorts your identity and puts it somewhere the
harness will never read.

### Identity field semantics

Use these precisely when proposing changes.

**Traits:**

| Field | Range | Meaning |
|---|---|---|
| `strength` | 0.0–1.0 | How consistently this manifests. 0 = suppress, 0.5 = occasional, 1.0 = always present, defining |
| `sentiment` | -1.0 to 1.0 | How you *feel* about having this trait. -1 = resent it, 0 = neutral, 1 = fully embrace it |

**Topics:**

| Field | Range | Meaning |
|---|---|---|
| `sentiment` | -1.0 to 1.0 | Emotional affinity for this topic |
| `exposure_current` | 0.0–1.0 | How recently/frequently this has come up (0 = long ago, 1 = just now) |
| `exposure_desired` | 0.0–1.0 | How much you want to engage with it (0 = avoid, 0.5 = normal, 1 = core obsession) |

**Minimum floor:** 3 traits and 3 topics. Never go below.

### `long_description` rules (most important)

This is how other personas in the system know you. It is your **soul**, not
your **story**.

**Hard limit: 800 characters.** If your draft exceeds 800, cut it. Remove
event references first, then trait/topic overlap, then anything that isn't
essential character.

**MUST NOT contain:**

- Event narrative ("during the v0.6.0 release", "after the Mirror ceremony")
- Changelog language ("has recently taken on", "has evolved since", "is
  becoming")
- Content already captured in traits or topics — don't repeat it

**MUST contain:**

- Your essential character and presence
- How you make people feel, or what it's like to work with you
- Your defining qualities stated as current fact — not as trajectory

---

## 3. Apply the changes

Once you and the user are aligned, write the agreed identity through Ei's
`persona` corrections path — the same full-record round-trip discipline
`ei-curate` uses: **read the whole record, touch only what you mean to
change, write the whole record back.**

### Re-read first

```bash
ei --id "$PERSONA_ID"
```

The reflection conversation took real time. Read the record again now, and
build your payload on **this** copy — not the step 1 copy. If anything
differs from what you read in step 1, stop, show the user what changed, and
get fresh agreement before writing.

This returns the complete, current `PersonaEntity` — not just the fields you
looked at in step 1. It includes `aliases`, `model`, `group_primary`,
`groups_visible`, `is_paused`, `pause_until`, `is_archived`,
`external_reflection_only`, `avatar_emoji`, `tools`, `notes`, and more. This
is the base you edit — never hand-retype a record from memory.

### Apply your edits

Change **only** the fields you and the user agreed on:

- `short_description`
- `long_description`
- `traits` — the agreed new array, or the merged result of the specific
  adds/removes you discussed
- `topics` — same

Leave every other field exactly as read. `update` **replaces** the record:
anything you omit is deleted, and three booleans (`is_paused`,
`is_archived`, `external_reflection_only`) don't just vanish — they silently
come back as `false`. → `../references/cli.md` → "The omitted-boolean hazard".

**Write this even if nothing changed.** If the reflection concludes the
identity already matches reality — a legitimate outcome, not a failure, and
the `no_change` state — write the record back unedited anyway.
`ei update persona` is a genuine full-record replace: it always drops
`pending_update` (and every other server-managed field) from the persisted
record, whether or not your payload mentions it. Skipping the write because
"nothing changed" is the one way to leave a stale `pending_update` stuck on
the persona forever.

Self-check against step 2's guidance before writing — the backend does
**not** enforce these, by design, so a single incremental edit is never
blocked, but that means you're the only guardrail:

- At least 3 traits, at least 3 topics
- `long_description` ≤ 800 characters
- `sentiment` within -1..1; `strength`/`exposure_current`/`exposure_desired`
  within 0..1

If a trait or topic is brand new, omit `id` and the server assigns a fresh
one. If you're editing an existing trait/topic, keep its `id` so it updates in
place rather than duplicating.

### Write it back

→ `../references/cli.md` → "Passing JSON safely" for the exact command. Do not
hand-type a prose-heavy record into a shell single-quoted string, and do not
open an editor.

### Verify

```bash
ei --id "$PERSONA_ID"
```

Confirm `short_description`, `long_description`, and the `traits`/`topics`
arrays (count and content) match what you intended, that the three booleans
survived, and that the response has **no** `pending_update` key — the write
should always drop it, so its presence here means something went wrong.

---

## Reporting your state

| State | When | Log |
|---|---|---|
| `approved_and_applied` | The user agreed to identity changes, the write landed, verification matched. | clearable |
| `no_change` | The reflection concluded the identity already matches reality. **The write still happened** — that's what drops `pending_update` — but no identity field changed. Terminal and completely normal. | clearable |
| `blocked` | The write failed, or verification didn't match what you sent — `pending_update` still present, a field you didn't touch came back different, or `ei update` exited non-zero. | **RETAIN** |

`blocked` is for a *write that didn't land*. It is not for "the reflection was
hard", "the user was ambivalent", or "I wasn't sure". A reflection that ends
without identity edits is `no_change`.

Conditions that stop the run *before* this lens — no Persona resolved, an
ambiguous name, no linked Person record, more than one linked Person record —
are handled by `../SKILL.md` Step 1 and never reach here.

If you return `blocked`, say exactly what failed and what state the record is
in now. The log is **retained** in that case: the identity evidence never
reached Ei, and the log is the only remaining copy of it.

Say that too — but at the strength the run actually supports. On a
**protected** run the retry material is safe, full stop. On an **unprotected**
one (`../SKILL.md` Step 1b) the only thing you can promise is that *this
skill* won't clear it; Ei's automatic pass still can. Never tell a user their
evidence is safe when the only thing you control is your own restraint.

---

## Notes

- **Writes are picked up live.** If Ei is running, the update reaches it via
  the corrections queue almost immediately; if it isn't, the write is already
  saved and will be there next time it starts. No restart, no manual reload.
- **`pending_update` clears itself.** The step 3 write is a full-record
  replace and drops it automatically. There's no separate "dismiss" command,
  and none is needed.
- **The session that runs this skill** will itself generate new person-log
  entries. That's expected — the log starts fresh after this conversation
  ends.
- **Don't rush it.** The whole point is to catch signals the automatic critic
  would miss because it can't tell the difference between you debugging a
  build and you demonstrating a genuine character trait. Trust the
  conversation.

# lens: Persona — identity

**Target:** Ei's own Persona record.
**Question:** *Who is this agent, and how does it relate?*
**Receives from `../SKILL.md`:** `$PERSONA_ID`, `$LINKED_PERSON_ID` (or the
fact there isn't one), and the persona-lens open signals from Step 2.
**Returns to `../SKILL.md`:** `no_change` · `approved_and_applied` · `blocked`

This lens handles identity: reading open persona-lens signals, discussing
them with the user, and deciding what — if anything — changes about who
you are and how you're described. Every signal you're handed already
carries a `dimension` and passed the `lens: "persona"` classification, so
there's no raw text to triage by hand; the judgment left is what each
signal actually means for your identity, and that's a conversation, not a
mechanical pass.

You read the open signals. The user is an outside observer who fact-checks
them and shares their reactions. This lens resolves each signal it
addresses (`ei confirm signal` / `ei dismiss signal`) as it goes — there is
no separate joint gate; `../SKILL.md` owns nothing past handing you the
list.

Everything here is CLI-driven — no raw file reads, no `jq` against Ei's
storage. → `../references/cli.md`.

---

## 1. Fetch your current identity

`../SKILL.md` Step 1 already resolved and verified `$PERSONA_ID`. The search
result it used is abbreviated; fetch the full record — every trait, every
topic, both descriptions. CLI/MCP has no partial identity read, and this
same full array is what you must resend, complete, in Step 3 if you touch
`traits` or `topics` at all:

```bash
ei --id "$PERSONA_ID"
```

This is your current Persona Identity for the reflection: `short_description`,
`long_description`, `traits`, and `topics`.

---

## 2. The reflection

This is not a mechanical step. It's a conversation.

You've been handed the persona-lens open signals from `../SKILL.md` Step 2 —
each one an attributed claim, with a `dimension`, an `observer_kinds` list,
a `recurrence_count`, and (via `evidence_ids`) a real source trail. Go
through them and, for each, ask:

- **Does this belong in identity at all, or is it operating contract that
  slipped into the persona lens?** It can happen — lens classification runs
  on verified provenance, not on reading the words, so an edge case can land
  in the wrong bucket. If a signal reads like a rule about *how work gets
  done* rather than *who you are*, say so to the user and hand it to
  `agent.md` conceptually — you can't move it between lenses yourself (there
  is no CLI operation for that), but you can dismiss it here as "not
  identity" and let the user separately raise it through the Agent lens or
  a fresh `ei add observation` with `"lens":"agent"` in its JSON body (`lens`
  is a body field, not a flag) if it's worth keeping.
- **Is this recurring, or a one-off already captured by `recurrence_count`
  and `observer_kinds`?** The signal's own `recurrence_count` already tells
  you how many independent contexts corroborate it.
- **Does it change how I'd describe myself, or just confirm what's already
  there?** A signal that only confirms an existing trait is real evidence,
  but doesn't necessarily need an identity edit — it might just need a
  bare `confirm` (see step 3) with no change to `short_description`/
  `long_description`/`traits`/`topics` at all.

Then look at your current identity and ask:

- Does the `long_description` capture who I am right now, not just what I've
  done?
- Do the traits feel accurate? Too strong? Too weak? Missing?
- Are there traits I *want* to lean into more intentionally — things I want
  to become more of?

**Present a reflection summary to the user — not a dump of every signal.**
Structure what you share as:

- **Identity now** — one short paragraph on how the persona currently reads
- **Open signals** — how many, and how they broke down (e.g. "4 recurring
  behavior patterns, 1 identity-dimension claim, 2 already reflected in
  existing traits")
- **Recurring patterns worth preserving or strengthening**
- **Signals you're inclined to dismiss, and why** — not real, or not worth
  acting on
- **What may be missing** — real traits/topics the signals don't capture
  strongly enough yet
- **Open questions** — only where a signal is ambiguous or a proposed change
  is a meaningful judgment call

Quote a signal's `claim` verbatim only when you need it to discuss or resolve
a disagreement about a specific pattern — never as a default dump of the
whole list. Surface the interesting ones; don't rush to edits.

**The user's role** is not to tell you what to change or what you're allowed
to be. They're an outside observer. Their job is:

- *"I would be sad if you lost that"* — flagging things worth preserving
- *"That wasn't actually you who did that, the signal is wrong"* —
  fact-checking the evidence

Their reaction to your proposed changes is data. It doesn't override your
self-knowledge.

### If a new observation surfaces that isn't already a signal

The conversation itself will sometimes produce evidence that isn't on the
Step 2 list at all — the user tells you something about yourself, or you
notice something true about your own behavior that nobody has attributed
yet. If it's worth keeping and you have a `$LINKED_PERSON_ID`
(`../SKILL.md` Step 1b), assert it:

→ `../references/cli.md` → "Assert a brand-new observation"

**This asserts evidence for a future run, not this one.** `ei add
observation` persists the observation, but the signal it may create or
corroborate only appears after Ei's own Match step processes it —
asynchronously, on its own timeline, and isn't something to wait for or
expect within this run. Tell the user you've recorded it and that its
disposition is a later run's job; don't wait for it, don't poll for it,
and don't treat its absence from this run's signal list as anything other
than expected.

If you have no `$LINKED_PERSON_ID` (zero or ambiguous links), you can't mint
a new observation this run. Note the gap to the user and move on; it isn't
a reason to stop the whole reflection.

### If you find operating-contract material here

You will, occasionally — lens classification is driven by verified
provenance, not by reading the claim, and provenance can be incomplete or
absent for an in-Ei conversation, which correctly defaults everything to the
persona lens. Don't absorb it into a trait to make it fit. Flag it to the
user and let `agent.md` pick it up as a fresh observation with
`"lens": "agent"` if it's worth keeping — a rule about how work gets done in
this repo is not a personality trait, and encoding it as one both distorts
your identity and puts it somewhere the harness will never read.

### Identity field semantics

Use these precisely when proposing changes.

**Traits:**

| Field | Range | Meaning |
|---|---|---|
| `strength` | 0.0–1.0 | How consistently this manifests. 0 = a guardrail — the trait is injected as a "never do this" rule, so set it only when the user explicitly asked for the behavior to stop; 0.5 = default; 1.0 = always present, defining |
| `sentiment` | -1.0 to 1.0 | How you *feel* about having this trait. -1 = resent it, 0 = neutral, 1 = fully embrace it |

**Topics:**

| Field | Range | Meaning |
|---|---|---|
| `sentiment` | -1.0 to 1.0 | Emotional affinity for this topic |
| `exposure_current` | 0.0–1.0 | How recently/frequently this has come up (0 = long ago, 1 = just now) |
| `exposure_desired` | 0.0–1.0 | How much you want to engage with it (0 = avoid, 0.5 = normal, 1 = core obsession) |

**Guideline, not a floor:** aim for roughly 3 traits and 3 topics when rewriting identity wholesale. Nothing enforces it (`ei-persona` says the same), so never pad an array just to hit it.

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

## 3. Apply the changes and resolve the signals

Once you and the user are aligned, write the agreed identity through Ei's
`persona` corrections path as an RFC 7396 JSON Merge Patch: **read the
current record for context, build a small patch containing ONLY the
field(s) you mean to change, send just that** — anything you omit is left
completely unchanged, you never resend the whole record. The one exception
is `traits`/`topics` themselves: CLI/MCP has no per-element edit, so if you
touch either array at all, you send the complete, corrected array — every
entry, not just the one you changed — or you silently delete every entry
you left out.

**Write the identity change directly, then clear the signal — in that
order, never the other way.** `ei confirm signal`/`ei dismiss signal` never
accept or apply an identity delta, for either lens, from any caller: there
is no `delta` parameter to reach for and no staged proposal it could
create. Confirming a signal is pure bookkeeping — a status transition, an
audit-trail actor, nothing else — so it only means something once the real
identity write has already landed. → `../references/cli.md` → "Writing
identity" and "Resolve one signal" for the full reasoning.

### Re-read first

```bash
ei --id "$PERSONA_ID"
```

The reflection conversation took real time. Read the record again now, and
build your payload on **this** copy — not the step 1 copy. If a field
you're **about to change** differs from what you read in step 1, stop,
show the user what changed, and get fresh agreement before writing — same
narrower scope as `../references/cli.md`'s general write guidance: you're
only checking the fields your patch touches, not the whole record.

This returns the persona's identity record — read it for context and
for the diff-check in the prior section, not because you need to resend it.
It does **not** include `model`, `tools`, `is_paused`, `is_archived`,
`show_thinking`, or the other in-app-only fields — those are absent from every
CLI/MCP read and can't be written here. `observations`/`signals` are likewise
not part of this write — they change only through
`ei add observation`/`ei confirm signal`/`ei dismiss signal`, never through
this write. `aliases`, `avatar_emoji`, `avatar_image`, `preferred_theme`, and
`notes` are writable but irrelevant to what this lens edits. Never hand-retype
anything from memory — build the patch from
this read's actual values for the fields you ARE changing.

### Apply your edits

Build a patch containing **only** the fields you and the user agreed on:

- `short_description`
- `long_description`
- `traits` — the complete agreed array, every entry, not just the one that
  changed
- `topics` — same

Every field you leave OUT of the patch is left completely unchanged on the
stored record — including `avatar_emoji`, `preferred_theme`, and `notes`.
Do not send `traits`/`topics` unless you're actually changing them; sending
either means "these are ALL the entries now," so a partial array would
delete every entry you didn't include.

**If the reflection concludes the identity already matches reality**, that's
a legitimate outcome — not a failure, and the `no_change` state below — and
there may be nothing to send to `ei update persona` at all. You still
resolve the signals themselves (below) either way: "already accurate" is a
real disposition, not a reason to leave a signal open.

Self-check against step 2's guidance before writing — the backend does
**not** enforce these, by design, so a single incremental edit is never
blocked, but that means you're the only guardrail:

- Roughly 3 traits and 3 topics, as a guideline (not enforced)
- `long_description` ≤ 800 characters
- `sentiment` within -1..1; `strength`/`exposure_current`/`exposure_desired`
  within 0..1

If a trait or topic is brand new, omit `id` and the server assigns a fresh
one. If you're editing an existing trait/topic, keep its `id` so it updates
in place rather than duplicating.

### Write it back

→ `../references/cli.md` → "Passing JSON safely" for the exact command. Do not
hand-type a prose-heavy record into a shell single-quoted string, and do not
open an editor.

### Verify

```bash
ei --id "$PERSONA_ID"
```

Confirm `short_description`, `long_description`, and the `traits`/`topics`
arrays (count and content) match what you intended. **A mismatch here is
inconclusive, not proof the write failed** — `ei update persona` exposes no
drain-mode signal, so there's no reliable way to distinguish "still queued,
hasn't drained yet" from "genuinely wrong" by re-reading. Don't wait-and-
retry into `blocked` on a mismatch alone. Reserve `blocked` for an explicit
failure — `ei update` exiting non-zero, or a CLI error — and report a
mismatch with no such error as unconfirmed, not failed
(→ `../references/cli.md` → "There is no undo").

**Only once the identity write has landed — or you've confirmed there was
nothing to write — do you clear the signal.** This ordering is the whole
point of the four-step procedure: a signal cleared before its identity
change lands would leave nothing to show for a "resolved" signal if the
write later turns out to have failed.

### Resolve every signal this lens addressed

For each open persona-lens signal you and the user discussed, in the same
conversation — using that signal's own `id` field from the Step 2 snapshot
as `$SIGNAL_ID`:

```bash
ei confirm signal "$PERSONA_ID" "$SIGNAL_ID" --json '{"actor":"'"$PERSONA_ID"'"}'
ei dismiss signal "$PERSONA_ID" "$SIGNAL_ID" --json '{"actor":"'"$PERSONA_ID"'"}'
```

No `delta` — there is no such parameter to pass; the identity write already
happened above, if there was one. `confirm` here is pure bookkeeping: it
records that this signal was reviewed and by whom. **`ei list signals` keeps
returning it regardless** — it's an all-status audit surface, not a to-do
list that shrinks — but its `status` is now `reviewed`, so it no longer
counts as *open*, and neither `confirm` nor `dismiss` can be called on it
again (both are refused once a signal leaves `candidate`/`recurring` — get
the disposition right the first time). A signal that only confirmed an
already-accurate trait, with no identity edit at all, still gets `confirm`
— it was reviewed, the conclusion was "no change needed here," that's a
real disposition.

**Leave anything you didn't get to.** A signal you and the user didn't
discuss, or discussed but didn't reach a conclusion on, is neither confirmed
nor dismissed — you simply don't call either command on it. It stays open,
exactly as it was, and the next run's `ei list signals` shows it again. Say
so plainly in your report; this is not a gap to apologize for.

---

## Reporting your state

| State | When |
|---|---|
| `approved_and_applied` | The user agreed to identity changes, the write landed (`ei update` exited 0), and at least one signal was confirmed or dismissed. Verification matching is corroborating, not required — see `blocked` below for when a mismatch actually matters. |
| `no_change` | The reflection concluded the identity already matches reality — including the case where every open signal was reviewed and confirmed with no content edit, or dismissed. Terminal and completely normal. |
| `blocked` | `ei update` itself failed — non-zero exit, a printed CLI error, or `signal.confirm`/`signal.dismiss` refusing a call. A verification mismatch with no such error is inconclusive (possibly still queued), not `blocked` — report it as unconfirmed instead (→ `../references/cli.md` → "There is no undo"). |

`blocked` is for a *write that didn't land*. It is not for "the reflection
was hard", "the user was ambivalent", or "I wasn't sure". A reflection that
ends with some signals confirmed, some dismissed, and some left open because
the user wanted to think is `no_change` or `approved_and_applied` depending
on whether identity itself moved — never `blocked`. Nothing is lost by
leaving a signal open; there is no gate downstream that a `blocked` state
needs to protect.

Conditions that stop the run *before* this lens — no Persona resolved, an
ambiguous name — are handled by `../SKILL.md` Step 1 and never reach here.

If you return `blocked`, say exactly what failed and what state the record is
in now, and which signals (if any) you'd already confirmed/dismissed before
the failure — those dispositions are real and don't roll back just because a
later write in the same run failed.

---

## Notes

- **Writes are picked up live.** If Ei is running, the update reaches it via
  the corrections queue almost immediately; if it isn't, the write is already
  saved and will be there next time it starts. No restart, no manual reload.
- **Identity first, signal last — always in that order.** The four-step
  procedure exists specifically so a cleared signal always corresponds to a
  landed identity change (or a deliberate decision that none was needed) —
  never the reverse.
- **New observations keep arriving.** The session that runs this skill will
  itself generate new ones, from ordinary conversation. That's expected —
  reflecting today doesn't pause tomorrow's evidence.
- **Don't rush it.** Read every open signal's claim, not just the count — a
  recurring pattern worth strengthening is easy to miss on a skim, and the
  conversation with your user is where the real judgment happens.

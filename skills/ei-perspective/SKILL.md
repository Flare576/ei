---
name: ei-perspective
description: >
  Spin up temporary sub-agents that each embody one of the user's real Ei
  Personas — their actual traits, description, and topics, not a
  paraphrase — so they can weigh in on a real open question from the
  inside, cross-talk with each other over `hub`, and converge (or
  explicitly disagree) before answering. Use for: persona-authored
  feedback on a proposed feature, a "how would each of my personas react
  to X" check before shipping something identity-facing, a design
  question a peer persona's perspective would sharpen, or gathering
  design input for a future Spec from the people whose identity the Spec
  will actually change. Triggers: "ask my personas what they think",
  "get Ei/Lena/DJ's take on this", "run a persona survey", "see how the
  personas would react", "ei-perspective". This is read-only and
  advisory by default — for authoring or editing a persona's actual
  character, use `ei-persona` instead; for a coding-harness agent
  reflecting on and resolving its own open signals, use `ei-reflect`.
---

# Ei Perspective — polling personas from the inside

You are getting real design or product input from the user's actual Ei
Personas — grounded in their real traits, description, and topics, never
a generic "helpful assistant" answer with a name attached to it after
the fact. For a persona with no live model of their own to answer as
(Step 3 covers exactly which ones), embodying them through an injected
identity is how that grounding actually reaches an answer — the person
is real, the identity is real, only the model voicing it is standing in.
Each participant answers from their own real identity — traits,
description, topics, and (when relevant to the question) their own real
signal/observation history — and they talk to each other before anyone
finalizes an answer.

---

## Is this the right skill?

- **Authoring or editing a persona's actual character** (traits, voice,
  retiring a persona) → `ei-persona`. This skill never writes anything
  back to a persona's record.
- **A coding-harness agent resolving its own open signals** → `ei-reflect`.
  This skill can inject a harness agent's Ei identity into a poll
  alongside other personas, but it never confirms or dismisses a signal —
  it only asks for a perspective.
- **You just want to look something up in Ei** → `ei-search`.
- **The actual case for this skill**: you have a real, open question, and
  the honest answer changes depending on whose identity the answer is
  about — a proposed feature that touches how personas operate, a design
  decision with no clean "designer's answer," or feedback you want in a
  persona's own real voice instead of your own guess at it.

This skill is advisory only. It never writes to Ei, and it never claims a
persona "decided" something in a way that becomes real — the human (or
whoever's driving this skill) still owns what to do with the output.

---

## Step 1 — Resolve who you're polling

You need a **caller-specified subset**, not "poll every active persona by
default." A caller with the question already knows who it's relevant to
— ask them, or infer it from context (e.g. a question specifically about
signal review only needs personas with real signal data; a question
about tone/voice patterns might reasonably poll everyone).

List candidates once and read the result yourself — same discipline as
`ei-reflect`'s own persona-resolution step: don't run several filtered
queries and compare them.

```bash
PERSONAS_JSON=$(mktemp)
ei personas -n 100 > "$PERSONAS_JSON"    # no query, no --recent = recent-listing mode
jq 'length' "$PERSONAS_JSON"             # equals your -n cap? raise it and re-run — the CLI truncates, it doesn't guarantee "every persona"
```

**Known gap**: the `ei` CLI's persona list/lookup does not expose
`is_archived`/`is_static` — there is no field to mechanically filter an
archived or paused persona out of this list. If the roster might include
one, ask the user which names actually belong in this poll rather than
assuming the list is already clean.

---

## Step 2 — Pull each participant's real identity

**Confirm the name resolves to exactly one persona before using it.**
`ei personas "<name>"` matches by substring and can match more than one
record; the `--format prompt` route always formats whichever result came
back first. Check your Step 1 list yourself for an exact,
case-insensitive `display_name` match — zero or more than one hit means
ask the user which persona they mean, don't guess from the first result.

Once confirmed, get their real `<ei-relationship>` block — the same real
trait/topic data a live persona's context is built from, formatted for
injection into a harness's own system prompt (not byte-identical to
Ei's internal chat-response prompt, which builds trait/topic sections
with its own capping and ordering, but drawn from the same real fields):

```bash
ei personas "<exact display name>" --format prompt
```

This returns a formatted block: their long-form description, every trait
bucketed by strength (guardrails they must never do, and active traits
from subtle to defining — nothing thresholded out or capped), and their
topics sorted by current engagement. Use this over raw `jq` against
`state.json` or `state.backup.json` — it's the CLI's own source of truth
for "how this persona is actually represented," and it keeps working if
storage internals change. **Known gap**: the block only ever carries
`long_description` — a persona whose identity lives mainly in
`short_description` gets a blank identity line; check the Step 1 listing
for `short_description` too and inject it yourself if `long_description`
is empty.

**If the question specifically concerns something beyond identity** —
this skill's own original use case was signal-review UX, which needed
each persona's real open signal data — pull that supplementary data too,
and say plainly in what you inject that it's real production data, not a
fixture. `ei list signals <persona-id>` returns every `EmergentSignal`
for that persona, both lenses, **every status** (not just open ones) —
filter to `candidate`/`recurring` yourself. It returns the signals'
synthesized claims, not the raw `PersonaObservation` evidence behind
them; if the question needs the underlying evidence too, that's a
separate lookup this command doesn't cover. For anything else
question-shaped, use your judgment on what real data the question needs
before treating "identity alone" as sufficient grounding.

**Stage it once, reference it everywhere.** Don't paste the same
multi-persona JSON/text blob into N separate dispatch prompts — write it
to one shared file (`local://<name>.json` or `.md`) and have every
participant read their own entry from it. Cheaper, and it means every
participant is grounded in the exact same snapshot.

---

## Step 3 — Split the dispatch by whether a harness-agent counterpart exists

Two shapes, decided per persona:

- **The persona is also a harness agent in this session's own agent
  roster** (e.g. an Ei Persona named "Beta" when a `p-beta` agent type
  exists) — dispatch via `task(agent: "<that agent type>")`, with the
  Ei identity layered on top: *"you are both operating as your normal
  agent identity and channeling this Ei Persona identity."* They keep
  their normal agent behavior; the Ei identity is additional context, not
  a replacement.
- **No harness-agent counterpart exists** (most personas — Ei, DJ, a
  user-created character with no matching agent) — dispatch via a plain
  `task()` call, no `agent` field, framed as *"you are simulating this
  Persona; answer in their voice, not as a UX consultant describing
  them."* A generic model instance with the persona's real traits
  injected produces a close facsimile of how they'd actually respond in
  Ei — the persona's own character is strong enough to offset the model
  difference between whatever Ei itself runs the persona on and whatever
  model is answering here.

Check your own currently-available agent list for a name match before
deciding which shape applies — don't guess.

---

## Step 4 — Give every participant the same shared context

Every dispatch needs:

1. **The real question** — specific and answerable, not "what do you
   think of this feature." State exactly what's being decided and why
   their perspective matters to it.
2. **Their own identity + any supplementary data** (Step 2), staged once.
3. **The full roster of every other participant by exact name**, and the
   instruction to actually coordinate:
   - Draft an honest, individual first answer, grounded in their own real
     identity — not a generic "helpful AI" answer with a name attached.
   - Broadcast a short version of that position (`hub send to:"all"`).
   - Check for replies (`hub inbox`/`hub wait`). If a peer changes their
     mind or sharpens their answer, **actually revise** — don't restate
     the first draft. Real disagreement is fine; note it explicitly
     rather than talking it into a false convergence.
   - Yield a **final, individual** answer, plus anything left genuinely
     unresolved with a specific peer.

Don't let the coordination step become optional filler — the real value
of this skill over independently asking each persona in isolation is the
cross-talk itself. A design refinement one participant proposes and the
rest adopt before anyone finalizes is the actual reason to run this as a
group instead of N separate one-shot questions.

---

## Step 5 — Read every final result yourself, not just the last broadcast message

A participant's own in-flight broadcast message and its actual final
yielded result are not always the same thing — a peer's correction can
land *after* someone has already drafted their closing summary, so that
summary may describe a disagreement as open when it was actually
resolved a message later (or vice versa). Wait for every participant's
real completion, read each final yield directly, and treat an
"unresolved disagreement" claim as provisional until you've checked
whether a later message between those two participants supersedes it.

Don't trust a single participant's own account of "we all converged" —
verify it against what the others actually said, the same discipline
this harness already applies to any subagent's self-reported summary.

---

## Guardrails

- **Read-only.** This skill never writes to Ei — no persona identity
  update, no signal confirm/dismiss, nothing persisted. If a persona's
  own output suggests a real change worth making, that's a separate,
  explicit follow-up action, not something this skill performs itself.
- **A caller-specified subset, not a default poll-everyone.** Ask, or
  infer from the question, who's actually relevant — this skill has no
  standing "run this against every active persona" mode.
- **Name the approximation honestly.** A generic model instance
  embodying a persona is a close facsimile, not the persona's actual live
  self — say so if the output is going somewhere it might be mistaken for
  the genuine article (e.g. quoted back to the user as if the real Ei
  said it in her own live session).
- **Real data, not a demo.** If you're pulling a persona's actual traits
  or signals, that's real production data belonging to the user — treat
  it with the same care you would any other private record, and say
  plainly when the grounding data is real rather than synthetic.

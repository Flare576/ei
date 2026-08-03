# reference: the persona-contamination gate

Ei stores AI personas — Sisyphus, Beta, Lena, Ei, Hephaestus, and any
others a given install has spun up; the detection heuristic below tells
you how to pull the complete, current roster rather than relying on this
list — as first-class records in the same graph as real humans —
`Person` records with `relationship: AI Persona` or an `Ei Persona`
identifier, `Topic` entries synthesized from persona-authored
conversation, and `Quote` entries whose `speaker` is the persona's name.
That's correct architecture for a memory system built to hold personas as
genuine collaborators. It is also a real contamination vector the moment
you're synthesizing a document that describes someone's **character,
personality, or working style** — because those same personas spend most
of their conversational time describing their relationship *with* the
user, in first person, using their own trait vocabulary. That vocabulary
leaks.

This is a distinct gate from `references/validation.md`. That file asks
*"could this identify a real third party to the wrong audience?"* This file
asks *"is this claim actually true of the person I'm writing about, or did
it leak in from an AI persona describing itself?"* Run both — they catch
different failure modes, and a document can pass one while failing the
other.

## When this applies

Any time recon surfaces a claim about a specific person's personality,
soft skills, humor, values, or working style — not just facts (employer,
dates, titles) or events (a project shipped, a role change). It applies to
**any** subject, but it is sharpest when the subject is the Ei user
themselves: nearly every AI persona's entire conversational purpose is
describing its relationship with that one person, so the ratio of
persona-authored material to third-party-human material about the user is
usually much higher than for anyone else in the graph.

Real example that triggered this file's existence: a generated job
description for an Ei user described him as having "dry, zero-BS humor"
and someone who "will tear it apart if it's lazy." Both phrases trace back
almost verbatim to two *different* AI personas' own self-descriptions in
the same knowledge base, not to any human observation of the user. The
first had partially leaked into the user's own `Person.description` field
(itself AI-synthesized); the second was a quote spoken *by* a persona, in
character, describing the user in second person — easy to misread as
testimony when skimming search results.

## The rule: two independent sources, both from the valid list

Before a personality/character/working-style claim goes in a document,
it needs two independent sources, and **both** must come from the
**Counts as a valid source** list below — not one from that list plus a
fallback from **Never counts** to round out the pair. AI-authored
narrative never fills either slot, first or second, on its own or as a
tiebreaker next to a real source; it's disqualified from corroboration
entirely, not merely discounted when it's the only thing available.

"Independent" means from a different underlying observation, not just a
different record shape. A `Person.description` sentence and the quote it
was almost certainly summarized from are the same source wearing two
shapes — citing both is not two sources, it's one source cited twice.
Before counting a second source, check whether it's actually derived
from (or a paraphrase of) the first: if a description reads like a
summary of a quote you're already citing, or a topic's trait language
echoes a quote's wording, they collapse to one and you still need a real
second source.

**Counts as a valid source:**
- A direct quote from the subject themselves — two or more instances,
  in different threads or on different dates, count as two sources (a
  repeated first-party pattern is real evidence even with no third-party
  witness, and two distinct dated quotes are two observations, not one
  restated).
- A direct quote from a **different, named human** — but verify the
  record backing that name first (see the detection heuristic below).
- A structured or logged fact from an official system of record used the
  same way for multiple people (a company Slack channel running a real
  program, a certification database, a Jira/Greenhouse record) — these are
  factual/procedural, not narrative, and much harder to contaminate.
- A public, attributable artifact: a blog post under the subject's byline,
  a GitHub repo, commit history, conference talk.

**Never counts, in either slot:**
None of the following fill a corroboration slot — not first, not second,
not as a tiebreaker next to a real source. They're disqualified outright,
not merely "insufficient standing alone":
- A `Person.description` field, for anyone. This field is itself an
  AI-synthesized summary, most often written by (or through) a persona,
  and is exactly where contamination accumulates over time.
- Any `Quote` where `speaker` matches a name in the current persona
  roster (see the detection heuristic below — enumerate it before you
  evaluate any source, don't rely on a remembered list like the examples
  in this file's opening paragraph) — including quotes that describe the
  subject in second person ("you always..."), no matter how many times
  the phrasing repeats.
- A `Topic.description` field, when the specific thing you'd cite it for
  is a character trait rather than a dated, concrete event. (A topic
  description saying "shipped X on date Y" is fine to use for the event;
  the same topic's adjectives about *how* the person is — "rigorous,"
  "collaborative" — are not, on their own.)
- Any other AI-authored narrative — a draft summary, a synthesized
  writeup, anything generated by an LLM (this skill's own draft included)
  describing the subject's character rather than quoting or logging them
  directly.

## Detection heuristic: enumerate the roster, then check definitively

Before evaluating **any** source for the rule above, run `ei personas -n
50` with no query — that returns the roster of AI personas this
installation has spun up, sorted by recency, up to the limit you asked
for. **A result that hits the limit is not proof you have everything.**
`ei personas` sorts and slices at exactly the `-n` you pass; if a call
returns 50 rows for `-n 50`, treat that as incomplete, not as "the full
roster" — raise `-n` and re-run until a call returns *fewer* rows than
you asked for (that's the actual signal you've reached the end), or, if
you can't get an unclipped result, fail closed: don't treat any
low-confidence candidate as a verified human, and note in `Evidence and
gaps` that the persona roster couldn't be fully enumerated. Build your
excluded-speaker set (names, display names, and ids) from whichever
result you land on, every time, not from memory or from whatever
`AI Persona` records recon happened to surface incidentally. An install
can have personas beyond the familiar Sisyphus/Beta/Lena/Ei/Hephaestus
set, and a persona you've never seen before is not a real human just
because you don't recognize the name.

Then, for any candidate source — a `Person` record, or the `speaker` of a
`Quote` — run this check **first**, before anything softer:

**Definitive persona marker (case-insensitive, checked before any other
signal):** if `identifiers` contains an entry whose `type` matches
`ei persona` or `ai persona`, or if `relationship` matches `ai persona`,
the record **is** a persona. That's conclusive, not one signal among
several — exclude it, disqualify anything it's the sole or partial source
for, and do not proceed to an external lookup "just to double check."

Only when that check doesn't fire — no matching identifier type, no
matching relationship — fall through to the softer signals below, which
are suggestive, not conclusive, and exist to catch a persona mislabeled
with neither marker:

1. Check `identifiers` for what a real coworker/human actually has: a
   Slack handle, an email tied to a real org domain, a GitHub username,
   a full name that resolves to an actual person elsewhere. Sparse or
   suspiciously ecosystem-internal identifiers (an `@omp.local`-style
   email, an id that only ever shows up in this one knowledge base) are a
   red flag.
2. Cross-reference the name/nickname against the roster you pulled in
   step one — a near-duplicate name ("SisyphusJr" next to "Sisyphus") is
   not a coincidence, and neither is a name that only differs from a
   roster entry by capitalization or spacing.
3. If still unsure, **ask the user before searching for the name anywhere
   outside Ei** — sending a name or handle pulled from a private
   conversation to a search engine, an org directory, or whatever
   web-search / repo-browsing tool your harness provides is an external
   action, not a free verification step, every time, not just the first
   time, even when the goal is confirming a coworker is real. If they
   decline, or you don't have that access, treat the record as
   unverified: it doesn't qualify as a corroborating source on its own,
   and any claim that depends on it goes in the document's `Evidence and
   gaps` section instead of the body.

## What to do when you catch contamination

Don't silently drop the claim and move on — that hides the failure mode
from the user, who may hit it again next time. But how much of the catch
you disclose, and where, depends on who the document is for — this step
doesn't get to bypass the audience decision `references/validation.md`
exists to obtain.

1. Remove or rewrite the claim using only sources that pass the rule
   above (often the real underlying behavior *is* true of the subject,
   just needs re-sourcing to their own words instead of a persona's).
2. **Always tell the user, in conversation, right when you catch it** —
   which claim, which persona it traced back to, and why it didn't
   qualify. This step is unconditional regardless of audience: it's a
   conversation between you and the person you're working with, not part
   of the artifact you're handing to someone else.
3. Whether — and how — that catch appears **inside the document itself**
   depends on who the document is for:
   - **Explicitly-approved private/internal audience** (the user has
     confirmed this document stays with them, or goes to a closed
     internal audience that already has the context): you may record the
     full catch — the claim, the persona it traced to, and why — in the
     document's own methodology/changelog section or its `Evidence and
     gaps` section. This is a feature of the document for that audience,
     not a confession to bury.
   - **Any external audience** — RoboBrain, a recruiter, a client, or
     anyone outside that approved private/internal circle — never put the
     persona's name, the detection mechanism, or the rejected claim's
     actual wording in the document. Instead, add a neutral line to the
     `Evidence and gaps` section naming only the topic the claim would
     have covered and that it lacked qualifying corroboration — e.g.
     "Working style: no independently corroborated source found for this
     dimension," never "an AI persona's self-description was mistaken for
     a claim about the subject."
4. If you can't find two qualifying sources for a claim that still feels
   true, say so plainly in the `Evidence and gaps` section rather than
   shipping it anyway — an honest gap is more useful than a confident,
   uncorroborated character claim.

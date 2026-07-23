# reference: Ei recon — the discipline this skill exists to enforce

Read `SKILL.md`'s "Why this skill exists" section first if you haven't — this
file is the mechanical follow-through on that warning. The short version:
**you have research tools the automatic Rewrite ceremony doesn't, and that is
a liability for this specific decision, not an advantage.** The ceremony is
forced to search Ei before it can redistribute anything, because
`find_memory`/`searchHumanData` is the *only* tool it has. You have to force
yourself to do the same thing on purpose.

The decision this file governs, precisely: **for a piece of content you're
about to pull out of a bloated record, does Ei already have a home for it?**
That question has exactly one authoritative source — Ei's own dataset,
searched live, right now. Not:

- **Your own inference about the subject.** Recognizing "Critique Crews" as a
  project from context, or from earlier in this conversation, tells you the
  subject is *real* — it tells you nothing about whether Ei *already has a
  record for it*. Those are different facts. Only a search answers the
  second one.
- **Grep across the codebase, Slack, or web search.** Those tools answer
  "what is objectively true about this subject in the world." They cannot
  tell you what Ei has already stored, under what name, with what wording.
  Ei's dataset is not indexed anywhere else — searching outside it for this
  particular decision is search theater, not evidence.
- **General knowledge from model training.** Irrelevant here by definition —
  Ei's dataset is private and personal; nothing about it was in your
  training data.

If you catch yourself thinking "I'm pretty sure there's already a topic for
this" — that is exactly the moment to search, not the moment to skip
searching because you're pretty sure.

---

## The search procedure (do this for every subject phrase)

1. **Run a balanced search first**: `ei "<subject phrase>"` (no type filter).
   This mirrors the ceremony's own `searchHumanData` call, which searches
   across facts/topics/people/quotes and returns whatever's closest
   semantically, not by exact keyword match.
2. **If nothing plausible comes back, don't stop — reformulate.** Semantic
   search is fuzzy on wording, not fuzzy on meaning. Try:
   - A shorter, more generic version of the phrase (your subject phrase from
     the scan step was written to be *specific*; a matching existing record
     may use *broader* language).
   - The record's own vocabulary, if the description used a specific term
     you paraphrased when writing the search phrase.
   - The subject from a different angle — "sprint ticket assignments" and
     "CMIDP sprint work" might both be worth trying for the same content.
   - At minimum two distinct phrasings before you conclude nothing exists.
3. **Narrow to type-specific search if the balanced search surfaces a
   candidate of the wrong displayed type or you want more depth**:
   `ei topic "<phrase>" -n 5` / `ei person "<phrase>" -n 5`. The ceremony
   itself checks both topics and people for every subject — a subject
   extracted from a Person record isn't guaranteed to belong in a Topic; it
   could just as easily belong to a *different* Person record (e.g. "he's
   been coordinating with Nick on the Data Lake migration" might mean Nick
   already has — or deserves — his own Person record).
4. **Pull the full record for any real candidate**: `ei --id <id>`. A search
   snippet is not enough to judge genuine overlap — read the whole
   description before deciding to merge into it.

## Judging a candidate: merge or don't

A search hit is a **guess**, not a verdict — the same caution `ei-curate`
applies to a bad-merge symptom applies here to a bad-redistribution risk:

- **Genuine overlap** → the candidate's own subject matter substantively
  matches what you're redistributing, not just a shared word. Fold your
  content into it (update its description; see `references/mechanics.md`).
- **Similar name, different meaning** → do **not** merge. Two things can
  share a name and be unrelated (a "Uniform" topic about the CMS platform vs.
  a stray mention of a work-uniform policy). Create a new record instead.
  Contaminating an unrelated record with mismatched content is worse than
  creating an extra one — it's exactly the kind of bad-data problem
  `ei-curate` would later have to clean up.
- **Partial overlap** → fold in only the genuinely overlapping portion; if
  part of the extracted content doesn't fit even the matched candidate,
  that part still needs its own home (repeat the search for just that part,
  or create new for it).

## When you're still not sure after searching

Two searches, multiple phrasings, no confident match either way — that's a
real ambiguity, not a failure of effort. Surface it to the user rather than
guessing (`references/talking-to-the-user.md`): name the candidate, name
your uncertainty, ask.

## A note on tooling

If you're running inside a harness that also exposes `ei_search`/`ei_lookup`
as direct tool calls (rather than shelling out to the `ei` CLI), those hit
the identical underlying search/lookup code — either is fine. What matters is
that you *actually invoke* one of them for every subject, not that you use a
particular interface.

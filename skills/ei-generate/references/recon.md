# reference: gathering material for a generated document

The naive approach — `ei "<subject>"`, take the top N, done — under-covers
anything broader than a tightly-named topic. This file replaces "raise N"
with three techniques, none of which involve a fixed result count.

## Why a single search isn't enough

Take "onboarding doc for R&P." A single `ei "R&P"` search returns whatever
literally mentions "R&P" most prominently — a handful of topics or quotes.
Most of what an onboarding doc actually needs (who you'll work with, how
timesheets work, what the sprint cadence looks like) won't rank highly on
that query, because those records don't say "R&P" in them — they're just
*about* R&P implicitly. The fix isn't a bigger top-N on the same query; it's
searching the right *facets* instead of the subject string itself.

## Step 1: Facet the subject before you search anything

Break the subject into the categories a document of this type actually
needs, before touching Ei. If `references/document-types.md` has a seeded
entry for this document type, use its facet list as a starting point — it
already encodes what tends to matter for that kind of document in Ei's data
specifically (not generic writing advice, which you don't need help with).

No matching entry? Derive facets yourself by asking "what would someone
reading this document need to know, broken into 3-6 categories" — then
search each category, not the subject as a whole.

## Step 2: Search each facet with multi-phrasing

This is the same discipline `ei-rewrite`'s recon enforces for a different
decision — reused here because it's the same underlying problem (semantic
search is fuzzy on wording, not on meaning):

1. Run a balanced search first: `ei "<facet phrase>"` (no type filter).
2. **If nothing plausible comes back, don't stop — reformulate.** At
   minimum two distinct phrasings before you conclude a facet has nothing:
   - A shorter, more generic version of the phrase.
   - The record's own likely vocabulary, if you guessed at a term.
   - The facet from a different angle (e.g. "timesheet process" and
     "Harvest hours" might both be worth trying for the same facet).
3. Narrow to a type-specific search (`ei topics "<phrase>" -n 5`,
   `ei people "<phrase>" -n 5`) if the balanced search surfaces a candidate
   of the wrong type, or you want more depth on a promising hit.

## Step 3: Expand strong hits via `linked_quotes` — this is the actual "more data" lever

Ei's own `processor.ts:generateDocument()` doesn't widen its search limit to
get more context — it does a graph walk: take the primary hits, pull the
quotes linked to each (via `human_quote_getForDataItem`), and follow those
quotes' `data_item_ids` to reach *secondary* entities that weren't direct
search hits but are connected through a shared quote. Reproduce this by
hand:

1. For every strong primary hit (topic or person), run `ei --id <id>` and
   read its `linked_quotes` array.
2. Each quote in that array has (or, via a follow-up `ei --id <quote-id>`,
   exposes) `data_item_ids` — the other facts/topics/people that quote is
   attached to. Any id you haven't already collected is a candidate for a
   secondary lookup: `ei --id <that-id>`.
3. Keep walking outward from genuinely relevant secondary hits, one hop at
   a time. Stop when a hop stops surfacing anything new or relevant — that's
   the natural termination condition, not an arbitrary cap.

This is precisely why there's no "top 20" number anywhere in this skill:
the graph walk self-limits to what's actually connected, and self-filtering
(next step) prunes what isn't worth including even if it's connected.

## Step 4: Self-filter at every layer, not just at the end

A facet search or a graph-walk hop can surface something real but
irrelevant to *this* document — a topic Ei ranks highly because it comes up
often in conversation, not because it belongs in a runbook. After every
search and every expansion hop, ask: would this document's actual reader
need this? Discard what doesn't clear that bar rather than including
everything you found because it was findable. This mirrors the contract
test `ei-rewrite` applies to Person/Topic records — the same discipline,
aimed at inclusion decisions instead of redistribution decisions.

## A note on tooling

If your harness exposes `find_memory`/`fetch_memory`/`fetch_message` as
direct tool calls (rather than shelling out to `ei`), those hit the
identical underlying search/lookup code — either is fine. What matters is
running the facet + multi-phrasing + graph-walk + self-filter sequence, not
which interface executes it.

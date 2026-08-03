# reference: the `ei` CLI, as used by this skill

This skill assumes you already know Ei's read surface from `ei-search`
(`skills/ei-search/SKILL.md`) — read that first if you haven't. This file
only covers what's specific to generating a document.

## Confirm reachability first

`ei --help` (or `bunx ei-tui --help` if `ei` isn't on PATH). If neither
works, stop — don't start recon or drafting. The live `--help` output is
the source of truth if it disagrees with anything here or in `ei-search`.

## There is no `ei generate` command

Ei's write path (`ei create/update/remove`, plus the quote-only
`ei create/fix/relink/remove quote`) supports
`fact | topic | person | quote | persona` only — no document/message type.
This skill never attempts to write a generated document back into Ei; the
only CLI verbs it ever uses are the read ones `ei-search` already
documents: `ei "query"`, `ei <type> "query"`, `--recent`, `--persona`,
`--source`, `--id`.

## The one command that matters most for this skill: `ei --id <id>`

`references/recon.md`'s graph-walk step depends entirely on the
`linked_quotes` array that `ei --id <id>` returns for facts, topics, and
people — it's the reverse index of every quote attached to that entity, and
those quotes' `data_item_ids` are how you find secondary entities a facet
search alone wouldn't surface. If you're skipping `ei --id` on your strong
primary hits, you're skipping the expansion step, not just being efficient.

## `ei facts` is about the Ei user only, never a subject

Facts are a small, fixed, seeded list of biographical fields (name,
birthday, employer, field of study, and the like — see the CLI's own
`ei facts` output for the live list) filled in once by extraction and then
treated as settled; the human can also add arbitrary custom facts.
Extraction only ever targets the Ei user — there is no per-third-party
fact record. So `ei facts "<subject>"` returns the **Ei user's**
demographic data every time, filtered by the query string, regardless of
what subject you pass it. If your subject is anyone other than the Ei
user, this command silently returns the wrong person's information with
no warning that it's mismatched — use `ei people "<subject>"` /
`ei --id <id>` to get that person's own `Person` record instead, and treat
anything you need about them as attributable quotes or corroborated
evidence, not `ei facts`.

## Enumerating the whole fixed fact set: `ei facts -n 30`, no query

`ei facts "<subject>"` — even pointed correctly at the Ei user, not a
third party — still embeds whatever query string you pass and returns
only the top matches above the similarity floor. Pass the user's own
name and you can get Full Name/Nickname back while Current Employer,
Current Job Title, and Years of Experience rank below the floor and
silently don't come back at all.

Passing **no query** avoids this. `ei facts -n 30` (no query string,
`-n` raised past the fixed set's size) resolves to recency mode
automatically — the CLI's own arg parsing treats an empty query the same
as `--recent` — which returns every fact sorted by recency instead of
filtering by similarity to a query. Since Facts are a small, fixed set
(the built-ins plus whatever custom facts the user has added), `-n 30`
enumerates the whole thing. This is not the broad-search-limit
workaround this skill's own guardrails warn against elsewhere — that
guidance is about not substituting a bigger `-n` for real faceting on a
semantic search; this is a small, fixed, non-semantic record set where
"return all of it" is the actually-correct query, not a workaround for a
lazy one. If you want a narrower pull instead, query specific field
vocabulary ("current employer", "years of experience") — never the
subject's name.

## Everything else

Follows `ei-search` exactly — output shapes, the two id formats
(entity id vs. fully-qualified message id), and the `--persona`/`--source`
narrowing caveats all apply unchanged here.

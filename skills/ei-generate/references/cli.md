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

## Everything else

Follows `ei-search` exactly — output shapes, the two id formats
(entity id vs. fully-qualified message id), and the `--persona`/`--source`
narrowing caveats all apply unchanged here.

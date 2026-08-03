# Historical Documents

Design artifacts from before Ei had a durable documentation convention (`CONTRACTS.md`,
`docs/adr/`). Preserved for what they reveal about how the system's thinking evolved, not as
current specification — nothing in this folder describes how Ei works today, and none of it should
be cited as a source of truth. Where a document here shows its age, that's the point: it's a record
of assumptions that later got proven wrong, replaced, or superseded, which is often more useful to
a future reader than the eventual "clean" version alone.

## Contents

| File | What it is |
|---|---|
| `original_web_prd.md` | The brain-dump PRD written for the pivot away from the original Blessed-based TUI toward the web frontend + Processor/StateManager/QueueProcessor architecture. Predates the "V1.x.x" release-numbering scheme entirely — its "V1" means "the thing after the Blessed prototype," a naming collision worth knowing about before assuming it describes any current release line. |
| `original_web_working_backward.md` | The companion UX pass to the PRD above — a wireframe-in-prose walkthrough of the same web pivot, written from the user's side rather than the system's. Predates Rooms, the onboarding wizard, and most of what shipped since. |
| `original_web_dependency_graph.md` | A dated (2026-01-27) implementation-status snapshot taken partway through the web pivot. Nearly everything marked "NOT STARTED" in it has long since shipped, in a different shape than planned. Useful as a time capsule of what "early" looked like, not as a status board. |
| `original_web_ticket_map.csv` | The matching 80-ticket backlog from the same period, before GitHub Issues became the actual tracker. |
| `original_tui_map.md` | An event/command mapping for the TUI, written independently and not tied to the two web-pivot documents above. Some of it (the `Ei_Interface` event names) still matches current source closely; most of the command/slash-command surface predates Rooms and the onboarding wizard and should be re-verified against `CONTRACTS.md` and `tui/` before being trusted. |

## Why these survived a cleanup pass

All five were originally in `.sisyphus/docs/` — a folder that shouldn't have existed at all
(`.sisyphus/` is gitignored and meant for ephemeral agent workspace, not durable project history).
They were kept, moved here, and renamed rather than deleted specifically because a past instance of
this project's coding agent and Flare used the web-pivot pair to stop talking past each other, and
that kind of resolved-confusion history is exactly what's worth having on hand the next time
something looks the same.

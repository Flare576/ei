# reference: default facet playbooks by document type

Frontier models already know what a runbook or an onboarding doc
conventionally contains — structure, tone, sections. **Nothing in this file
is generic writing advice.** Each entry is an Ei-specific facet list: what
to search for, in Ei's data specifically, when someone asks for this kind of
document. This file is meant to grow — when you work out a good facet list
for a document type that isn't here yet, add it.

Every entry assumes you'll still run the full `references/recon.md`
procedure per facet (multi-phrasing, linked-quotes expansion, self-filter).
The facets below are the starting search targets, not a replacement for that
process.

---

## Runbook

**Validation note**: runbooks are almost always written *for someone else*
(a rotating on-call, a new team member, a handoff) — treat the audience
question in `references/validation.md` as effectively always relevant here,
even if the user doesn't flag it themselves.

**Facets to search:**
- Engagement/project scope and current state — `ei topics "<subject> scope"`,
  `ei topics --recent "<subject>"` for what's currently active vs. historical.
- Key contacts and roles, both client-side and internal — `ei people
  "<subject>"`; check each hit's `relationship` field for who's actually
  operationally relevant vs. a passing mention.
- Recurring issues and their resolutions — search for incident/bug/outage
  language tied to the subject; quotes are often where the actual fix
  narrative lives, more than topic descriptions.
- Access, environment, and technical setup details — if the subject has a
  `category: "Technical"` topic, read it fully; these are allowed to be
  dense (see the Technical exemption in `ei-rewrite`'s `contracts.md`) and
  often contain exactly the operational detail a runbook needs.
- Escalation path — who to contact when something breaks, and in what
  order; this usually lives in a Person's `description`, not a Topic.

---

## Onboarding Doc

**Validation note**: same as above — the audience question matters more
here than for most doc types. "Onboarding doc for R&P" for the user's own
future reference reads very differently than one meant to actually hand to
a new hire.

**Facets to search:**
- People / team structure — who the user works with regularly, their roles;
  `ei people --source <relevant prefix>` if the subject correlates with a
  specific source (e.g. Slack) can surface names a plain-text search misses.
- Tools and processes — the recurring software/workflow topics tied to the
  organization (project tracking, time tracking, deployment process).
- Terminology and jargon — organization-specific terms that show up
  repeatedly across topics/quotes but wouldn't mean anything to an outsider.
- Recurring rituals — standups, sprint planning, timesheet/PTO process,
  career-development checkpoints — anything cadence-based rather than
  one-off.
- Escalation / who-to-ask — distinct from "key contacts" above in that this
  is specifically about *what to do when you don't know something*, not who
  owns what.

---

## Anything else

No seeded entry yet. Derive facets yourself: ask what a reader of this
document type would need to know, broken into 3-6 categories, then run
`references/recon.md`'s procedure per facet. If this document type comes up
again, add what you learned here as a new entry rather than re-deriving it
from scratch next time.

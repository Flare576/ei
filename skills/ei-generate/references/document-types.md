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

## Profile / Job Description

**Which one**: this label covers three different deliverables — ask
which before you search anything, if it isn't already obvious from the
request. (a) A professional profile or self-summary — what this person
brings, in their own right. (b) A description of an existing role — what
this seat actually does, day to day. (c) A hiring-facing role
specification — what you'd require of someone filling this seat. The
answer changes audience and tense, not structure: all three draw on the
same facet list below and end in the same canonical `Evidence and gaps`
section (`SKILL.md` step 5, Synthesize) — this is one clarifying
question, not three separate templates.

**Validation note**: this is the one document type where the *subject*
is often the Ei user themselves, not a third party — which changes what
the names/audience gate in `references/validation.md` needs to ask.
- **Subject is the Ei user**: there's no third-party identifier in being
  yourself, so the generic gate's own trigger doesn't fire on the
  subject — but ask the audience question anyway (who actually sees
  this: a recruiter, a client, just the user's own files?), and ask one
  thing the generic gate doesn't cover: which of the user's *own*
  identifiers — phone, birth date, location, personal or employer email,
  client/engagement affiliation — are okay to include. Default to
  leaving all of them out unless the user names one they want in;
  nothing about "profile" or "job description" as a document type
  implies a birth date belongs in it just because `ei facts` has one on
  file.
- **Subject is anyone else**: the third-party gate in
  `references/validation.md` applies exactly as written — no changes
  here.

Either way, the dominant remaining risk is the **persona-contamination
gate** (`references/contamination.md`): personality, working-style, and
"what makes them good at this" claims are the majority of this
document's content, and that's exactly the material AI personas in the
same knowledge base are most likely to have leaked into. Run that gate on
every trait claim, not just once at the top.

**Facets to search:**
- Identity and structural facts — **only when the subject is the Ei
  user**: run `ei facts -n 30` with **no query**. The fixed fact set is
  small enough that omitting the query enumerates all of it — built-ins
  plus anything custom the user added — instead of filtering by
  similarity; see `references/cli.md` for why this differs from a normal
  search. Never pass the subject's name as the query: `ei facts
  "<name>"` embeds the name and can rank Full Name/Nickname highest
  while Current Employer, Current Job Title, and Years of Experience
  fall below the similarity floor and silently don't come back at all.
  If you want a narrower pull instead of the full enumeration, query
  specific field vocabulary ("current employer", "years of experience")
  — never the subject's name. "Certifications" is not one of Ei's
  seeded fact fields; only expect it back if the user has separately
  added it as a custom fact, and don't promise it as part of this
  facet's return set by default. When the subject is a third party,
  skip `ei facts` entirely and pull their `Person` record instead
  (`ei people "<subject>"` / `ei --id <id>`); treat anything you need
  about their background as attributable quotes or independently
  corroborated evidence, not a Fact.
- Career and project history — concrete engagements with dates and
  outcomes. Prefer topics with an event-shaped description (something
  that happened, with specifics) over topics whose content is mostly
  character adjectives.
- Concrete contributions with an independent witness — hiring/interview
  involvement, mentorship or counselor records, official program logs
  (anything with a real audit trail: a named colleague's quote, a
  structured entry in a company-wide channel/system used for other
  people too). These corroborate far more cheaply than personality claims
  because they're procedural, not narrative.
- Working style and culture signals — the highest-value and
  highest-risk facet. Every claim here needs the two-independent-source
  check in `references/contamination.md` before it's usable. Direct
  quotes from the subject, repeated across different threads/dates, are
  usually the strongest available source when a third-party human
  witness isn't on record.
- Public/external artifacts — published writing under the subject's
  byline, open-source repos, commit history, talks. These double as
  independent corroboration for self-reported facts and skills, and as a
  primary source for tone/voice in their own words. This is an external
  lookup: gated like every other one by the guardrail above (ask before
  sending anything Ei-derived outside Ei, whatever web-search or
  repo-browsing capability your harness provides). If the user declines,
  or the harness has no such capability at all, don't skip the claim
  silently and don't treat it as corroborated anyway — keep it labeled
  self-reported/unverified and record the missing corroboration in
  `Evidence and gaps`.
- End with the canonical `Evidence and gaps` section (`SKILL.md` step 5,
  Synthesize). This type's own dimension: self-reported vs.
  independently-corroborated. Never let a single-sourced claim read the
  same as a two-sourced one; the reader (a hiring manager, a recruiter,
  the subject themselves reviewing a draft) needs to know which is
  which.

---

## RoboBrain Learning Note

**Validation note**: mirror the Runbook entry's own pattern instead of an
"always ask" rule that fights `references/validation.md`'s exemption for
a clean technical topic with no named people or companies attached.
RoboBrain's audience is external/organizational *by type* — it's a
separate organizational knowledge system, not a private handoff to a
teammate — so say that once, the same way the Runbook entry treats its
audience question as effectively always relevant. Don't force the
names/client questions when nothing identifying has actually surfaced;
ask them only if a name, client, or company identifier turns up during
recon (a workaround tied to one client's system, a colleague credited
with a fix) — then apply the answer to the vault-routing decision below,
not just to the note's prose.

Before drafting, ask two things, not one — and get both in the human's
own words rather than guessing: (1) which vault this note is destined
for, and (2) how broadly the learning applies inside that vault.
RoboBrain scopes one vault per **client engagement** (set up via its own
`setup_vault`, discoverable via `list_vaults`) — the real choice is not
"client/project Cortex vs. an org-wide vault," it's *which* client's
vault, full stop; there is no organization-wide vault spanning clients.
Within the selected client's vault, the second question is whether this
learning belongs in that client's canonical, engagement-wide catalog, or
is scoped to one specific project inside that engagement. If either
answer is unknown, mark it unresolved rather than guessing or reusing
whatever vault came up last time — this skill has no notion of a
default, and won't as Ei adoption grows beyond a single install with a
single answer. Record both answers in the note's own text (a short
"Destination:" line is enough) so the human placing the file doesn't
have to reconstruct the routing decision from memory of this
conversation.

Bind every candidate learning to that selected engagement, not to
whatever the Ei graph happens to surface — a facet search runs against
the whole graph, not just the selected client's slice of it. Before a
candidate goes in the note, check that its source/topic provenance
actually traces back to the selected engagement. Redacting a client's
name doesn't make their proprietary terminology, architecture
workaround, or workflow safe to write into a *different* client's vault
— the content itself is the leak, not just the label, so cross-client
material is excluded outright, not just anonymized. If a candidate's
provenance is ambiguous or genuinely spans more than one engagement, ask
the user before including it rather than including it and flagging the
ambiguity afterward.

Exclude personal and emotional content by default. RoboBrain's canon is
professional/organizational knowledge (patterns, terminology, process
learnings) — not the subject's frustrations, feelings, or private life.
If recon surfaces material like that, leave it out unless the user
explicitly asks for it, and flag that inclusion as unusual for this type
if they do.

**Input shape — verified against RoboBrain's own ingestion, not
guessed**: its text-extractor reads raw markdown/text directly, so there
is no required heading template to hit. There is also no frontmatter
contract for an ordinary input note — RoboBrain's own YAML frontmatter
usage is specific to its `Cortex.md` and project-charter files, never to
source notes fed into it. **This note should not carry YAML frontmatter**
— write it as plain markdown prose with normal headings, not a metadata
block imitating RoboBrain's own internal files. A one-line provenance
note near the top (who/when/what session this came from) is good
practice for the human reader, but it isn't something RoboBrain's schema
requires — it has no required author or date-range field of its own.

**Concept taxonomy** — RoboBrain's concept types are a real, closed
20-value enum (`canonical_concept.schema.json`): `organization,
business_unit, team, role, stakeholder, process, task, event, routine,
system, integration, artifact, business_object, rule_or_constraint,
goal, metric, pain_point, acronym, domain_term, status_or_state`. Write
toward the types each facet below actually maps to, not a guess:
- Technical patterns and gotchas — maps to `process`, `rule_or_constraint`,
  or `task`, depending on whether it's a repeatable practice, a hard
  constraint, or a one-off unit of work.
- Terminology and domain language — maps to `acronym` or `domain_term`.
- Recurring pain points — maps to `pain_point`.
- Process and workflow learnings — maps to `process` or `routine`.

RoboBrain also runs its own ambiguity-review phase before a claim reaches
its canon, which is real and does add a layer of human review beyond
this skill. Be honest about its limits, though: that same pipeline
exposes an operator-controlled bulk auto-accept path, so it isn't an
absolute guarantee that a human reads every claim this note contains
before ingestion. Treat this skill's own recon and inclusion discipline
as load-bearing on its own merits — not as a backstop that RoboBrain's
review will always catch what you got wrong.

**This skill only produces the file.** It never calls RoboBrain's own
tooling — not its MCP server, not `write_to_vault`, not any pipeline
command. (For context: if the human uses RoboBrain's own MCP tooling
themselves, that's typically `write_to_vault`, writing into `00 -
raw/intake-documents` or `00 - raw/discovery-transcripts` — this skill
never calls it.) The human places the file into RoboBrain's own intake
process, or hands it to whoever owns the destination vault, and runs
RoboBrain's own ingestion themselves. When you confirm placement in step
6, restate both the vault/routing decision recorded above and that the
human is the one who moves the file into RoboBrain — that hand-off is
the human-review gate this document type exists to preserve, and this
skill's own recon discipline (previous paragraph) is why it still
matters even with that gate in place.

**Facets to search:**
- Technical patterns and gotchas — recurring solutions, workarounds, "the
  thing that took three days to figure out." Keep them phrased as
  generalizable practice, not a one-off incident retelling.
- Terminology and domain language — project- or team-specific acronyms
  and jargon coined or adopted during the work, the kind of thing a
  newcomer wouldn't know without being told.
- Recurring pain points and their resolutions — search the same
  incident/bug/friction language the Runbook facet does, but keep only
  the generalizable lesson; drop the specific incident's private details
  (who was on call, internal drama, anything emotional).
- Process and workflow learnings — tooling or sequencing decisions and
  the reasoning behind them; distinguish an established practice from a
  one-off call that hasn't been repeated (see the session-provenance
  method below — don't guess this from how often a search happened to
  match).
- End with the canonical `Evidence and gaps` section (`SKILL.md` step 5,
  Synthesize). This type's own dimension: single-session observation vs.
  a pattern confirmed across multiple sessions. Determine that from two
  things — distinct `sources[]` entries on the entity's own `ei --id
  <id>` record (each is a namespaced session identifier; more than one
  distinct entry means more than one session touched this), and distinct
  `timestamp` values across its `linked_quotes[]` (different dates mean
  the same claim surfaced more than once). If a linked quote's own
  `message_id` comes back null on a follow-up `ei --id <quote-id>` — a
  manually-entered quote with no session backing — or a source is
  otherwise unavailable to inspect, treat that quote's session
  provenance as unknown rather than counting it toward either single- or
  multi-session.

---

## Period Performance Review

**When this is the right type**: a status/accomplishments report scoped
to a date range — not a role, and not the person's profile in general.
"Make a job description for all the shit I do" is Profile / Job
Description; it's about the role. "I need an end-of-year accomplishments
report" or "what did I do this week" is this type; it's about a period.
The subject is always the Ei user — there's no third-party version of
this document type.

**Resolve the date range before recon starts** (this is step 1's job,
not step 3's): accept either an explicit range ("March 1 through March
31") or a natural-language period ("this week," "Q2," "since May"), but
convert the natural-language version to explicit calendar dates yourself
before searching anything. "This week" means something different
depending on when it's asked; the recon technique below filters on real
timestamps, not on the phrase.

Two things the date range needs before it's actually a predicate, not
just a phrase: a **time zone** (ask the user's if you don't already know
it — don't assume UTC or the machine's local zone silently) and an
**explicit end-boundary rule** — treat the range as half-open, midnight
start-of-day through midnight start of the day *after* the range ends,
so "March 1 through March 31" doesn't silently drop or duplicate
late-day work on either boundary. State the resolved zone and interval
in the document (or its provenance note) so a reader can tell exactly
what was and wasn't in scope.

**Recon technique — there is no native date-range flag yet.** `ei`
doesn't have a `--since`/`--until` style filter (tracked in
`github.com/Flare576/ei/issues/98` — this section exists because of that
gap and can shrink once #98 ships). Until then, this is the real, tested
workaround — and it has the same silent-truncation risk as any other
fixed `-n`, so treat "returned exactly the limit" as incomplete, not as
"got everything":
- `ei quotes --recent -n 100000` (a deliberately large `-n`) returns the
  full quote corpus rather than a meaningfully similarity-filtered
  subset, *up to that limit* — every quote carries a real `timestamp`,
  so filter to the requested range yourself on that field. Don't trust
  `-n` or a similarity score to have already scoped it; they haven't.
  If the call returns exactly 100000 rows, you may be missing older
  in-range quotes — raise `-n` and re-run until a call returns fewer
  rows than requested, or tell the user the range is too large to
  reconstruct exhaustively this way and ask them to narrow it. A report
  that silently omits older evidence while reading as complete is worse
  than one that says plainly what it couldn't confirm.
- `ei facts --recent -n <large>` behaves the same way, but its results
  carry `validated_date` — when the fact was last confirmed, not when it
  was mentioned — so it's not useful for scoping a period on its own.
- Topics and people don't expose a date on their flat search results at
  all (only their full `ei --id <id>` record does, and pulling that per
  candidate topic is the expensive way to do this). Instead, derive
  topic/person involvement for the period from the date-bounded quotes
  you already pulled: walk each in-range quote's `linked_items` to see
  which topics and people it's attached to. This is `references/recon.md`'s
  own `linked_quotes` graph-walk, run in the direction quotes →
  topics/people instead of the usual topics/people → quotes — cheap,
  because you already paid for the date filter on the quotes themselves.

**Validation note**: reuse `references/validation.md`'s existing gate
as-is — no new mechanism needed. The subject is always the Ei user, but
the audience question still matters: a private weekly self-note and an
end-of-year report handed to a manager have very different disclosure
needs for any coworker or client names the in-range quotes turn up.

**Facets to search:**
- In-range quotes, filtered directly on `timestamp` — the primary source
  for this document type; see the recon technique above.
- Topics and people active in the period, derived from those quotes'
  `linked_items` rather than searched independently, for the reason
  above.
- Concrete outcomes and deliverables — shipped work, decisions made,
  problems resolved — weighted toward what the in-range quotes describe
  as done, not just discussed.
- End with the canonical `Evidence and gaps` section (`SKILL.md` step 5,
  Synthesize) for anything mentioned once in the period with no
  independent confirmation. This type doesn't need its own dimension
  beyond the canonical one.

---

## Anything else

No seeded entry yet. Derive facets yourself: ask what a reader of this
document type would need to know, broken into 3-6 categories, then run
`references/recon.md`'s procedure per facet. If this document type comes up
again, add what you learned here as a new entry rather than re-deriving it
from scratch next time.

---
name: ei-rewrite
description: >
  Use when a Topic or Person record in Ei has grown bloated with content that
  doesn't belong there — a coworker's Person record accreted project/ticket
  details, or a Topic became a catch-all for several unrelated subjects — and
  the user wants it slimmed down and the extra content redistributed, by hand,
  right now (rather than waiting for the automatic Rewrite ceremony). Triggers:
  "this record is too long", "split out the project stuff from X", "slim down
  X's description", "redistribute X's content", "rewrite this person/topic",
  "do a manual rewrite", "clean up Abinet's record", "run the rewrite by hand".
  This is NOT for fixing wrong data (misattribution, duplicates, bad merges —
  that's `ei-curate`) — it's for correctly-attributed content that lives in
  the wrong-shaped record.
---

# Ei Rewrite — manually slimming a bloated Topic or Person record

You are helping someone do, by hand, what Ei's automatic **Rewrite ceremony**
does on a schedule: a Topic or Person record has grown into a catch-all,
mixing its core subject with content that belongs somewhere else. Your job is
to identify what doesn't belong, find or create the right home for it, and
leave the original record slim and on-topic — without losing any real
information and without inventing duplicate records Ei already has.

> **Read this whole file first.** Like `ei-curate`, this skill is rarely
> invoked and is written to be complete, not short.

---

## This is not `ei-curate`'s job — know the difference

`ei-curate` fixes **wrong data**: a record misattributes who said something,
two people got merged into one, a fact is stale. The judgment call there is
*"what actually happened?"* — evidence and provenance.

This skill fixes **right data in the wrong container**: the record correctly
describes its one subject, but the subject's content sprawled past what that
record type is *for*. The judgment call here is *"does this sentence belong
under this record's contract, and if not, where does it belong instead?"*
There is no misattribution to investigate, no provenance to check, no
disambiguation step. If you find yourself asking "did this really happen to
this person," you've wandered into `ei-curate`'s territory — stop and use
that skill instead.

If a "rewrite" task turns out to actually be a bad merge (the record is
describing *two different people*, not one person plus off-topic content),
switch to `ei-curate`'s Recipe A. Don't force it through this skill.

---

## Why this skill exists — and its central risk

Ei already has an automated **Rewrite ceremony** (`src/core/handlers/rewrite.ts`,
`src/prompts/ceremony/people-rewrite.ts`, `topic-rewrite.ts`) that does this
job on a schedule, LLM-driven — though not with full symmetry: the automatic
Person-rewrite phase only ever redistributes extracted content into Topics
(it has no path to spin off a new Person), while the automatic Topic-rewrite
phase can produce either. This skill's manual workflow deliberately extends
that — see the Person-creation policy in step 4 below — so don't read
"mirrors the ceremony" as strict parity. This skill exists so a human +
coding agent can do the job **on demand**, for a specific record, right
now — for the same reason `ei-curate` exists alongside Ei's automatic
person-matching: sometimes you don't want to wait, or you want a human in
the loop on a judgment call.

**But read this carefully, because it names the exact way this skill fails if
you're not disciplined:**

The Rewrite ceremony's LLM step has **only Ei's own tools** — `find_memory` /
`searchHumanData` — and nothing else. It cannot grep a codebase, cannot search
the web, cannot lean on anything it "already knows" about the subject from
training or from earlier in a conversation. Every candidate home for
redistributed content is found by *actually querying Ei's own dataset*,
because that's the only query surface it has. This constraint is a **feature**:
it structurally prevents the ceremony from inventing a duplicate Topic or
Person that already exists under different wording, because it's forced to
check first.

You — a coding-harness agent — do not have that constraint. You have grep, web
search, general knowledge, and (often) memory of a conversation where the
subject already came up. **That is a supplementary superpower everywhere
else, and a liability here.** It is very easy to look at "Successfully
launched Critique Crews and moved it from concept to prototype" in a Person
record, recognize the project from context, and just... write a new Topic for
it — skipping the one step that actually matters: *checking whether Ei
already has a record for it, possibly under a different name or phrasing.*
Skip that step and you fragment the user's memory instead of organizing it —
the opposite of the point.

**The rule this skill exists to enforce:** for every piece of content you
plan to redistribute, you search Ei's own data for an existing home *before*
you decide to create anything new — every time, no exceptions, using Ei's
actual search, not your assumptions. → **Read `references/recon.md` now.**
It is the most important reference file in this skill.

---

## Mental model: two record contracts

Both Topic and Person records have a contract for what belongs in them. A
"rewrite" is the act of enforcing that contract on a record that's drifted
past it. → **Read `references/contracts.md`** before scanning any record —
it has the exact test for each type, with keep/remove examples pulled from
the ceremony's own prompts.

| Type | Contract in one line |
|---|---|
| **Person** | A relationship profile: who they are, their role, their character, how the user works with them. NOT a project log, ticket tracker, or biography. |
| **Topic** | One cohesive subject. NOT a catch-all for everything ever discussed near it. (Technical-category topics get more room — see `references/contracts.md`.) |

---

## Picking a target record

Most of the time the user names one ("abinet's record is huge"). If instead
you're asked to *find* the worst offenders yourself, be honest about a real
gap: **the `ei` CLI has no "find largest records" or "find records overdue
for review" query.** The ceremony's own candidate selection works directly
off `state.json` (topics/people where `rewrite_length_floor` is unset, or the
description has grown past it) — there is no CLI-surfaced equivalent. If you
have filesystem access to `$EI_DATA_PATH/state.json`, you can replicate that
ranking directly (sort `human.topics`/`human.people` by `description.length`,
prioritizing records with no `rewrite_length_floor`); if you don't, say so and
ask the user to name a record instead of guessing.

---

## The workflow

### 0. Confirm the CLI is reachable
Run `ei --help` (or `bunx ei-tui --help` if `ei` isn't on PATH — same
fallback `ei-curate`/`ei-persona`/`ei-search`/`ei-reflect` all use). **The
live `--help` output is the source of truth** for the exact command surface;
this skill's examples are a guide, but the CLI evolves. If neither command
works, stop — do not read, plan, or write anything yet; tell the user the
CLI isn't reachable. If your harness also exposes `ei_search`/`ei_lookup` as
direct tool calls, those satisfy recon/read steps where available (see
`references/recon.md`), but they do not confirm the *write* path
(`create`/`update`) exists — this preflight is specifically about the `ei`
CLI you'll use for every write in step 7.

### 1. Read the full record
`ei --id <id>` (or `ei topic|person "<name>"` to find it first). Read
everything — `name`, `description`, `sentiment`, `category`/`relationship`,
`persona_groups`, `interested_personas`, and (for a Person) `linked_quotes`.

### 2. Scan — apply the contract test
Go through the description and mark every sentence/clause against the
relevant contract in `references/contracts.md`. For each piece that fails the
test, write down a short, **specific, search-friendly phrase** describing it
(3-8 words — this phrase is what you'll search with next, so make it a good
query, not a vague label). This mirrors exactly what the ceremony's Phase 1
scan produces.

If nothing fails the test, stop here and tell the user the record is
already clean — don't force a split.

### 3. Recon — find a home for each subject (mandatory, no shortcuts)
For every subject phrase from step 2: search Ei's own data before deciding
anything. → **`references/recon.md`** has the exact search discipline —
follow it in full, including the "don't trust what you already inferred"
rule and the multi-phrasing requirement.

### 4. Plan the redistribution
For each subject: either it genuinely overlaps with something recon found
(fold the content in) or it doesn't (create new). Also plan the slimmed
version of the original record. → **`references/mechanics.md`** has the exact
bookkeeping — which fields you can still set on each write (a much shorter
list than before: `rewrite_length_floor` and `persona_groups`/
`interested_personas` all left the write contract entirely, ADR-031) and the
required JSON shape for every record you touch or create.

**Person-creation policy (a deliberate extension beyond the automatic
ceremony):** the automatic Person-rewrite phase never spins off a new
Person — it only ever redistributes into Topics. This skill allows it, but
only when both hold: (a) the extracted content genuinely identifies a real,
distinct *person* rather than a project/subject, and (b) recon
(`references/recon.md`) found no existing Person to fold it into. Otherwise,
default to a Topic — that's the ceremony-proven path. When you do create a
new Person under this policy, say so explicitly when confirming with the
user (step 5) rather than presenting it as routine.

### 5. Confirm with the user
Plain language, no raw JSON, before any write. → `references/talking-to-the-user.md`.

### 6. Refresh — immediately before writing
Time passed between step 1's read and this point: recon, planning, and
getting the user's yes are none of them instant, and the record you read
first may no longer be current — another correction, an extraction, or a
ceremony pass could have touched it or a fold-in target in the meantime.
**Immediately before you write anything**, re-read every record you're
about to update — every fold-in target and the original — via `ei --id`.
**Compare the fresh read against your step 1 read of that same record, on the field(s) your
patch will actually send — for this skill, that's `description` and, occasionally,
`category`/`relationship`.** If any of THOSE fields differ, **stop**: don't write. Show the
user what changed, redo recon or planning if the change affects it, and get fresh approval.
A field your patch never mentions — `sentiment`, `identifiers`, `linked_quotes`,
`persona_groups`, `interested_personas`, or anything else — can drift freely between the two
reads with no consequence: `update` is a merge patch now (ADR-029), so a field you don't
send is left exactly as it is on the server, whatever it says by the time your write lands.
When you do write, build the payload from **this fresh read's value(s)** for the field(s)
you're changing plus your approved edit — never from the step 1 read.

### 7. Write
Order matters: create/update the redistribution targets first, **then** slim
the original last (so if anything fails partway, the original record is
never left half-edited with its content nowhere else). → `references/cli.md`
for the exact commands: `create` is still a full-body write; `update` is a merge patch —
send only the field(s) you're changing (`description`, and whatever else your plan
actually touches), not the whole record.

**After each individual create/update, re-read that record before moving to
the next target.** If a write fails, or the re-read doesn't match what you
sent, **stop the entire sequence immediately** — do not proceed to the
remaining targets, and never touch the original record. Report exactly
which targets landed successfully and which didn't, then repair and
re-confirm the plan before resuming. The targets-first/original-last
ordering only protects the original if you actually stop on a target
failure instead of continuing through a prebuilt batch of writes.

### 8. Verify & report
Re-read every record you touched or created (`ei --id`). Confirm: the
original is slim and on-contract, every redistributed subject landed
somewhere (existing or new), and nothing was invented that Ei already had
under another name.
Tell the user in plain language what moved where.

---

## Guardrails (non-negotiable)

- **Recon before creation, every time.** Creating a new Topic/Person without
  first searching Ei for an existing match is the one mistake this skill
  exists to prevent. → `references/recon.md`.
- **`update` is a merge patch.** Read for context, send only the field(s)
  actually changing (usually just `description`).
- **Lose no relationship/subject data.** Slimming means *redistributing*, not
  discarding — the only content that's allowed to simply vanish is genuine
  throwaway trivia with no standalone value (see `references/contracts.md`).
- **Weak matches stay separate.** A search hit with a similar name but
  different meaning is not a match — create a new record rather than
  contaminating an unrelated one. (This is exactly the failure mode
  `ei-curate` cleans up after — don't cause a fresh one here.)
- **`rewrite_length_floor` and `persona_groups`/`interested_personas` are no
  longer yours to set.** Both left the write contract entirely (ADR-031) —
  don't try, and don't promise the old union/recompute behavior still
  happens. → `references/mechanics.md` for what actually happens instead and
  when to flag the resulting visibility gap to the user.
- **There is no undo.** Same as `ei-curate` — writes are append-only
  corrections; a mistake is fixed with another write, and `remove` discards
  a record's id and quote links for good. Confirm before writing.
- **STOP and ask when:** a subject is genuinely ambiguous between two
  existing candidate homes, the record turns out to be a bad-merge situation
  (→ hand off to `ei-curate`), or you're not confident a piece of content
  clears the "worth a standalone record" bar.

---

## Load references on demand

| When you are… | Read |
|---|---|
| deciding what belongs vs. doesn't in a Person/Topic | `references/contracts.md` |
| searching Ei for a home for extracted content | `references/recon.md` |
| computing floors, unions, and record shapes before writing | `references/mechanics.md` |
| about to run any `ei` read/write command | `references/cli.md` |
| planning with, or reporting to, a non-technical user | `references/talking-to-the-user.md` |

When in doubt, search more, write less, and ask the user.

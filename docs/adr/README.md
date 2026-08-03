# Architecture Decision Records

Durable record of **why** Ei works the way it does. Code shows what; ADRs show why, and what we rejected.

This exists because the alternative was observed directly: *"I really wish we had been writing ADRs this whole time, because I can't remember why we thought that was necessary."*

## Index

| ADR | Title | Status | Date | Kind |
|---|---|---|---|---|
| [001](ADR-001-persona-agent-separation.md) | Persona Identity and Agent Operating Contract Are Separate Records | Accepted | 2026-08-01 | Current |
| [002](ADR-002-ei-write-boundary.md) | Ei Writes Only What It Owns | Accepted | 2026-08-01 | Current |
| [003](ADR-003-personlog-clear-timing.md) | PersonLog Clears at Critic Completion, Not at User Decision | Accepted | 2026-08-01 | Current |
| [004](ADR-004-exponential-exposure-decay.md) | Exposure Decays Exponentially at K=0.1, Replacing a Logistic Curve | Accepted | 2026-08-01 | Backfill |
| [005](ADR-005-generic-user-references.md) | Generic User References (GURs) Define Ei's Design Priority | Accepted | 2026-08-01 | Current |
| [006](ADR-006-ei-persona-link-multiplicity.md) | A Person Record and a Persona Link One-to-One | Accepted | 2026-08-01 | Current |
| [007](ADR-007-external-reflection-only.md) | A Persona May Opt Out of the Automatic Reflection Critic | Accepted | 2026-08-01 | Current |
| [008](ADR-008-accepted-write-races.md) | Two Last-Write-Wins Races Are Accepted, Not Fixed | Accepted | 2026-08-01 | Current |
| [009](ADR-009-tui-yaml-loses-to-concurrent-writes.md) | A Stale TUI YAML Edit Loses to a Concurrent Write | Accepted | 2026-08-01 | Current |
| [010](ADR-010-invalid-persona-links-are-reported-not-repaired.md) | Invalid Persona Links Are Reported, Never Repaired Automatically | Accepted | 2026-08-01 | Current |
| [011](ADR-011-quotes-outlive-their-links.md) | A Quote Outlives the Items It Was Linked To | Accepted | 2026-08-02 | Current |
| [012](ADR-012-sunset-with-a-path-forward.md) | Sunset With a Path Forward | Accepted | 2026-08-02 | Current |
| [013](ADR-013-tool-agnostic-skill-language.md) | Skills Name Tool Capabilities, Never Specific Tools | Accepted | 2026-08-03 | Current |

## Conventions

**Location.** `docs/adr/ADR-{NNN}-{slug}.md`. Never in an agent-workspace folder — mixing durable project documentation into ephemeral scratch space is what produced the current "why does X work like Y?" problem.

**Self-contained, always.** An ADR must be complete for a reader who has only this repository. Never
cite a path that does not ship — agent workspace, local planning files, scratch directories. If
something in a working file is load-bearing for the decision, **reproduce its substance in the ADR**;
a reference is not a record. This is not a style preference: these files go out to GitHub and the
workspace does not, so a dangling reference is invisible breakage for every reader who is not the
author. The same rule kills "see the interview" and "per the plan document" — inline the reasoning or
it did not survive.

**Numbering.** Sequential by allocation order, never renumbered. A number is a stable identifier, not a timestamp — an older decision backfilled later gets a higher number. Reference across ADRs by number (`superseded by ADR-014`).

**Template.** `skill://design-review/references/adr-template.md`.

**Status.** `Proposed` → `Accepted` → `Deprecated` / `Superseded by ADR-XXX`. Never edit a superseded ADR's decision; write a new one and link it. The wrong turn is as valuable as the right one.

## Backfilled ADRs

Many decisions predate this directory. Backfilling them is explicitly sanctioned — the absence of a contemporaneous record is a process gap, not a reason to leave the reasoning lost.

**What a backfilled ADR claims to be.** Enough was remembered, at the time of writing, to be worth writing down. It is not an exhaustive reconstruction. If you are about to pivot or change the decision, spend a few minutes in `git log` and `git blame` first — the archaeology is there, and this document did not go looking for it.

Backfilled ADRs carry two extra obligations:

**Kind: Backfill** in the index, and a note that the decision predates the record.

**A `Rationale Provenance` section**, classified against **current source only**:

| Classification | Meaning |
|---|---|
| **STATED** | The "why" exists in current source or docs. Quote it verbatim and cite it. |
| **INFERRED** | Not written, but strongly implied by structure. Say what it was inferred from, and label it. |
| **UNRECORDED** | Not present in current source. **Not the same as lost** — git history almost certainly holds it. We simply have no present reason to dig. |

**Source and git history are different things.** Current source shows what the code is and whatever rationale someone thought to write in a comment. Git history shows the decision chain: what was tried, what replaced it, and when. These ADRs read source. They do not read history, by default, because doing so for every backfill would cost more than it returns.

That is why the third bucket is `UNRECORDED` rather than `UNKNOWN`. `UNKNOWN` implies the reasoning is gone. It is not gone; it is unread.

If someone *does* dig blame for a given decision, record what they found — including "dug, found nothing." That saves the next person the same excavation.

**Never upgrade a weaker classification to a stronger one.** An ADR that launders a guess into documentation is worse than no ADR, because future readers will trust it.

A frequent and useful shape is a *split* classification: the mechanism's purpose is STATED while the exact constant is UNRECORDED. See ADR-004, where the decay curve's rationale is fully documented in a source comment but the specific value `0.1` is not — and where the code has been iterated on heavily enough that blame would likely be informative if the value ever needs revisiting.

## Correcting an ADR

A **published** ADR containing a wrong fact gets corrected in place, with the correction marked visibly — the error and its source are part of the record, because people may have relied on it. This is distinct from superseding, which is for a changed *decision*, not a bad citation.

**Drafting is not history.** Revisions made before an ADR is first committed are just writing. Do not annotate them, and do not date them — an ADR appearing for the first time should simply be correct. The tracks worth leaving are the *decision's* journey: options weighed, alternatives rejected, constraints discovered. Not the author's edit history.

## When to write one

Write an ADR when the decision:
- chose between real alternatives with real trade-offs,
- constrains future options,
- or would be non-obvious — or look like a bug — to someone reading the code later.

That last case is the highest value. ADR-003 exists precisely because the behavior it documents reads as a defect and is not one.

Do **not** write one for obvious choices, existing conventions better captured in `CONTRACTS.md`, or implementation details that are cheap to change. A logging epsilon or a unit conversion is not an architectural decision, even if nobody wrote down why.

## Where decisions come from

Planning interviews are the source material. Decisions surfaced during an interview get recorded here
as they settle — not reconstructed afterward from memory. The ephemeral planning files an interview
produces are deliberately deleted once spent, so anything that must outlive them belongs in an ADR
**before** that happens, written out in full rather than pointed at.

## Backlog

- **Three pre-convention records await migration** into this directory, with numbers assigned at
  migration time: one on integration granularity, one on topic-scan scoring, and one on the exposure
  system. The exposure record's substance is already reproduced in ADR-004's Risks section, so that
  ADR does not depend on the migration happening.
- **Backfill queue**, identified by prior-decision mining and ranked by whether current work touches
  them: the three-mode Person description contract; reflection trigger and threshold gating; the
  reflection critic's null escape hatch; the 3-trait/3-topic health floor; `long_description`
  soul-not-story and its 800 cap; `rewrite_length_floor`'s 750 + 1.1× formula; extraction pre-marking
  and idempotence; quote provenance; MCP-removed-by-default; full-record replacement semantics.
- **Undocumented load-bearing carve-out**: `ceremony.ts:495-501` excludes `ei persona`-linked records
  from the Rewrite phase with no explanatory comment. One line of code comment, cheap, prevents a
  future maintainer removing it. Tracked in ADR-003.
- **Possible stale comment**: `src/cli/install.ts:156-163` states OMP does not read `~/.agents/skills`.
  Upstream OMP source reportedly now has a generic `.agent`/`.agents` provider that includes it. Needs
  verification against the installed OMP version; if confirmed, the comment is misleading.

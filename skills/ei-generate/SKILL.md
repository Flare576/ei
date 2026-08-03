---
name: ei-generate
description: >
  Use when someone wants to turn what Ei knows about a subject into a
  standalone, shareable document — a runbook, an onboarding doc, a status
  brief, a relationship or profile writeup, or any other synthesis of Ei's
  memory into markdown. Triggers: "generate a doc/runbook/brief about X",
  "export a runbook for X", "write up everything Ei has on X", "make me a
  document about X I can hand to someone", "synthesize Ei's memory on X into
  a doc". This is NOT the TUI/Web `/generate` feature — that queues an async
  LLM call and stores the result as an Emmett message you can `/unsource` or
  re-run later. This skill has none of that: it is read-only recon plus
  agent-authored synthesis. You are the LLM doing the writing, Ei's CLI only
  supplies the facts, and the output is a plain file placed wherever you and
  the user agree — untracked by Ei, no history, no re-run list. If the goal
  is instead to fix wrong data in Ei, that's `ei-curate`; to look something
  up without producing a document, that's `ei-search`.
---

# Ei Generate — synthesizing a document from Ei's memory, by hand

You are helping someone turn what **Ei** knows about a subject into a real
document — something they can hand to a teammate, keep as a reference, or
share externally. Ei already has a `/generate` feature in the TUI and web
apps that does something *similar* under the hood (search memory, feed it to
an LLM, store the result). This skill is a deliberately different mechanism
for the same goal, built for a coding-harness agent rather than a live Ei
process — read `references/recon.md` before you assume "bigger search limit"
solves anything; it doesn't.

---

## How this differs from Ei's own `/generate` — know this before you start

`processor.ts:generateDocument()` (the code behind TUI's `/generate` and
web's Documents-tab generate button) searches Ei's memory, **enqueues an
LLM call** through Ei's own request queue, and stores the result as a
message owned by the `Emmett` persona (id format
`generate:document:<slug>:<uuid>`) — trackable in
`settings.document.processed_documents` and cleanable via `/unsource`.

None of that machinery is reachable from here. There is no `ei generate` CLI
verb, and Ei's write path (`ei create/update/remove`, plus the quote-only
`ei create/fix/relink/remove quote`) only supports
`fact | topic | person | quote | persona` — no message/document type. So:

- **You are the LLM.** There is no queue to hand this off to — you read the
  data and write the document yourself, in this conversation.
- **Ei's CLI is read-only recon here** — same posture as `ei-search`.
  Nothing you do in this skill writes anything back to Ei.
- **The output is untracked.** No `/unsource` entry, no re-run list, no
  Emmett attribution. If the user wants to regenerate it later, they ask
  again from scratch.
- **You decide the file's home together with the user** — there's no
  Ei-managed docs folder backing this the way `$EI_DATA_PATH/docs/` backs a
  TUI-written generated doc. Never assume a path; ask (see step 6 below).

---

## Before you start

Confirm the CLI is reachable: `ei --help` (or `bunx ei-tui --help` if `ei`
isn't on PATH — same fallback every Ei skill uses). If you're not already
familiar with `ei`'s read surface (`ei "query"`, `ei --id <id>`,
`--recent`, `--persona`, `--source`), read `skills/ei-search/SKILL.md`
first — this skill assumes that baseline and doesn't repeat it. →
`references/cli.md` has the two things specific to *this* skill's use of
the CLI.

---

## The workflow

### 1. Get the subject and the document type
Ask if either is unclear. The document type matters more than it looks —
it determines what facets you'll search for in step 3 and how hard the
validation gate in step 4 should push. Check `references/document-types.md`
for a matching seeded entry (currently: **Runbook**, **Onboarding Doc**). No
match? Use the generic technique in `references/recon.md` and consider
adding a new entry once you've worked out good facets for it — that file is
meant to grow.

### 2. Facet the subject — don't search the subject itself
A single `ei "<subject>"` search under-covers anything broader than a
tightly-named topic (a company, a relationship, an engagement). Break the
subject into the facets a document of this type actually needs first. →
`references/recon.md` has the full technique and the seeded facet lists.

### 3. Recon — search each facet, expand, self-filter
For each facet: search with the multi-phrasing discipline, expand strong
hits via their `linked_quotes` (the same graph-walk `generateDocument()`
does internally), and judge every candidate against whether it actually
belongs in *this* document — not whether it matched semantically. No fixed
result-count anywhere in this process. → `references/recon.md`.

### 4. Validation gate — ask before you draft, not after
The moment a coworker/client Person record, or a company/client name,
surfaces in what you've gathered, stop and ask about names/handles and
about who the document is actually for. Don't guess, and don't wait until
the draft is written to raise it. → `references/validation.md`.

### 5. Synthesize
Write the document yourself. Distill relationships and meaning — don't just
restate the bullets Ei gave you. Apply any Ei-specific structural notes from
the matched `document-types.md` entry, but the actual writing (structure,
tone, what a runbook or onboarding doc conventionally contains) is yours —
frontier models already know that; this skill only supplies what Ei knows
and how to gather it responsibly.

### 6. Confirm placement, then write
Ask where the file should go, or whether the user wants it printed inline
instead of saved. Never default to a path — there's no Ei-managed location
backing this output. Write only after they've told you.

---

## Guardrails

- **Read-only, always.** This skill never calls `ei create/update/remove`.
  If you find yourself wanting to record "I generated a doc about X"
  somewhere in Ei, that's out of scope — say so, don't improvise a write.
- **No hardcoded search limits.** Facet + multi-phrasing + linked-quotes
  expansion + self-filter naturally sizes itself to what Ei actually has.
  Reaching for "just raise the -n" is a sign you skipped faceting.
- **Never skip the validation gate once it's triggered.** A coworker's full
  name or a client's identity ending up in a document handed to the wrong
  audience is the actual failure mode this skill exists to prevent.
- **Never assume a default output path.** Confirm placement every time.
- **`--help` is the source of truth** for the live CLI surface — this skill
  is a guide, but the CLI evolves.
- **Not this skill's job**: fixing wrong data in Ei (`ei-curate`), authoring
  a persona's character (`ei-persona`), or a quick mid-conversation lookup
  with no document to produce (`ei-search`).

---

## Load references on demand

| When you are… | Read |
|---|---|
| deciding what to search and how to expand/self-filter | `references/recon.md` |
| deciding whether to ask about names/audience, and how | `references/validation.md` |
| checking for a seeded facet list for this document type | `references/document-types.md` |
| confirming exactly which CLI commands apply here | `references/cli.md` |

When in doubt, search more, ask before you draft, and never guess at where
the file belongs.

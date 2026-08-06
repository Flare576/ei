# ADR-030: An Attested Quote Merges With Overlapping Quotes, Exactly As Extraction Does

## Status

Accepted

## Date

2026-08-03

## Context

Two code paths create quotes on a message, and until now they disagreed about overlap.

> **Correction (2026-08-04) — the premise above is wrong in a way that changes the work, and the `message`
> precedent cited below is wrong in a way that hides a scope increase.** Verified against executing code before
> item 07 was implemented; full detail in `.sisyphus/investigations/1.10-mechanism-pass-findings.md`.
>
> **1. They do not "disagree about overlap." One path merges; the other does not compare overlap at all.**
> `createQuoteEntity` (`src/cli/corrections-endpoints.ts:470-551`) verifies the supplied text against its source
> (`:479`), constructs a **fresh** `Quote` (`:484-498`), and queues it. **It never searches for an existing quote on
> the same message, by span or otherwise** — there is no `human_quote_getForMessage` call and no overlap predicate.
> `fixQuoteEntity` mirrors it. The drain's `quote.create` case (`src/core/corrections.ts:551`) matches on **id
> only**.
>
> This matters because "reconcile two behaviours" and "add a behaviour to a path that lacks one" are different
> tasks. The second is larger, and a plan written from the first framing will under-scope it.
>
> **2. The `message` field precedent in the References is real but does not reach the success path.**
> `corrections-endpoints.ts:227-231` (`QuoteWritePending`) and `:255-259` (`QuoteWriteUnconfirmed`) do carry
> `message: string` — but those are the **not-yet-confirmed** shapes. `createQuoteEntity` returns
> `Promise<Quote | QuoteWritePending>` and on success returns a **bare `Quote`** (`:550`, `stripEmbedding(quote)`),
> which has no `message` member. `QuoteWritePending` is returned **only** when `drainMode === "queued"` (`:525-531`).
>
> So the Decision's requirement that a merge be explained to the caller **cannot be met without changing a shipped
> endpoint's success return type.** That is a real scope increase, not a detail. The decision itself stands — a
> caller must be told what was absorbed — but an implementer needs to know it costs an API change, and the
> precedent citation reads as though the field already exists on the path that needs it.
>
> **Neither correction reverses this ADR.** Overlapping spans should still merge, and a merge should still be
> reported. What changed is the size and shape of the work: add overlap detection where there is none, make it
> N-aware rather than first-match, and widen the success contract to carry an explanation.

**Extraction merges.** `src/core/handlers/human-matching.ts:489-517` finds an existing quote on the same
`message_id` whose span overlaps the new one (`matchStart < q.end && matchEnd > q.start`), takes the union
span via `Math.min`/`Math.max`, recomputes the embedding, and dedupes `data_item_ids` and
`persona_groups`. Covered by `tests/unit/core/handlers/extraction.test.ts:2696-2750`.

**Attestation does nothing.** `createQuoteEntity` (`src/cli/corrections-endpoints.ts:478-487`) mints a
fresh `crypto.randomUUID()` with empty links and never calls `human_quote_getForMessage`.
`fixQuoteEntity` (`:637-643`) overlays text/offsets with no comparison against neighbours. The drain's
`quote.create` case (`src/core/corrections.ts:549-560`) compares `quote.id` only — never spans.

So two attested quotes could coexist with overlapping character ranges where extraction would have
merged them, and nothing recorded that as a decision. The question was raised during the interview that
preceded the attestation work — *"Does an attested quote merge, coexist, or reject? Nobody has specified
this"* — and shipped unanswered.

The relevant ADRs are silent because they answer a different axis. ADR-014 governs **provenance** —
whether a stored quote can be trusted to have been said. ADR-011 governs **link lifecycle**. ADR-012
governs the retirement of `ei update quote`. None addresses **multiplicity**.

This is not a security question. ADR-014's guarantee holds regardless: `create quote` and `fix quote`
verify supplied text against the resolved source message or refuse. Overlapping quotes are each
individually true. The cost is duplication and inconsistency, not falsehood.

## Decision

**Attestation behaves exactly as extraction does. An overlapping span merges.**

Stated by the owner as the governing principle: *"regardless of what the trigger is, updating a quote to
overlap another quote should merge and update the related links. The source material did not change, just
the window into it."*

**1. Both verbs merge.** `create quote` and `fix quote` alike.

**2. The merge is N-aware.** All overlapping quotes are absorbed, not one.

The existing extraction merge uses `Array.find()`, which returns the **first** match. With three
overlapping quotes, one is absorbed and two are left behind still overlapping — a latent defect in
shipped code, surfaced by the owner asking *"What if there are three, one on each side?"* as a
hypothetical. It was not hypothetical. Fixing it is part of this decision, not a separate concern,
because "the same as extraction" is only a coherent rule if extraction itself handles N.

**3. The result tells the caller what was absorbed.**

**Corrected 2026-08-04.** This clause previously read: *"Precedent exists and is caller-facing:
`QuoteWritePending` and `QuoteWriteUnconfirmed` (`corrections-endpoints.ts:227-231, 255-259`) both carry
`message: string`, returned from all four quote verbs — e.g. `:533`. So this uses an established shape rather than
inventing one."*

**The precedent does not reach the path that needs it.** Both named shapes mean *the write is **not** confirmed* —
`QuoteWritePending` is returned only when `drainMode === "queued"` (`:525-531`). A completed merge **is** confirmed,
and the success shape is a bare `Quote` (`:550`), which has no `message` member. **So a new shape is required**, and
this clause previously said the opposite in the ADR's binding section while a Context note said the truth.

The required behaviour is unchanged — a caller must be told what was absorbed, because that report is the only
mitigation this ADR's Risks section relies on. What changed is the honest cost: **an API change**, not the reuse of an
existing field. See the correction in Context.

**The result shape is specified here, not in a plan document** — per the principle ADR-010 states outright: *the ADR is
the durable artifact and the plan is not.* An earlier revision of this note cited a plan's Contract section for the
shape; that plan has since been deleted and regenerated, which is exactly the dependency this inversion removes.

`{ status: "merged"; quote; absorbed: string[]; message }` — returned **only** after a confirmed self-drain merge.
Queued writes keep returning `QuoteWritePending` with **no** `absorbed` list, because a queued write is not confirmed
and cannot report what it absorbed.

**4. Provenance derivation is unchanged.** The merged quote's text remains a contiguous slice of the same
source message, so the invariant `text === content.slice(start, end)` survives a union merge. Speaker,
channel, timestamp, and embedding continue to derive server-side from the resolved message.

## Alternatives Considered

### Alternative A: Merge on `create`, refuse on `fix`

- **Description**: `create` is additive so merging resolves naturally; `fix` is corrective and should
  refuse rather than consume a neighbour, preserving its documented contract.
- **Pros**: No documentation change. `fix quote` keeps its promise never to touch links. No record is
  ever destroyed by a corrective operation.
- **Cons**: Pushes reconciliation onto the caller, and the caller is usually an agent. The owner's
  walkthrough is the refutation: an agent told *"fix this mangled quote by checking the source"* pulls the
  message id, computes the correct span, calls `fix` — and gets an error about an overlap it had no reason
  to know existed. It must then fetch the neighbour, reconcile spans itself, and retry. With overlaps on
  both sides it must reconcile three. That is a worse contract than merging, and it makes the common case
  fail.
- **Why not chosen**: this was the recommendation put to the owner, and it lost on the use case. Making
  the server reconcile once is cheaper and more reliable than making every agent reconcile N times.

### Alternative B: Coexistence is correct; extraction's merge is the anomaly

- **Description**: ADR-011 establishes a quote as an independent entity whose value does not derive from
  its surroundings, so two overlapping quotes may be two genuinely distinct memorable lines.
- **Pros**: No code change to attestation. Arguably the most faithful reading of ADR-011.
- **Cons**: Leaves two creators with two rules and nothing marking the difference as intentional. Also
  leaves the store accumulating near-duplicate embeddings that all match the same semantic search, and
  leaves extraction's `find()` picking an arbitrary merge target whenever more than one overlap exists.
- **Why not chosen**: ADR-011 is about a quote surviving its *links*, not about span multiplicity.
  Stretching it to license overlapping duplicates reads the precedent past what it decided.

### Alternative C: Refuse on both verbs

- **Description**: Any overlap is refused, matching attestation's verify-or-refuse posture.
- **Pros**: Cheapest to implement and test. Truest to ADR-014's "there is no third outcome."
- **Cons**: Inherits Alternative A's caller burden on both verbs instead of one, and makes the ordinary
  act of attesting a slightly longer version of an existing quote an error requiring manual deletion first.
- **Why not chosen**: it optimises for implementation simplicity at the cost of every caller.

## Consequences

### Positive

- One rule for quote overlap across the whole system, instead of two undocumented ones.
- A latent N-overlap defect in shipped extraction code gets fixed rather than inherited.
- Callers never have to reconcile spans. The server does it once, correctly, and says what it did.
- The store stops accumulating overlapping near-duplicates whose embeddings compete in the same search.

### Negative

- **`fix quote`'s documented contract becomes false and must be rewritten.** It currently promises it
  *"never changes links or provenance"* — but a merge unions `data_item_ids` from the absorbed quote.
  `CHANGELOG.md`, `ei --help`, and `src/cli/README.md` all carry that claim. The owner's assessment:
  *"our original stance/docs lacked research and understanding."*
- **A merge destroys a record, so a held id can dangle.** Anything holding an absorbed quote's id — a
  `data_item_ids` reference, an agent mid-workflow, a `fetch_memory` call — now points at nothing. The
  `message` field mitigates this only for the caller who triggered the merge, not for a third party.
- `create quote` no longer always creates. A caller must read the returned object rather than assume the
  id it gets back is new.

### Risks

- **A merge is arguably a third outcome** next to ADR-014's *"either verify… or refuse — there is no third
  outcome."* The reconciliation: ADR-014's dichotomy is about **provenance** — text is either verified
  against the source or the write is refused — and a merge does not weaken that, because the merged text is
  still a verified contiguous slice of the same message. The dichotomy governs whether the write is
  trustworthy, not how many records result. Worth stating explicitly so a future reader does not read a
  contradiction where there is a category difference.
- **Merge-on-`fix` makes the corrective verb destructive.** This is the sharpest cost of the decision and
  is accepted knowingly. An operation a user thinks of as "correct a typo" can remove a neighbouring
  record. The `message` field is the only signal, and only the immediate caller sees it.
- **Repeated merges are lossy in one direction.** Absorbed spans widen monotonically; nothing splits a
  quote back apart. A sequence of overlapping attestations converges on one large quote, and there is no
  inverse operation. `ei relink quote` can repoint links but cannot restore a span.

## Reversibility

Moderate for the code, poor for the data. The merge logic is additive and removable, and reverting
restores coexistence for future writes. But quotes already merged cannot be un-merged — the absorbed
records are gone and their original spans are not retained anywhere. A revert therefore leaves a store
containing merged quotes under a policy that would no longer produce them.

## References

- `docs/adr/ADR-011-quotes-outlive-their-links.md` — quote independence; silent on span multiplicity
- `docs/adr/ADR-012-sunset-with-a-path-forward.md` — the four-verb split whose `fix` contract this changes
- `docs/adr/ADR-014-quote-attestation-trusts-verified-text.md` — the provenance dichotomy this does not violate
- `src/core/handlers/human-matching.ts:489-517` — extraction's merge, and the `Array.find()` N-overlap defect
- `src/cli/corrections-endpoints.ts:478-487, 637-643` — the attestation paths gaining merge behaviour
- `src/cli/corrections-endpoints.ts:227-231, 255-259` — `message` on `QuoteWritePending` / `QuoteWriteUnconfirmed`. **Not a precedent for the success path** — both mean "not confirmed"; success returns a bare `Quote` (`:550`). See the Context correction and Decision clause 3
- `src/core/corrections.ts:549-560` — the drain's `quote.create` case, which compares ids only
- `.sisyphus/issues/attested-quote-overlap-unspecified.md` — the filed finding this resolves

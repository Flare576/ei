# ADR-014: Quote Attestation Trusts Verified Text, Not `created_by` or `message_id`

## Status

Accepted

## Date

2026-08-03

## Context

Before this work, `CONTRACTS.md`'s Corrections Queue table said, verbatim, that a quote could
never be authored externally:

> quote | — | yes | — | Verifiable-origin data (produced only by the extraction pipeline) —
> correctable (repoint `data_item_ids`, fix mistranscribed text) but never authored or deleted
> externally

`Quote.created_by` is typed `"extraction" | "human"` (`src/core/types/data-items.ts:90`). Only the
extraction pipeline (LLM-driven session analysis) or a human via the web capture modal
(`QuoteCaptureModal.tsx`, freely-editable textarea, `created_by: 'human'`) could ever produce one.

The dual-lens reflection work needed a third path: an external agent (a reflection skill, running
outside Ei) discovers a specific line worth preserving as evidence and wants to attest to it
through the CLI/MCP corrections surface, which had no create path for quotes at all.

**The first design was wrong, twice, in a way worth recording so it isn't repeated.** The initial
attempt required `message_id` + `start` + `end` and treated a non-null `message_id` on the stored
record as proof of legitimate provenance. Round 1 review found a blocker; the round-1 fix patched
around it by locking provenance once a stored quote's `message_id` was already non-null. Round 2
review found the patch had made things worse, not better:

- **Room-origin messages were indistinguishable.** The message resolver's output for a
  room-*persona* message was byte-identical to a room-*human* message, so nothing could safely
  reject the latter.
- **The patch was a laundering path.** It locked provenance only once `message_id` was already set
  and explicitly left null-`message_id` quotes alone. That meant: take any existing unsourced
  quote, update it once with a forged `message_id` plus forged `speaker`/`timestamp`/`channel` and
  `created_by: extraction`, and every *subsequent* update would treat that forged history as
  already-attested, legitimate provenance.
- **`created_at` was never protected** and remained caller-writable throughout.
- **Worst of all, `message_id` presence was never a valid signal in the first place.** The web
  capture modal already creates quotes with a real `message_id`, from freely-editable text, with
  `created_by: 'human'`. Any check keyed on "does this quote have a `message_id`" cannot tell a
  legitimately human-edited quote from a forged one — the entire discriminator was checking the
  wrong thing.

The finding that mattered most: *"`message_id` is not a valid attestation signal."* The core
security property — what makes a quote trustworthy — had never actually been designed; it had been
asserted as a constraint and then patched toward twice, each patch keying on a signal that didn't
mean what it looked like.

## Decision

**Trust comes from verifying a quote's TEXT against the real content of a resolved source message
at write time — never from the presence or value of `message_id`, `created_by`, or any other
caller-supplied metadata.**

Concretely:

1. **Require `message_id` + `text`.** Offsets (`start`/`end`) are optional and used only to
   disambiguate when identical text appears twice in one message — the caller is never trusted to
   supply them as the sole proof of location. Verification reuses the extraction pipeline's own
   battle-tested matcher (`matchQuoteInMessage`, `src/core/handlers/human-matching.ts:472` —
   normalized exact match, then word-boundary fallback via `expandToWordBoundaries`/
   `findQuoteByWords`, `:408`/`:418`) rather than a new, less-tested verification path.

2. **All provenance fields are derived server-side and rejected if the caller supplies them.**
   `speaker`, `timestamp`, `channel`, `embedding`, `created_at`, and (on create) `created_by` are
   never taken from the wire — `createQuoteEntity`'s input schema is a `z.strictObject` that
   rejects any of those keys before resolution or matching ever runs
   (`src/cli/corrections-endpoints.ts:136-140`).

3. **`created_by: "extraction"` is reused, not extended with a third value.** Its meaning is
   redefined from "produced by the extraction pipeline" to "text is verifiable against a resolved
   source, not an arbitrary human claim" — stated directly in the implementation: *"`created_by`
   is the literal `"extraction"` — per the design's decision that this value means 'verifiable,'
   not 'produced by the extraction pipeline specifically.'"* (`src/cli/corrections-endpoints.ts:
   458-460`).

4. **`quote.relink` and `quote.remove` carry only the fields they change** — `id`/`data_item_ids`/
   `attempt_id`, or `id` alone (`src/core/corrections.ts:109-182`) — and assert nothing about text
   or provenance. There is no operation, after creation, through which a quote's `message_id`,
   `speaker`, or `created_by` can be changed. `quote.fix` re-verifies text against the quote's
   *existing* `message_id` only; it never re-resolves a new source. This makes the laundering path
   found in round 2 structurally unrepresentable rather than separately guarded against.

5. **Room-origin ambiguity is closed with an explicit discriminant**, not a heuristic.
   `ResolvedMessage` now carries `origin_kind` (`"ei-room"` vs. `"ei-direct"` vs. others,
   `src/cli/retrieval.ts:453-471,504`), so a room-human message is distinguishable from a room-persona
   message where it previously was not.

## Alternatives Considered

### Alternative A: `message_id` + `start` + `end`, trusted by presence (the original design)
- **Description**: Require exact offsets; treat a non-null `message_id` on the record as proof.
- **Pros**: Simple mental model — "it has a message_id, therefore it's sourced."
- **Cons**: This is exactly what failed. `message_id` is set on human-authored quotes too; offsets
  invite the laundering path once any update-after-create is permitted.
- **Why not chosen**: Round 2 review demonstrated it does not provide the security property it was
  asserted to provide.

### Alternative B: Add a third `created_by` value (`"attested"`)
- **Description**: Distinguish agent-attested quotes from extraction-pipeline quotes with a new
  enum member.
- **Pros**: Preserves the literal meaning of `"extraction"`; a future reader or query could isolate
  agent-attested quotes specifically.
- **Cons**: Ripples into the corrections schema, any UI switching on the value, and the
  older-client-sees-unknown-enum-value path (tolerated today by the optional-field convention, but
  still a wider footprint). No consumer today treats "produced by the extraction pipeline" and
  "verified against a resolved source by another path" differently — the distinction would exist
  in the schema with no reader.
- **Why not chosen**: `"extraction"`, in every place it is actually consulted, already functions as
  "not an arbitrary human claim" rather than literally "the extraction pipeline." Reusing it costs
  nothing today and adds no enforcement that a new value would provide, since the actual trust
  boundary lives in the write-time verification, not in this field.

### Alternative C: Trust `created_by === "extraction"` + `message_id` as a compound signal
- **Description**: The literal round-1/round-2 approach — treat two pieces of caller-adjacent state
  together as sufficient provenance.
- **Cons**: This is what produced the room-origin ambiguity and the laundering path. Both fields
  were, at the time, things an existing write path could set through ordinary updates. A compound
  check over two forgeable fields is obscurity, not a boundary.
- **Why not chosen**: Directly refuted by the round-2 findings.

### Alternative D: Require exact offsets only, no text-based matching
- **Description**: Keep the original offset requirement; drop the `message_id`-presence trust but
  keep offsets as the mechanism.
- **Cons**: Character offsets into arbitrary source text are fiddly for an LLM caller to compute
  correctly — a common, unforced failure mode. Text-based verification through the same matcher the
  extraction pipeline already relies on gives equivalent forgery resistance (the text must still
  exist in the resolved message) with a dramatically easier caller contract.
- **Why not chosen**: No security gain over text-plus-matcher; real usability cost, and it would
  have meant a second, parallel, less-tested verification path instead of reusing production code.

## Consequences

### Positive

- Attested creation runs through the exact matcher the extraction pipeline has relied on and
  hardened for a long time, instead of a new, separately-tested verification path.
- Forgery resistance is structural, not asserted: a caller cannot manufacture a quote whose text
  does not actually appear in the resolved source message, regardless of what `created_by`,
  `message_id`, or offsets they supply — those fields are never read from the caller at all.
- The round-2 laundering path is closed by making it unrepresentable (`relink`/`remove`'s narrow
  field allowlists), not by adding a check that a future edit could accidentally remove.

### Negative

- `created_by: "extraction"` no longer means "the automated session-parsing pipeline produced
  this." Any future code — or person — reading `created_by === "extraction"` as "came from the
  automatic pipeline" is wrong for an unknown subset of records, and no field distinguishes them.
- The distinction between "the extraction pipeline surfaced this while summarizing a session" and
  "an agent attested to this specific line on request" is now permanently invisible in the data
  model. If that distinction ever becomes load-bearing — trust-weighting, a UI badge, a filter — it
  requires a new field; there is nothing in today's records (timestamp pattern, other field, or
  convention) that recovers it retroactively.
- This redefinition is explained in exactly one place before this ADR: a code comment at
  `corrections-endpoints.ts:458-460`. `CONTRACTS.md` documents the current *mechanism* fully but
  never states *why* `"extraction"` was reused instead of a new value, or why external creation is
  now safe when it previously was not.

### Risks

- **The boundary lives in code, not in the type system.** `created_by: "extraction" | "human"`
  cannot distinguish an attested quote from a genuinely extracted one at the type level; only
  `createQuoteEntity`/`fixQuoteEntity`'s validation enforces the boundary. A future write path added
  for quotes that bypasses these two functions — and forgets this constraint — reintroduces the
  exact round-2 laundering hole, with no compiler or schema signal to catch it.
- **The underlying lesson generalizes past this one field.** Round 2 proved that `message_id` and
  `created_by` presence are not trustworthy provenance signals on their own. Nothing prevents a
  future feature from making the identical mistake with a different field — e.g. treating a
  populated `embedding` as proof of legitimate creation. That lesson is enforced only in this one
  write path, not anywhere structural.

## Reversibility

Moderate. Adding a distinguishing field later (e.g. a dedicated `attestation_source`) is additive
and cheap going forward — optional-field convention, no migration, no effect on existing records.
It cannot retroactively distinguish quotes already written under this decision: every quote created
through `createQuoteEntity` looks bitwise identical to a genuine extraction-pipeline quote, because
the only thing that differed was which caller happened to invoke the endpoint, and that fact is not
itself recorded anywhere.

## References

- `CONTRACTS.md` → Corrections Queue → Quote write path — the current mechanism this decision
  produced
- `src/cli/corrections-endpoints.ts:136-140,392-470` — `createQuoteEntity`, the shared verification
  core, and the `created_by: "extraction"` decision comment
- `src/core/handlers/human-matching.ts:408-490` — `expandToWordBoundaries`, `findQuoteByWords`,
  `matchQuoteInMessage`, reused unchanged by attested creation
- `src/core/corrections.ts:109-360` — the four dedicated quote ops and their per-op field
  allowlists
- `src/core/types/data-items.ts:90` — `Quote.created_by: "extraction" | "human"`
- `src/cli/retrieval.ts:453-471,504` — `ResolvedMessage.origin_kind`, the `"ei-room"` discriminant that
  closes the room-origin ambiguity
- ADR-008 — the accepted write races this same quote work narrowed for three of the four ops
- ADR-012 — the tombstone pattern used to retire the old `ei update quote` path this replaces

# ADR-035: A Sync Peer With Valid Credentials Is the User, Not an Adversary

## Status

Accepted

## Date

2026-08-07

## Context

A code review during the same session that produced ADR-030's implementation surfaced a finding
against the one-to-one Person↔Persona link guard (`docs/adr/ADR-006-ei-persona-link-multiplicity.md`,
`ADR-010-invalid-persona-links-are-reported-not-repaired.md`): `guardPersonaLinks`
(`src/core/utils/identifier-utils.ts`) interpolates a conflicting Person's raw `.id` field into a
refusal message without validating its shape first, unlike the link `value`/`personName` fields, which
by then had been fixed to reject anything that isn't a UUID or a recognized reserved id.

Tracing reachability rather than accepting or dismissing the finding on its face: every in-app write
surface that can set a Person's `.id` — CLI/MCP `create`, CLI/MCP `update`, LLM extraction's
`handlePersonUpdate`, dedup's merge — is airtight. Each one either mints a fresh `crypto.randomUUID()`
or requires the supplied id to already match a previously-validated, already-stored record. There is no
path through any of those four surfaces where free text becomes a Person's `id`.

One path is not airtight: remote sync. `mergeDataItems`/`yoloMerge` (`src/storage/merge.ts`) and
`HumanState.load` (`src/core/state/human.ts`, reached via `StateManager.restoreFromState`) accept a
decrypted peer's `Person` records verbatim — no schema check, no id-format check. This is reachable not
only through the explicit conflict-resolution UI but through the ordinary first-launch silent pull
(`src/core/processor.ts`'s "no primary state, remote exists" path). A peer holding valid sync
credentials (the account's derived AES-256-GCM key, from `EI_SYNC_USERNAME`/`EI_SYNC_PASSPHRASE`) could
in principle hand-craft a `Person` with an attacker-chosen `.id` and have it land, unvalidated, in local
state.

That reachability trace is accurate, and on its own reads like a real gap. It isn't one, once the
actual trust model is named: **Ei's sync is single-user, multi-device — a passphrase-derived key shared
across a person's own laptop and phone, not a multi-tenant server brokering data between independent
account holders.** A "peer with valid sync credentials" is not a third party who has found a foothold.
It is the same person's other device, or someone who already holds their passphrase outright. Either
way, that party already has full plaintext read access to every fact, topic, quote, and message the
account has ever synced — the entire corpus, in the clear, no crafted payload required. Constructing a
poisoned `Person.id` to leak one string through one refusal message, when direct read access to
everything is already available, grants no incremental capability. It's a strictly worse way to do
something already possible more directly.

The owner's own words, once the mechanism was traced and relayed: *"if they already have access to
literally all of the data... why would they fuck around with a poisoned ID?"*

## Decision

**A sync peer that can present valid account credentials is treated as the account owner, not as an
untrusted third party.** Findings whose entire attack requires "attacker already holds valid sync
credentials" as a precondition are closed by this reasoning, not treated as accepted risk or deferred
work — the described threat does not exist given how sync is actually scoped. This is a general
disposition rule, not a one-off ruling on the specific finding that surfaced it: any future finding
resting on the same precondition should be checked against this ADR before a fix is proposed.

This does **not** bless leaving sync's ingress path unvalidated as a matter of general code hygiene —
`mergeDataItems`/`HumanState.load` accepting malformed data (a wrong type, a missing required field, a
future schema drift between two client versions) is a separate, ordinary correctness concern,
independent of any adversarial framing. This ADR is scoped to the adversarial question only: does an
authenticated sync peer need to be defended against as if they were an attacker. The answer is no.

## Alternatives Considered

### Alternative A: Validate every field of every synced entity against its schema before merge/load

- **Description**: Treat sync input with the same suspicion as any other external input — run every
  incoming `Person`/`Fact`/`Topic`/`Quote` through full schema validation (the same Zod schemas
  `corrections-endpoints.ts` already uses for CLI/MCP writes) before it enters local state.
- **Pros**: Closes this specific finding and any structurally similar one at the root, rather than at
  each individual downstream display site. Also catches honest data corruption (a truncated sync
  payload, a version mismatch), not just adversarial input.
- **Cons**: Real, non-trivial engineering work — sync's wire shape is a full `StorageState`, and
  validating it end-to-end touches every entity type, not just `Person`. Solves a threat that, per the
  Decision above, does not exist for the adversarial case it was proposed to close.
- **Why not chosen**: the adversarial framing that motivated it doesn't hold. The non-adversarial
  motivation (defend against honest corruption/drift) is real but is its own, separately-scoped piece of
  work — worth doing on its own merits, not smuggled in as a security fix for a threat model that isn't
  Ei's.

### Alternative B: Sanitize every displayed field derived from synced data, everywhere, unconditionally

- **Description**: Since *any* synced free-text field (not just `Person.id`) could in principle carry
  adversarial content if the threat model were real, sanitize every such field at every display/prompt
  site as a blanket policy.
- **Pros**: Uniform, doesn't require re-deriving the threat model per finding.
- **Cons**: Solves the same nonexistent threat as Alternative A, at even more call sites, for even less
  reason — Ei already accepts that synced/imported human data is trusted content once it's local (the
  existing memory-context injection blocks label content rather than attempting to neutralize it), and
  this ADR's own reasoning is why that acceptance is sound rather than an oversight.
- **Why not chosen**: same reasoning as Alternative A, applied more broadly.

## Consequences

### Positive

- A whole class of future findings — "a synced record's field X could contain adversarial content and
  reach sink Y" — has a fast, correct, written-down disposition instead of requiring this exact
  reachability trace to be redone from scratch.
- Prevents defensive work that would add real surface area (validation code, sanitization call sites)
  against a threat that provides no actual security improvement, since the same party could always act
  more directly.

### Negative

- A genuinely malicious *third party* scenario — sync credentials leaked to someone who is not the
  account owner and not a device the owner controls — is still nominally covered by "holds valid
  credentials = trusted," which is the same exposure any credential-based system has. This ADR does not
  change that exposure; it only clarifies that Ei's existing design already accepts it, the same way a
  stolen password grants read access to any single-user system's data.

### Risks

- **This reasoning is scoped to the *adversarial* question only.** A future finding that isn't "could an
  attacker exploit this" but "could sync accept genuinely malformed data and crash/corrupt state" is NOT
  closed by this ADR — that's Alternative A's non-adversarial motivation, and remains open, real,
  ordinary-correctness work.
- **If Ei's sync model ever grows a multi-tenant or shared/collaborative feature** (a persona/data
  shared across accounts, a team feature, anything where a sync peer is no longer definitionally the
  same account holder), this ADR's premise stops holding and every disposition made under it needs
  re-examination.

## Reversibility

Easy to revisit, hard to silently outgrow. Nothing is built as a consequence of this decision — it is a
disposition rule, not new code. Reversing it only means treating a future finding on its own merits
instead of dismissing it via this ADR. The risk is the opposite failure mode: this ADR's premise (single-
user, multi-device sync) quietly stops being true as the product grows, and nobody notices before an old
finding gets re-closed under a rule that no longer applies.

## References

- `.sisyphus/reviews/tonight-post-audit-fix-queue.md` — the I5 finding this ADR resolves, including the
  full reachability trace (every in-app write surface airtight; sync merge/restore the one gap) and the
  owner's ruling in his own words
- `docs/adr/ADR-006-ei-persona-link-multiplicity.md`, `ADR-010-invalid-persona-links-are-reported-not-repaired.md` — the guard whose diagnostic output raised this question
- `docs/adr/ADR-014-quote-attestation-trusts-verified-text.md` — a related "what does this system actually need to defend against" precedent, for provenance rather than sync trust
- `src/storage/merge.ts`, `src/core/state/human.ts` — the unvalidated sync merge/load path traced during the reachability check
- `src/storage/crypto.ts` — AES-256-GCM, PBKDF2-derived key from `EI_SYNC_USERNAME`/`EI_SYNC_PASSPHRASE`; the actual boundary this ADR treats as the trust line

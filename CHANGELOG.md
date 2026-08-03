# Changelog

All notable changes to Ei are recorded here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning
convention is in [README.md → Versioning](./README.md#versioning): `v1` is an extension of
`v0`, so breaking changes ride the minor until `v2` is earned.

This file starts where it was added and is deliberately not backfilled. For anything earlier,
read `git log`, or the per-document changelog tables in `CONTRACTS.md`.

## [Unreleased]

### Added

- **Four dedicated quote verbs.** A quote asserts that a real person said a specific thing, so
  the commands that touch one are now split by whether they make that claim:
  - `ei create quote --message-id <id> --text "<text>" [--start N --end N]`
    (MCP: `ei_quote_create`) — attests a new quote by matching the supplied text against the
    resolved source message. `speaker`, `channel`, `timestamp`, the offsets, and the embedding
    are all derived from that message, and are rejected if a caller supplies them.
  - `ei fix quote --quote-id <id> --text "<text>" [--start N --end N]`
    (MCP: `ei_quote_fix`) — corrects mistranscribed text by re-verifying it against the quote's
    *existing* source message. Never re-resolves a different source, and never touches links or
    provenance.
  - `ei relink quote <id> --to <entity-id,...>` (MCP: `ei_quote_relink`) — changes
    `data_item_ids` and nothing else. `--to` is the complete replacement list, and `--to ""`
    clears every link. It asserts nothing about text or origin, so unlike create/fix it also
    works on a quote whose source message no longer resolves, or one whose `message_id` is
    `null` because it predates attestation.
  - `ei remove quote <id>` (MCP: `ei_remove` with `entity_type: "quote"`) — deletes a quote.
    Quote removal was previously unavailable on the public surface entirely.
- `create quote` and `fix quote` either verify the supplied text against a resolved source
  message or refuse — there is no third outcome. The four refusals are `no source message to
  verify against` (the quote predates attestation), `source message could not be found`,
  `quote text not found in source message`, and `offset does not match the resolved text
  location`. A refusal persists nothing.
- `--start`/`--end` on `create quote`/`fix quote` are a consistency check, never a way to
  select a later occurrence of repeated text: supply both, and both must equal the span the
  server independently finds, or the write is refused.

### Changed

- **Quote corrections no longer use the generic `upsert`/`remove` correction ops.**
  `entity_type: "quote"` now validates against exactly four dedicated ops — `quote.create`,
  `quote.fix`, `quote.relink`, `quote.remove` — each with its own allowed-key set. A
  pre-cutover `{op: "upsert", entity_type: "quote", …}` record left queued by an older binary
  is rejected at all three consumers (the CLI read overlay, the CLI self-drain, and the live
  Processor drain), and rejecting it reports a skip rather than wedging the other pending
  corrections in the same batch.
- **Room attribution.** Message resolution returns a discriminated `ResolvedMessage` carrying
  `origin_kind`, a canonical `source_id`, and a `container.kind` of `persona`/`room`/`session`,
  so a room message is distinguishable from a direct one instead of being flattened into a
  single generic envelope. A room message whose persona has since been deleted now resolves to
  the display name `Participant` instead of `undefined`.
- **Channel derivation.** A quote created through `create quote` takes its `channel` from the
  resolved source's container display name — the persona's name for a direct message, the
  room's name for a room message, the session title for a coding-tool session — instead of
  being left unset.
- `ei remove` and MCP `ei_remove` now accept `quote` as a type, and `ei --help` documents all
  four quote verbs.
- The Release Protocol checklist in `AGENTS.md` gained a step for closing out this file's
  `[Unreleased]` heading before tagging.

### Fixed

- **The startup migration can no longer launder an unverifiable quote into a sourced one.**
  `migrateMessageIds()` rewrites a quote's bare `message_id` into the fully-qualified format
  only when the quote's own text is actually found in that candidate message's content.
  Previously any id that resolved to *some* message was upgraded, which handed an unverifiable
  quote a plausible-looking source pointer — and, as of this release, a `message_id` that
  `fix quote` would then accept as its verification target. A quote that fails the check keeps
  its unqualified id, the same disposition a quote with no candidate match at all always had:
  nothing is deleted, rejected, or logged.

### Removed

- Nothing. The `update` verb on a quote — CLI `ei update` with a quote type, MCP `ei_update`
  with `entity_type: "quote"` — is **tombstoned, not removed**. Both are still real, still
  registered, and now always reject with a message naming `ei fix quote`, `ei relink quote`,
  and `ei remove quote`, and stating that installed skills instructing you to call it predate
  this version. Deleting it outright would have turned every stale installed skill into an
  unhelpful "unknown type" error instead of a corrective one; see
  [ADR-012](./docs/adr/ADR-012-sunset-with-a-path-forward.md). Scheduled for removal two
  releases after the one that ships that message.

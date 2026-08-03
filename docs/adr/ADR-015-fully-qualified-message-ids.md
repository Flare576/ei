# ADR-015: Message IDs Are Fully-Qualified Provenance Locators, and the Resolver Refuses What It Cannot Safely Resolve

## Status

Accepted

## Date

2026-08-03

## Context

Before this work, a `Quote.message_id` (and a `Message.id` for anything imported from an
external tool) was a naked native identifier with no provenance encoded in it at all:

- `msg_c75b...` looks like an OpenCode message ID, but nothing says *which machine* imported
  it or *which OpenCode session* it belongs to.
- `0da9e1e8-...` is an unqualified UUID. It could be an Ei-native persona/room message, a
  Claude Code message, a Cursor message, or a document-import message — the shape alone cannot
  tell you.

This made two things impossible to do correctly:

1. **Cross-machine `fetch_message` resolution.** Given only a naked ID, there was no way to
   know which reader to invoke (OpenCode's SQLite DB? Claude Code's JSONL projects directory?
   Cursor's global DB?) or which machine's copy of that store to open.
2. **Display-code equality.** Code that matched `quote.message_id === message.id` only worked
   "by accident" — both sides happened to be equally naked, so string equality degenerated into
   coincidental collision-avoidance rather than a real address match.

A third, unrelated field had also grown up beside this problem: document-import messages
carried a separate `source_tag` string (e.g. `"import:document:my-file.pdf"`) recording where
they came from, entirely independent of their `id`. This was a parallel, redundant provenance
concept — one message had both an opaque `id` *and* a separately-tracked-but-differently-shaped
`source_tag` describing the same fact (where it came from), and nothing kept the two in sync by
construction.

## Decision

**Every message ID is a fully-qualified locator. The ID itself is the provenance record — no
separate field describes where a message came from.**

### ID shapes

Documented in the header comment of the parser module
(`src/core/utils/message-id.ts:1-10`):

```
ei:${uuid}                                         Ei-native (persona chat, room)
opencode:${machine}:${session}:${nativeId}         OpenCode
claudecode:${machine}:${session}:${nativeId}       Claude Code
cursor:${machine}:${session}:${nativeId}           Cursor
codex:${machine}:${session}:${nativeId}            Codex
import:document:${slug}:${uuid}                    Document import
slack:${workspace}:${channel}:${ts}                Slack
```

(A `pi` integration — `pi:${machine}:${session}:${nativeId}` — and a legacy
`generate:document:${slug}:${uuid}` shape for AI-synthesized documents exist in current source
alongside these; both are discussed below.) The prefix alone tells a reader the integration,
the machine, the session, and the native ID within that session — no second field, no guessing.

### Central parser

`parseMessageId` (`src/core/utils/message-id.ts:31-113`) is the single place that turns an ID
string into a discriminated `ParsedMessageId`:

```typescript
export interface ParsedMessageId {
  integration: MessageIdIntegration  // "ei" | "opencode" | "claudecode" | "cursor" | "codex"
                                      // | "pi" | "import" | "slack" | "unknown"
  machine?: string
  session?: string
  nativeId: string
  raw: string
}
```

It splits on `:` and matches each known prefix by shape (`opencode`/`claudecode`/`cursor`/
`codex`/`pi` require at least 4 colon-separated parts; `import:document:...` checks the literal
second segment `"document"`; anything unrecognized falls through to `{ integration: "unknown" }`
rather than throwing). A matching `qualify*` helper exists for every shape — `qualifyEiMessage`,
`qualifyOpenCodeMessage`, `qualifyClaudeCodeMessage`, `qualifyCursorMessage`,
`qualifyCodexMessage`, `qualifyPiMessage`, `qualifyDocumentMessage`, `qualifySlackMessage`
(`src/core/utils/message-id.ts:122-152`) — so every write site constructs an ID through a named
function instead of hand-building a template string. Every current integration importer uses
its corresponding helper at the point of writing a message: OpenCode
(`src/integrations/opencode/importer.ts:17,53`), Claude Code
(`src/integrations/claude-code/importer.ts:17,46`), Cursor
(`src/integrations/cursor/importer.ts:10,37`), Codex (`src/integrations/codex/importer.ts:12,40`),
Pi (`src/integrations/pi/importer.ts:12,45`), Slack (`src/integrations/slack/importer.ts:8,68`),
and document import (`src/core/handlers/document-segmentation.ts:8,54`).

### Central resolver, with explicit refusal as a first-class outcome

`resolveExternalMessage` (`src/cli/retrieval.ts:606-855`) is the single place that turns a
fully-qualified ID back into a resolved message plus surrounding context. It parses the ID and
switches on `parsed.integration`:

- **`ei`** — scans in-memory persona threads, then rooms, for a message with that exact ID
  (`src/cli/retrieval.ts:614-676`). A persona-thread hit is tagged `origin_kind: "ei-direct"`; a
  room hit is tagged `origin_kind: "ei-room"` — the two are structurally distinguishable in the
  result even though both parse from the same `ei:<uuid>` shape (`src/cli/retrieval.ts:461-464`,
  `624`, `650`).
- **`opencode` / `claudecode` / `cursor` / `codex` / `pi`** — each branch first checks
  `parsed.machine !== getMachineId()` and returns a discriminable `{ error }` result naming the
  origin machine if it doesn't match this one (five occurrences, one per integration,
  e.g. `src/cli/retrieval.ts:678-682` for OpenCode, `685-688` for Claude Code, `723-726` for
  Cursor, `758-761` for Codex, `790-793` for Pi). On a machine match, it dynamically imports the
  integration's reader and looks the native ID up in that integration's actual store (OpenCode's
  SQLite DB, Claude Code's `~/.claude/projects/` JSONL, Cursor's global DB, etc.).
- **`slack`** — returns a `ResolverRefusal` (`{ refused: true, reason }`,
  `src/cli/retrieval.ts:534-537,822-827`): *"Message originates from a Slack import; Slack
  sources are not independently resolvable/attestable."*
- **`import`** (document) — returns the same refusal shape: *"Message originates from an
  imported document; document sources are not independently resolvable/attestable."*
  (`src/cli/retrieval.ts:829-834`).
- **`unknown`/default** — a bare `msg_[a-zA-Z0-9]+` string (the pre-FQ OpenCode shape, matched
  by `OPENCODE_MESSAGE_ID` at `src/cli/retrieval.ts:441`) is treated as legacy OpenCode with no
  machine qualifier, for backward compatibility with data written before this scheme.
  `generate:document:${slug}:${uuid}` — a literal prefix that predates the qualified-ID scheme
  and so cannot be classified by `parseMessageId`'s `integration` field at all — is recognized by
  string prefix and refused with the same "not independently resolvable/attestable" wording
  (`src/cli/retrieval.ts:836-851`). Anything else returns bare `null`.

The refusal return type is deliberate, not a stand-in for "not found." The doc comment above
`ResolvedMessage` states the boundary directly: *"records whose role is 'persona' with no
persona_id at all are explicitly refused — `resolveExternalMessage` returns a discriminable
`ResolverRefusal` ... rather than fabricating a partial result. Bare `null` is reserved for an id
shape the resolver does not recognize at all"* (`src/cli/retrieval.ts:496-501`). A malformed
room-persona-primary message (role `"persona"`, no `persona_id`, so no speaker identity can be
recovered) hits this same refusal path at `src/cli/retrieval.ts:662-667`. Three distinct
non-answers exist on purpose: `{ error }` (resolvable in principle, unavailable on this machine
right now), `{ refused: true, reason }` (this class of source is never independently resolvable,
regardless of machine), and `null` (id shape not recognized at all). Collapsing any of these into
a single "couldn't find it" would erase a real distinction a caller needs.

The pre-FQ function name survives only as a deprecated one-line forwarding shim:
`resolveOpenCodeMessage` is `@deprecated Use resolveExternalMessage` and its body is exactly
`return resolveExternalMessage(id, before, after);` (`src/cli/retrieval.ts:443-450`).

### The refusal boundary is duplicated into a browser-safe classifier, not bypassed

`resolveExternalMessage` dynamically imports five external-integration readers, several of which
touch Node `fs`/SQLite and have no business in a browser bundle. Rather than let the web client's
`fetch_message` tool silently skip refusal and fall through to a local scan for Slack/document/
generated-document IDs, `src/core/utils/message-refusal.ts` mirrors the same three refusal
branches (Slack, imported document, generated document) plus the malformed-room-primary check,
built from nothing but `parseMessageId` and in-memory message data — no I/O, no Node-only
imports (`src/core/utils/message-refusal.ts:1-26`). `classifyRefusedMessageId`
(`:53-78`) and `classifyMalformedRoomPrimary` (`:113-121`) are called by the `fetch_message`
builtin tool executor *before* any local scan or resolver call, on **both** the TUI and browser
tool registrations (`src/core/tools/builtin/fetch-message.ts:5,79-83`). The reason strings are
written to match `resolveExternalMessage`'s wording verbatim, so a caller gets an identical
refusal regardless of which runtime produced it (`src/core/utils/message-refusal.ts:23-25`). This
means the "explicitly refuse, never fabricate" property is not a single-code-path convention that
a browser build happens to inherit — it is independently enforced on both runtimes, in two files,
by design.

### Load-time migration, and the parts of it that never shipped

`migrateMessageIds` (`src/core/migrations.ts:58-176`), invoked once at startup right after
`migrateLearnedOn` (`src/core/processor.ts:252-253`), rewrites pre-FQ data in place:

1. **Ei-native message IDs.** For every persona-thread message with `!message.external` and a
   bare-UUID `id` (matched by `UUID_PATTERN`, `src/core/migrations.ts:4,66`), rewrite
   `id` to `ei:${id}`. The same pass runs over every room's messages, additionally rewriting any
   `parent_id`/`active_node_id` that pointed at a just-rewritten bare UUID
   (`src/core/migrations.ts:63-105`).
2. **Quote `message_id` values.** For every quote whose `message_id` is set and *not* already
   qualified (`isQualifiedMessageId`, i.e. contains no `:`): if it matches the bare
   `msg_[a-zA-Z0-9]+` OpenCode shape, look it up via the OpenCode reader's `getMessageById` and
   verify the quote's stored text still appears in that message's content
   (`matchQuoteInMessage`, reused from the extraction pipeline's own matcher) before qualifying
   it to `opencode:${getMachineId()}:${session.id}:${id}` (`src/core/migrations.ts:122,138-150`).
   If it's a bare UUID instead, look it up against a map of every *already-qualified*
   `ei:`-prefixed message built from this same run's Pass 1 output, again verifying text before
   qualifying to that message's new `ei:${uuid}` ID (`src/core/migrations.ts:110-120,152-161`).
   Anything that doesn't resolve (a different machine's OpenCode session, or an integration this
   migration doesn't check) is left naked and retried on the next launch — the migration is
   designed to be idempotent and incremental, not a one-shot cutover.

**What was never shipped: the plan's document-import migration pass.** The original design
(reproduced above from the source plan) called for a second pass that would find every message
in Emmett's (the document-import persona's) message list carrying a `source_tag` field, rewrite
its `id` to `${source_tag}:${id}`, and delete the `source_tag` field. **No such pass exists in
`migrateMessageIds` today** — the function has exactly the two passes described above, and
neither one reads or writes anything named `source_tag`. A project-wide search for `source_tag`
across `src/` returns zero matches: the field was deleted from the `Message` type
(`src/core/types/llm.ts`) with no runtime code left anywhere that migrates data written under the
old convention.

This is a real, live gap, not a cosmetic one. Document-import messages are written with
`external: true` (`src/core/handlers/document-segmentation.ts:60`), so Pass 1 above — which only
touches `!message.external` messages — correctly leaves them alone; they were never candidates
for `ei:`-qualification and should not be. But that also means Pass 1 provides no safety net:
**any document-import message that predates the current write-time `qualifyDocumentMessage` call
and still carries a bare-UUID `id` plus a leftover `source_tag` key from the old convention would
never be touched by any migration pass that exists today.** Its `id` would stay a naked UUID
indistinguishable from an Ei-native or external-integration UUID, and any quote pointing at it
would fail every check in the quote-migration pass too: it isn't a `msg_...` OpenCode shape, and
it isn't in the `ei:`-qualified map built from Pass 1 (that map is built only from persona/room
messages, never from Emmett's document messages) — so such a quote's `message_id` stays naked
forever, with no path back to a resolvable address. This is a known incomplete piece of the
rollout: real for any state file whose document-import messages were written before the FQ
scheme shipped, and it is not silently swept under a passing migration — it simply has no code
path attempting it.

### Downstream simplification this made possible

- **`unsource.ts`'s** document-source lookup now prefix-matches on the message ID itself
  (`preview.sourceTag.startsWith("import:document:")` / `"generate:document:"`,
  `src/integrations/document/unsource.ts:148-152`) instead of filtering messages by a separate
  `source_tag` field.
- **`processor.ts`'s** generated-document lookups (`getGeneratedDocument`,
  `regenerateDocument`, and the has-content check feeding `onDocumentGenerated`) all match on
  `m.id.startsWith(...)` against the `generate:document:${slug}` prefix
  (`src/core/processor.ts:481-484,493-496,1231-1233`) rather than a `source_tag` equality check.
- **Display-code equality** (`quote.message_id === message.id`) needed no change at all: once
  both sides are fully-qualified by construction, string equality is a real address match instead
  of a coincidence of two equally-naked strings.

## Alternatives Considered

### Alternative A: Keep `source_tag` as the provenance field, leave `id` opaque

- **Description**: Continue tracking origin in a field parallel to `id`, and teach
  `fetch_message` to consult both `id` and `source_tag` depending on message type.
- **Pros**: No migration of existing `id` values required.
- **Cons**: Two fields describing one fact (where a message came from) invites exactly the drift
  that had already happened — `source_tag` covered document imports only, so every other
  integration (OpenCode, Claude Code, Cursor) still had no provenance at all in either field.
  Every new integration would need its own bolted-on side-channel field instead of reusing one
  mechanism.
- **Why not chosen**: Doesn't solve the actual problem — cross-machine/cross-integration routing
  still requires guessing from ID shape for every integration that isn't documents. It also keeps
  two sources of truth for the same fact, which is the failure mode that motivated this decision
  in the first place.

### Alternative B: A lookup table mapping opaque IDs to provenance, instead of encoding provenance in the ID

- **Description**: Keep IDs opaque; maintain a separate persisted index from `id` → `{
  integration, machine, session }`.
- **Cons**: Adds a second data structure that must be kept in sync with every message write, for
  every integration, forever — the exact "parallel, redundant concept" problem `source_tag`
  already demonstrated at a smaller scale. It also cannot be reconstructed from an ID alone if
  the index is ever lost, corrupted, or omitted from an export.
- **Why not chosen**: Encoding provenance directly in the ID means the ID is self-describing with
  no auxiliary state to lose sync with. A caller (or a future migration, or a debugging session
  looking at raw JSON) can read the answer directly off the string.

### Alternative C: Attempt best-effort resolution for every source, including Slack/document/generated-document

- **Description**: Instead of refusing Slack, imported-document, and generated-document sources
  outright, attempt some resolution — e.g. return the stored message content directly from state
  without the surrounding-context/re-resolution guarantees the other integrations provide.
- **Cons**: Would blur the line between "resolved with the same guarantees as every other source"
  and "returned whatever happened to be sitting in memory." A document-import message has no
  independent store to re-resolve against — the message *is* the state, not a pointer into a
  live session in another tool — so "resolving" it doesn't produce the same kind of answer a
  live-session lookup does. Silently returning it anyway would make every caller's success case
  ambiguous between two very different provenance guarantees.
- **Why not chosen**: The explicit-refusal design (Alternative that shipped) makes the limitation
  visible and machine-readable (`{ refused: true, reason }`) instead of quietly returning a
  degraded answer that looks identical to a fully-resolved one.

## Consequences

### Positive

- A message's own ID is now sufficient to know its integration, its originating machine, and its
  session — no auxiliary lookup, no separate field, no guessing from shape alone (which was
  previously ambiguous for bare UUIDs specifically).
- `fetch_message` can route correctly across integrations and machines from the ID alone, and
  distinguishes three genuinely different non-answers (`error`, `refused`, `null`) instead of
  collapsing them into an opaque failure.
- The refusal boundary is enforced identically on both TUI and browser runtimes
  (`message-refusal.ts` mirrors `retrieval.ts`'s three refusal branches without requiring the
  browser bundle to import Node-only readers), so the "never fabricate a partial resolution"
  property holds regardless of which client is asking.
- `source_tag` is gone as a concept; there is exactly one place that encodes provenance (the ID),
  and downstream document-lookup code shrank to prefix checks instead of parallel-field checks.

### Negative

- The plan's second migration pass (rewriting legacy `source_tag`-bearing document-import
  messages to fully-qualified IDs) was never implemented. Any state file with document-import
  messages written before the FQ write path shipped can be left with bare-UUID message IDs and a
  dead `source_tag` key that no code reads anymore, and any quote pointing at one of those
  messages has no migration path to a resolvable `message_id` — it stays naked indefinitely.
- The migration is deliberately incremental (unmatched IDs are left naked and retried on the next
  launch), which means a quote pointing at, e.g., a Claude Code or Cursor message from a *different
  machine* than the one currently running Ei will never be qualified by this migration at all —
  qualification for those requires an integration this migration doesn't itself check.
- `generate:document:${slug}:${uuid}` is a second, structurally different "legacy" shape
  (`parseMessageId` cannot classify it via `ParsedMessageId.integration` — it has no `"generate"`
  branch) that both `resolveExternalMessage` and `message-refusal.ts` have to special-case by
  literal string prefix rather than through the parser. Every future reader of either file has to
  know this one shape exists outside the parser's model.

### Risks

- **The refusal wording is duplicated by hand in two files** (`retrieval.ts` and
  `message-refusal.ts`), kept in sync only by a code comment stating the intent
  (`src/core/utils/message-refusal.ts:23-25`), not by either file importing the other's strings.
  A future edit to one file's reason text with no corresponding edit to the other produces a
  silent, cosmetic divergence — not a correctness bug, but a caller-visible inconsistency between
  runtimes that nothing catches automatically.
- **The unshipped document migration pass has no tracking mechanism of its own.** Nothing in the
  codebase flags a naked-UUID document-import message as "needs migration" versus "was never a
  document message at all" — the absence is invisible until someone specifically looks for
  `source_tag` in a state file and finds it dead. This ADR is, at present, the only place this gap
  is written down.
- **`parseMessageId`'s `unknown` fallback and the two literal-prefix special cases
  (`msg_...`, `generate:document:...`) are backward-compatibility surface that has no expiration.**
  Every one of these must be preserved indefinitely, or old data (or a quote pointing at old data)
  silently stops resolving instead of erroring loudly — there is no version marker in state that
  would let a future cleanup safely assume the legacy shapes are gone.

## Reversibility

**Low, for data already migrated; moderate for the architecture itself.** The parser, the
`qualify*` helpers, and `resolveExternalMessage`'s switch-per-integration structure could be
replaced by a different scheme without much difficulty — nothing outside `message-id.ts` and
`retrieval.ts`'s dispatch depends on the exact string format, only on the parsed
`{ integration, machine, session, nativeId }` shape. Reversing the *migration*, however, is not
practical: once a bare UUID has been rewritten to `ei:${uuid}` (or a quote's naked `msg_xxx` has
been rewritten to `opencode:${machine}:${session}:${msg_xxx}`), there is no stored record of the
pre-migration value to roll back to — the rewrite is in place, not additive. Any new provenance
scheme would need its own forward migration from the current fully-qualified shapes, not a
reversal of this one. The unshipped Pass 2 remains implementable independently at any time — it
was never removed by a later change, it simply was never written — so closing that specific gap
does not require re-opening this decision.

## References

- `src/core/utils/message-id.ts:1-152` — the ID-shape header comment, `parseMessageId`, and every
  `qualify*` helper
- `src/cli/retrieval.ts:441-855` — `resolveOpenCodeMessage` (deprecated forwarding shim),
  `ResolverRefusal`, `ResolvedMessage`/`ResolvedMessageOriginKind`, and `resolveExternalMessage`'s
  full per-integration switch including the five machine-mismatch `{ error }` branches and the
  Slack/document/generated-document `{ refused: true }` branches
- `src/core/utils/message-refusal.ts:1-121` — the browser-safe mirror of the same three refusal
  branches plus the malformed-room-primary check, and its rationale for existing independently of
  `retrieval.ts`
- `src/core/tools/builtin/fetch-message.ts:5,79-91` — the `fetch_message` builtin tool calling the
  browser-safe classifier before any local scan, on both TUI and browser registrations
- `src/core/migrations.ts:58-176` — `migrateMessageIds`, its two shipped passes (Ei-native
  message IDs; quote `message_id` qualification via `matchQuoteInMessage`-verified lookup), and
  the absence of any `source_tag`-driven document-migration pass
- `src/core/processor.ts:252-253` — the startup call site, immediately after `migrateLearnedOn`
- `src/core/handlers/document-segmentation.ts:8,54,60` — document-import write site using
  `qualifyDocumentMessage`, and the `external: true` flag that keeps these messages out of Pass 1
- `src/core/handlers/knowledge-synthesis.ts:23` — the legacy `generate:document:${slug}:${uuid}`
  literal-ID write site, predating the qualified-ID scheme
- `src/integrations/document/unsource.ts:148-152` — prefix-based document-source lookup replacing
  the old `source_tag` equality check
- `src/core/processor.ts:481-484,493-496,1231-1233` — prefix-based generated-document lookups
- `tests/unit/core/utils/message-id.test.ts`, `tests/unit/core/utils/message-refusal.test.ts` —
  unit coverage for the parser and the browser-safe refusal classifier

# ADR-026: Third-Party Integrations Are Scoped Per-Harness, Not Per-Vendor

## Status

Accepted

## Date

2026-08-03

## Kind

Backfill

## Context

This decision was made in chat on 2026-07-18 by Flare and Sisyphus, with no code written at
decision time and no contemporaneous record — it lived only in `.sisyphus/docs/` (gitignored,
never committed) until this backfill. What follows reproduces that decision's substance in full,
since the source file is deleted once this migration lands.

Flare asked Ei whether it imports Claude Desktop's `Code` tab session history
(`~/.claude/projects/`). It does: `src/integrations/claude-code/reader.ts` reads that path via
`getDefaultProjectsPath()`, which hardcodes `join(process.env.HOME, ".claude", "projects")`
(`src/integrations/claude-code/reader.ts:35-37`), gated behind `human.settings.claudeCode`
(`src/core/types/entities.ts:135`).

A prior claim — that the CLI and Desktop's `Code` tab write to two *different* paths — was checked
and found wrong: both write to the same `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl` file.

A second claim — that Desktop's `CoWork` and `Chat` tabs are "100% ephemeral, server-side only,
nothing on disk" — was also checked, and turned out half right. Flare ran a live experiment: one
throwaway message in each of Desktop's `Chat`, `CoWork`, and `Code` tabs (Desktop app only, no
CLI), each carrying a unique grep-able marker string. Results:

| Tab | Found locally? | Where |
|---|---|---|
| **Code** | Yes | `~/.claude/projects/-Users-flare576-Projects-RP/0acef1d4-....jsonl` — the same path/format `claude-code/reader.ts` already reads. |
| **CoWork** | Yes, different root | `~/Library/Application Support/Claude/local-agent-mode-sessions/<workspace-uuid>/<window-uuid>/local_<uuid>/.claude/projects/<encoded-vm-path>/<cli-session-uuid>.jsonl` — CoWork runs in a sandboxed VM (`claude-code-vm/`, backed by a `claudevm.bundle` disk image); each session gets its own private `.claude` root that never touches the host's `~/.claude/projects/`. Same record schema as Code (`type: "user"/"assistant"/"system"` records) — confirmed no dual-write by grepping the CoWork session's `cliSessionId` against everything under `~/.claude/projects/` and getting zero hits. |
| **Chat** | No | Marker not found anywhere under `~/.claude` or `~/Library/Application Support/Claude/` (excluding the opaque 6.7 GB `vm_bundles/*.img` VM disk images, which weren't mounted/inspected). Consistent with — but not proof of — fully server-side storage. |

This is corroborating evidence, not proof, for Chat being server-side: the unexamined VM disk
image is exactly the kind of irreversible-if-botched inspection (mounting a live app's backing
disk) that wasn't attempted without explicit sign-off.

Two ways to model this in Ei's integration layer:

1. **Rename `claudecode` → `claude`, import "the whole ecosystem"** — one vendor-level integration
   reading Chat + CoWork + Code as facets of one Anthropic surface.
2. **Add `cowork` as a new sibling integration next to `claudecode`** — keep integrations scoped
   per *harness/product surface*, not per *vendor*.

## Decision

**Ei models third-party integrations per harness/product surface, not per vendor.** Concretely:
add `cowork` as a new top-level integration, a sibling to `claudecode`, `opencode`, `cursor`,
`codex`, and `pi` — not a vendor-level rename or merge of `claudecode` into a broader `claude`
integration spanning Chat, CoWork, and Code.

This matches existing precedent already in source: `opencode`, `cursor`, `codex`, and `pi` are
four separate top-level integrations in `src/integrations/` despite all being "just" terminal
coding agents from different vendors, each wired into `IntegrationSyncManager` as its own
`checkAndSync*` method (`checkAndSyncClaudeCode`, `checkAndSyncCursor`, `checkAndSyncCodex`,
`checkAndSyncPi` — `src/core/integration-sync-manager.ts:83-108,207,260,313,367`) and its own
settings block on `HumanEntity.settings` (`claudeCode?`, `cursor?`, `codex?`, `pi?` —
`src/core/types/entities.ts:135-138`). `claudecode` and `cowork` being both Anthropic-branded
doesn't make them one product: different storage root (real host filesystem vs. VM-isolated
sandbox), different sandbox model, and a different tool surface — CoWork sessions carry MCP tool
grants (e.g. `mcp__Claude_in_Chrome__*`) that Code sessions don't have. Same reasoning, applied
consistently, is why they stay split rather than merged.

Chat is out of scope for this decision: no locally-readable transcript was found, and Ei's
integrations are filesystem readers — a server-side surface would need a fundamentally different
(API-based) integration shape if pursued at all.

**This ADR is the *why*; GitHub issue #91 ("feat(integrations): add CoWork integration"), filed
2026-07-19 and still OPEN as of this writing, is the *what*.** It specifies the concrete shape: a
new `human.settings.cowork` block mirroring `ClaudeCodeSettings`, a reader that recursively
discovers `local-agent-mode-sessions/**/local_*/.claude/projects/**/*.jsonl`, a new single
synthetic `"CoWork"` persona (not folded into the existing `"Claude Code"` persona), a new
`checkAndSyncCoWork()` wired into `IntegrationSyncManager.checkAll()`, and a new `"cowork"`
message-ID qualifier type.

### An open, deliberately-deferred tangent

Applying "per-harness, not per-vendor" consistently surfaces an existing inconsistency, found but
**not actioned** by this decision: `src/integrations/pi/` currently treats vanilla Pi and OhMyPi
(OMP) as a single persona. Verified against current source:

- `PI_PERSONA_NAME = "Pi"` (`src/integrations/pi/types.ts:126`).
- The persona created under that name carries `aliases: ["pi", "pi coding agent", "omp",
  "oh-my-pi"]` (`src/integrations/pi/importer.ts:68`) — both `"pi"` and `"oh-my-pi"` collapse into
  the one alias list of the one persona.
- `importer.ts:180` explicitly comments this as the "Single-persona path (vanilla Pi / OMP without
  active agent)" — the conflation is deliberate in the current code, not an oversight, but it
  predates this ADR's reasoning being applied to it.

Vanilla Pi and OhMyPi are arguably as distinct a pair as `claudecode`/`cowork` — a different
orchestration layer sitting on top of the same underlying agent loop, the same shape of
distinction that motivated splitting `cowork` out from `claudecode`. This decision does **not**
resolve that inconsistency. It is flagged here explicitly so it isn't silently "fixed" by
inconsistency the next time someone touches `src/integrations/pi/` — if it's worth splitting, that
is its own future ADR and issue, not a drive-by rename riding on this one.

## Alternatives Considered

### Alternative A: Rename `claudecode` → `claude`, one vendor-level integration for Chat + CoWork + Code
- **Description**: Treat all three Claude Desktop tabs as facets of a single Anthropic integration.
- **Pros**: One settings block, one persona, one place to look for "everything Claude." Feels
  natural given all three share a vendor and (for Code/CoWork) a record schema.
- **Cons**: Breaks with the `opencode`/`cursor`/`codex`/`pi` precedent of scoping by product
  surface. Code and CoWork have materially different storage roots, sandbox models, and tool
  surfaces — collapsing them loses that distinction in the data model (which persona/session a
  given piece of context came from). Chat's server-side nature would force an awkward partial
  member of a "unified" integration that can't actually be read the same way as the other two.
- **Why not chosen**: The distinction per harness is exactly the information Ei's integration
  model is built to preserve, and every existing sibling integration already proves vendor
  identity is not the scoping axis in use.

### Alternative B: Fold CoWork transcripts into the existing `claudecode` integration/persona
- **Description**: Keep one `claudecode` integration and reader, but point it at both the host
  `~/.claude/projects/` root and the CoWork sandbox roots, merging everything into the existing
  `"Claude Code"` persona.
- **Cons**: Same record schema does not imply same product — the discovery roots, sandbox
  isolation, and tool-grant surface differ enough that merging would blur which sessions came from
  a real host filesystem versus an ephemeral sandboxed VM, information likely to matter later
  (e.g. for trust-weighting or debugging why a session's files don't exist on disk).
- **Why not chosen**: Same underlying reasoning as Alternative A, at the persona/reader level
  rather than the settings/naming level.

## Consequences

### Positive

- Integration granularity stays consistent with the four other coding-agent integrations already
  in `src/integrations/` — no special-casing Anthropic's multi-surface product.
- Preserves a genuinely useful distinction: a session read via `cowork` is known to have run in an
  isolated VM sandbox with a different tool-grant surface, information that would be lost if
  merged into `claudecode`.
- Gives issue #91 an unambiguous, already-decided shape to implement against — no rename/merge
  question left open when that work starts.

### Negative

- Users see `claudecode` and `cowork` as two separate settings toggles/personas for "the same
  company's product," which may read as more integrations than necessary to someone unfamiliar
  with the underlying storage-model differences.
- The Pi/OMP inconsistency now has a documented, correct rationale for splitting it (this ADR's own
  reasoning) sitting unactioned in the codebase — a future reader could reasonably ask why the same
  logic wasn't applied there too. That risk is deliberately accepted rather than resolved here.

### Risks

- **The deferred Pi/OMP question could get "fixed" incidentally.** A future edit to
  `src/integrations/pi/` for an unrelated reason could quietly split the persona as a drive-by
  change, without the dedicated ADR+issue this document calls for — losing the chance to weigh it
  as a real decision with its own alternatives.
- **Issue #91 could drift from this ADR's shape.** If CoWork's storage layout changes before #91
  ships (Anthropic could restructure `local-agent-mode-sessions/**`), the concrete reader shape in
  the issue would need re-verification; this ADR's decision (sibling integration, not a merge)
  would still hold regardless.

## Reversibility

Moderate. Splitting `cowork` back out of a hypothetical merged `claude` integration (or vice
versa) is a data-model change: any already-imported sessions would carry `sources` entries and
persona links keyed to whichever shape was live at import time (`data-items.ts:18`'s
`"provider:id"` namespacing). Reverting after `cowork` sessions exist would require a migration to
re-key those sources and re-attribute persona history, not just a rename. Reversing course *before*
issue #91 ships (the current state) costs nothing — no code exists yet.

## Rationale Provenance

- **STATED**: The live-experiment findings (storage roots, schema-compatibility, no dual-write, MCP
  tool-grant differences) are reproduced directly from the original decision record and independently
  re-verified against current source in this backfill — `getDefaultProjectsPath()`
  (`claude-code/reader.ts:35-37`), the sibling settings blocks (`entities.ts:135-138`), and the
  sibling `checkAndSync*` methods (`integration-sync-manager.ts:83-108`).
- **STATED**: The Pi/OMP conflation is stated directly in source as deliberate — the "Single-persona
  path (vanilla Pi / OMP without active agent)" comment at `pi/importer.ts:180`, and the single
  `PI_PERSONA_NAME` with both `"omp"`/`"oh-my-pi"` and `"pi"` aliases at `pi/types.ts:126` and
  `pi/importer.ts:68` — confirmed still true as of this writing.
- **INFERRED**: The claim that `cowork`/`claudecode` splitting "matches existing precedent" is
  inferred from the structural fact that `opencode`/`cursor`/`codex`/`pi` are four separate
  integrations in current source, not from an explicit design note stating that precedent as a
  rule.
- **UNRECORDED**: Why the *original* four-integration split (`opencode`/`cursor`/`codex`/`pi`)
  was chosen per-vendor-terminal-agent rather than some other grouping is not written anywhere in
  current source; this ADR only confirms the split is real and consistent, not why it was first
  made that way.

## References

- Issue #91 — `feat(integrations): add CoWork integration` — OPEN as of this writing; the *what*
  this ADR's *why* supports
- `src/integrations/claude-code/reader.ts:35-37` — `getDefaultProjectsPath()`, the existing Code
  tab / CLI discovery root
- `src/integrations/pi/types.ts:126` — `PI_PERSONA_NAME = "Pi"`
- `src/integrations/pi/importer.ts:68,180` — the merged Pi/OMP alias list and the single-persona
  path comment; the flagged, deliberately-deferred inconsistency
- `src/core/types/entities.ts:131-138` — `HumanEntity.settings`'s sibling integration blocks
  (`opencode`, `claudeCode`, `cursor`, `codex`, `pi`)
- `src/core/integration-sync-manager.ts:83-108,207,260,313,367` — the four sibling
  `checkAndSync*` methods proving the per-harness precedent
- `src/core/types/data-items.ts:18` — `sources`'s `"provider:id"` namespacing, relevant to
  reversibility

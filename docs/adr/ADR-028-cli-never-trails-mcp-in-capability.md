# ADR-028: The CLI Never Trails MCP in Capability — MCP Is a Thin Wrapper, Not a Second Implementation

## Status

Accepted

## Date

2026-08-03

## Context

Ei ships two surfaces for the same underlying operations: the CLI (`ei ...`) and an MCP server
(`ei mcp`) exposed to Claude Code, Cursor, Codex, and OpenCode. `src/cli/README.md:96` states the
intended relationship directly:

> `ei --install` removes any Ei MCP registration from Claude Code, Cursor, and Codex by default —
> every MCP tool (`ei_search`, `ei_lookup`, `ei_fetch_message`, `ei_create`, `ei_update`,
> `ei_remove`, `ei_quote_create`, `ei_quote_fix`, `ei_quote_relink`) is a thin wrapper over the same
> CLI/corrections-queue code the `ei-search`, `ei-curate`, and `ei-persona` skills already teach
> agents to call directly.

And `src/cli/README.md:60`:

> every capability those MCP tools offered has a skill or CLI equivalent, so there's no longer a
> persistent `ei mcp` process sitting around per open session

This is why MCP registration is removed by default on three of the four supported harnesses
(`src/cli.ts` `--install` behavior) — the design bet is that the CLI plus skills fully cover MCP's
capability, so most users never need the extra process.

**That bet went unenforced.** `ei_fetch_message` (`src/cli/mcp.ts:181-201`) exposes `before`/`after`
parameters and threads them into `resolveExternalMessage(id, before, after)`
(`src/cli/retrieval.ts:606-610`), which already supports a full surrounding-message context window
for every integration it resolves (`opencode`, `ei`-direct, `ei`-room, and others). The CLI's `--id`
flag calls the exact same function — but before this ADR's companion fix, called it with no
`before`/`after` arguments at all, silently defaulting both to `0` with no flag to request
otherwise. (That call site is now fixed; the pre-fix state is not reproduced here by line number,
since fixing it necessarily moved the lines — see this decision's own commit for the exact diff.)
An agent with MCP disabled (the default posture on three of four harnesses) could look up a
quote's source message but never read the conversation around it —
exactly the capability the README claims the CLI already has.

This was found while investigating unrelated data — cross-referencing a quote's over-broad topic
links required reading the message before/after it to judge context, and the CLI had no way to do
that. The MCP tool did. That gap is what this ADR exists to close, structurally, rather than leaving
the "MCP is a thin wrapper" claim as prose nobody checks against.

## Decision

**MCP tool capability is a ceiling on the CLI, not a separate offering. Any parameter a shared
underlying function accepts must be reachable from the CLI, even if the CLI's caller (an agent
skill) is expected to use it less often than a chat-embedded MCP tool would.**

Concretely, for this instance: `ei --id <message-id>` now accepts `--before <N>` and `--after <N>`,
parsed in `src/cli.ts` next to the existing `--id` handling and passed straight into the same
`resolveExternalMessage(id, before, after)` call `ei_fetch_message` already used
(`src/cli.ts:600-605`). No new resolver logic — the capability already existed and was already
correct; only the CLI's argument surface was missing.

Going forward, when a new MCP tool is added or an existing one gains a parameter, the CLI path over
the same underlying function must gain the equivalent flag in the same change — not as a follow-up,
not "if someone asks." Adding an MCP-only parameter is the exact failure mode this ADR closes.

## Alternatives Considered

### Alternative A: Leave `--before`/`--after` MCP-only; document that context-window reading requires MCP
- **Description**: Accept the gap, adjust the README to say the CLI covers lookup but not
  surrounding-context reading, which needs MCP.
- **Pros**: Zero code change.
- **Cons**: Directly contradicts the stated default posture — MCP is *removed* by default on three
  of four harnesses specifically because the CLI is supposed to be sufficient. Undermines the whole
  reason `--install` strips MCP registration: the tradeoff was "you lose nothing meaningful," and
  this gap is exactly a meaningful loss (reading a quote's real conversational context, the primary
  tool for judging whether extracted data means what it claims to).
- **Why not chosen**: The gap wasn't a deliberate CLI/MCP split; it was an oversight. Codifying it
  as intentional would be worse than fixing it.

### Alternative B: Re-enable MCP by default instead of closing CLI gaps as they're found
- **Description**: Treat MCP as the primary surface again, stop trying to keep the CLI at parity.
- **Cons**: Reverses the v1.8.0 migration (tagged "MCP = My CLI, Please" per this repo's release
  history) without a new architectural reason to do so — that migration's stated motivation was that
  a persistent `ei mcp` process per open session "bought nothing" once the CLI covered the same
  ground. Re-enabling MCP by default doesn't fix the underlying gap-detection problem; it just
  changes which surface has the gap.
- **Why not chosen**: Doesn't address the actual failure (parity checked by nobody), just picks a
  different default surface to be the one that's occasionally behind.

### Alternative C: A structural/fitness-function check enforcing MCP-tool-param ↔ CLI-flag parity automatically
- **Description**: Add a check to `ci/structural-checks.sh` (or equivalent) that fails if an MCP
  tool's Zod schema declares a parameter with no matching CLI flag reachable through the same
  underlying function.
- **Pros**: Would have caught this exact gap mechanically, at the time it was introduced, without
  needing an agent to stumble into it mid-investigation.
- **Cons**: Nontrivial to write generically — MCP tools and CLI flags don't share a common schema
  representation today; a real check would need either a shared parameter manifest per operation or
  fragile text/AST matching between `mcp.ts`'s `inputSchema` blocks and `cli.ts`'s `args.indexOf`
  calls.
- **Why not chosen for this pass**: Real value, but a larger investment than this specific fix
  justifies alone. Recorded as a **Risk**, below, rather than deferred silently.

## Consequences

### Positive

- `ei --id <message-id> --before N --after N` now gives the CLI the same conversational-context
  read MCP already had, closing the gap that motivated this ADR.
- The underlying resolver (`resolveExternalMessage`) needed zero changes — this was purely a
  missing argument-parsing path in the CLI entrypoint, the cheapest possible fix for this class of
  gap.
- Reaffirms the CLI as capable of everything a harness with MCP disabled by default (Claude Code,
  Cursor, Codex) needs, closing a real hole in that default posture rather than leaving it
  documented-but-false.

### Negative

- No mechanical enforcement exists yet (see Alternative C) — the next MCP-only parameter added to
  a tool in `src/cli/mcp.ts` can silently reintroduce this exact gap, and nothing will fail CI to
  catch it. This ADR's decision is a standing practice, not a guardrail.

### Risks

- **The parity claim in `src/cli/README.md:96` ("thin wrapper over the same ... code") is aspirational
  prose, not a verified invariant.** This ADR closes one instance; it does not audit every other MCP
  tool (`ei_search`, `ei_lookup`, `ei_create`, `ei_update`, `ei_remove`, `ei_quote_create`,
  `ei_quote_fix`, `ei_quote_relink`) for the same class of gap. A full audit is explicitly out of
  scope here and is tracked as follow-up work, not silently assumed clean.
- **Fitness-function enforcement (Alternative C) remains undone.** Until it exists, this decision
  depends entirely on whoever adds the next MCP parameter remembering to read this ADR.

## Reversibility

Trivial to reverse for this one instance — removing `--before`/`--after` from the CLI's `--id`
handling is a two-line revert with no data or migration impact. The broader *decision* (CLI must
not trail MCP) is a standing practice, not a piece of code; reversing it means explicitly choosing
to let CLI and MCP capability diverge again, which is Alternative A, reconsidered.

## References

- `src/cli/README.md:60,96` — the stated "thin wrapper" / "no capability gap" design intent
- `src/cli/mcp.ts:181-201` — `ei_fetch_message`'s `before`/`after` schema, the MCP side of the gap
- `src/cli/retrieval.ts:606-610` — `resolveExternalMessage(id, before, after)`, the shared function
  both surfaces call
- `src/cli.ts:596-605` — the CLI's `--id` handling, where the fix landed
- ADR-012 — the sunset-with-a-path-forward pattern this repo already uses when retiring one surface
  in favor of another; not directly applicable here since MCP is being kept alive deliberately, but
  the same "don't silently strand a caller" instinct motivates this decision

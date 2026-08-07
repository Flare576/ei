# ADR-034: Session-Boundary Hook Races Are Accepted Across OMP, Claude Code, and Cursor

## Status

Accepted

## Date

2026-08-07

## Context

Tonight's work added identity ("WHO") and memory-dedup ("MEMORY") context injection to Ei's OMP, Claude
Code, and Cursor hooks (`src/cli/install.ts`). All three WHO mechanisms, and one of the three MEMORY
mechanisms, share the same shape of hazard: **a hook that announces something at a session boundary can
race the very first read of that boundary's own output**, because none of the three harnesses' relevant
hook events block the agent loop while the hook runs. This record exists so that is a decision someone
made rather than something nobody noticed — the same reason ADR-008 exists for Ei's own write races.

Four races are recorded here. Three share one mechanism (a fire-and-forget hook can lose a race against
the first read of what it was supposed to set up). The fourth is a distinct hazard specific to Cursor's
platform constraints, but resolves to the same *shape* of outcome — a bounded, self-correcting staleness
window, never permanent corruption — which is why it belongs in the same record.

### Race 1 — OMP: `cyclePersona()` vs the WHO hook's `activePersonaName` read

`cyclePersona()` (the Tab-switch handler) is launched fire-and-forget from the input controller
(`packages/coding-agent/src/modes/controllers/input-controller.ts:443-452` in oh-my-pi). It calls
`applyAgentPersona()`, which can await model/provider-session work
(`packages/coding-agent/src/session/model-controls.ts:205-249`) before it actually assigns the new
`#activePersona` (`packages/coding-agent/src/session/agent-session.ts:6666-6679`, `:6711`).

If a prompt is submitted during that window, the WHO hook's `ctx.activePersonaName` read
(`src/cli/install.ts`, `installOmp()`'s WHO handler) still returns the **outgoing** persona's name, not
the one the user just switched to. The hook then either wrongly re-announces the old identity (if it
differs from the last branch marker) or wrongly suppresses the new one (if the old identity happens to
match). Either way, the correct identity is announced on the very next turn, once `applyAgentPersona` has
actually completed and the branch marker catches up — this is self-correcting, not permanent.

This race is narrower than Races 2 and 3: it requires a Tab-press followed by a prompt submission inside
a specific in-flight window, not merely "the first prompt of a new session."

### Race 2 — Claude Code: `SessionStart` vs the first `UserPromptSubmit`

Claude Code's hooks reference (`code.claude.com/docs/en/hooks`) is explicit that `UserPromptSubmit`
**blocks model processing until it completes** — stated directly, with a 30-second default timeout
specifically because of that blocking behavior. `SessionStart` carries no equivalent language anywhere in
the same reference; its own decision-control row states only "No blocking or decision control" (which
documents that a `SessionStart` hook cannot block the *session* from starting, not whether the first
*prompt* waits for it).

**This is inferred, not stated.** No sentence in Claude Code's documentation says the first prompt in a
new/resumed/forked session can be processed before a concurrently-running `SessionStart` hook's
`additionalContext` attaches. The inference rests on the asymmetry above: `UserPromptSubmit` earns
an explicit blocking guarantee (and a timeout budget) precisely because the timing matters there;
`SessionStart` earns neither. If that inference is wrong and `SessionStart` actually is synchronous
with respect to the first prompt, this race does not exist for Claude Code — but nothing in the
current documentation lets us rule it out, so it is recorded as a real possibility rather than
assumed away.

### Race 3 — Cursor: `sessionStart` vs the first `beforeSubmitPrompt`

Cursor's hooks reference (`cursor.com/docs/hooks`) states this one directly, not by inference:
`sessionStart` "runs as fire-and-forget; the agent loop does not wait for or enforce a blocking
response." The first prompt in a brand-new Cursor conversation can therefore be sent to the model before
the `additional_context` from our `ei-session-start.ts` hook lands — the identity block may not appear
until the second message of a session, not the first.

### Race 4 — Cursor: the shared rules file has no session-scoping primitive

This is a different hazard from the first three, and it exists only because of a Cursor-specific
platform gap: **`beforeSubmitPrompt`'s entire output schema is `{ continue, user_message }` — confirmed
directly from the docs, no context field exists on it at all.** OMP and Claude Code can put fresh MEMORY
content directly into the hook's own return value, scoped to the triggering turn. Cursor cannot; the only
per-turn content channel is rewriting `~/.cursor/rules/ei-context.mdc`, an `alwaysApply` rule file that
is unconditionally included in *every* session's context — global, not session-scoped, at the layer Cursor
loads rules.

Cursor genuinely supports concurrent sessions — background agents (up to 8 in parallel), Side Chats
(introduced Cursor 3.11), and multiple Composer windows via separate worktrees — so a single shared file
has no way to represent "whose turn is this" on its own.

Our mitigation (`src/cli/install.ts`, Cursor's `beforeSubmitPrompt` hook): per-session bookkeeping lives in
an isolated state file keyed by `conversation_id` (`~/.cursor/ei-hook-state/<id>.json`, same
`SAFE_SESSION_ID`-validated, 0700/0600-permissioned pattern already built for Claude Code), and the shared
rules file is treated as a pure render target — every hook firing swaps in *that session's own* current
accumulated view, atomically (write-to-temp-then-`rename`).

**What this does and does not fix.** Two sessions' content is never merged — each swap is always exactly
one session's clean, internally-consistent view. What it does not fix: a session that is not the most
recent speaker can see a *different* session's view for one turn when sessions interleave, until it
speaks again and reclaims the file. Whether this is one-turn-stale or effectively immediate depends on
whether `beforeSubmitPrompt`'s file write, for the session that triggered it, lands before or after that
*same* triggering request reads the rules directory — **this ordering is not documented anywhere in
Cursor's hooks reference and is recorded here as unknown**, not assumed in either direction. The
implementation is deliberately conservative: it assumes the write is always one turn late, and is correct
either way if that assumption turns out to be pessimistic.

## Decision

**Accept all four. Document all four. Fix none.**

For Races 1–3: closing any of them requires the harness itself to make its session/tab-switch hook
blocking, which is a decision none of the three projects have made (and two document as deliberate —
Cursor explicitly, Claude Code by omission and asymmetry with `UserPromptSubmit`). Ei's install-time hook
scripts have no way to force a harness's own event loop to wait on them. The only lever Ei controls is
*what the hook does once it runs*, not *when the harness lets it run*.

For Race 4: the alternative is either (a) a single shared, ever-growing, cross-session-merged file — which
was seriously considered and rejected during design, see Alternatives — or (b) session-scoped rule files,
which Cursor's rules system has no mechanism to honor (`alwaysApply` has no session predicate). Given
those are the only two other shapes available, render-and-swap against isolated per-session state is the
best of the three, not a compromise reached under time pressure.

**All four races are self-correcting, not permanent.** The worst outcome in every case is "the wrong (or
no) identity/memory context for exactly one turn, then it corrects itself." None can leave two sessions'
content permanently blended, and none can crash a hook process (verified — see References for the test
files covering forced-failure paths).

## Alternatives Considered

### For Races 1–3: poll or delay the first turn

- **Description**: have the hook script itself, or the harness's prompt-submission path, wait/retry until
  the identity-setting operation is known to have completed before proceeding.
- **Pros**: closes the race outright.
- **Cons**: none of the three harnesses expose a "wait for this hook" primitive from the *prompt*-submission
  side — the blocking behavior (or its absence) is a property of the harness's own event loop, not
  something an installed hook script can add after the fact. Implementing this would mean patching the
  harness itself, which is out of scope for an npm package that only installs configuration and scripts
  into harnesses it doesn't own.
- **Why not chosen**: not implementable from where Ei's hooks run.

### For Race 4: one shared file, content merged (never scoped) — Sisyphus's own first draft, rejected

- **Description**: skip per-session state entirely. On every `beforeSubmitPrompt` firing, parse whatever
  ids are already embedded in the rendered `ei-context.mdc`, append only genuinely new ids, and never
  reset. One growing, permanently shared record.
- **Pros**: no separate state directory, no per-session bookkeeping files, "no other record keeping
  needed."
- **Cons**: two real defects, both caught before implementation (this exact alternative was proposed,
  then retracted, in the session that produced this ADR). First, **unbounded cross-session content
  mixing**: Session A's and Session B's memory would permanently blend into one array with no way to tell
  them apart later, unlike Race 4's accepted design where a swap always reflects exactly one session.
  Second, **unbounded per-turn cost within a single long session**: because `alwaysApply` resends the
  *entire* file every turn (unlike OMP/Claude Code, where an already-shown item costs zero tokens once
  shown), a never-evicting shared array means every old item is paid for again, forever, on every single
  prompt for the rest of the session.
- **Why not chosen**: makes the *existing*, already-imperfect behavior (last speaker wins, transient
  overwrite) strictly worse — trades a transient, self-correcting bug for a permanent, growing one.

### For Race 4: per-session rule files, one per `conversation_id`

- **Description**: write `~/.cursor/rules/ei-context-<conversation_id>.mdc` per session instead of one
  shared file, hoping Cursor scopes `alwaysApply` rules to the session that created them.
- **Pros**: would give genuine session isolation at the delivery layer, not just the bookkeeping layer, if
  it worked.
- **Cons**: nothing in Cursor's rules documentation (`cursor.com/docs/rules`) describes any session-scoping
  predicate for `.mdc` files — `alwaysApply: true` is stated to apply to "every chat session," full stop.
  Every open session would very likely see the union of every other open session's file, which is worse
  than today's single-file "last writer wins" — now *every* session accumulates *every* other session's
  content simultaneously, with no bound at all.
- **Why not chosen**: relies on a platform capability that isn't documented to exist, and the failure mode
  if it doesn't exist is worse than the status quo.

### For Race 4: overwrite with only this turn's fresh items, no accumulation at all

- **Description**: closest to the *previous* shipped behavior (`ei --recent -n 10`, unconditional
  overwrite) but using prompt-relevant search instead of `--recent`. No per-session state, no accumulation,
  no cap.
- **Pros**: simplest possible change from what shipped before tonight; zero new state files.
- **Cons**: a session that asked about topic X three turns ago and gets a fresh, unrelated topic Y this
  turn would lose topic X from context entirely, even though it might still be relevant to the ongoing
  conversation — this is strictly less useful than what OMP/Claude Code's *accumulate-and-dedup* design
  provides, and was the actual complaint that started tonight's work (Jeremy: "we're not filtering the
  messages").
- **Why not chosen**: solves Race 4 by not having a MEMORY feature worth the name.

## Consequences

### Positive

- Every WHO/MEMORY hook across all three harnesses degrades to "briefly stale or absent," never to a
  crash, a hang, or permanently corrupted cross-session state — verified directly: every hook's forced-
  failure path (bad session id, unwritable state directory, malformed input) is covered by a real
  subprocess test in `tests/unit/cli/install-omp.test.ts`, `install-claude-code.test.ts`, and
  `install-cursor.test.ts`.
- Cursor's MEMORY hook, despite having the least capable underlying platform primitive (no context
  field on its only per-turn hook), ends up with genuine per-session dedup — arguably a better testable
  correctness guarantee than the two harnesses whose platform actually gives them richer hooks, because
  every unit of it is a local file Ei fully owns.
- The alternative that was *actually proposed by a human* mid-session — append-only, one shared record,
  no bookkeeping — is preserved here as a rejected alternative with a specific failure mode, not silently
  dropped. Future contributors reconsidering "why not just append" get the answer without re-deriving it.

### Negative

- **A user acting immediately after a persona switch (OMP), a session start/resume/fork (Claude Code), or
  a new conversation (Cursor) may not see updated identity context on their very first message.** This is
  the direct, user-visible cost of Races 1–3, and it is silent — none of the three hooks can detect that
  they lost the race, so none can warn the user it happened.
- **Cursor's Race 4 additionally means a session that isn't the most recent speaker can briefly show a
  different session's memory context** if the user or a background agent interleaves turns across
  multiple open sessions quickly. Also silent, same reasoning.
- Cursor's MEMORY design carries a real, disclosed token-cost tradeoff: the accumulated array is resent in
  full on every turn (capped at 30 items), unlike OMP/Claude Code where an already-shown item is free
  after its first showing. A long, single Cursor session with many distinct relevant topics will cost more
  per turn, over time, than the equivalent OMP or Claude Code session.

### Risks

- **Silence is the whole problem, same as ADR-008's Race 1/2.** None of these four races produce an error,
  a warning, or a log line visible to the user. A missing WHO block or a stale MEMORY view is
  indistinguishable from "nothing relevant to show" from the user's side. If ever reported, expect "Ei
  didn't seem to know who it was talking to at the start of that chat" with no clean reproduction.
- **Race 4's ordering assumption (write-lands-after, not before, the triggering read) is unverified.** It
  was designed conservatively specifically because it could not be confirmed either way from documentation.
  If Cursor's actual behavior is same-turn (write completes before the triggering request reads rules),
  the design still works correctly — it would simply mean the "1 turn behind" framing is more pessimistic
  than reality, never less.
- **Race 2's inference could be wrong in either direction.** If Claude Code's `SessionStart` is in fact
  synchronous with the first prompt, Race 2 does not exist and this document overstates Claude Code's
  exposure. If a future Claude Code release changes `SessionStart`'s timing (in either direction) without
  a corresponding documentation change, this record would not catch that regression — there is no test
  that can observe real harness timing from outside a live Claude Code session.
- **All three harnesses can change this out from under Ei with no warning.** Cursor's hook system was
  described in ecosystem writeups as still evolving as of late 2025; Claude Code ships frequent hook-schema
  refinements (the stale-`session_id` bug fixed in 2.0.24 is a direct precedent, see References). A future
  version could make any of these events blocking, non-blocking, or change their input/output schema
  entirely, and nothing in Ei's own test suite would notice unless it's re-verified against live
  documentation.

## Reversibility

High for the *documentation* of these races — nothing here is load-bearing code that would need to change
if a harness later closes one of these gaps on its own (e.g., Claude Code making `SessionStart` blocking).
Low-effort to revisit: re-check the relevant harness's current hooks documentation, confirm the blocking
language changed, and delete the corresponding section here.

Reversing Race 4's *design* (render-and-swap) would mean either accepting the rejected append-forever
alternative's costs, or waiting for Cursor to ship genuine session-scoped rules — neither is an Ei-side
change.

## References

- `docs/adr/ADR-008-accepted-write-races.md` — the precedent this record follows: document a race,
  don't fix it, when the cost of fixing exceeds the cost of the outcome.
- `src/cli/install.ts` — `installOmp()`'s WHO handler (Race 1), `installClaudeCodeHooks()`'s
  `ei-session-start.ts`/`ei-inject.ts` (Race 2), `installCursorHooks()`'s `ei-session-start.ts`/
  `ei-inject.ts` (Races 3 and 4)
- `tests/unit/cli/install-omp.test.ts`, `install-claude-code.test.ts`, `install-cursor.test.ts` — the
  forced-failure and cross-session-isolation regression coverage referenced under Consequences
- `code.claude.com/docs/en/hooks` — Claude Code's hooks reference; the `UserPromptSubmit`-vs-`SessionStart`
  blocking asymmetry behind Race 2, and the documented "SessionStart hooks run again on resume... so they
  can refresh their context" behavior this design relies on
- `cursor.com/docs/hooks` — Cursor's hooks reference; the explicit fire-and-forget statement behind Race 3,
  and `beforeSubmitPrompt`'s `{continue, user_message}`-only output schema behind Race 4
- `cursor.com/docs/rules` — Cursor's rules reference; `alwaysApply: true` applies "to every chat session,"
  the absence of any documented session-scoping predicate is why the per-session-rule-file alternative for
  Race 4 was rejected
- GitHub `anthropics/claude-code` issue #9188 — the stale-`session_id`-across-resume bug, fixed in Claude
  Code 2.0.24, cited as precedent that Ei's own session-boundary assumptions about these harnesses can be
  invalidated by a harness update with no warning

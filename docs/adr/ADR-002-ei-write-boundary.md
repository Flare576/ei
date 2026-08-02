# ADR-002: Ei Writes Only What It Owns

## Status

Accepted

## Date

2026-08-01

## Context

Dual-lens reflection (ADR-001) requires editing agent definition files that live in harness configuration directories. Ei holds the reflection data, so the natural question is whether Ei should write those files.

Ei is a local-first personal knowledge base, and the intuitive answer is that its write surface is exactly `EI_DATA_PATH` — everything beyond that belongs to the harness-running skill.

**The intent behind that answer is right; the absolute phrasing is not.** `ei --install` writes hooks, plugins, extensions, MCP configuration, and skills into six harnesses' config directories. More pointedly, the Cursor integration installs a `beforeSubmitPrompt` hook that rewrites `~/.cursor/rules/ei-context.mdc` — a **primary instruction surface** — before *every prompt*, wholesale, with `alwaysApply: true` (`src/cli/install.ts:530-551`).

A reader may object that the bash hook performs that write, not the Ei binary, which only supplies content via `ei --recent`. That distinction does not survive scrutiny: Ei authors the script, installs it, and owns the file it targets. Attributing the write to bash would be a semantic dodge.

So Ei's system already performs **runtime** writes outside `EI_DATA_PATH`, into a file that shapes every model call.

Critically, **that is a tolerated exception, not the principle in action.** Cursor exposes no other mechanism for injecting memory context; the rules file is the only path anyone found. Nobody on the project likes it. It is recorded here as a deviation with an exit condition, not as evidence that writing outside the boundary is fine.

What the exception does prove is that the boundary cannot be *stated* as a location. The question is not only *where* Ei writes, but *what Ei is entitled to overwrite* — and how reluctantly.

## Decision

The boundary is **ownership, not location**, applied as a strict preference order. Lower tiers require justification; the bar rises with each step.

| Tier | Write | Standing |
|---|---|---|
| 1 | Inside `EI_DATA_PATH` | Always preferred. No justification needed. |
| 2 | A file Ei created and solely manages, outside `EI_DATA_PATH` | **Exception only.** Permitted when the harness offers no in-boundary mechanism. Requires a recorded exit condition. |
| 3 | A clearly-marked region Ei owns *inside* a user-owned file | Permitted for user-approved writes. Ei claims the region, never the file. |
| 4 | Wholesale rewrite of user-authored content | Never. |

A tier-1 or tier-2 file must satisfy all four ownership tests: Ei created it, Ei is its sole manager, it holds no user-authored content, and overwriting it wholesale destroys nothing a human wrote. `~/.claude/CLAUDE.md`, a user's `AGENTS.md`, hand-authored `.cursor/rules/*.mdc`, and any human-written agent definition fail every one.

**Tier 3 is strictly better than tier 2** and should be preferred wherever both are possible. A delimited region makes no ownership claim over the file, survives the user editing around it, and is written on user approval rather than on a timer. Tier 2 requires Ei to squat on a whole file in someone else's directory.

**Corollary — delimited regions.** A tier-3 write must be idempotent and must leave every byte outside its markers untouched. This generalizes the `<ei-relationship>` pattern, and it is what lets the Agent lens persist into `CLAUDE.md` without ever clobbering a user's own instructions.

## Known Exception: Cursor context injection

**Status: active, disliked, remove when possible.**

`~/.cursor/rules/ei-context.mdc` is a tier-2 write. Ei owns the file completely and rewrites it before every prompt.

- **Why it exists**: Cursor provides no other route for injecting memory context. Every alternative was explored; this was the only one that worked.
- **Why it is disliked**: Ei claims a whole file inside a user's config directory, and rewrites it on a timer rather than on user action. It is also `alwaysApply: true`, so its content rides along on every single model call — the same unbounded-injection cost ADR-003 addresses elsewhere.
- **Exit condition**: replace it the moment Cursor exposes any alternative — a hook that injects context directly without a backing file, an MCP context surface, or an equivalent. This is not a "revisit someday" item; it is a standing intent to remove.
- **Do not generalize from it.** New integrations start at tier 1 and must argue their way down. The existence of this exception is not precedent for the next one.

## Application to reflection

- Ei owns Persona state and the automatic-critic gate — tier 1 throughout.
- Agent-definition edits route through the harness-running skill, with the user present and approving. **Not because Ei is forbidden to write**, but because those files are user-owned: editing them is a judgment call, not a data operation. Those writes are tier 3, delimited and approved.

## Alternatives Considered

### Alternative A: Ei edits user-owned config files wholesale
- **Description**: Extend Ei's CLI to read, modify, and rewrite whole agent definitions and instruction files.
- **Pros**: One tool, one workflow. Ei already knows the persona↔agent mapping.
- **Cons**: Ei cannot validate harness-specific formats it does not own, cannot know which of several resolved definitions is authoritative, and would need per-harness knowledge that changes outside its release cycle. Worse, a wholesale rewrite of a file containing human-authored content risks destroying work Ei never understood.
- **Why not chosen**: The hazard is not writing outside a directory — Ei already does that safely. The hazard is **overwriting content a human authored**. The delimited-region corollary gets the capability without the hazard.

### Alternative B: Ei mirrors agent definitions inside `EI_DATA_PATH`
- **Description**: Store a copy of each agent definition in Ei's own directory; treat it as the reflection target and let something else sync it.
- **Pros**: Stays inside the boundary. Gives reflection a stable target.
- **Cons**: Two sources of truth with no reconciliation. The live definition changes outside Ei constantly; the mirror goes stale immediately and silently.
- **Why not chosen**: A stale mirror is worse than no copy — reflection would diff against fiction.

### Alternative C: Treat agent definitions as a special category Ei may own
- **Description**: Declare agent-definition files a privileged class Ei is permitted to rewrite, regardless of who authored them.
- **Pros**: Minimal machinery; no marker format, no region logic.
- **Cons**: Ownership is a property of *who wrote the content*, not of *what kind of file it is*. Agent definitions are frequently hand-authored and hand-tuned — they are among the most personal files in a harness config, not the least. A category exception would authorize exactly the destructive case the ownership rule exists to prevent.
- **Why not chosen**: It swaps a checkable per-file test for an unfalsifiable category claim.

## Consequences

### Positive
- The rule is **checkable per file** rather than per directory. "Did Ei create this and solely manage it?" has a yes-or-no answer a reviewer can verify.
- It **names the existing Cursor exception as an exception**, with a tier, a reason, and an exit condition — rather than either pretending it does not exist or quietly promoting it to precedent.
- The delimited-region corollary unlocks the Agent lens on user-owned files **without** the destroy-a-human's-work hazard, which the location-based rule could only avoid by forbidding the capability entirely.
- Harness-specific format knowledge stays in the skill layer, where it can change independently of Ei's release cycle.

### Negative
- **Ownership must be established, not assumed.** A file Ei created but a user later hand-edited is genuinely ambiguous, and nothing currently records provenance. `ei-context.mdc` is safe only because it is clobbered so aggressively that no user would think to edit it — which is not a principle, it is a happy accident.
- **Region writes need real machinery**: a stable marker format, idempotent replacement, and a guarantee that surrounding bytes are untouched. Materially more than a wholesale overwrite.
- Users may still expect Ei to "just fix" a user-owned agent file, and will be told it proposes rather than rewrites.

### Risks
- **Boundary erosion by good intentions.** Each future feature will present a plausible reason for one small exception, and the Cursor deviation is now sitting in the record as a template for arguing one. Mitigation: the tier table makes the bar explicit and rising, every tier-2 write must carry a recorded exit condition, and "Cursor does it" is pre-emptively rejected as precedent. An exception requires superseding this ADR, not a code-review waiver.

## Reversibility

Hard, and deliberately so. This is a security boundary, not a design preference. Reversing it means auditing every write path in the codebase and re-establishing user consent for a materially broader permission. Treat as effectively one-way.

## References

- `src/cli/install.ts:530-551` — the Cursor `beforeSubmitPrompt` hook that rewrites `~/.cursor/rules/ei-context.mdc` on every prompt. The tier-2 exception this ADR governs.
- `src/cli/commands/personas.ts:42-66` — `buildEiRelationshipBlock()`, the delimited-region pattern the corollary generalizes.
- ADR-001 — the reflection design this governs.
- **Do not cite `src/cli/install.ts:156-163`.** That comment claims Claude Code, OMP, and OpenCode do not read `~/.agents/skills`. It is verified wrong for OMP — `omp://skills.md` calls `.agent[s]/skills` "the canonical OMP-native location" — and reported wrong for OpenCode. Tracked for correction.

# ADR-012: Sunset With a Path Forward

## Status

Accepted

## Date

2026-08-02

## Context

Ei ships a CLI, an MCP server, and installed skills. The skills are **copied** into a user's harness directories by `installSkillsTo()` (`src/cli/install.ts:7-15,51-60`) and stay there until something re-runs the installer. Upgrading the package does not do that — `bunx ei-tui` fetches a new binary and never invokes the copier. The only automatic refresh is a TUI prompt that fires solely when accounts exist and stamps the version even when the install is dismissed or fails (`tui/src/context/ei.tsx:853-859,919-932`).

So a user can be running a new binary against skills copied from an old one, indefinitely, with no signal.

That is the ordinary state of affairs, not an edge case, and it changes what removing a command costs. The forthcoming attestation work retires the broad `ei update quote` in favour of narrow `fix` / `relink` / `remove` verbs. If the old command simply ceases to exist, an installed `ei-curate` keeps instructing agents to call it — and `ei-curate` does exactly that today, in three places (`skills/ei-curate/references/cli.md:81-106`, `recipes.md:37-45,107-116`, `SKILL.md:60-61`).

A stale skill is worse than a missing one. A missing skill produces an agent that does not know how to do something. A stale skill produces an agent that is confidently, specifically wrong, and follows its instructions off a cliff.

The obvious responses are to build a refresh mechanism or a staleness warning. Both are real work, both must reach users who never open the TUI, and both are new machinery whose own failure modes need designing.

## Decision

**Sunset with a path forward. Retire a surface by making it fail usefully, not by making it disappear.**

- Instead of deleting an endpoint or command, keep it and have it **always error, naming its replacement**.
- Instead of `rm`-ing a skill, **rewrite it to explain the new mechanism**.
- Instead of dropping a documented option, keep it and reject it with the reason.

The retired surface's job changes from doing the work to **telling whoever still calls it what to do instead.**

The concrete instance: `ei update quote` will remain a real command that always rejects, with a message naming `ei fix quote` and `ei relink quote` and stating that the caller's installed skills predate this version.

**You will not always be able to do this. You should always try.** Where it is genuinely impossible, say so explicitly rather than removing quietly.

## Why this works better than the alternatives

The failure it prevents is not "the caller gets an error." A deleted command also produces an error. The failure it prevents is **a wrong caller who cannot tell why they are wrong**, and the difference is entirely in what the error says.

It also inverts the discovery problem. A refresh mechanism has to find every stale installation. A tombstone does not have to find anyone — **the stale caller announces itself** by invoking the dead surface, and gets told exactly what happened at precisely the moment it matters. No enumeration, no version checks, no reaching users who never open the TUI.

And it is safe by construction. The retired surface cannot do the old thing, because it does nothing. Any security or correctness property that motivated the removal is fully preserved by a path that only rejects.

## Consequences

### Positive

- Stale callers get a specific, actionable error instead of silent wrongness, without any new refresh machinery.
- Retirement stops being a coordinated cutover across every consumer, and becomes a local change to the retired surface.
- The error message is a documentation surface that reaches exactly the people who need it, exactly when they need it.

### Negative

- Dead code accumulates: command registrations, route entries, and enum members that exist only to reject.
- Tombstones need their own eventual removal, and "eventually" tends to mean never without a policy.
- Type-level and structural surfaces cannot always be tombstoned — see below.

### Risks

- **A tombstone that is not obviously a tombstone is worse than none.** If it reads like live code, a future maintainer will "fix" it, or extend it. Mark them unmistakably.
- **A tombstone's message goes stale too.** It names a replacement, and replacements get replaced. A message pointing at a second dead command is exactly the failure this ADR exists to prevent, one level down.

## Where it does not apply

Name these rather than removing quietly:

- **Removed fields and type members.** A field cannot raise on access. The nearest equivalent is retaining it as optional-and-ignored with a comment, which is weaker and carries its own confusion.
- **Surfaces with no caller-visible failure path.** If invocation cannot report anything, there is nothing to say.
- **Genuinely dangerous live paths**, where the surface must be unreachable rather than merely non-functional. Note that a reject-only tombstone is usually already unreachable in the relevant sense — this exception is narrower than it first appears.

## Retiring a tombstone

A tombstone is not permanent, but it outlives the thing it replaced. Remove one when the population that could still hold a stale reference has plausibly turned over — for Ei, one or two releases past the change, since installed skills refresh on any successful onboarding.

Record the intended removal in the tombstone itself, so a future reader inherits the plan and not an unexplained rejection.

## References

- `src/cli/install.ts:7-15,51-60` — skills are copied persistently; upgrading does not re-copy
- `tui/src/context/ei.tsx:853-859,919-932` — the only automatic refresh, conditional and stamping on failure
- `skills/ei-curate/references/cli.md:81-106` — a shipped skill teaching a command scheduled for retirement
- `.sisyphus/issues/upgrade-prompt-dismiss-is-permanent.md` — the refresh-mechanism defect this decision routes around rather than depends on

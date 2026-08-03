# ADR-013: Skills Name Tool Capabilities, Never Specific Tools

## Status

Accepted

## Date

2026-08-03

## Context

Ei's shipped skills are plain markdown, copied verbatim into whatever harness the user
runs. `ei --install` detects and writes into Claude Code, Codex, Cursor, OpenCode, Pi, and
OMP, plus the shared spec-standard `~/.agents/skills` directory that several of those tools
each independently walk (`src/cli/install.ts:88-171`). `README.md:38` states the supported
set; `AGENTS.md:482-488` notes that every shipped skill goes out through this one path.

Three properties of that pipeline matter here:

**There is one text, not N texts.** No build step, no templating, no per-harness variant.
The bytes in `skills/<name>/SKILL.md` are the bytes the agent reads on every harness.

**Tool surfaces do not overlap.** These harnesses expose different tools under different
names, and some expose none of a given category. A skill receives no capability manifest —
nothing in its environment tells it which tools exist before it tries one.

**The shared directory has no single reader.** `~/.agents/skills` is read by Cursor, Codex,
base Pi, and OMP concurrently. Even if per-harness specialization were desirable, there is
no one harness to specialize *for* at that path. `install.ts:156-166` also records live
uncertainty about which tools read which locations ("Whether OpenCode's plugin reads this
path is unverified against OpenCode's own docs; do not assume either way").

### What surfaced this

Reviewing `skills/ei-generate/`'s should-fix findings. That skill's contamination guardrail
requires stepping *outside* Ei to corroborate a claim — its two-independent-sources rule
counts "a public, attributable artifact: a blog post under the subject's byline, a GitHub
repo, commit history, conference talk." Writing that instruction pulls hard toward naming
the tool the author happens to have in front of them: `gh`, or a specific web-search
product.

That sentence would be wrong on most installs, and it fails in two directions:

- **False negative.** The agent *has* the capability under a different name, does not
  recognize the named tool, and takes the no-verification branch. The user silently gets a
  weaker document — a claim demoted to unverified and pushed into Known Gaps — for no real
  reason.
- **Fabricated evidence.** Worse: the agent attempts the named tool anyway, shells out to a
  binary that is not installed, and treats the resulting error output as a lookup result.

Meanwhile the *consent* rule wrapped around that capability is real and entirely
harness-independent. `skills/ei-generate/references/contamination.md` requires asking the
user "before searching for the name anywhere outside Ei," because sending a name or handle
pulled from a private conversation to a search engine or an org directory "is an external
action, not a free verification step." Whether that search runs through one tool or another
changes nothing about whether the user consented.

### The convention already existed, unwritten

Two shipped skills got this right by instinct. `skills/ei-curate/SKILL.md:100-103`:

> **Do not assume any other tool exists.** You may or may not have a Slack tool, GitHub
> access, or web search. [...] External tools are a *bonus* for verification, never a
> requirement

And `skills/ei-rewrite/references/recon.md:21` names "grep across the codebase, Slack, or
web search" as a category of capability rather than as invocations.

Nothing made either binding, so a third skill nearly shipped the opposite. This ADR exists
to make it a rule instead of a habit.

One further pressure: per ADR-012, installed skills are copies that upgrading the package
does not refresh. A harness-specific reference baked into a shipped skill cannot be
corrected on the copies already on disk. Getting it right at authoring time is the only
opportunity.

## Decision

**Ei skills refer to external tool use by capability, never by tool name.**

Write "whatever web-search tool your harness provides" or "if you have repo-browsing
access." Never `gh`, never a named search product, never a specific MCP server.

Three obligations follow:

1. **Phrase the capability, not the invocation.** Name what the agent needs to accomplish
   (search the web, browse a repository, read Slack), and let it map that onto whatever it
   actually has.

2. **Every such instruction carries an explicit no-capability branch.** Absence is the
   expected case, not an error path. The branch must state the *outcome*, not just permit a
   skip — e.g. the claim stays unverified and moves to Known Gaps.

3. **Consent and approval gates attach to the capability, never to the tool.** A rule like
   "never send an Ei-derived name or handle outside Ei without asking first" applies
   identically no matter which concrete tool ends up carrying the request. A gate written
   against one tool's name is a gate with holes in it.

**Ei's own surfaces are exempt, in the opposite direction.** The `ei` CLI's commands and the
`ei_*` MCP tools are named exactly and precisely, because Ei ships them and can guarantee
them. The boundary is ownership: name what we ship, describe what we hope is there.

**One narrow exception.** A skill explicitly scoped to a single harness may name that
harness's tools — and must say so in its own description, so a reader on any other harness
knows immediately that it does not apply to them. No such skill exists today, and this
should stay rare.

## Alternatives Considered

### Alternative A: Name one canonical tool and let each harness alias it
- **Description**: pick a single reference tool name, write skills against it, and have
  Ei's installer register an alias in each harness that maps that name onto the local
  equivalent.
- **Pros**: skills get exact invocation syntax, which is more reliable than a capability
  description when the tool is actually present. One name to learn.
- **Cons**: **there is no alias layer, in any harness.** `ei --install` writes hooks,
  plugins, MCP registrations, and skill files — it has no mechanism to define a tool alias,
  and none of the six targets offers one to write into. Building it would mean six
  harness-specific shims that Ei then owns and maintains against upstream churn, for a
  prose problem.
- **Why not chosen**: it invents infrastructure to avoid rewording a sentence, and it
  inverts responsibility — Ei would take on guaranteeing tools it does not ship.

### Alternative B: Leave it to per-skill author judgment
- **Description**: no rule; trust whoever writes a skill to remember that the reader may be
  on a different harness.
- **Pros**: zero process. Costs nothing to adopt.
- **Cons**: this *is* the status quo, and it already produced the defect once — caught in
  review rather than by the author. The failure mode is specifically invisible to the
  person writing it: the text works perfectly on the harness they are testing from. A
  convention that holds only when the author happens to remember is not a convention.
- **Why not chosen**: it was tried by default and failed by default.

### Alternative C: Generate per-harness skill variants at install time
- **Description**: the installer already knows which harness it is writing to, so emit a
  tailored copy naming that harness's real tools.
- **Pros**: maximum precision per install. Every reader gets exact syntax.
- **Cons**: N variants of every skill to keep in sync, and drift among them is invisible
  because no single reader sees two. Skill text stops being one reviewable artifact.
  Critically, it does not even cover the cases it targets: `~/.agents/skills` is read by
  multiple tools at once, so the copy written there cannot be specialized at all, and
  `install.ts:156-166` records that the path-to-tool mapping is not reliably known.
- **Why not chosen**: high maintenance cost, and it structurally cannot serve the shared
  install path.

### Alternative D: Have the agent probe for capabilities at runtime and branch
- **Description**: instruct the skill to test which tools exist, then take a tool-specific
  path.
- **Pros**: adapts without the installer knowing anything.
- **Cons**: the probe is itself a tool call that may not exist. A missing tool is commonly
  reported as an execution error rather than a clean capability answer — the exact
  confusion that produces the fabricated-evidence failure above. And the outcome is
  identical to generic phrasing, since an agent that can enumerate its own tools can
  already map "web search" onto one.
- **Why not chosen**: strictly more machinery for the same result, with a new failure mode
  attached.

## Consequences

### Positive
- One skill text is correct on every harness, which is what the copy-verbatim install model
  already assumes.
- Obligation 2 forces the no-capability branch to be written deliberately. That is the
  branch most installs actually take, and it was previously the one left implicit.
- Review becomes close to mechanical: a specific external tool name inside `skills/` is a
  greppable defect rather than a judgment call.
- Consent gates stop being coupled to a tool that may not be present, so they cannot be
  bypassed by arriving via a different one.

### Negative
- Generic phrasing is vaguer, and vagueness costs something. A weaker model may not map
  "some form of web search" onto the tool it holds, where a literal command name would have
  landed.
- Ei gives up the reliability of exact invocation syntax in the case where the tool *is*
  present — a real loss, accepted because that case is the minority.
- Prose gets wordier. Every external-capability instruction now carries a hedge and a
  stated fallback where one clause used to do.

### Risks
- **A hedge read as permission to skip.** "If your harness provides web search" can be
  taken as license to drop the verification rather than to take the documented fallback.
  Mitigated by obligation 2: state the fallback's concrete outcome, so the else-branch is
  an instruction and not an absence.
- **Over-correction onto Ei's own surface.** Someone applies this rule to `ei fix quote` and
  writes "whatever memory tool you have," which is worse than the original defect — those
  commands are guaranteed, and vagueness there costs precision for nothing. The stated
  boundary is ownership, and it needs to stay stated.
- **Nothing enforces it.** `ci/structural-checks.sh` runs grep-based fitness functions over
  the codebase and could plausibly scan `skills/` for known tool names, but no such check
  exists today, and any name blocklist is inherently incomplete. For now this is a review
  obligation, which is precisely the mechanism that Alternative B shows is fallible.

## Reversibility

Easy, and cheap. This is a prose rule: no code, no schema, no persisted data, no migration.
Reversing it means rewriting the affected sentences in `skills/`, and the install pipeline
copies whatever text ships without caring what it says.

Adopting Alternative C later is also still open — per-harness variants would be a new
capability in the installer, not a change to this decision, and generically-phrased source
text is a fine input to a specializing generator. Choosing generic prose now forecloses
nothing.

The only thing genuinely hard to undo is the reach of already-installed copies (ADR-012):
skills already on disk will not pick up a reversal until something re-runs the installer.
That argues for getting the rule right rather than for hesitating to adopt it.

## References

- `src/cli/install.ts:88-171` — the harness targets `ei --install` detects and writes to
- `src/cli/install.ts:156-166` — the shared `~/.agents/skills` path, read by several tools
  at once, with recorded uncertainty about which
- `README.md:38` — supported coding tools: OpenCode, Claude Code, Cursor, Codex, Pi/OMP
- `AGENTS.md:482-488` — shipped skills all install through the one path
- `skills/ei-curate/SKILL.md:100-103` — the pre-existing generic phrasing this
  generalizes from
- `skills/ei-rewrite/references/recon.md:21` — capabilities named as categories, not
  invocations
- `skills/ei-generate/references/contamination.md` — the consent gate on external lookup,
  quoted above; the guardrail whose review produced this decision
- ADR-012 — installed skills are stale copies, so a harness-specific reference cannot be
  corrected after it ships

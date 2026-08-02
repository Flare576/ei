# ADR-005: Generic User References (GURs) Define Ei's Design Priority

## Status

Accepted

## Date

2026-08-01

## Context

`AGENTS.md` states a design priority: *"Everyone else"* (a random user who found Ei on GitHub) first, power users second, Flare last. The intent is sound — optimize for the widest audience, not the author — and it has genuinely shaped decisions.

But it is too coarse to settle arguments. Two problems:

**"Everyone else" collapses distinct users.** Someone who installed Ei to mine their Cursor history and someone evaluating Ei from its README want different things, tolerate different friction, and would answer the same design question differently. Ranking them as one group hides the tradeoff instead of resolving it.

**There is no vocabulary for reasoning about it.** The standard industry term is "user persona" — unusable here. **Persona** is a core domain concept in Ei with a precise meaning (Identity + message history + topics + quotes). Overloading it would be the same category confusion this project keeps having to untangle elsewhere.

## Decision

Adopt **Generic User References (GURs)** as the vocabulary for abstracted user archetypes, deliberately avoiding "persona."

Three GURs, in **strict priority order**:

### 1. NMU — Non-Dev Memory User

Installed Ei to parse their history from Cursor or Claude Code. Their primary interaction surface is that harness, not Ei's own TUI.

- Finds high value in injected context.
- **Will not use nano, vim, or any CLI editor.** Hard constraint, not a preference.
- *May* be interested in persistent behavior, but it is not why they came.
- Technical, but not necessarily a developer, and not invested in Ei's internals.

**Highest priority.**

### 2. RGU — Random GitHub User

Found Ei, isn't sure what they want from it yet. Technical level unknown.

- Expects things to work.
- Expects to be able to understand it with a little effort — not zero, but not a research project.
- No established workflow to protect, and no investment to lose.

### 3. FFF — Full Feature Freak

Wants rooms, conversation, sync, the whole surface. Happy in vim. Uses the skills and harness integration. Asks for features and contributes code.

- Population is currently **one** (Flare).
- **Lowest priority**, explicitly. Revisit if the population reaches two or more.

## Alternatives Considered

### Alternative A: Keep the informal `AGENTS.md` list
- **Description**: leave "everyone else → power users → Flare" as-is.
- **Pros**: zero work; already directionally right.
- **Cons**: cannot settle a concrete tradeoff. "Would a random GitHub user accept this?" has no determinate answer because the category holds people who would answer differently.
- **Why not chosen**: it states a value without providing a test.

### Alternative B: Use the standard term "user persona"
- **Description**: adopt industry vocabulary directly.
- **Pros**: universally understood outside the project.
- **Cons**: **Persona** is load-bearing domain vocabulary in Ei. Every occurrence would require disambiguation, and the failure mode — quietly conflating two meanings of one word — is precisely the class of confusion this codebase already fights.
- **Why not chosen**: the collision is not cosmetic.

### Alternative C: Named archetypes without acronyms
- **Description**: "the memory user," "the evaluator," "the power user."
- **Pros**: readable, no jargon to learn.
- **Cons**: descriptive phrases drift. Three people will use three variants and gradually mean three different things — the exact drift that produced this ADR.
- **Why not chosen**: a fixed acronym is a stable identifier; a phrase is not.

## Consequences

### Positive
- Design arguments become checkable: *"an NMU would have to open vim for this, so no"* either holds or it does not.
- The priority order is now explicit where it was previously implied. NMU outranks RGU, which was not stated anywhere before.
- Flare's own position at the bottom is now written down with a stated reason (n=1) and a revisit condition (n≥2), rather than being a recurring act of self-restraint.

### Negative
- Three archetypes is a simplification. Real users straddle them, and a GUR will occasionally be the wrong lens for a specific decision.
- Jargon has a cost. Anyone new must learn what NMU means before the shorthand helps.

### Risks
- **Archetype drift.** GURs describe assumptions about users, not measurements of them. They were written from one person's model of the audience and should be revised when contradicted by an actual user, not defended.
- **Priority inversion under enthusiasm.** FFF is the most fun to build for and the easiest to imagine, because the author is one. The ordering exists specifically to resist that pull.

## Derived constraint worth stating separately

**The NMU will not use a CLI editor.** This is the sharpest single implication and it binds immediately: any workflow whose only path runs through `$EDITOR` is unavailable to the highest-priority GUR.

Concretely, the TUI's `$EDITOR`-based YAML persona editing is an FFF-tier affordance. Skill-driven and CLI-flag paths are NMU-compatible. New features should have at least one NMU-compatible path or a stated reason they do not.

## Reversibility

Easy. GURs are vocabulary and documentation, with no code dependency. Renaming, reordering, adding a fourth, or abandoning the framework costs only the edits to documents that reference it.

## References

- `AGENTS.md` — the design-priority list this refines. Not superseded; GURs make it operational.
- ADR-001 — Persona/Agent separation, the other place this project had to fix overloaded vocabulary.

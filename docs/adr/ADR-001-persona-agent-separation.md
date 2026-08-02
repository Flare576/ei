# ADR-001: Persona Identity and Agent Operating Contract Are Separate Records

## Status

Accepted

## Date

2026-08-01

## Context

Ei maintains a **Persona** — identity, traits, topics, descriptions — for each entity it knows. For coding-harness personas (Beta, Sisyphus), extraction also accumulates a linked Person record informally called the **PersonLog**, a running log of observed behavior. For these personas the extraction prompt is explicitly instructed to *"add, never truncate"* (`src/prompts/human/person-update.ts:124-142`), unlike regular person records which are told to *"synthesize, don't accumulate."*

That log accumulates two categorically different kinds of evidence:

1. **Persona evidence** — how the entity behaves as a character: opinions, voice, relational patterns.
2. **Agent evidence** — how the agent operates under its harness contract: verification discipline, gate behavior, delegation patterns, what it treats as proof.

The automatic Reflection critic can only revise Persona identity. When a coding-harness log fills with Agent evidence — the common case, since these personas do technical work all day — the critic either forces operational discipline into character traits, or consumes and discards it.

A concrete instance triggered this: Beta's PersonLog reached 11,178 characters, and the dominant signal was operating discipline acquired after a harness overhaul, not character drift.

## Decision

Treat Persona identity and Agent operating contract as **separate concerns with separate persistence targets**, reflected on through separate lenses:

| Lens | Question | Persistence target |
|---|---|---|
| Persona | What changed in who I am / how I relate? | Ei `PersonaEntity`, via CLI corrections |
| Agent | What changed in how I operate in this harness and role? | The harness-native agent definition file, edited by the reflection skill |

Neither lens may write to the other's target. Agent evidence never mutates Persona identity unless the Persona lens independently supports that identity change.

## Alternatives Considered

### Alternative A: Single reflection, fold everything into Persona traits
- **Description**: Keep one lens; let the critic write operational patterns into traits and `long_description`.
- **Pros**: No new machinery. Ships immediately.
- **Cons**: Conflates the soul with the runtime contract. `long_description` is how *other personas* know this one — filling it with verification discipline is noise to every reader. Traits degrade into a changelog.
- **Why not chosen**: The two kinds of evidence have different lifetimes, different audiences, and different correct storage. Merging them loses both.

### Alternative B: New Ei entity type for agent contracts
- **Description**: Ei stores agent operating contracts as a first-class record alongside personas.
- **Pros**: Single tool owns the whole picture; uniform CRUD.
- **Cons**: Ei would hold a copy of data owned by the harness, with no way to validate its format or keep it in sync. Guaranteed drift between Ei's copy and the live definition.
- **Why not chosen**: Violates ADR-002. The authoritative agent definition lives in the harness; a mirror is a second source of truth.

### Alternative C: Discard agent evidence
- **Description**: Accept that reflection is identity-only; let operational evidence be cleared unprocessed.
- **Pros**: Zero work.
- **Cons**: Discards the highest-signal content in the log for exactly the personas that generate the most of it.
- **Why not chosen**: The evidence is the point.

## Consequences

### Positive
- Operating drift can be captured without corrupting identity.
- Each target keeps its native format — Ei records stay Ei-shaped, agent definitions stay harness-shaped.
- Makes a previously invisible category of change (how an agent works) observable and reviewable.

### Negative
- Two approval gates and two write paths instead of one.
- The PersonLog can only be cleared once **both** applicable lenses reach a terminal state, which is more coordination than the automatic flow needs.
- Reflection becomes harness-aware, which it was not before.

### Risks

- **Agent-lens targets need three branches, not two.** An earlier draft of this record claimed the two-column split — agent-*definition* files govern subagents, rules/context/system files govern the primary session — held across every harness examined without exception. Direct checking against each vendor's own documentation refuted that. In half the harnesses a **named agent can be promoted to primary**, and its definition then governs the main session.

  | Harness | Primary session governed by | Agent definitions | Promotion to primary |
  |---|---|---|---|
  | Claude Code | `~/.claude/CLAUDE.md`, `./CLAUDE.md` or `./.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/*.md`, auto-memory under `~/.claude/projects/<project>/memory/` | `~/.claude/agents/`, `.claude/agents/` — **native**, not an Ei invention | **Yes** — `claude --agent <name>` runs the main thread as that subagent |
  | OMP | `.omp/SYSTEM.md`, `.omp/APPEND_SYSTEM.md`, `AGENTS.md`, `RULES.md`, `.omp/rules/*` and user equivalents under `~/.omp/agent/` | `.omp/agents/*.md`, `~/.omp/agent/agents/*.md` | **Yes** — `mode: "primary"` definitions cycle via Tab/Ctrl-Tab, or `--agent <name>` |
  | OpenCode | `AGENTS.md` and nested files, `~/.config/opencode/AGENTS.md`, `CLAUDE.md` compatibility fallbacks, `instructions` in config | `.opencode/agents/*.md`, `~/.config/opencode/agents/*.md` | **Yes** — `mode: primary` or `mode: all`, cycled with Tab |
  | Cursor | `.cursor/rules/*.mdc` (Project Rules), `AGENTS.md` at root or subdirs, **User Rules and Team Rules — UI only, no file path** | `.cursor/agents/*.md`, `~/.cursor/agents/*.md`, plus `.claude/agents/` and `.codex/agents/` compatibility locations | **Unrecorded** — the official rules, subagents, and agent-overview pages document delegation and `/name` invocation, not promotion |
  | Codex | `~/.codex/AGENTS.override.md` or `AGENTS.md`, the project-to-cwd `AGENTS.md` chain, `config.toml`, generated `~/.codex/memories/` | `~/.codex/agents/*.toml`, `.codex/agents/*.toml` | **Unrecorded** — `/agent` switches a *spawned* thread; the main thread stays the main thread |
  | Pi | `.pi/SYSTEM.md` or `~/.pi/agent/SYSTEM.md`, `APPEND_SYSTEM.md`, `AGENTS.md`/`CLAUDE.md` context | **None.** Pi's own README states "No sub-agents" and directs users to tmux, extensions, or third-party packages | No — nothing to promote |

  So the lens resolves three cases, not two:

  1. **Default primary** → rules, context, and system surfaces.
  2. **Delegated subagent** → the named agent definition.
  3. **Promoted primary** → the named agent definition **plus** the base primary context, which still loads alongside it.

  Case 3 is not an edge case. It is the normal operating mode for a user who has switched personas in OMP or OpenCode, or launched Claude Code with `--agent`. A lens that writes only the agent definition in case 3 leaves the base context unexamined; one that writes only the base context misses the definition actually steering the session. The workflow is conversational, so the lens asks which case applies rather than inferring it.

  Two notes that would otherwise mislead:
  - Claude Code does **not** read `AGENTS.md` natively — its memory documentation specifies `CLAUDE.md`.
  - Cursor's current rules documentation does not mention `.cursorrules` at all. Its deprecation status is therefore unrecorded rather than confirmed; do not assume an older file is ignored in every version.

- **Some operating contract is structurally unreachable, in every harness.** This is broader than one vendor's UI choice, and the lens must be able to say "part of your configuration lives somewhere I cannot reach" rather than presenting a partial write as complete.

  | Harness | Unreachable to a file-based tool |
  |---|---|
  | Cursor | **User Rules** (Customize → Rules) and **Team Rules** (dashboard) — no backing path at any permission level |
  | Claude Code | server-managed settings and managed policy; `--system-prompt` / `--append-system-prompt` / `--agents` are invocation inputs, not files |
  | OpenCode | remote `instructions` URLs, the remote `.well-known/opencode` endpoint, and MDM-delivered managed settings |
  | Codex | the per-chat `/memories` toggle; `-c`/`--config` overrides. Local memory files exist but are described as generated state, not a hand-editing surface |
  | OMP | memory coverage varies by active backend; the local summary backend is file-reachable, others are not established. CLI prompt flags are process-local |
  | Pi | `before_agent_start` extensions can replace or modify the system prompt at runtime; static files do not reveal that behavior |

  This is a coverage limit, not a permissions problem, and no amount of harness support fixes it.

- **Mis-scoped evidence.** A reflection that routes Agent evidence into the Persona lens re-creates the original problem. Mitigation: the lenses are separate files with separate instructions, not two modes of one prompt.

## Reversibility

Moderate. The separation is enforced at the skill layer, not in stored data — no migration is required to collapse it back into a single lens. What would be lost is any agent-definition edit already made, which lives in the harness's own version control, not Ei's.

## References

- ADR-002 — the write boundary that rules out Alternative B
- ADR-003 — why the automatic critic's log handling forced this issue
- `src/prompts/human/person-update.ts:124-142` — the accumulate-vs-synthesize split that produces these logs

The per-harness claims above were verified against each harness's own published documentation at the
time of writing, not inferred from Ei's source. Where a claim could not be established it is stated
as a limit rather than asserted — see the Cursor User Rules case under Risks.

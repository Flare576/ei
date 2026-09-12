# reference: which file governs this session

Used by `../lenses/agent.md`. Everything below was checked against each vendor's
own documentation. Harnesses change; if what you find on disk contradicts this
file, trust the disk and say so.

---

## Three branches, not two

The intuitive model is a two-column split: context/rules/system files govern
the primary session, agent-definition files govern delegated subagents. That
model is **only correct for an ordinary primary session.** It breaks as soon
as a named agent is running as the main thread — which Claude Code, OMP, and
OpenCode all support, and which is the normal mode for anyone who has
`Tab`-cycled a persona or launched with `--agent`.

| Case | Situation | Governing surface |
|---|---|---|
| **1 — default primary** | The harness's ordinary main session; no named agent selected. | Rules / context / system files. |
| **2 — delegated subagent** | A parent session spawned you to do this task. | Your named agent-definition file. |
| **3 — promoted primary** | A *named agent* is the main thread. | Your named agent-definition file **plus** the base primary context, which still loads alongside it. |

Case 3 is the one that costs you if you miss it. The base context is loaded in
both case 1 and case 3, so its presence proves nothing about which case you're
in — and the agent definition is invisible to you unless you go read it.
**Ask the user.**

### Which harnesses have a case 3 at all

| Harness | Promoted primary? | How |
|---|---|---|
| **Claude Code** | Yes | `claude --agent <name>` (or the `agent` setting) runs the main thread as that named subagent. Its system prompt, tools, and model apply to the session, while `CLAUDE.md` and project memory still load through the normal flow. |
| **OMP** | Yes | An agent definition with `mode: "primary"` opts into the main-chat persona set. `Tab`/`Ctrl+Tab` cycles them; `--agent <name>` selects the initial one. The definition's `systemPrompt` becomes the active persona block; base `.omp` context/rules/system files remain separate inputs. |
| **OpenCode** | Yes | `mode: primary` (or `mode: all`) makes a definition eligible as a primary agent; the UI cycles primary agents with `Tab`. The definition's `prompt`, model, and permissions define the contract; AGENTS/instruction files remain additional context. |
| **Cursor** | No documented equivalent | Cursor's documented custom agents are delegated subagents. The reviewed docs describe parent delegation, `/name` invocation, and foreground/background execution — no route for a custom agent file to become the main session. |
| **Codex** | No documented equivalent | Custom TOML agents are for spawned sessions. `/agent` switches the active *agent thread*; the main thread stays the main thread. |
| **Pi** | No — no subagents at all | Pi's own README says **"No sub-agents"** and points to tmux, extensions, or third-party packages instead. Only case 1 exists. A third-party extension may implement something promotion-like, but its governing file is package-specific and cannot be named from Pi's contract. |

For Cursor, Codex, and Pi: absence of a documented promotion path is not proof
that a plugin or a future release can't behave differently. If the user says
they started you as a named agent on one of those, believe them and ask where
that definition lives.

---

## Per-harness surfaces

### Claude Code

- **Case 1 — primary context.** `CLAUDE.md` at the project root or
  `.claude/CLAUDE.md`; `CLAUDE.local.md`; user `~/.claude/CLAUDE.md`;
  `.claude/rules/*.md` and `~/.claude/rules/*.md`; auto-memory files under
  `~/.claude/projects/<project>/memory/` (`MEMORY.md` plus topic files).
  Claude's memory documentation explicitly says it reads `CLAUDE.md`, **not**
  `AGENTS.md`.
- **Cases 2 and 3 — agent definition.** Markdown definitions in
  `.claude/agents/` (project) and `~/.claude/agents/` (user), plus
  managed/plugin `agents/` locations. `--agents` can supply JSON definitions
  for a single session, but that is not a file — see
  `unreachable-surfaces.md`.
- **Scope:** both project and user.
- **Commit expectations:** project `CLAUDE.md`, `.claude/rules/`, and project
  agent files are documented as team-shareable. User/local instructions, user
  agents, and auto-memory are normally machine-local.

### Cursor

- **Case 1 — primary context.** Project Rules in `.cursor/rules/*.mdc`;
  project and nested `AGENTS.md`. User Rules and Team Rules also govern the
  session but are **not file-backed** — see `unreachable-surfaces.md`.
- **Case 2 — agent definition.** `.cursor/agents/*.md` and
  `~/.cursor/agents/*.md`. Cursor also documents `.claude/agents/` and
  `.codex/agents/` as compatibility locations. The built-in Explore/Bash/
  Browser subagents are supplied by Cursor, not by user files — there is
  nothing to write for those.
- **Case 3:** none documented.
- **Scope:** both, plus team-managed rules.
- **Commit expectations:** Cursor calls Project Rules version-controlled and
  recommends committing project subagents. User agent files are normally
  local; User/Team Rules are dashboard state, not commits.
- The current official rules page does not mention legacy `.cursorrules`. Its
  status is unrecorded rather than known-dead — if you find one, ask rather
  than assuming it's ignored.

### Codex

- **Case 1 — primary context.** User `~/.codex/AGENTS.override.md` or
  `~/.codex/AGENTS.md`; the project-to-cwd `AGENTS.override.md`/`AGENTS.md`
  chain, with configured fallback filenames; user/project `.codex/config.toml`
  and profile files; generated local memories in `~/.codex/memories/` (which
  Codex describes as generated state — don't treat hand-editing them as the
  primary control).
- **Case 2 — agent definition.** Custom agent **TOML** files in
  `~/.codex/agents/` (user) and `.codex/agents/` (project), each with `name`,
  `description`, and `developer_instructions`. Built-ins are `default`,
  `worker`, and `explorer`. TOML is not Markdown — see
  `agent-file-writes.md` for the delimited-region rule in that format.
- **Case 3:** none documented.
- **Scope:** both.
- **Commit expectations:** project `AGENTS.md` is repo guidance that travels
  with the repository; project `.codex/agents/*.toml` and project config are
  normally committed. User config, profiles, generated memories, and logs are
  not.

### OMP

- **Case 1 — primary context.** Native project `.omp/SYSTEM.md`,
  `.omp/APPEND_SYSTEM.md`, `.omp/AGENTS.md`, `.omp/RULES.md`,
  `.omp/rules/*.{md,mdc}`, and other native instruction files; user
  equivalents under `~/.omp/agent/`. OMP also has compatibility providers for
  Claude/Codex/Gemini files, so a `CLAUDE.md` in the tree may be live too.
- **Cases 2 and 3 — agent definition.** `.omp/agents/*.md` and
  `~/.omp/agent/agents/*.md`, plus extension-package agent directories.
  Frontmatter `mode: "subagent"` vs `mode: "primary"` distinguishes the two
  cases; project definitions take precedence over user ones.
- **Scope:** both.
- **Commit expectations:** project `.omp/` definitions and rules are normally
  committed; user definitions and runtime/session/memory state are not.

### OpenCode

- **Case 1 — primary context.** Project `AGENTS.md` (and nested files), global
  `~/.config/opencode/AGENTS.md`, Claude-compatibility `CLAUDE.md` fallbacks,
  and `instructions` entries in `opencode.json` / the global config.
  `instructions` may also point at **remote URLs** — see
  `unreachable-surfaces.md`.
- **Cases 2 and 3 — agent definition.** `.opencode/agents/*.md` (project) and
  `~/.config/opencode/agents/*.md` (user), or agent objects in JSON config.
  Singular `agent/` directories remain a documented compatibility form.
  Definitions carry `mode: primary`, `subagent`, or `all`.
- **Scope:** both.
- **Commit expectations:** project config and project agent files are normally
  committed. Global config/agents and remote or managed policy are not.
- Prefer the `.md` agent file over a JSON agent object when both are
  available — a delimited region is far safer in Markdown.

### Pi

- **Case 1 only.** Context files are `AGENTS.md` (or `CLAUDE.md`) from
  `~/.pi/agent/` and cwd ancestors. Project `.pi/SYSTEM.md` or global
  `~/.pi/agent/SYSTEM.md` **replaces** the default system prompt;
  `APPEND_SYSTEM.md` appends to it. Project/global settings and extensions
  also affect prompt construction.
- **No case 2 or 3.** No core file-backed subagent-definition surface exists.
- **Scope:** both.
- **Commit expectations:** project `.pi/` context/system files can be shared;
  user files, settings, extensions, and generated state are normally local.
- Note the difference between `SYSTEM.md` (replaces) and `APPEND_SYSTEM.md`
  (appends). Writing a region into the wrong one changes what else the agent
  is running on.

---

## When you don't know the harness

Ask that too, in the same breath as the case question — it's one exchange, not
two:

> "Which harness am I running in, and are you talking to the default session
> or a named agent you selected?"

Then check the filesystem to confirm rather than to decide: the presence of
`.claude/`, `.cursor/`, `.codex/`, `.omp/`, `.opencode/`, or `.pi/` in the
project or home directory corroborates the answer. Several of these coexist in
one repo — a `.claude/` directory does **not** mean you're running in Claude
Code. Corroborate; don't conclude.

# reference: the parts you cannot reach

Used by `../lenses/agent.md`. Every harness has pieces of its operating contract
that no file-based tool can read or write. This file names them per harness so
the lens can **disclose** the gap instead of silently writing a partial answer.

**This is a coverage limit, not a permissions problem.** No amount of
filesystem access makes a rule stored in a vendor dashboard readable. Never
phrase it as "I don't have permission," never offer to retry with elevated
access, and never imply a retry would help.

The distinction that matters: *"no file found"* and *"this harness has no file
for that part"* are different answers, and only one of them means the write
you just made covers everything.

---

## What to say

Disclose **before** you write, not after — the user may want to check the
unreachable surface first and change what you write.

> "Before I write this: on Cursor, your User Rules and any Team Rules live in
> the UI rather than in a file, so I can't read or change them. If 'always run
> the full suite' is already in your User Rules, what I write into the project
> rules would be a duplicate. Worth a look before I go ahead."

Three parts, in this order:

1. **Name the surface** — specifically. "User Rules and Team Rules," not "some
   settings."
2. **Name the consequence** — a duplicate, a contradiction, or a false sense
   that the config is now consistent.
3. **Hand it back** — they can check it; you can't.

Then, in your final report, restate what you couldn't reach alongside what you
did write. A user who reads "done, wrote 3 rules to `.cursor/rules/team.mdc`"
and nothing else will reasonably assume their configuration is now coherent.

---

## Per-harness gaps

### Claude Code — partially reachable

- **Reachable:** auto-memory content is ordinary Markdown under
  `~/.claude/projects/<project>/memory/`.
- **Unreachable — invocation inputs.** Text passed via `--system-prompt` /
  `--append-system-prompt`, and JSON definitions passed via `--agents`, are
  process-invocation inputs, not persistent files. Once the session is
  running, a file-only tool cannot recover or rewrite those values. If the
  user launched with any of them, the definition governing you may not exist
  on disk at all.
- **Unreachable — managed policy.** Claude Code supports server-managed
  settings and managed policy delivery, so an organization's remotely
  delivered policy can sit entirely outside the local file surface. Whether a
  given org's payload is locally exportable is not documented — do **not**
  imply that editing a local `CLAUDE.md` covers it.

### Cursor — explicit UI-only gaps

- **Unreachable — User Rules.** Defined in **Customize → Rules**. The official
  rules page gives no backing pathname.
- **Unreachable — Team Rules.** Created and enforced from the Cursor
  dashboard. Same: no path.
- **Reachable:** Project Rules (`.cursor/rules/*.mdc`), `AGENTS.md`, and
  custom agent files.

This is the sharpest gap of any harness, and Cursor is one of the two
priority surfaces for this skill — the non-developer whose whole interaction
is the harness UI. Expect to disclose here most of the time.

### Codex — generated memory is readable, per-chat control is not

- **Reachable but not the control surface:** local memory files live under
  `~/.codex/memories/`, but Codex describes them as *generated state* and says
  not to rely on hand-editing them as the primary control. Writing a region
  into a generated file is a poor target; prefer `AGENTS.md` or an agent TOML.
- **Unreachable — the `/memories` toggle.** `/memories` controls whether the
  current chat uses or contributes to memories. It's an interactive
  chat-level choice with no documented backing file, so a file-only lens can't
  inspect or change it.
- **Unreachable — CLI overrides.** `-c` / `--config` overrides are ephemeral
  per-invocation values.

### OMP — local memory is reachable, backend coverage is not uniform

- **Reachable:** the local summary backend exposes `memory://root`,
  `MEMORY.md`, and generated skills — a real file/tool-readable path.
- **Unreachable — invocation inputs.** `--system-prompt` and
  `--append-system-prompt` take direct text and are not files.
- **Not uniform — memory backends.** OMP names multiple memory backends, and
  there is no single file path or file-write contract that holds for all of
  them. **Ask which backend is active** rather than claiming complete
  coverage.
- No dedicated OMP User Rules / Team Rules UI-only surface was found in the
  reviewed core documentation. Absence of a record is not proof of absence.

### OpenCode — remote and administrator-owned inputs

- **Unreachable — remote instructions.** `instructions` entries may contain
  remote URLs, and organization defaults can arrive from the remote
  `.well-known/opencode` endpoint. A local file tool cannot author those.
- **Unreachable — MDM / managed preferences.** Managed settings can be
  deployed through system files, but macOS managed preferences and MDM are
  administrator-controlled policy, not a user-owned file surface. The MDM
  source itself is out of reach.
- No separate native OpenCode memory file or UI-only User Rules surface was
  found in the reviewed documentation. That silence is not proof that plugins
  or deployments can't add one.

### Pi — runtime extension behavior exceeds the static files

- **Unreachable — invocation inputs.** `--system-prompt` and
  `--append-system-prompt` take direct text.
- **Unreachable — runtime prompt rewriting.** `before_agent_start` extensions
  can inject messages or **replace or modify the system prompt for a turn**.
  You can read a discovered extension file, but you cannot infer arbitrary
  runtime behavior from the static `AGENTS.md`/`SYSTEM.md` files.
- No UI-only rules surface and no native named-agent surface were found in
  the reviewed documentation.

---

## The pattern behind all of them

Three recurring shapes. Recognizing the shape is faster than remembering the
table:

1. **Invocation inputs** — anything passed on the command line for one run.
   Present in five of the six harnesses. Never a file, never recoverable
   afterward.
2. **Vendor-hosted state** — dashboards, org policy, MDM, remote config
   endpoints. Not on this machine at all.
3. **Generated or runtime-mutated state** — memory files the harness
   regenerates, extensions that rewrite the prompt per turn. On disk, but not
   yours to own.

If a rule the user gave you might live in any of those, disclose before
writing.

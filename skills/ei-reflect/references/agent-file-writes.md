# reference: writing into a harness's own files

Used by `../lenses/agent.md`. Read this before your first write.

---

## The rule

An agent-definition or instruction-file write is a **marked delimited
region**: Ei claims the region, never the file.

- **Idempotent** — running the lens twice produces the same file, not two
  regions.
- **Surrounding bytes untouched** — every byte outside the markers is
  byte-identical afterward.
- **Never a wholesale rewrite.**

These files are the user's. They are often version-controlled, are frequently
read by other people and other agents, and routinely contain content Ei knows
nothing about. Replacing one because your version "has everything important"
destroys work you never saw.

This is the same shape as the `<ei-relationship>` block Ei injects into system
prompts: a self-identifying region a tool owns, inside content it does not.

---

## Markers

```
<!-- ei-reflect:begin persona=<PERSONA_ID> -->
… content …
<!-- ei-reflect:end persona=<PERSONA_ID> -->
```

Both markers carry the Persona's **id** — the value `../SKILL.md` Step 1a
resolved. That is what makes the region addressable when two personas share
one file: each owns its own region and neither can consume the other's.

**Don't assume the id is a UUID.** It usually is, but Ei's built-in personas
have the literal ids `ei` and `emmet`, and `persona=ei` is a perfectly valid
marker key. What matters about an id is not its spelling — it's that **Ei
issues it and you only ever copy it**, so it is a single whitespace-free token
that can't carry a comment delimiter into a marker.

**Never key the marker on a display name.** A `display_name` is mutable,
non-unique across Personas, and free-form text. Keying on it means an ordinary
rename orphans the region, the exact-marker lookup misses it, and the next run
appends a *second* region — silently breaking the idempotency this whole
protocol exists to guarantee. It also puts arbitrary user text into a comment
delimiter, where a stray `-->`, quote, or brace can corrupt the target file.

The human-readable name belongs in the **heading inside** the region — see
"The heading" below for the one check it has to pass first. If it goes stale
after a rename, the next run rewrites it and nothing breaks.

Rules:

- **Match on the exact marker pair**, begin and end, including the id. Never
  match on the content between them.
- **Exactly one region per persona per file.** If you find two, stop and ask
  — that's a prior bug or a hand-edit, and merging them is the user's call.
- **A region whose `persona=` value is not a Persona id was not written by
  this skill.** You already hold the full candidate list from `../SKILL.md`
  Step 1a — if the key isn't one of those ids, it's foreign. Don't adopt it,
  rewrite it, or assume it's yours under an older format; this skill has never
  written any other key. Show it to the user and let them decide whether to
  remove it before you add yours. A key that *is* another Persona's id is
  neither foreign nor yours: leave it exactly alone.
- **Never nest regions**, and never place a region inside a fenced code block.
- If the file doesn't end with a newline, add one before appending.

---

## The heading

A human skimming a shared `AGENTS.md` needs to know whose rules these are, so
the region opens with a short heading naming the persona — `## Working
agreements (Sisyphus)`.

That heading is the **only** place a `display_name` appears anywhere in this
protocol, and it gets there exactly one way: **you type it as literal text,
copied from the record you read back in `../SKILL.md` Step 1a.** Never build it
with a command — no shell interpolation, no `jq`, no `--arg`. `display_name` is
`z.string().min(1)` and nothing more, so it is arbitrary user-controlled text
that is about to land inside a delimited region.

So before you type it, look at the name you read. It must be:

- a **single line**, and
- free of `<!--`, `-->`, and `ei-reflect:`.

Almost every name passes. A name that doesn't can close the region early: a
`display_name` of `X)` followed by a newline and a literal
`<!-- ei-reflect:end persona=<the id> -->` puts a matching end marker inside
your heading, *before* the real one. The next run's exact-pair lookup stops
there, the remainder of the region is stranded as loose text in the user's
file, and the idempotency guarantee above is gone.

**If the name fails either check, drop it and use the bare heading
`## Working agreements`.** The `persona=` id in the markers already identifies
the region, and a name that can forge a marker has no business inside one.
Tell the user you did that and why — one line, not an apology.

## The write algorithm

1. **Re-read the file** immediately before writing. Not the copy from
   discovery — the reflection conversation took real time, and the file may
   have moved. If it differs at all from what you read during discovery: stop,
   show the user, re-approve.
2. **Search for the exact begin marker.**
   - **Found** → replace everything from the begin marker through the end
     marker, inclusive, with the new region. Nothing before the begin marker
     and nothing after the end marker changes.
   - **Not found** → append the region at the end of the file, separated by a
     blank line. Appending is the safe default: it can't land in the middle of
     a structure you misread.
   - **Begin marker found but no matching end marker** → **stop.** Do not
     guess where the region ends and do not append a second one. Show the user
     the file and let them fix it.
3. **Write.** Perform the edit yourself with your harness's own file-editing
   tool. Never shell out to `sed -i` on a user's config file, never instruct
   the user to open `$EDITOR`, and never depend on one yourself.
4. **Re-read and verify.** Region present exactly once, content matches what
   was approved, everything outside the markers byte-identical to step 1.

## Content style

The region is loaded into a context window on every call the harness makes
against that file. Prose costs tokens forever.

- One line per rule, imperative.
- A short heading naming the persona, so a human skimming the file knows whose
  rules these are — subject to the single-line check in "The heading" above.
- No dates, no narrative, no "as observed during the reflection on…". If it
  reads like a changelog, cut it.
- No secrets, no absolute paths containing a username, and nothing you
  wouldn't want in a commit — assume the file is committed unless you know it
  isn't.

```
<!-- ei-reflect:begin persona=ea475c69-2e52-42f2-b3e3-b112df189336 -->
## Working agreements (Sisyphus)

- Run the full vitest suite before calling a task done — never a narrowed file.
- vitest needs the repo's pinned Node; bare `node` here is a Bun shim that
  can't run it.
- Verify a sub-delegate's claim independently before building on it.
<!-- ei-reflect:end persona=ea475c69-2e52-42f2-b3e3-b112df189336 -->
```

---

## Non-Markdown targets

Most targets are Markdown, where an HTML comment is inert and everything above
applies directly. Two harnesses have formats where it doesn't.

### Codex agent definitions — TOML

`.codex/agents/*.toml` and `~/.codex/agents/*.toml` carry instructions in a
`developer_instructions` string. The region goes **inside that string value**,
using the same `<!-- ei-reflect:begin … -->` markers — the markers exist for
*your* idempotency, and inside a prompt string they're inert text the model
reads past.

You must preserve TOML syntax exactly: the quoting style of the existing
string, its escaping, and every other key in the file. If the value is a
single-quoted literal string, your content cannot contain a single quote of
that form; if it's a basic string, backslashes and quotes need escaping. A
multi-line literal (`'''…'''`) is the easiest case.

**If you cannot make that edit confidently, stop and disclose it rather than
guessing.** Corrupting a TOML file breaks the agent entirely. Prefer Codex's
Markdown `AGENTS.md` surface when the rule could reasonably live there
instead.

### OpenCode agent objects — JSON

Agent objects in `opencode.json` carry a `prompt` string. JSON has no comment
syntax, so the markers again live *inside* the string value, correctly
JSON-escaped along with any newlines in your content.

**Prefer the `.md` agent file.** OpenCode supports `.opencode/agents/*.md` and
`~/.config/opencode/agents/*.md` for exactly this content, and a delimited
region in Markdown is far safer than string surgery in a config file the
harness parses strictly. Only touch the JSON if the user has no `.md`
definition and doesn't want one.

### Frontmatter

Several agent-definition formats (Claude Code, Cursor, OMP, OpenCode `.md`)
open with YAML frontmatter. **The region always goes in the body, after the
closing `---`.** Never inside frontmatter — it isn't prose, the harness parses
it, and an HTML comment there is at best ignored and at worst a parse error.

---

## Failure handling

- **Write failed, or verification didn't match** → `blocked`. Say which file,
  what you attempted, and what state the file is in now.
- **File changed between discovery and the write** → stop, re-approve. If the
  user isn't there to re-approve, that's `blocked`, not a silent retry.
- **Two targets (the case-3 pair) and only the first landed** → report exactly
  that split. Do **not** roll back a write the user approved; leaving one
  approved change in place and naming the gap is more honest than undoing work
  they asked for.
- **Never partially write a region.** Either the full approved region lands
  between its markers, or nothing does.

import { join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { cp, mkdir, readdir, rename, rm, stat } from "fs/promises";

// Canonical runEi() body shared by every Bun-shell-based generated hook
// script (Codex/Claude Code/Cursor hook files, the OMP extension, and the
// OpenCode plugin) -- interpolated verbatim into each script's own template
// literal at hook-generation time. These scripts run standalone on an end
// user's machine via Bun's own runtime and can't import a real shared
// module, so a template-string constant is the only dedup available here.
// Local `ei` is tried first and its settled result -- including a
// legitimate empty string, a valid zero-results answer -- is returned
// as-is; only an actual thrown error (nonzero exit / binary not found)
// falls through to `bunx ei-tui@latest`. Pi's separate execFileAsync-based
// runEi (no Bun `$` available in that runtime) applies the same
// exception-based fix but isn't built from this snippet -- see installPi().
const RUN_EI_BUN_SNIPPET = `async function runEi(commandArgs) {
  try {
    return await $\`ei \${commandArgs}\`.quiet().text();
  } catch {
    return await $\`bunx ei-tui@latest \${commandArgs}\`.quiet().text().catch(() => "");
  }
}`;

/**
 * Copy every skills/<name>/ directory from Ei's own package into a
 * harness's native skill-discovery directory (targetDir). Copy, not
 * symlink — a symlink into an npm/bunx-installed package's cache breaks
 * silently on upgrade/uninstall, and Windows symlinks need elevated
 * permissions; every other install* function in this file already
 * materializes content onto disk rather than referencing back to source.
 * Generic over whatever exists under skills/ — adding a new Ei-shipped
 * skill later requires zero changes here. Overwrites unconditionally on
 * every run, same as the extension files below.
 *
 * `sourceDir` defaults to Ei's own packaged skills/ (resolved relative to
 * this file's own location, so it works regardless of install method —
 * global npm, bunx, or a from-source checkout) and exists as a parameter
 * purely so tests can redirect it at a fixture directory instead.
 */
export async function installSkillsTo(targetDir: string, sourceDir?: string): Promise<void> {
  // `.pathname` on a file:// URL keeps a leading slash before a Windows
  // drive letter (`/C:/Users/...`), which fs APIs on Windows do not accept
  // as an absolute path — fileURLToPath() normalizes it correctly on every OS.
  const skillsSourceDir = sourceDir ?? fileURLToPath(new URL("../../skills", import.meta.url));

  // Plain fs.stat instead of shelling out to `test -d` — `test` is not a
  // Bun Shell builtin (it falls back to a PATH lookup), and stock Windows
  // ships no `test` binary, so the old shell-based check silently treated
  // every Windows install as "source doesn't exist" and skipped skill
  // installation with no warning at all.
  try {
    const sourceStat = await stat(skillsSourceDir);
    if (!sourceStat.isDirectory()) return;
  } catch {
    // From-source checkout or a package build that predates this feature —
    // nothing to do yet, and that's not an error.
    return;
  }

  // fs.readdir + isDirectory() instead of `ls -d dir/*/` — skips stray files
  // directly under skills/ (e.g. a top-level README.md) without depending on
  // Bun Shell's undocumented `-d` flag support or POSIX glob semantics.
  const entries = await readdir(skillsSourceDir, { withFileTypes: true });
  const skillNames = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (skillNames.length === 0) return;

  await mkdir(targetDir, { recursive: true });

  for (const skillName of skillNames) {
    const dest = join(targetDir, skillName);
    // fs.cp merges into an existing dest rather than nesting like a naive
    // `cp -r` would, but it won't remove files that only exist in a stale
    // prior copy — clear first so every run leaves an exact mirror of the
    // current source, matching the unconditional full-overwrite behavior
    // every other install* function in this file gets via Bun.write.
    await rm(dest, { recursive: true, force: true });
    await cp(join(skillsSourceDir, skillName), dest, { recursive: true });
  }

  console.log(`✓ Installed ${skillNames.length} skill(s) to ${targetDir}`);
}

function resolveHome(): string {
  // Plain Windows shells (cmd.exe, PowerShell without Git Bash/WSL) don't set
  // $HOME — os.homedir() reads USERPROFILE there instead. Without this
  // fallback, `home` silently became the literal string "~", and every
  // downstream join("~", ...) resolved relative to CWD instead of the user's
  // actual profile directory.
  return process.env.HOME || homedir();
}

export async function runInstallStep(label: string, step: () => Promise<void>): Promise<boolean> {
  try {
    await step();
    return true;
  } catch (e) {
    console.warn(`⚠️  ${label} install step failed: ${e instanceof Error ? e.message : String(e)}`);
    console.warn(`   Skipping — other integrations will still be attempted.`);
    return false;
  }
}

export async function installMcpClients(): Promise<void> {
  const failures: string[] = [];

  if (!(await runInstallStep("Claude Code", installClaudeCode))) failures.push("Claude Code");

  const home = resolveHome();

  if (await commandExists("codex")) {
    if (!(await runInstallStep("Codex", installCodex))) failures.push("Codex");
  } else {
    console.log(`ℹ️  Codex CLI not detected — skipping Codex MCP install.`);
  }

  const cursorDataDirs = [
    join(home, "Library", "Application Support", "Cursor"),
    join(home, ".config", "Cursor"),
    join(home, "AppData", "Roaming", "Cursor"),
  ];
  // Bun.file(x).exists() only detects regular files — it returns false for
  // a directory, and "<CursorDir>/User" is a directory. Use fs.stat()'s
  // isDirectory() instead (already imported above).
  const hasCursor = (
    await Promise.all(
      cursorDataDirs.map(async (p) => {
        try {
          return (await stat(join(p, "User"))).isDirectory();
        } catch {
          return false;
        }
      })
    )
  ).some(Boolean);
  if (hasCursor) {
    if (!(await runInstallStep("Cursor", installCursor))) failures.push("Cursor");
  } else {
    console.log(`ℹ️  Cursor not detected — skipping Cursor install.`);
  }

  const opencodeDir = join(home, ".config", "opencode");
  const hasOpenCode = await Bun.file(join(opencodeDir, "opencode.jsonc")).exists() ||
    await Bun.file(join(opencodeDir, "opencode.json")).exists() ||
    await Bun.file(join(opencodeDir, "opencode.db")).exists();

  if (hasOpenCode) {
    if (!(await runInstallStep("OpenCode plugin", installOpenCodePlugin))) failures.push("OpenCode plugin");
  } else {
    console.log(`ℹ️  OpenCode not detected — skipping OpenCode plugin install.`);
  }

  const hasPi =
    await Bun.file(join(home, ".pi", "agent", "settings.json")).exists() ||
    await Bun.file(join(home, ".pi", "agent", "auth.json")).exists();

  if (hasPi) {
    if (!(await runInstallStep("Pi extension", installPi))) failures.push("Pi extension");
  } else {
    console.log(`ℹ️  Pi not detected — skipping Pi extension install.`);
  }

  const hasOmp =
    await Bun.file(join(home, ".omp", "agent", "settings.json")).exists() ||
    await Bun.file(join(home, ".omp", "agent", "auth.json")).exists() ||
    await Bun.file(join(home, ".omp", "agent", "config.yml")).exists() ||
    await Bun.file(join(home, ".omp", "agent", "agent.db")).exists();

  if (hasOmp) {
    if (!(await runInstallStep("OMP extension", installOmp))) failures.push("OMP extension");
  } else {
    console.log(`ℹ️  OMP not detected — skipping OMP extension install.`);
  }

  // Shared, spec-standard skill discovery directory that Cursor, Codex, and
  // base Pi (non-OMP) each independently walk up looking for
  // (~/.agents/skills/<name>/SKILL.md) — unconditional because, unlike the
  // harness-specific steps above, it needs no per-tool detection: every tool
  // that reads it does so regardless of what else is installed on the machine.
  // OMP has its own "agents" provider that treats `.agent[s]/skills` as its
  // canonical native location (see omp://skills.md), so OMP reads this path
  // independently of installOmp(). Claude Code does NOT read this path — it
  // keeps its own installSkillsTo() call inside installClaudeCode(). Whether
  // OpenCode's plugin reads this path is unverified against OpenCode's own
  // docs; do not assume either way.
  if (
    !(await runInstallStep("Shared skills directory (~/.agents/skills)", () =>
      installSkillsTo(join(home, ".agents", "skills"))
    ))
  ) {
    failures.push("Shared skills directory");
  }

  if (failures.length > 0) {
    throw new Error(
      `${failures.length} integration(s) failed to install: ${failures.join(", ")}. See warnings above for details.`,
    );
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([command, "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    return proc.exitCode === 0;
  } catch {
    return false;
  }
}

function hookEntryHasCommand(entry: unknown, command: string): boolean {
  if (typeof entry !== "object" || entry === null || !("hooks" in entry)) return false;
  const hooks = (entry as { hooks?: unknown }).hooks;
  if (!Array.isArray(hooks)) return false;

  return hooks.some((hook) => {
    if (typeof hook !== "object" || hook === null) return false;
    const candidate = hook as { type?: unknown; command?: unknown };
    return candidate.type === "command" && candidate.command === command;
  });
}

export async function installCodex(): Promise<void> {
  const home = resolveHome();
  const configPath = join(home, ".codex", "config.toml");

  // `codex mcp remove <name>` verified as a real subcommand (`codex mcp
  // --help`, `codex mcp remove --help`) against codex-cli 0.142.3 —
  // symmetric with the `codex mcp add` call this replaces. It rewrites
  // ~/.codex/config.toml itself, so we don't hand-roll a TOML writer here;
  // we only pre-check the file (via Bun's built-in TOML parser) to decide
  // whether there's anything to remove, so a no-op run never touches —
  // or lets the codex CLI reformat — the file at all.
  let hasEiEntry = false;
  try {
    const text = await Bun.file(configPath).text();
    const parsed = Bun.TOML.parse(text) as { mcp_servers?: Record<string, unknown> };
    hasEiEntry = Boolean(parsed?.mcp_servers?.ei);
  } catch {
    // File doesn't exist, or isn't valid TOML — nothing to remove.
  }

  if (!hasEiEntry) {
    console.log(`ℹ️  Ei MCP already absent from ${configPath} — nothing to remove.`);
  } else {
    const proc = Bun.spawn(["codex", "mcp", "remove", "ei"], {
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    if (exitCode !== 0) {
      console.warn(`⚠️  Codex MCP removal failed.`);
      const detail = (stderr || stdout).trim();
      if (detail) console.warn(`   ${detail}`);
    } else {
      console.log(
        `✓ Removed Ei MCP server registration from ${configPath} (skills now cover this capability; MCP remains available via manual setup — see README).`
      );
    }
  }

  await installCodexHooks();
}

// Verified against the real, locally installed codex-cli 0.142.3 binary and
// its hosted hooks reference (developers.openai.com/codex/hooks), not
// assumed by analogy to Claude Code. Codex's hook events, config shape
// (hooks.json / inline [hooks] in config.toml), and output contract
// (hookSpecificOutput.{hookEventName,additionalContext}) intentionally
// mirror Claude Code's almost field-for-field -- confirmed directly from the
// compiled binary's embedded JSON schema and the hosted docs, not inferred.
//
// One load-bearing difference from every other harness Ei hooks into:
// **Codex requires an explicit trust review before any non-managed command
// hook runs at all**, even with a perfectly-formed hooks.json already in
// place. A live `codex exec` smoke test against this exact hooks.json shape
// silently fired nothing until run with `--dangerously-bypass-hook-trust`;
// for a real interactive user, the equivalent unblock is running `/hooks` in
// the CLI once, which the install-time message below still points at. There
// is no way for `ei --install` to complete this trust step on the user's
// behalf -- it is a per-hash, per-user decision Codex's own trust model
// requires.
//
// Both SessionStart and UserPromptSubmit were confirmed live (via
// `codex exec` with a garbage API key, so no billable model call could
// complete) to run synchronously, in that order, before Codex's actual model
// request is dispatched -- not a fire-and-forget race like Claude Code's
// SessionStart or Cursor's sessionStart. No ADR-034 addition needed for
// Codex.
async function installCodexHooks(): Promise<void> {
  const home = resolveHome();
  const hooksDir = join(home, ".codex", "hooks");
  const memoryScriptPath = join(hooksDir, "ei-inject.ts");
  const sessionStartScriptPath = join(hooksDir, "ei-session-start.ts");
  const hooksJsonPath = join(home, ".codex", "hooks.json");

  await Bun.$`mkdir -p ${hooksDir}`;

  try {
    await Bun.$`test -w ${hooksDir}`.quiet();
  } catch {
    console.warn(`⚠️  Cannot write to ${hooksDir} (permission denied).`);
    console.warn(`   Fix with: sudo chown ${process.env.USER ?? "$(whoami)"} ${hooksDir}`);
    console.warn(`   Then re-run: ei --install`);
    return;
  }

  // MEMORY (UserPromptSubmit): now filters returned items against every
  // entity id already surfaced earlier in this Codex session before
  // injecting, matching the fix already shipped for OMP/Claude Code/Cursor.
  // Codex hooks are stateless external processes (a fresh `bun run` per
  // turn), so dedup state is a real file — one per session_id under
  // ~/.codex/ei-hook-state/, same SAFE_SESSION_ID-validated 0700/0600
  // pattern already used for Claude Code. Request size aligned from the
  // previous -n 8 to -n 5 for consistency with every other harness's fixed
  // hook — no Codex-specific reason justified the previous, different
  // number. The --transcript/--session/--hook-source enrichment is
  // preserved unchanged: confirmed live (src/cli/session-context.ts,
  // hookSource === "codex" branch) that this is real, functioning session
  // context retrieval, not dead code -- unlike Claude Code, where the
  // equivalent hook_source branch could never fire and was removed.
  const memoryScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { mkdir, writeFile, chmod } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.codex/ei-hook-state\`;
// Codex session_ids are UUIDs, but treat that as a convention, not a
// guarantee — reject anything else outright rather than interpolating it
// into a filesystem path unchecked.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

function extractId(item) {
  return item && typeof item === "object" && typeof item.id === "string" ? item.id : undefined;
}

function statePathFor(sessionId) {
  if (typeof sessionId !== "string" || !SAFE_SESSION_ID.test(sessionId)) return null;
  return \`\${STATE_DIR}/\${sessionId}.json\`;
}

async function loadSeenIds(sessionId) {
  const path = statePathFor(sessionId);
  if (!path) return new Set();
  try {
    const data = await Bun.file(path).json();
    return new Set(Array.isArray(data?.ids) ? data.ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(sessionId, ids) {
  const path = statePathFor(sessionId);
  if (!path) return;
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await chmod(STATE_DIR, 0o700);
    await writeFile(path, JSON.stringify({ ids: [...ids] }), { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    // State persistence failed (disk full, permissions, a race with another
    // process, ...). The fresh context we already wrote to stdout above is
    // still valid and must not be lost to an uncaught rejection here — losing
    // just the durable marker means these ids may resurface next turn, which
    // is safe; letting this throw and crash the hook process is not.
  }
}

if (import.meta.main) {
  const input = (await new Response(Bun.stdin.stream()).json().catch(() => ({}))) ?? {};
  const rawPrompt = typeof input.prompt === "string" ? input.prompt : "";
  const raw = rawPrompt.replace(/<[^>]*>/g, "").trim();
  const searchArgs = ["-n", "5"];

  const sessionArgs = [];
  if (typeof input.transcript_path === "string" && input.transcript_path) {
    sessionArgs.push("--transcript", input.transcript_path);
  }
  if (typeof input.session_id === "string" && input.session_id) {
    sessionArgs.push("--session", input.session_id, "--hook-source", "codex");
  }

  const args = raw ? [...searchArgs, ...sessionArgs, raw] : ["--recent", ...searchArgs];

  const output = await runEi(args);
  if (output.trim()) {
    let items = null;
    try {
      items = JSON.parse(output);
    } catch {
      // Non-JSON output (e.g. an error string) — nothing to de-dup by id, inject as-is.
    }

    const heading = [
      "## Ei Memory Context",
      "*(The user cannot see this block. It is injected automatically before their message.)*",
      "*(If you reference anything from it, briefly explain where it came from — e.g. \\"Ei shows you've been working on X\\" — so the user isn't confused by knowledge that appeared from nowhere.)*",
      "",
      "Ei is a personal knowledge base built from the user's coding sessions, Slack, documents, and conversations.",
      "The following memories MAY be relevant to your current task — use \`ei_search\` or \`ei_lookup\` for targeted queries.",
    ].join("\\n");

    if (Array.isArray(items)) {
      const seen = await loadSeenIds(input.session_id);
      const fresh = items.filter((item) => {
        const id = extractId(item);
        return !id || !seen.has(id);
      });
      if (fresh.length > 0) {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "UserPromptSubmit",
            additionalContext: \`\\n\${heading}\\n\${JSON.stringify(fresh, null, 2)}\\n\`,
          },
        }));
        for (const item of fresh) {
          const id = extractId(item);
          if (id) seen.add(id);
        }
        await saveSeenIds(input.session_id, seen);
      }
      // fresh.length === 0: everything here already surfaced this session — inject nothing.
    } else {
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: \`\\n\${heading}\\n\${output.trim()}\\n\`,
        },
      }));
    }
  }
}
`;

  // WHO (SessionStart): announces the single "Codex" persona's identity
  // (ensureCodexPersona-equivalent in src/integrations/codex/importer.ts,
  // CODEX_PERSONA_NAME = "Codex") — every Codex session shares this one
  // persona, no multi-agent tab-switching to resolve. No dedup state needed:
  // confirmed live that SessionStart only fires at real session boundaries
  // (source: startup/resume/clear/compact), never per-turn, and Codex's own
  // docs say it fires again on compact specifically "before the next model
  // request" so the continuation gets fresh context — exactly the semantic
  // we want, matching Claude Code's identical SessionStart contract. Plain
  // text on stdout (confirmed live, no JSON envelope needed for this event),
  // matching Claude Code's WHO hook's own choice for the same reason. Also
  // prunes MEMORY's per-session dedup state files older than 30 days here
  // (once per session boundary) rather than in the MEMORY hook (once per
  // turn), to avoid a directory scan on every single prompt.
  const sessionStartScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { readdir, stat, unlink } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.codex/ei-hook-state\`;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

async function pruneStaleState() {
  let names;
  try {
    names = await readdir(STATE_DIR);
  } catch {
    return; // state dir doesn't exist yet — nothing to prune
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = \`\${STATE_DIR}/\${name}\`;
    try {
      const info = await stat(path);
      if (now - info.mtimeMs > STALE_MS) await unlink(path);
    } catch {
      // transient stat/unlink failure, or another process already removed it — skip.
    }
  }
}

if (import.meta.main) {
  const block = await runEi(["personas", "--format", "prompt", "--", "Codex"]);
  if (block.trim() && !block.includes("No saved state")) {
    process.stdout.write(\`\\n\${block.trim()}\\n\`);
  }

  await pruneStaleState();
}
`;

  await Bun.write(memoryScriptPath, memoryScriptContent);
  await Bun.$`chmod +x ${memoryScriptPath}`;
  await Bun.write(sessionStartScriptPath, sessionStartScriptContent);
  await Bun.$`chmod +x ${sessionStartScriptPath}`;

  type CodexHookEntry = {
    hooks: Array<{ type: string; command: string; statusMessage?: string; timeout?: number }>;
  };

  interface CodexHooksConfig {
    hooks: {
      UserPromptSubmit?: CodexHookEntry[];
      SessionStart?: CodexHookEntry[];
      [key: string]: unknown;
    };
  }

  let hooksConfig: CodexHooksConfig = { hooks: {} };
  try {
    const text = await Bun.file(hooksJsonPath).text();
    hooksConfig = JSON.parse(text) as CodexHooksConfig;
    if (!hooksConfig.hooks || typeof hooksConfig.hooks !== "object") {
      hooksConfig.hooks = {};
    }
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const userPromptSubmit = (hooksConfig.hooks.UserPromptSubmit ?? []) as CodexHookEntry[];
  const memoryHookEntry = {
    hooks: [{
      type: "command",
      command: memoryScriptPath,
      statusMessage: "Loading Ei memory context",
      timeout: 30,
    }],
  };
  if (!userPromptSubmit.some((entry) => hookEntryHasCommand(entry, memoryScriptPath))) {
    userPromptSubmit.push(memoryHookEntry);
  }
  hooksConfig.hooks.UserPromptSubmit = userPromptSubmit;

  const sessionStart = (hooksConfig.hooks.SessionStart ?? []) as CodexHookEntry[];
  const whoHookEntry = {
    hooks: [{
      type: "command",
      command: sessionStartScriptPath,
      statusMessage: "Loading Ei identity",
    }],
  };
  if (!sessionStart.some((entry) => hookEntryHasCommand(entry, sessionStartScriptPath))) {
    sessionStart.push(whoHookEntry);
  }
  hooksConfig.hooks.SessionStart = sessionStart;

  const tmpPath = `${hooksJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(hooksConfig, null, 2) + "\n");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei Codex context hooks to ~/.codex/hooks/ei-inject.ts (UserPromptSubmit) and ~/.codex/hooks/ei-session-start.ts (SessionStart)`);
  console.log(`  Use /hooks in Codex to review/trust the hooks if prompted — Codex requires explicit trust before any non-managed hook runs.`);
}

export async function installClaudeCode(): Promise<void> {
  const home = resolveHome();
  const claudeJsonPath = join(home, ".claude.json");

  // Direct config edit — matches the atomic-write pattern the original
  // registration used, but inverted: remove the "ei" entry instead of
  // adding one. Every other key/entry in the file is left untouched.
  let config: Record<string, unknown> = {};
  try {
    const text = await Bun.file(claudeJsonPath).text();
    config = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — nothing to remove.
  }

  const mcpServers = config.mcpServers;
  const hasEiEntry = typeof mcpServers === "object" && mcpServers !== null && "ei" in mcpServers;

  if (!hasEiEntry) {
    console.log(`ℹ️  Ei MCP already absent from ${claudeJsonPath} — nothing to remove.`);
  } else {
    delete (mcpServers as Record<string, unknown>)["ei"];

    // Atomic write: write to temp file then rename to avoid partial writes
    const tmpPath = `${claudeJsonPath}.ei-install.tmp`;
    await Bun.write(tmpPath, JSON.stringify(config, null, 2) + "\n");
    await rename(tmpPath, claudeJsonPath);

    console.log(
      `✓ Removed Ei MCP server registration from ${claudeJsonPath} (skills now cover this capability; MCP remains available via manual setup — see README).`
    );
  }

  await installClaudeCodeHooks();

  await installSkillsTo(join(home, ".claude", "skills"));
}

async function installClaudeCodeHooks(): Promise<void> {
  const home = resolveHome();
  const hooksDir = join(home, ".claude", "hooks");
  const memoryScriptPath = join(hooksDir, "ei-inject.ts");
  const sessionStartScriptPath = join(hooksDir, "ei-session-start.ts");
  const settingsPath = join(home, ".claude", "settings.json");

  await Bun.$`mkdir -p ${hooksDir}`;

  try {
    await Bun.$`test -w ${hooksDir}`.quiet();
  } catch {
    console.warn(`⚠️  Cannot write to ${hooksDir} (permission denied).`);
    console.warn(`   Fix with: sudo chown ${process.env.USER ?? "$(whoami)"} ${hooksDir}`);
    console.warn(`   Then re-run: ei --install`);
    return;
  }

  // MEMORY (UserPromptSubmit): unchanged -n 5 request size, but now filters
  // returned items against every entity id already surfaced earlier in this
  // Claude Code session before injecting, and skips injection entirely once
  // nothing new survives the filter. Claude Code hooks are stateless external
  // processes (a fresh `bun run` per turn, no persistent extension host like
  // OMP's), so the dedup state has to be a real file — one per session_id
  // under ~/.claude/ei-hook-state/. session_id is stable across --continue
  // and --resume as of Claude Code 2.0.24 (github.com/anthropics/claude-code
  // issue #9188), and Claude Code replays saved additionalContext on resume
  // rather than re-running the hook for past turns, so the file needs to
  // survive the resume for this to be correct, not just the live process.
  // Dropped the old `input.hook_source` branch: Claude Code never actually
  // sends that field (session_id/transcript_path/cwd/permission_mode/
  // hook_event_name/prompt are the real UserPromptSubmit fields per
  // code.claude.com/docs/en/hooks), and `ei --hook-source` only recognizes
  // "opencode-plugin"/"cursor"/"codex" — so that branch could never fire.
  const memoryScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { mkdir, writeFile, chmod } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.claude/ei-hook-state\`;
// Claude Code session_ids are UUIDs, but treat that as a convention, not a
// guarantee — reject anything else outright rather than interpolating it
// into a filesystem path unchecked (a session_id of "../settings" would
// otherwise resolve outside STATE_DIR entirely).
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;

function extractId(item) {
  return item && typeof item === "object" && typeof item.id === "string" ? item.id : undefined;
}

function statePathFor(sessionId) {
  if (typeof sessionId !== "string" || !SAFE_SESSION_ID.test(sessionId)) return null;
  return \`\${STATE_DIR}/\${sessionId}.json\`;
}

async function loadSeenIds(sessionId) {
  const path = statePathFor(sessionId);
  if (!path) return new Set();
  try {
    const data = await Bun.file(path).json();
    return new Set(Array.isArray(data?.ids) ? data.ids.filter((id) => typeof id === "string") : []);
  } catch {
    return new Set();
  }
}

async function saveSeenIds(sessionId, ids) {
  const path = statePathFor(sessionId);
  if (!path) return;
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await chmod(STATE_DIR, 0o700);
    await writeFile(path, JSON.stringify({ ids: [...ids] }), { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    // State persistence failed (disk full, permissions, a race with another
    // process, ...). The fresh context we already wrote to stdout above is
    // still valid and must not be lost to an uncaught rejection here — losing
    // just the durable marker means these ids may resurface next turn, which
    // is safe; letting this throw and crash the hook process is not.
  }
}

if (import.meta.main) {
  const heading = \`
## Ei Memory Context
*(The user cannot see this block. It is injected automatically before their message.)*
*(If you reference anything from it, briefly explain where it came from — e.g. "Ei shows you've been working on X" — so the user isn't confused by knowledge that appeared from nowhere.)*

Ei is a personal knowledge base built from the user's coding sessions, Slack, documents, and conversations.
The following items MAY be relevant to your current task — use \\\`ei_search\\\` or \\\`ei_lookup\\\` for targeted queries.
\`;

  const input = (await new Response(Bun.stdin.stream()).json().catch(() => ({}))) ?? {};
  const rawPrompt = typeof input.prompt === "string" ? input.prompt : "";
  const raw = rawPrompt.replace(/<[^>]*>/g, "").trim();

  const sessionArgs = [];
  if (typeof input.transcript_path === "string" && input.transcript_path) {
    sessionArgs.push("--transcript", input.transcript_path);
  }

  const args = raw ? ["-n", "5", ...sessionArgs, raw] : ["--recent", "-n", "5"];

  const output = await runEi(args);
  if (output.trim()) {
    let items = null;
    try {
      items = JSON.parse(output);
    } catch {
      // Non-JSON output (e.g. an error string) — nothing to de-dup by id, inject as-is.
    }

    if (Array.isArray(items)) {
      const seen = await loadSeenIds(input.session_id);
      const fresh = items.filter((item) => {
        const id = extractId(item);
        return !id || !seen.has(id);
      });
      if (fresh.length > 0) {
        process.stdout.write(\`\\n\${heading}\\n\${JSON.stringify(fresh, null, 2)}\\n\`);
        for (const item of fresh) {
          const id = extractId(item);
          if (id) seen.add(id);
        }
        await saveSeenIds(input.session_id, seen);
      }
      // fresh.length === 0: everything here already surfaced this session — inject nothing.
    } else {
      process.stdout.write(\`\\n\${heading}\\n\${output.trim()}\\n\`);
    }
  }
}
`;

  // WHO (SessionStart): announces the single "Claude Code" persona's identity
  // (ensureClaudeCodePersona in src/integrations/claude-code/importer.ts —
  // display_name "Claude Code", NOT "Claude" — every Claude Code session
  // shares this one persona, there's no multi-persona tab-switching to
  // resolve). No dedup state needed: SessionStart itself only fires at real
  // session boundaries — startup, resume, /clear, compaction, and
  // --fork-session forks — and Claude Code's own docs say it re-runs on
  // resume/fork specifically "so they can refresh their context," which is
  // exactly the semantic we want. Also prunes state files older than 30 days
  // from the MEMORY hook's per-session dedup store — done here (once per
  // session) rather than in the MEMORY hook (once per turn) to avoid a
  // directory scan on every single prompt.
  const sessionStartScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { readdir, stat, unlink } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.claude/ei-hook-state\`;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

async function pruneStaleState() {
  let names;
  try {
    names = await readdir(STATE_DIR);
  } catch {
    return; // state dir doesn't exist yet — nothing to prune
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = \`\${STATE_DIR}/\${name}\`;
    try {
      const info = await stat(path);
      if (now - info.mtimeMs > STALE_MS) await unlink(path);
    } catch {
      // transient stat/unlink failure, or another process already removed it — skip.
    }
  }
}

if (import.meta.main) {
  const block = await runEi(["personas", "--format", "prompt", "--", "Claude Code"]);
  if (block.trim() && !block.includes("No saved state")) {
    process.stdout.write(\`\\n\${block.trim()}\\n\`);
  }

  await pruneStaleState();
}
`;

  await Bun.write(memoryScriptPath, memoryScriptContent);
  await Bun.$`chmod +x ${memoryScriptPath}`;
  await Bun.write(sessionStartScriptPath, sessionStartScriptContent);
  await Bun.$`chmod +x ${sessionStartScriptPath}`;

  let settings: Record<string, unknown> = {};
  try {
    const text = await Bun.file(settingsPath).text();
    settings = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;

  const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];
  const memoryHookEntry = { hooks: [{ type: "command", command: "~/.claude/hooks/ei-inject.ts" }] };
  if (!userPromptSubmit.some((entry) => hookEntryHasCommand(entry, "~/.claude/hooks/ei-inject.ts"))) {
    userPromptSubmit.push(memoryHookEntry);
  }
  hooks.UserPromptSubmit = userPromptSubmit;

  const sessionStart = (hooks.SessionStart ?? []) as unknown[];
  const whoHookEntry = { hooks: [{ type: "command", command: "~/.claude/hooks/ei-session-start.ts" }] };
  if (!sessionStart.some((entry) => hookEntryHasCommand(entry, "~/.claude/hooks/ei-session-start.ts"))) {
    sessionStart.push(whoHookEntry);
  }
  hooks.SessionStart = sessionStart;

  settings.hooks = hooks;

  // Atomic write: write to temp file then rename to avoid partial writes
  const tmpPath = `${settingsPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmpPath, settingsPath);

  console.log(`✓ Installed Ei context hooks to ~/.claude/hooks/ei-inject.ts (UserPromptSubmit) and ~/.claude/hooks/ei-session-start.ts (SessionStart)`);
}

export async function installCursor(): Promise<void> {
  const home = resolveHome();
  const cursorJsonPath = join(home, ".cursor", "mcp.json");

  // Direct config edit — matches the atomic-write pattern the original
  // registration used, but inverted: remove the "ei" entry instead of
  // adding one. Every other key/entry in the file is left untouched.
  let config: Record<string, unknown> = {};
  try {
    const text = await Bun.file(cursorJsonPath).text();
    config = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — nothing to remove.
  }

  const mcpServers = config.mcpServers;
  const hasEiEntry = typeof mcpServers === "object" && mcpServers !== null && "ei" in mcpServers;

  if (!hasEiEntry) {
    console.log(`ℹ️  Ei MCP already absent from ${cursorJsonPath} — nothing to remove.`);
  } else {
    delete (mcpServers as Record<string, unknown>)["ei"];

    const tmpPath = `${cursorJsonPath}.ei-install.tmp`;
    await Bun.write(tmpPath, JSON.stringify(config, null, 2) + "\n");
    await rename(tmpPath, cursorJsonPath);

    console.log(
      `✓ Removed Ei MCP server registration from ${cursorJsonPath} (skills now cover this capability; MCP remains available via manual setup — see README).`
    );
  }

  await installCursorHooks();
}

// WHO (sessionStart): Cursor's docs (cursor.com/docs/hooks) confirm sessionStart
// supports `additional_context` output — a real, non-file-based context channel,
// unlike beforeSubmitPrompt (continue/user_message only, no context field). Every
// Cursor session shares the single "Cursor" persona (ensureCursorPersona-equivalent
// in src/integrations/cursor/importer.ts, CURSOR_PERSONA_NAME = "Cursor"), so — same
// as Claude Code — there's no active-persona resolution needed, just an unconditional
// lookup. sessionStart's own docs describe it as fire-and-forget (the agent loop does
// not wait for or enforce a blocking response), so the very first prompt in a brand
// new session can race ahead of this — see docs/adr/ADR-034.
//
// MEMORY (beforeSubmitPrompt): Cursor's ONLY per-turn hook has no context-injection
// output at all (confirmed directly from the docs — continue/user_message only), so
// content still has to go through the rules-file trick, unlike OMP/Claude Code where
// the hook itself can carry fresh content. But Cursor genuinely supports concurrent
// sessions (background agents, Side Chats, multiple Composer windows via worktrees),
// while ~/.cursor/rules/ lives outside any one session's scope — a single shared file
// has no way to know which session "owns" it. So per-session bookkeeping (which items
// THIS session has already seen) lives in its own state file, keyed by conversation_id
// exactly like Claude Code's session_id-keyed store, and the shared rules file is
// treated as a pure render target: every time a session's hook fires, it swaps in
// THAT session's own current view. A session that isn't the most recent speaker can
// see a stale, different session's view for one turn when sessions interleave — a
// bounded, self-correcting race of the same shape as the sessionStart race above, not
// unbounded cross-session contamination. See ADR-034.
async function installCursorHooks(): Promise<void> {
  const home = resolveHome();
  const hooksDir = join(home, ".cursor", "hooks");
  const rulesDir = join(home, ".cursor", "rules");
  const memoryScriptPath = join(hooksDir, "ei-inject.ts");
  const sessionStartScriptPath = join(hooksDir, "ei-session-start.ts");
  const hooksJsonPath = join(home, ".cursor", "hooks.json");

  await Bun.$`mkdir -p ${hooksDir}`;
  await Bun.$`mkdir -p ${rulesDir}`;

  const memoryScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { mkdir, readFile, writeFile, chmod, rename } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.cursor/ei-hook-state\`;
const RULES_DIR = \`\${process.env.HOME}/.cursor/rules\`;
const RULES_FILE = \`\${RULES_DIR}/ei-context.mdc\`;
// conversation_id/session_id are UUIDs in practice, but treat that as a
// convention, not a guarantee — reject anything else before it reaches a path.
const SAFE_SESSION_ID = /^[A-Za-z0-9_-]+$/;
// The whole accumulated array is resent every turn (alwaysApply has no
// incremental-context concept the way OMP/Claude Code's transient messages
// do), so this bounds a single long-lived session's token cost. Aging an
// item out of this list re-eligibilizes it for a future "fresh" showing —
// once it's no longer actually in context, resurfacing it later isn't waste.
const MAX_MEMORY_ITEMS = 30;

function extractId(item) {
  return item && typeof item === "object" && typeof item.id === "string" ? item.id : undefined;
}

function statePathFor(sessionId) {
  if (typeof sessionId !== "string" || !SAFE_SESSION_ID.test(sessionId)) return null;
  return \`\${STATE_DIR}/\${sessionId}.json\`;
}

async function loadItems(sessionId) {
  const path = statePathFor(sessionId);
  if (!path) return [];
  try {
    const data = JSON.parse(await readFile(path, "utf-8"));
    return Array.isArray(data?.items) ? data.items : [];
  } catch {
    return [];
  }
}

async function saveItems(sessionId, items) {
  const path = statePathFor(sessionId);
  if (!path) return;
  try {
    await mkdir(STATE_DIR, { recursive: true });
    await chmod(STATE_DIR, 0o700);
    await writeFile(path, JSON.stringify({ items }), { mode: 0o600 });
    await chmod(path, 0o600);
  } catch {
    // Persistence failure — the render step below still uses this turn's
    // in-memory items, so the shared rules file stays correct even if the
    // durable per-session record didn't make it to disk.
  }
}

function renderRulesFile(items) {
  const body = items.length > 0 ? \`## Ei Memory (session context)\\n\\n\${JSON.stringify(items, null, 2)}\\n\` : "";
  return \`---\\ndescription: Ei persistent memory context (auto-updated before each prompt)\\nalwaysApply: true\\n---\\n\${body}\`;
}

async function swapInRulesFile(content) {
  try {
    await mkdir(RULES_DIR, { recursive: true });
    const tmpPath = \`\${RULES_FILE}.ei-tmp-\${process.pid}\`;
    await writeFile(tmpPath, content);
    await rename(tmpPath, RULES_FILE);
  } catch {
    // If the swap fails, Cursor keeps whatever was already there — never
    // worse than the pre-swap state, never a crash.
  }
}

if (import.meta.main) {
  const input = (await new Response(Bun.stdin.stream()).json().catch(() => ({}))) ?? {};
  const sessionId =
    typeof input.conversation_id === "string"
      ? input.conversation_id
      : typeof input.session_id === "string"
        ? input.session_id
        : undefined;
  const rawPrompt = typeof input.prompt === "string" ? input.prompt : "";
  const raw = rawPrompt.replace(/<[^>]*>/g, "").trim();

  const args = raw ? ["-n", "5", raw] : ["--recent", "-n", "5"];
  const output = await runEi(args);

  let items = await loadItems(sessionId);
  if (output.trim()) {
    let parsed = null;
    try {
      parsed = JSON.parse(output);
    } catch {
      // Non-JSON output — nothing to merge by id; accumulated items stay as-is.
    }
    if (Array.isArray(parsed)) {
      const seen = new Set(items.map(extractId).filter((id) => id !== undefined));
      const fresh = parsed.filter((item) => {
        const id = extractId(item);
        return !id || !seen.has(id);
      });
      if (fresh.length > 0) {
        items = [...items, ...fresh].slice(-MAX_MEMORY_ITEMS);
        await saveItems(sessionId, items);
      }
    }
  }

  // Always re-render, even when nothing changed this turn: this session's
  // own hook firing is what keeps the one shared rules file pointed at ITS
  // view. Skipping the render on a no-new-items turn would let a different
  // session that fired in between keep "winning" the shared file indefinitely.
  await swapInRulesFile(renderRulesFile(items));

  process.stdout.write(JSON.stringify({ continue: true }));
}
`;

  const sessionStartScriptContent = `#!/usr/bin/env bun
import { $ } from "bun";
import { readdir, stat, unlink } from "fs/promises";

${RUN_EI_BUN_SNIPPET}

const STATE_DIR = \`\${process.env.HOME}/.cursor/ei-hook-state\`;
const STALE_MS = 30 * 24 * 60 * 60 * 1000;

async function pruneStaleState() {
  let names;
  try {
    names = await readdir(STATE_DIR);
  } catch {
    return; // state dir doesn't exist yet — nothing to prune
  }
  const now = Date.now();
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const path = \`\${STATE_DIR}/\${name}\`;
    try {
      const info = await stat(path);
      if (now - info.mtimeMs > STALE_MS) await unlink(path);
    } catch {
      // transient stat/unlink failure, or another process already removed it — skip.
    }
  }
}

if (import.meta.main) {
  await new Response(Bun.stdin.stream()).json().catch(() => ({}));
  const block = await runEi(["personas", "--format", "prompt", "--", "Cursor"]);
  const result = block.trim() && !block.includes("No saved state") ? { additional_context: block.trim() } : {};
  process.stdout.write(JSON.stringify(result));

  await pruneStaleState();
}
`;

  await Bun.write(memoryScriptPath, memoryScriptContent);
  await Bun.$`chmod +x ${memoryScriptPath}`;
  await Bun.write(sessionStartScriptPath, sessionStartScriptContent);
  await Bun.$`chmod +x ${sessionStartScriptPath}`;

  interface HooksConfig {
    version: number;
    hooks: {
      beforeSubmitPrompt?: Array<{ command: string }>;
      sessionStart?: Array<{ command: string }>;
      [key: string]: unknown;
    };
  }

  let hooksConfig: HooksConfig = { version: 1, hooks: {} };
  try {
    const text = await Bun.file(hooksJsonPath).text();
    hooksConfig = JSON.parse(text) as HooksConfig;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const beforeSubmit = (hooksConfig.hooks.beforeSubmitPrompt ?? []) as Array<{ command: string }>;
  const memoryEntry = { command: "~/.cursor/hooks/ei-inject.ts" };
  if (!beforeSubmit.some((entry) => entry.command === memoryEntry.command)) {
    beforeSubmit.push(memoryEntry);
  }
  hooksConfig.hooks.beforeSubmitPrompt = beforeSubmit;

  const sessionStart = (hooksConfig.hooks.sessionStart ?? []) as Array<{ command: string }>;
  const whoEntry = { command: "~/.cursor/hooks/ei-session-start.ts" };
  if (!sessionStart.some((entry) => entry.command === whoEntry.command)) {
    sessionStart.push(whoEntry);
  }
  hooksConfig.hooks.sessionStart = sessionStart;

  const tmpPath = `${hooksJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(hooksConfig, null, 2) + "\n");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei context hooks to ~/.cursor/hooks/ei-inject.ts (beforeSubmitPrompt) and ~/.cursor/hooks/ei-session-start.ts (sessionStart)`);
}

// WHO/MEMORY for raw Pi: verified against the real installed
// @earendil-works/pi-coding-agent package (0.75.4), not assumed from OMP's
// fork. Two confirmed divergences drive this implementation:
//
// 1. ExtensionContext has no activePersonaName or any agent-identity concept
//    at all -- Pi has no persona-switching. Ei's own importer (PI_PERSONA_NAME
//    in src/integrations/pi/types.ts) already treats every Pi session as one
//    fixed "Pi" persona, so WHO here is a static single-persona injection,
//    the same shape as Ei's Claude Code/Cursor hooks -- dedupe once per
//    session branch via an "ei-who" marker, not per-persona-transition like
//    OMP.
// 2. Pi's extensions load via jiti directly from the .ts source (not
//    bundled), and its own alias table resolves "typebox" but not "bun" --
//    confirmed absent for both a Node-run `pi` and a Bun-compiled `pi`
//    binary. The prior version of this hook imported Bun's `$` shell helper,
//    which cannot resolve inside a Pi extension and would have failed at
//    load time on every real install. Replaced with node:child_process,
//    which every Pi runtime provides.
//
// registerTool's `parameters` field is real TypeBox (confirmed by Pi's own
// docs/extensions.md and examples/extensions/hello.ts), and `promptSnippet`
// is a real, functional ToolDefinition field for Pi (controls the tool's
// one-line entry in the default "Available tools" system-prompt section) --
// both kept, unlike OMP where promptSnippet doesn't exist on that fork's
// ToolDefinition at all.
export async function installPi(): Promise<void> {
  const home = resolveHome();

  const extensionContent = `import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const runEi = async (cmdArgs: string[]): Promise<string> => {
  try {
    const { stdout } = await execFileAsync("ei", cmdArgs, { timeout: 15000 });
    return stdout;
  } catch {
    // local ei failed (nonzero exit / binary not found) -- fall back to bunx
  }
  try {
    const { stdout } = await execFileAsync("bunx", ["ei-tui@latest", ...cmdArgs], { timeout: 30000 });
    return stdout;
  } catch {
    return "";
  }
};

// Pi has exactly one persona for the whole install (see file header) --
// dedupe once per session branch, never re-fetching after a successful send.
function alreadySentWho(ctx: ExtensionContext): boolean {
  return ctx.sessionManager.getBranch().some(
    (entry) => entry.type === "custom" && entry.customType === "ei-who"
  );
}

// Union of every entity id the MEMORY hook has already surfaced on this branch.
function collectSeenMemoryIds(ctx: ExtensionContext): Set<string> {
  const seen = new Set<string>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "ei-memory") continue;
    const data = entry.data;
    if (!data || typeof data !== "object" || !("ids" in data) || !Array.isArray(data.ids)) continue;
    for (const id of data.ids) {
      if (typeof id === "string") seen.add(id);
    }
  }
  return seen;
}

function extractId(item: unknown): string | undefined {
  if (item && typeof item === "object" && "id" in item) {
    const id = item.id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

export default function eiIntegration(pi: ExtensionAPI) {
  // WHO: inject the single <ei-relationship> block once per branch.
  pi.on("before_agent_start", async (_event, ctx) => {
    if (alreadySentWho(ctx)) return undefined;

    const block = await runEi(["personas", "--format", "prompt", "--", "Pi"]).catch(() => "");
    if (!block.trim()) return undefined;

    pi.appendEntry("ei-who", { sent: true });

    return {
      message: {
        customType: "ei-persona-who",
        content: block.trim(),
        display: false,
      },
    };
  });

  // MEMORY: inject relevant Ei context based on the current prompt, filtered
  // against every entity id already surfaced earlier on this branch.
  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = event.prompt ?? "";
    const args = prompt ? ["-n", "5", "--", prompt] : ["--recent", "-n", "5"];
    const output = await runEi(args).catch(() => "");
    if (!output.trim()) return undefined;

    let items: unknown = null;
    try {
      items = JSON.parse(output);
    } catch {
      // Non-JSON output (e.g. an error string) -- nothing to de-dup by id, inject as-is.
    }

    let body = output.trim();
    let newIds: string[] = [];
    if (Array.isArray(items)) {
      const seen = collectSeenMemoryIds(ctx);
      const fresh = items.filter((item) => {
        const id = extractId(item);
        return !id || !seen.has(id);
      });
      if (fresh.length === 0) return undefined; // everything here already surfaced this session
      newIds = fresh.map(extractId).filter((id): id is string => id !== undefined);
      body = JSON.stringify(fresh, null, 2);
    }

    const heading = [
      "## Ei Memory Context",
      "*(The user cannot see this block. It is injected automatically before their message.)*",
      "*(If you reference anything from it, briefly explain where it came from.)*",
      "",
      "Ei is a personal knowledge base built from your coding sessions, Slack, documents, and conversations.",
      "The following items MAY be relevant to your current task — use ei_search or ei_lookup for targeted queries.",
    ].join("\\n");

    if (newIds.length > 0) pi.appendEntry("ei-memory", { ids: newIds });

    return {
      message: {
        customType: "ei-context",
        content: \`\${heading}\\n\\n\${body}\`,
        display: false,
      },
    };
  });

  pi.registerTool({
    name: "ei_search",
    label: "Search Ei Memory",
    description: "Semantic search of Ei's personal knowledge base — facts, topics, people, quotes across all sources. Use when you need context about the user, their work, or anything Ei has learned.",
    promptSnippet: "Search Ei's personal memory for relevant facts, topics, people, or quotes.",
    parameters: Type.Object({
      query: Type.String({ description: "Natural language search query" }),
      type: Type.Optional(Type.Union([
        Type.Literal("facts"),
        Type.Literal("topics"),
        Type.Literal("people"),
        Type.Literal("quotes"),
        Type.Literal("personas"),
      ], { description: "Filter to a specific data type. Omit for balanced results across all types." })),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const args = params.type
        ? [params.type, "-n", "5", "--", params.query]
        : ["-n", "5", "--", params.query];
      const output = await runEi(args).catch(() => "");
      return {
        content: [{ type: "text" as const, text: output.trim() || "No results found" }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ei_lookup",
    label: "Lookup Ei Entity",
    description: "Full-record lookup for a specific Ei entity (Fact, Topic, Person, Quote, or Persona) by ID. Use after ei_search to retrieve complete details for an item.",
    parameters: Type.Object({
      id: Type.String({ description: "Entity ID from ei_search results" }),
    }),
    async execute(_id, params, _signal, _onUpdate, _ctx) {
      const output = await runEi(["--id", params.id]).catch(() => "");
      return {
        content: [{ type: "text" as const, text: output.trim() || "Not found" }],
        details: {},
      };
    },
  });
}
`;

  const extDir = join(home, ".pi", "agent", "extensions");
  const extFilename = "ei-integration.ts";

  await Bun.$`mkdir -p ${extDir}`;
  await Bun.write(join(extDir, extFilename), extensionContent);
  console.log(`✓ Installed Ei extension to ~/.pi/agent/extensions/${extFilename}`);
}

export async function installOmp(): Promise<void> {
  const home = resolveHome();

  const extensionContent = `import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";
import { $ } from "bun";

${RUN_EI_BUN_SNIPPET}

// WHO block deduplication: Promise identity reuse — resolving is synchronous on subsequent calls.
const personaBlockFetch = new Map<string, Promise<string | null>>();

async function fetchPersonaBlock(name: string): Promise<string | null> {
  try {
    const block = await runEi(["personas", "--format", "prompt", "--", name]);
    return block.trim() || null;
  } catch {
    return null;
  }
}

// Scan THIS session's actual lineage — never ctx.sessionManager.getEntries(),
// which spans every fork/branch and would let a sibling fork's markers wrongly
// suppress an injection this branch never received — for the persona named in
// the most recent "ei-who" marker. Custom entries never reach the LLM (see
// ExtensionAPI.appendEntry's doc comment), so this dedup state costs nothing
// per turn, and a forked child correctly inherits everything marked before the
// fork point while staying blind to whatever a sibling branch marks after it.
function findLastWhoPersona(ctx: ExtensionContext): string | null | undefined {
  const branch = ctx.sessionManager.getBranch();
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type !== "custom" || entry.customType !== "ei-who") continue;
    const data = entry.data;
    if (!data || typeof data !== "object" || !("persona" in data)) continue;
    const persona = data.persona;
    if (persona === null || typeof persona === "string") return persona;
    // Marker present but malformed (persona is neither a string nor null) — keep
    // scanning further back for the latest actually-valid marker.
  }
  return undefined; // no marker recorded yet on this branch
}

// Union of every entity id the MEMORY hook has already surfaced on this branch.
function collectSeenMemoryIds(ctx: ExtensionContext): Set<string> {
  const seen = new Set<string>();
  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "custom" || entry.customType !== "ei-memory") continue;
    const data = entry.data;
    if (!data || typeof data !== "object" || !("ids" in data) || !Array.isArray(data.ids)) continue;
    for (const id of data.ids) {
      if (typeof id === "string") seen.add(id);
    }
  }
  return seen;
}

function extractId(item: unknown): string | undefined {
  if (item && typeof item === "object" && "id" in item) {
    const id = item.id;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

export default function eiIntegration(pi: ExtensionAPI) {
  // WHO: inject <ei-relationship> block for the active primary persona.
  // Prefer ctx.activePersonaName when the field is present at all — including
  // when its value is explicitly null ("no persona loaded"), which must win
  // over a stale "You are X" string surviving in event.systemPrompt. Only
  // fall back to parsing the HOW block when the field is genuinely absent
  // (pre persona-tab-cycle OMP, which predates this API entirely).
  pi.on("before_agent_start", async (event, ctx) => {
    const quoted = event.systemPrompt.join("\\n").match(/You are "([^"]+)"/);
    const personaName: string | null =
      "activePersonaName" in ctx ? ctx.activePersonaName : (quoted?.[1]?.trim() ?? null);

    // Dedup key is "what identity did we last announce on THIS branch" — not
    // "have we ever sent this persona." A→B→A (and A→null→A) all resend: every
    // transition is a real change the model hasn't seen reflected yet, even
    // when the destination identity already appeared earlier in the session.
    // "No active persona" is its own tracked state, not a bare skip — otherwise
    // clearing and then reselecting the same persona would look identical to
    // never having left it.
    if (findLastWhoPersona(ctx) === personaName) return undefined;

    if (!personaName) {
      pi.appendEntry("ei-who", { persona: null });
      return undefined;
    }

    if (!personaBlockFetch.has(personaName)) {
      personaBlockFetch.set(personaName, fetchPersonaBlock(personaName));
    }
    const block = await personaBlockFetch.get(personaName)!;
    if (!block) return undefined;

    pi.appendEntry("ei-who", { persona: personaName });

    return {
      message: {
        customType: "ei-persona-who",
        content: block,
        display: false,
      },
    };
  });

  // MEMORY: inject relevant Ei context based on the current prompt, filtered
  // against every entity id already surfaced earlier on this branch. Request
  // size stays at -n 5 deliberately: the fix is per-item de-dup, not a bigger
  // candidate pool padded back up to size — that would just push relevance
  // further down the ranked list every turn instead of shrinking the block,
  // trading duplication for noise about steadily less-relevant items.
  pi.on("before_agent_start", async (event, ctx) => {
    const prompt = event.prompt ?? "";
    const args = prompt ? ["-n", "5", "--", prompt] : ["--recent", "-n", "5"];
    const output = await runEi(args).catch(() => "");
    if (!output.trim()) return undefined;

    let items: unknown = null;
    try {
      items = JSON.parse(output);
    } catch {
      // Non-JSON output (e.g. an error string) — nothing to de-dup by id, inject as-is.
    }

    let body = output.trim();
    let newIds: string[] = [];
    if (Array.isArray(items)) {
      const seen = collectSeenMemoryIds(ctx);
      const fresh = items.filter((item) => {
        const id = extractId(item);
        return !id || !seen.has(id);
      });
      if (fresh.length === 0) return undefined; // everything here already surfaced this session
      newIds = fresh.map(extractId).filter((id): id is string => id !== undefined);
      body = JSON.stringify(fresh, null, 2);
    }

    const heading = [
      "## Ei Memory Context",
      "*(The user cannot see this block. It is injected automatically before their message.)*",
      "*(If you reference anything from it, briefly explain where it came from.)*",
      "",
      "Ei is a personal knowledge base built from your coding sessions, Slack, documents, and conversations.",
      "The following items MAY be relevant to your current task — use ei_search or ei_lookup for targeted queries.",
    ].join("\\n");

    if (newIds.length > 0) pi.appendEntry("ei-memory", { ids: newIds });

    return {
      message: {
        customType: "ei-context",
        content: \`\${heading}\\n\\n\${body}\`,
        display: false,
      },
    };
  });

  // Tools use plain JSON Schema — no typebox import needed (not available in source mode).
  pi.registerTool({
    name: "ei_search",
    label: "Search Ei Memory",
    description: "Semantic search of Ei's personal knowledge base — facts, topics, people, quotes across all sources. Use when you need context about the user, their work, or anything Ei has learned.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural language search query" },
        type: {
          type: "string",
          enum: ["facts", "topics", "people", "quotes", "personas"],
          description: "Filter to a specific data type. Omit for balanced results across all types.",
        },
      },
      required: ["query"],
    },
    async execute(_id, params: { query: string; type?: string }, _signal, _onUpdate, _ctx) {
      const args = params.type
        ? [params.type, "-n", "5", "--", params.query]
        : ["-n", "5", "--", params.query];
      const output = await runEi(args).catch(() => "");
      return {
        content: [{ type: "text" as const, text: output.trim() || "No results found" }],
        details: {},
      };
    },
  });

  pi.registerTool({
    name: "ei_lookup",
    label: "Lookup Ei Entity",
    description: "Full-record lookup for a specific Ei entity (Fact, Topic, Person, Quote, or Persona) by ID. Use after ei_search to retrieve complete details for an item.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Entity ID from ei_search results" },
      },
      required: ["id"],
    },
    async execute(_id, params: { id: string }, _signal, _onUpdate, _ctx) {
      const output = await runEi(["--id", params.id]).catch(() => "");
      return {
        content: [{ type: "text" as const, text: output.trim() || "Not found" }],
        details: {},
      };
    },
  });
}
`;

  const extDir = join(home, ".omp", "agent", "extensions");
  const extFilename = "ei-integration.ts";

  await Bun.$`mkdir -p ${extDir}`;
  await Bun.write(join(extDir, extFilename), extensionContent);
  console.log(`✓ Installed Ei extension to ~/.omp/agent/extensions/${extFilename}`);

  await installSkillsTo(join(home, ".omp", "agent", "skills"));
}

export async function installOpenCodePlugin(): Promise<void> {
  const home = resolveHome();
  const opencodeDir = join(home, ".config", "opencode");
  const pluginsDir = join(opencodeDir, "plugins");
  const pluginPath = join(pluginsDir, "ei-persona.ts");

  await Bun.$`mkdir -p ${pluginsDir}`;

  const pluginContent = `import { $ } from "bun"
import { join } from "path"
import { appendFileSync } from "fs"
import { homedir } from "os"

// Deduplication: the Promise itself is re-awaited on subsequent calls (synchronous once resolved).
const personaFetch = new Map<string, Promise<string | null>>()

const logPath = join(process.env.EI_DATA_PATH ?? join(process.env.HOME ?? homedir(), ".local", "share", "ei"), "ei-persona-plugin.log")

function log(msg: string) {
  try {
    appendFileSync(logPath, \`[\${new Date().toISOString()}] \${msg}\\n\`)
  } catch {}
}

// Pulls the agent name from the system prompt. Handles OMO/OMP formats:
//   You are "Sisyphus" - ...           (quoted, dash)
//   You are "Sisyphus - Ultraworker"   (quoted, dash in name)
//   You are Atlas - ...                (unquoted, dash)
//   You are Hephaestus, ...            (unquoted, comma)
export function extractAgentName(systemPrompt: string): string | null {
  const clean = systemPrompt.replace(/[\\u200B-\\u200D\\uFEFF]/g, "")
  const quoted = clean.match(/You are "([^"]+)"/)
  if (quoted?.[1]) return quoted[1].trim()
  const unquoted = clean.match(/You are ([A-Za-z][A-Za-z0-9]*)(?:\\s*[-—,]|\\s*$)/m)
  if (unquoted?.[1]) return unquoted[1].trim()
  return null
}

${RUN_EI_BUN_SNIPPET}

// Fetch the <ei-relationship> block for a named persona via the Ei CLI.
// Delegates all formatting to \`ei personas <name> --format prompt\` so
// the block format is maintained in one place.
async function fetchRelationshipBlock(rawName: string): Promise<string | null> {
  try {
    const block = await runEi(["personas", "--format", "prompt", "--", rawName])
    if (!block.trim() || block.includes("No saved state")) return null
    log(\`ei-persona: injecting block for \${rawName}\`)
    return block.trim()
  } catch {
    return null
  }
}

export default async function EiPersonaPlugin() {
  return {
    name: "ei-persona",
    "experimental.chat.system.transform": async (
      input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
      output: { system: string[] },
    ): Promise<void> => {
      if (!Array.isArray(output.system) || typeof output.system[0] !== "string") return
      const rawName = extractAgentName(output.system[0])
      if (!rawName) return

      // Cache per persona name (not per session) — block only changes when the
      // persona's Ei data changes, which is infrequent.
      if (!personaFetch.has(rawName)) {
        personaFetch.set(rawName, fetchRelationshipBlock(rawName))
      }

      const block = await personaFetch.get(rawName)!
      if (block !== null && !output.system[0].includes("<!-- ei-relationship-injected -->"))
        output.system[0] = output.system[0] + "\\n\\n" + block
    },
  }
}
`;

  await Bun.write(pluginPath, pluginContent);
  console.log(`✓ Installed Ei persona plugin to ${pluginPath}`);

  await installSkillsTo(join(opencodeDir, "skills"));

  const omoCandidates = [
    join(opencodeDir, "oh-my-opencode.json"),
    join(opencodeDir, "oh-my-opencode.jsonc"),
    join(opencodeDir, "oh-my-openagent.json"),
    join(opencodeDir, "oh-my-openagent.jsonc"),
    join(opencodeDir, "node_modules", "oh-my-opencode", "package.json"),
    join(opencodeDir, "node_modules", "oh-my-openagent", "package.json"),
  ];
  const hasOmo = (await Promise.all(omoCandidates.map((p) => Bun.file(p).exists()))).some(Boolean);

  if (!hasOmo) {
    console.log(`
ℹ️  Oh My OpenCode not detected.
   The Ei persona plugin is installed, but context injection (hook) requires OMO.
   For full Ei integration in OpenCode, we recommend:

     bunx oh-my-opencode install

   OMO picks up the Ei UserPromptSubmit hook automatically via its Claude Code
   compatibility layer.
`);
  }
}

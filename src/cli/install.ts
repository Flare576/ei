import { join } from "path";
import { fileURLToPath } from "url";
import { homedir } from "os";
import { cp, mkdir, readdir, rename, rm, stat } from "fs/promises";

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

async function installCodexHooks(): Promise<void> {
  const home = resolveHome();
  const hooksDir = join(home, ".codex", "hooks");
  const scriptPath = join(hooksDir, "ei-inject.ts");
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

  const scriptContent = `#!/usr/bin/env bun
import { $ } from "bun";

async function runEi(commandArgs) {
  const direct = await $\`ei \${commandArgs}\`.quiet().text().catch(() => "");
  if (direct.trim()) return direct;
  return await $\`bunx ei-tui@latest \${commandArgs}\`.quiet().text().catch(() => "");
}

if (import.meta.main) {
  const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
  const raw = (input.prompt ?? "").replace(/<[^>]*>/g, "").trim();
  const searchArgs = ["-n", "8"];

  const sessionArgs = [];
  if (input.transcript_path) {
    sessionArgs.push("--transcript", input.transcript_path);
  }
  if (input.session_id) {
    sessionArgs.push("--session", input.session_id, "--hook-source", "codex");
  }

  const args = raw ? [...searchArgs, ...sessionArgs, raw] : ["--recent", ...searchArgs];

  const output = await runEi(args);
  if (output.trim()) {
    const heading = [
      "## Ei Memory Context",
      "*(The user cannot see this block. It is injected automatically before their message.)*",
      "*(If you reference anything from it, briefly explain where it came from — e.g. \\"Ei shows you've been working on X\\" — so the user isn't confused by knowledge that appeared from nowhere.)*",
      "",
      "Ei is a personal knowledge base built from the user's coding sessions, Slack, documents, and conversations.",
      "The following memories MAY be relevant to your current task — use \`ei_search\` or \`ei_lookup\` for targeted queries.",
    ].join("\\n");

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: \`\\n\${heading}\\n\${output.trim()}\\n\`,
      },
    }));
  }
}
`;

  await Bun.write(scriptPath, scriptContent);
  await Bun.$`chmod +x ${scriptPath}`;

  type CodexUserPromptHook = {
    hooks: Array<{ type: string; command: string; statusMessage?: string; timeout?: number }>;
  };

  interface CodexHooksConfig {
    hooks: {
      UserPromptSubmit?: CodexUserPromptHook[];
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

  const userPromptSubmit = (hooksConfig.hooks.UserPromptSubmit ?? []) as CodexUserPromptHook[];
  const hookEntry = {
    hooks: [{
      type: "command",
      command: scriptPath,
      statusMessage: "Loading Ei memory context",
      timeout: 30,
    }],
  };
  const alreadyInstalled = userPromptSubmit.some((entry) => hookEntryHasCommand(entry, scriptPath));
  if (!alreadyInstalled) {
    userPromptSubmit.push(hookEntry);
  }

  hooksConfig.hooks.UserPromptSubmit = userPromptSubmit;

  const tmpPath = `${hooksJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(hooksConfig, null, 2) + "\n");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei Codex context hook to ~/.codex/hooks/ei-inject.ts`);
  console.log(`  Use /hooks in Codex to review/trust the hook if prompted.`);
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
  const scriptPath = join(hooksDir, "ei-inject.ts");
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

  const scriptContent = `#!/usr/bin/env bun
import { $ } from "bun";

async function runEi(commandArgs) {
  const direct = await $\`ei \${commandArgs}\`.quiet().text().catch(() => "");
  if (direct.trim()) return direct;
  return await $\`bunx ei-tui@latest \${commandArgs}\`.quiet().text().catch(() => "");
}

if (import.meta.main) {
  const heading = \`
## Ei Memory Context
*(The user cannot see this block. It is injected automatically before their message.)*
*(If you reference anything from it, briefly explain where it came from — e.g. "Ei shows you've been working on X" — so the user isn't confused by knowledge that appeared from nowhere.)*

Ei is a personal knowledge base built from the user's coding sessions, Slack, documents, and conversations.
The following items MAY be relevant to your current task — use \\\`ei_search\\\` or \\\`ei_lookup\\\` for targeted queries.
\`;

  const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
  const raw = (input.prompt ?? "").replace(/<[^>]*>/g, "").trim();

  const sessionArgs = [];
  if (input.session_id && input.hook_source) {
    sessionArgs.push("--session", input.session_id, "--hook-source", input.hook_source);
  } else if (input.transcript_path) {
    sessionArgs.push("--transcript", input.transcript_path);
  }

  const args = raw ? ["-n", "5", ...sessionArgs, raw] : ["--recent", "-n", "5"];

  const output = await runEi(args);
  if (output.trim()) process.stdout.write(\`\\n\${heading}\\n\${output.trim()}\\n\`);
}
`;

  await Bun.write(scriptPath, scriptContent);
  await Bun.$`chmod +x ${scriptPath}`;

  let settings: Record<string, unknown> = {};
  try {
    const text = await Bun.file(settingsPath).text();
    settings = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const hooks = (settings.hooks ?? {}) as Record<string, unknown>;
  const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[];

  const hookEntry = { hooks: [{ type: "command", command: "~/.claude/hooks/ei-inject.ts" }] };
  const alreadyInstalled = userPromptSubmit.some((entry) => hookEntryHasCommand(entry, "~/.claude/hooks/ei-inject.ts"));
  if (!alreadyInstalled) {
    userPromptSubmit.push(hookEntry);
  }

  hooks.UserPromptSubmit = userPromptSubmit;
  settings.hooks = hooks;

  // Atomic write: write to temp file then rename to avoid partial writes
  const tmpPath = `${settingsPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(settings, null, 2) + "\n");
  await rename(tmpPath, settingsPath);

  console.log(`✓ Installed Ei context hook to ~/.claude/hooks/ei-inject.ts`);
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

async function installCursorHooks(): Promise<void> {
  const home = resolveHome();
  const hooksDir = join(home, ".cursor", "hooks");
  const rulesDir = join(home, ".cursor", "rules");
  const hookScriptPath = join(hooksDir, "ei-inject.sh");
  const hooksJsonPath = join(home, ".cursor", "hooks.json");

  await Bun.$`mkdir -p ${hooksDir}`;
  await Bun.$`mkdir -p ${rulesDir}`;

  const hookScript = `#!/bin/bash
# Ei memory context injection hook for Cursor
# Writes recent Ei context to ~/.cursor/rules/ei-context.mdc (alwaysApply)
# so Cursor includes it automatically on the next prompt.

RULES_FILE="$HOME/.cursor/rules/ei-context.mdc"
CONTEXT=$(ei --recent -n 10 2>/dev/null)

if [ -n "$CONTEXT" ]; then
  cat > "$RULES_FILE" << 'RULE'
---
description: Ei persistent memory context (auto-updated before each prompt)
alwaysApply: true
---
RULE
  echo "## Ei Memory (recent context)" >> "$RULES_FILE"
  echo "$CONTEXT" >> "$RULES_FILE"
fi

# Always exit 0 — never block Cursor
exit 0
`;

  await Bun.write(hookScriptPath, hookScript);
  await Bun.$`chmod +x ${hookScriptPath}`;

  interface HooksConfig {
    version: number;
    hooks: {
      beforeSubmitPrompt?: Array<{ command: string }>;
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
  const eiEntry = { command: "~/.cursor/hooks/ei-inject.sh" };
  const alreadyPresent = beforeSubmit.some((entry) => entry.command === eiEntry.command);
  if (!alreadyPresent) {
    beforeSubmit.push(eiEntry);
  }
  hooksConfig.hooks.beforeSubmitPrompt = beforeSubmit;

  const tmpPath = `${hooksJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(hooksConfig, null, 2) + "\n");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei context hook to ~/.cursor/hooks/ei-inject.sh`);
}

async function installPi(): Promise<void> {
  const home = resolveHome();

  const extensionContent = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { $ } from "bun";

const runEi = async (cmdArgs: string[]): Promise<string> => {
  const direct = await $\`ei \${cmdArgs}\`.quiet().text().catch(() => "");
  if (direct.trim()) return direct;
  return $\`bunx ei-tui@latest \${cmdArgs}\`.quiet().text().catch(() => "");
};


export default function eiIntegration(pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const entries = ctx.sessionManager.getEntries();
    const recentMsgs = entries
      .filter((e: any) => e.type === "message" && (e.message?.role === "user" || e.message?.role === "assistant"))
      .slice(-5)
      .map((e: any) => {
        const role = e.message?.role ?? "unknown";
        const text = Array.isArray(e.message?.content)
          ? e.message.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join(" ")
          : (e.message?.content ?? "");
        return \`\${role}: \${text.slice(0, 200)}\`;
      })
      .join("\\n");

    const prompt = event.prompt ?? "";
    const args = prompt
      ? ["-n", "5", "--", prompt]
      : ["--recent", "-n", "5"];

    const output = await runEi(args).catch(() => "");

    if (!output.trim()) return undefined;

    const heading = [
      "## Ei Memory Context",
      "*(The user cannot see this block. It is injected automatically before their message.)*",
      "*(If you reference anything from it, briefly explain where it came from.)*",
      "",
      "Ei is a personal knowledge base built from your coding sessions, Slack, documents, and conversations.",
      "The following items MAY be relevant to your current task — use ei_search or ei_lookup for targeted queries.",
    ].join("\\n");

    return {
      message: {
        customType: "ei-context",
        content: \`\${heading}\\n\\n\${output.trim()}\`,
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

const runEi = async (cmdArgs: string[]): Promise<string> => {
  const direct = await $\`ei \${cmdArgs}\`.quiet().text().catch(() => "");
  if (direct.trim()) return direct;
  return $\`bunx ei-tui@latest \${cmdArgs}\`.quiet().text().catch(() => "");
};

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

const runEi = async (cmdArgs: string[]): Promise<string> => {
  const direct = await $\`ei \${cmdArgs}\`.quiet().text().catch(() => "")
  if (direct.trim()) return direct
  return $\`bunx ei-tui@latest \${cmdArgs}\`.quiet().text().catch(() => "")
}

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

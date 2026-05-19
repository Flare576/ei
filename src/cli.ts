#!/usr/bin/env bun
/**
 * EI CLI - Memory retrieval interface for coding tool integrations
 *
 * Usage:
 *   ei "search text"               Search all data types
 *   ei -n 5 "search text"          Limit results
 *   ei quote "search text"         Search specific type
 *   ei quote -n 5 "search text"    Type-specific with limit
 *   ei --id <id>                   Look up entity by ID
 *   echo <id> | ei --id             Look up entity by ID from stdin
 */

import { parseArgs } from "util";
import { join } from "path";
import { retrieveBalanced, lookupById, resolveExternalMessage, loadLatestState } from "./cli/retrieval";
import type { StorageState } from "./core/types";
import { resolvePersonaId, filterByPersona, filterTypeSpecificByPersona, filterBySource, filterTypeSpecificBySource } from "./cli/persona-filter.js";
import pkg from "../package.json" assert { type: "json" };

const rawArgs = process.argv.slice(2);
if (rawArgs.includes("--version") || rawArgs.includes("-v")) {
  process.stdout.write(`${pkg.version}\n`);
  process.exit(0);
}

const TYPE_ALIASES: Record<string, string> = {
  quote: "quotes",
  quotes: "quotes",
  fact: "facts",
  facts: "facts",
  person: "people",
  people: "people",
  topic: "topics",
  topics: "topics",
  persona: "personas",
  personas: "personas",
};

function printHelp(): void {
  console.log(`
Ei

Usage:
  ei                            Launch the TUI chat interface
  ei "search text"              Search all data types (top 10)
  ei -n 5 "search text"         Limit results
  ei <type> "search text"       Search a specific data type
  ei <type> -n 5 "search text"  Type-specific with limit
  ei --recent                   Return most recently mentioned items
  ei --recent "query"           Filter recent items by query
  ei <type> --recent "query"    Type-specific recent search
  ei --persona "Name" "query"   Filter results to what a persona has learned
  ei --id <id>                  Look up a specific entity by ID
  echo <id> | ei --id           Look up entity by ID from stdin
  ei mcp                        Start the Ei MCP stdio server (for Claude Code/Cursor/Codex)

Types:
  quote / quotes      Quotes from conversation history
  fact / facts        Facts about the user
  person / people     People from the user's life
  topic / topics      Topics of interest
  persona / personas  Personas in this Ei instance

Options:
  --number, -n        Maximum number of results (default: 10)
  --recent, -r        Sort by last_mentioned date (most recent first)
  --persona, -p       Filter to entities a specific persona has learned about
  --source, -s        Filter to entities from a specific source (prefix match, e.g. "cursor", "codex:my-machine", "opencode:my-machine:ses_abc123")
  --id                Look up entity by ID (accepts value or stdin)
  --install           Register Ei with Claude Code, Cursor, Codex, and OpenCode (MCP + context hooks where supported)
  --session <id>      Session ID to enrich the query with recent context (use with --hook-source)
  --hook-source <src> Source of the hook: "opencode-plugin" (OpenCode SQLite), "cursor", or "codex"
  --transcript <path> Path to a Claude Code JSONL transcript file for context enrichment
  --help, -h          Show this help message

Examples:
  ei "debugging"                         # Search everything
  ei -n 5 "API design"                   # Top 5 across all types
  ei quote "you guessed it"              # Search quotes only
  ei --recent                            # Most recently mentioned items
  ei topics --recent "work"              # Recent work-related topics
  ei --persona "Architect" "work stuff"  # What Architect knows about work
  ei topics --source cursor "X"          # Topics learned from Cursor sessions
  ei --id abc-123                        # Look up entity by ID
  ei "memory leak" | jq .[0].id | ei --id  # Pipe ID from search
`);
}


async function installMcpClients(): Promise<void> {
  await installClaudeCode();

  const home = process.env.HOME || "~";

  if (await commandExists("codex")) {
    await installCodex();
  } else {
    console.log(`ℹ️  Codex CLI not detected — skipping Codex MCP install.`);
  }

  const cursorDataDirs = [
    join(home, "Library", "Application Support", "Cursor"),
    join(home, ".config", "Cursor"),
    join(home, "AppData", "Roaming", "Cursor"),
  ];
  const hasCursor = (await Promise.all(cursorDataDirs.map((p) => Bun.file(join(p, "User")).exists()))).some(Boolean);
  if (hasCursor) {
    await installCursor();
  } else {
    console.log(`ℹ️  Cursor not detected — skipping Cursor install.`);
  }

  const opencodeDir = join(home, ".config", "opencode");
  const hasOpenCode = await Bun.file(join(opencodeDir, "opencode.jsonc")).exists() ||
    await Bun.file(join(opencodeDir, "opencode.json")).exists() ||
    await Bun.file(join(opencodeDir, "opencode.db")).exists();

  if (hasOpenCode) {
    await installOpenCodePlugin();
  } else {
    console.log(`ℹ️  OpenCode not detected — skipping OpenCode plugin install.`);
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

async function installCodex(): Promise<void> {
  const dataPath = process.env.EI_DATA_PATH ?? join(process.env.HOME || "~", ".local", "share", "ei");
  const proc = Bun.spawn(
    ["codex", "mcp", "add", "ei", "--env", `EI_DATA_PATH=${dataPath}`, "--", "bunx", "ei-tui", "mcp"],
    {
      stdout: "pipe",
      stderr: "pipe",
    }
  );

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    console.warn(`⚠️  Codex MCP install failed.`);
    const detail = (stderr || stdout).trim();
    if (detail) console.warn(`   ${detail}`);
  } else {
    console.log(`✓ Installed Ei MCP server to Codex config (~/.codex/config.toml)`);
    console.log(`  Restart Codex to activate MCP.`);
  }

  await installCodexHooks();
}

async function installCodexHooks(): Promise<void> {
  const home = process.env.HOME || "~";
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

async function runEi(commandArgs) {
  const direct = await $\`ei \${commandArgs}\`.quiet().text().catch(() => "");
  if (direct.trim()) return direct;
  return await $\`bunx ei-tui@latest \${commandArgs}\`.quiet().text().catch(() => "");
}

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
  const { rename } = await import(/* @vite-ignore */ "fs/promises");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei Codex context hook to ~/.codex/hooks/ei-inject.ts`);
  console.log(`  Use /hooks in Codex to review/trust the hook if prompted.`);
}

async function installClaudeCode(): Promise<void> {
  const home = process.env.HOME || "~";
  const claudeJsonPath = join(home, ".claude.json");

  // Claude Code supports ${VAR} substitution in env values, resolved from its
  // own environment at spawn time — so the value stays fresh if EI_DATA_PATH changes.
  const mcpEntry: Record<string, unknown> = {
    type: "stdio",
    command: "bunx",
    args: ["ei-tui", "mcp"],
    env: { EI_DATA_PATH: "${EI_DATA_PATH}" },
  };

  // Direct atomic write — we need full control over the config structure to
  // write the env field. `claude mcp add` doesn't support env vars.
  let config: Record<string, unknown> = {};
  try {
    const text = await Bun.file(claudeJsonPath).text();
    config = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers["ei"] = mcpEntry;
  config.mcpServers = mcpServers;

  // Atomic write: write to temp file then rename to avoid partial writes
  const tmpPath = `${claudeJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(config, null, 2) + "\n");
  const { rename } = await import(/* @vite-ignore */ "fs/promises");
  await rename(tmpPath, claudeJsonPath);

  console.log(`✓ Installed Ei MCP server to ${claudeJsonPath}`);
  console.log(`  Restart Claude Code to activate.`);

  await installClaudeCodeHooks();
}

async function installClaudeCodeHooks(): Promise<void> {
  const home = process.env.HOME || "~";
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

const heading = \`
## Ei Memory Context
*(The user cannot see this block. It is injected automatically before their message.)*
*(If you reference anything from it, briefly explain where it came from — e.g. "Ei shows you've been working on X" — so the user isn't confused by knowledge that appeared from nowhere.)*

Ei is a personal knowledge base built from the user's coding sessions, Slack, documents, and conversations.
The following topics MAY be relevant to your current task — use \\\`ei_search\\\` or \\\`ei_lookup\\\` for targeted queries.
\`;

const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
const raw = (input.prompt ?? "").replace(/<[^>]*>/g, "").trim();
const typeArgs = ["topics", "-n", "5"];

const sessionArgs = [];
if (input.session_id && input.hook_source) {
  sessionArgs.push("--session", input.session_id, "--hook-source", input.hook_source);
} else if (input.transcript_path) {
  sessionArgs.push("--transcript", input.transcript_path);
}

const args = raw ? [...typeArgs, ...sessionArgs, raw] : ["--recent", ...typeArgs];

const output = await $\`bunx ei-tui@latest \${args}\`.quiet().text().catch(() => "");
if (output.trim()) process.stdout.write(\`\\n\${heading}\\n\${output.trim()}\\n\`);
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
  const { rename } = await import(/* @vite-ignore */ "fs/promises");
  await rename(tmpPath, settingsPath);

  console.log(`✓ Installed Ei context hook to ~/.claude/hooks/ei-inject.ts`);
}

async function installCursor(): Promise<void> {
  const home = process.env.HOME || "~";
  const cursorJsonPath = join(home, ".cursor", "mcp.json");

  // Cursor does not support ${VAR} substitution in mcp.json — literal values only.
  const mcpEntry: Record<string, unknown> = {
    type: "stdio",
    command: "bunx",
    args: ["ei-tui", "mcp"],
    env: { EI_DATA_PATH: process.env.EI_DATA_PATH ?? "" },
  };

  let config: Record<string, unknown> = {};
  try {
    const text = await Bun.file(cursorJsonPath).text();
    config = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // File doesn't exist or isn't valid JSON — start fresh
  }

  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers["ei"] = mcpEntry;
  config.mcpServers = mcpServers;

  await Bun.$`mkdir -p ${join(home, ".cursor")}`;
  const tmpPath = `${cursorJsonPath}.ei-install.tmp`;
  await Bun.write(tmpPath, JSON.stringify(config, null, 2) + "\n");
  const { rename } = await import(/* @vite-ignore */ "fs/promises");
  await rename(tmpPath, cursorJsonPath);

  console.log(`✓ Installed Ei MCP server to ${cursorJsonPath}`);
  console.log(`  Restart Cursor to activate.`);

  await installCursorHooks();
}

async function installCursorHooks(): Promise<void> {
  const home = process.env.HOME || "~";
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
  const { rename } = await import(/* @vite-ignore */ "fs/promises");
  await rename(tmpPath, hooksJsonPath);

  console.log(`✓ Installed Ei context hook to ~/.cursor/hooks/ei-inject.sh`);
}

async function installOpenCodePlugin(): Promise<void> {
  const home = process.env.HOME || "~";
  const opencodeDir = join(home, ".config", "opencode");
  const pluginsDir = join(opencodeDir, "plugins");
  const pluginPath = join(pluginsDir, "ei-persona.ts");

  await Bun.$`mkdir -p ${pluginsDir}`;

  const pluginContent = `import { $ } from "bun"
import { join } from "path"
import { appendFileSync } from "fs"

const sessionCache = new Map<string, string | null>()
const sessionFetch = new Map<string, Promise<string | null>>()

const logPath = join(process.env.EI_DATA_PATH ?? join(process.env.HOME ?? "~", ".local", "share", "ei"), "ei-persona-plugin.log")

function log(msg: string) {
  try {
    appendFileSync(logPath, \`[\${new Date().toISOString()}] \${msg}\\n\`)
  } catch {}
}

type PersonaTrait = { name: string; description: string; strength: number }
type PersonaTopic = { name: string; perspective: string; approach: string; exposure_current: number }
type PersonaResult = { display_name: string; base_prompt?: string; traits?: PersonaTrait[]; topics?: PersonaTopic[] }

// Pulls the agent name from the system prompt. Handles OMO's multiple formats:
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

// Queries Ei for persona candidates and validates by name containment —
// tolerates OMO renaming agents without requiring a hardcoded alias map.
export async function resolveEiPersona(rawName: string): Promise<PersonaResult | null> {
  try {
    const out = await $\`bunx ei-tui@latest personas -n 5 \${rawName}\`.text()
    const candidates = JSON.parse(out.trim()) as PersonaResult[]
    if (!Array.isArray(candidates) || candidates.length === 0) return null
    const rawLower = rawName.toLowerCase()
    const match = candidates.find((p) => {
      const nameLower = p.display_name.toLowerCase()
      return rawLower.includes(nameLower) || nameLower.includes(rawLower)
    })
    return match ?? null
  } catch {
    return null
  }
}

function buildEiRelationshipBlock(persona: PersonaResult): string {
  const strongTraits = (persona.traits ?? [])
    .filter((t) => t.strength >= 0.7)
    .sort((a, b) => b.strength - a.strength)
    .map((t) => \`**\${t.name}** (\${Math.round(t.strength * 100)}%): \${t.description}\`)
    .join("\\n")
  const sortedTopics = [...(persona.topics ?? [])]
    .sort((a, b) => b.exposure_current - a.exposure_current)
    .map((t) => \`**\${t.name}**: \${t.perspective} — \${t.approach}\`)
    .join("\\n")
  return [
    "<!-- ei-relationship-injected -->",
    "<ei-relationship>",
    "## Ei: Relationship Context",
    "",
    persona.base_prompt ?? "",
    "",
    "### Working Style",
    strongTraits || "(no traits above threshold)",
    "",
    "### Shared Context",
    sortedTopics || "(no topics)",
    "</ei-relationship>",
  ].join("\\n")
}

export default async function EiPersonaPlugin() {
  return {
    name: "ei-persona",
    "experimental.chat.system.transform": async (
      input: { sessionID?: string; model: { id: string; providerID: string; [key: string]: unknown } },
      output: { system: string[] },
    ): Promise<void> => {
      const rawName = extractAgentName(output.system[0] ?? "")
      if (!rawName) return

      const cacheKey = \`\${input.sessionID ?? "unknown"}:\${rawName}\`

      if (sessionCache.has(cacheKey)) {
        const cached = sessionCache.get(cacheKey) ?? null
        if (cached !== null && !output.system[0].includes("<!-- ei-relationship-injected -->"))
          output.system[0] = output.system[0] + "\\n\\n" + cached
        return
      }

      if (!sessionFetch.has(cacheKey)) {
        sessionFetch.set(cacheKey, (async () => {
          const persona = await resolveEiPersona(rawName)
          if (!persona) return null
          log(\`ei-persona: injecting \${persona.display_name}\`)
          return buildEiRelationshipBlock(persona)
        })())
      }

      const block = await sessionFetch.get(cacheKey)!
      sessionCache.set(cacheKey, block)
      if (block !== null && !output.system[0].includes("<!-- ei-relationship-injected -->"))
        output.system[0] = output.system[0] + "\\n\\n" + block
    },
  }
}
`;

  await Bun.write(pluginPath, pluginContent);
  console.log(`✓ Installed Ei persona plugin to ${pluginPath}`);

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

async function getRecentSessionMessages(
  sessionId: string | undefined,
  hookSource: string | undefined,
  transcriptPath: string | undefined
): Promise<string[]> {
  if (transcriptPath) {
    try {
      const text = await Bun.file(transcriptPath).text();

      const { parseCodexRolloutMessages } = await import(
        /* @vite-ignore */ "./integrations/codex/reader.js"
      );
      const codexMessages = parseCodexRolloutMessages(text, sessionId ?? "transcript");
      if (codexMessages.length > 0) {
        return codexMessages.slice(-5).map((m) => `${m.role}: ${m.content}`);
      }

      const messages: Array<{ content: string }> = [];

      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let record: Record<string, unknown>;
        try {
          record = JSON.parse(trimmed) as Record<string, unknown>;
        } catch {
          continue;
        }

        if (record.type === "user") {
          const msgContent = (record.message as Record<string, unknown>)?.content;
          if (typeof msgContent === "string" && msgContent.trim()) {
            messages.push({ content: msgContent.trim() });
          }
        } else if (record.type === "assistant") {
          const msgContent = (record.message as Record<string, unknown>)?.content;
          if (Array.isArray(msgContent)) {
            const extracted = (msgContent as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string)
              .join("\n\n")
              .trim();
            if (extracted) {
              messages.push({ content: extracted });
            }
          }
        }
      }

      return messages.slice(-5).map((m) => m.content);
    } catch {
      return [];
    }
  }

  if (!sessionId || !hookSource) return [];

  try {
    if (hookSource === "opencode-plugin") {
      const { createOpenCodeReader } = await import(
        /* @vite-ignore */ "./integrations/opencode/reader-factory.js"
      );
      const reader = await createOpenCodeReader();
      const messages = await reader.getMessagesForSession(sessionId);
      return messages.slice(-5).map((m) => `${m.role}: ${m.content}`);
    }

    if (hookSource === "cursor") {
      const { CursorReader } = await import(
        /* @vite-ignore */ "./integrations/cursor/reader.js"
      );
      const reader = new CursorReader();
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return session.messages.slice(-5).map((m) => `${m.type === 1 ? "user" : "assistant"}: ${m.text}`);
      }
    }

    if (hookSource === "codex") {
      const { CodexReader } = await import(
        /* @vite-ignore */ "./integrations/codex/reader.js"
      );
      const reader = new CodexReader();
      const sessions = await reader.getSessions();
      const session =
        sessions.find((s) => s.id === sessionId) ?? sessions[sessions.length - 1];
      if (session) {
        return session.messages.slice(-5).map((m) => `${m.role}: ${m.content}`);
      }
    }
  } catch {
    return [];
  }

  return [];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    const tuiDir = new URL("../tui", import.meta.url).pathname;
    const tuiEntry = new URL("../tui/src/index.tsx", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "--conditions=browser", "run", tuiEntry], {
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env },
      cwd: tuiDir,
    });
    await proc.exited;
    process.exit(proc.exitCode ?? 0);
  }

  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }

  if (args[0] === "--install") {
    await installMcpClients();
    console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Codex
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  If Codex was detected, Ei MCP was registered via:

    codex mcp add ei --env EI_DATA_PATH="${process.env.EI_DATA_PATH ?? "~/.local/share/ei"}" -- bunx ei-tui mcp

  Restart Codex to activate.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  OpenCode: add to ~/.config/opencode/opencode.jsonc
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  "mcp": {
    "ei": {
      "type": "local",
      "command": ["bunx", "ei-tui", "mcp"],
      "enabled": true,
      "environment": { "EI_DATA_PATH": "${process.env.EI_DATA_PATH ?? "~/.local/share/ei"}" }
    }
  }

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`);
    process.exit(0);
  }

  if (args[0] === "mcp") {
    const { handleMcpCommand } = await import("./cli/mcp.js");
    await handleMcpCommand(args.slice(1));
    process.exit(0);
  }

  // Handle --id flag: look up entity by ID
  const idFlagIndex = args.indexOf("--id");
  if (idFlagIndex !== -1) {
    let id = args[idFlagIndex + 1]?.trim();

    // If no value after --id, try reading from stdin
    if (!id && !process.stdin.isTTY) {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk as Buffer);
      }
      id = Buffer.concat(chunks).toString("utf-8").trim();
    }

    if (!id) {
      console.error("--id requires a value. Usage: ei --id <id> or echo <id> | ei --id");
      process.exit(1);
    }

    // Strip surrounding quotes (from jq output or shell quoting)
    id = id.replace(/^["']|["']$/g, "");

    const ocMessage = await resolveExternalMessage(id);
    if (ocMessage) {
      console.log(JSON.stringify(ocMessage, null, 2));
      process.exit(0);
    }

    const entity = await lookupById(id);
    if (!entity) {
      console.error(`No entity found with ID: ${id}`);
      process.exit(1);
    }
    console.log(JSON.stringify(entity, null, 2));
    process.exit(0);
  }
  let targetType: string | null = null;
  let parseableArgs = args;

  if (TYPE_ALIASES[args[0]]) {
    targetType = TYPE_ALIASES[args[0]];
    parseableArgs = args.slice(1);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: parseableArgs,
      options: {
        number: { type: "string", short: "n" },
        recent: { type: "boolean", short: "r" },
        persona: { type: "string", short: "p" },
        source: { type: "string", short: "s" },
        help: { type: "boolean", short: "h" },
        session: { type: "string" },
        "hook-source": { type: "string" },
        transcript: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
  } catch (e) {
    console.error(`Error parsing arguments: ${(e as Error).message}`);
    process.exit(1);
  }

  if (parsed.values.help) {
    printHelp();
    process.exit(0);
  }

  const query = parsed.positionals.join(" ").trim();
  const limit = parsed.values.number ? parseInt(parsed.values.number, 10) : 10;
  // Default to recent mode when no query — allows `ei --persona Foo` and `ei` with no args
  const recent = parsed.values.recent === true || !query;
  const personaName = parsed.values.persona?.trim();
  const sourcePrefix = parsed.values.source?.trim();
  const sessionId = parsed.values.session?.trim();
  const hookSource = parsed.values["hook-source"]?.trim();
  const transcriptPath = parsed.values.transcript?.trim();

  if (isNaN(limit) || limit < 1) {
    console.error("--number must be a positive integer");
    process.exit(1);
  }

  let state: StorageState | null = null;
  let personaId: string | undefined;
  if (personaName || sourcePrefix) {
    state = await loadLatestState();
    if (!state) {
      console.error("No saved state found. Is EI_DATA_PATH set correctly?");
      process.exit(1);
    }
    if (personaName) {
      personaId = resolvePersonaId(state, personaName) ?? undefined;
      if (!personaId) {
        console.error(`Persona "${personaName}" not found.`);
        process.exit(1);
      }
    }
  }

  const options = { recent };

  const recentMessages = await getRecentSessionMessages(sessionId, hookSource, transcriptPath);
  const enrichedQuery = recentMessages.length > 0
    ? [...recentMessages, query].join(" ").trim()
    : query;

  let result;
  if (targetType) {
    const module = await import(`./cli/commands/${targetType}.js`);
    result = await module.execute(enrichedQuery, limit, options);
    if (personaId && state) {
      result = filterTypeSpecificByPersona(result, state, personaId, targetType);
    }
    if (sourcePrefix && state) {
      result = filterTypeSpecificBySource(result, state, sourcePrefix, targetType);
    }
  } else {
    result = await retrieveBalanced(enrichedQuery, limit, options);
    if (personaId && state) {
      result = filterByPersona(result, state, personaId);
    }
    if (sourcePrefix && state) {
      result = filterBySource(result, state, sourcePrefix);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});

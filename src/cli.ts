#!/usr/bin/env bun
/**
 * EI CLI - Memory retrieval interface for OpenCode integration
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
  ei mcp                        Start the Ei MCP stdio server (for Cursor/Claude Desktop)

Types:
  quote / quotes      Quotes from conversation history
  fact / facts        Facts about the user
  person / people     People from the user's life
  topic / topics      Topics of interest
  persona / personas  Personas in this Ei instance

Options:
  --number, -n     Maximum number of results (default: 10)
  --recent, -r     Sort by last_mentioned date (most recent first)
  --persona, -p    Filter to entities a specific persona has learned about
  --source, -s     Filter to entities from a specific source (prefix match, e.g. "cursor", "opencode:my-machine", "opencode:my-machine:ses_abc123")
  --id             Look up entity by ID (accepts value or stdin)
  --install        Register Ei with Claude Code, Cursor, and OpenCode (MCP + context hooks)
  --help, -h       Show this help message

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
  await installCursor();
  await installOpenCodePlugin();
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

Ei is a personal knowledge base built from coding sessions, Slack, documents, and conversations.
The following topics MAY be relevant to your current task — use the \\\`ei_search\\\` and \\\`ei_lookup\\\`
MCP tools for targeted queries.
\`;

const input = await new Response(Bun.stdin.stream()).json().catch(() => ({}));
const raw = (input.prompt ?? "").replace(/<[^>]*>/g, "").trim();
const typeArgs = ["topics", "-n", "5"];
const args = raw ? [raw, ...typeArgs] : ["--recent", ...typeArgs];

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
  const alreadyInstalled = userPromptSubmit.some(
    (entry) => JSON.stringify(entry) === JSON.stringify(hookEntry)
  );
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
  const omoCandidates = [
    join(opencodeDir, "oh-my-opencode.json"),
    join(opencodeDir, "oh-my-opencode.jsonc"),
    join(opencodeDir, "oh-my-openagent.json"),
    join(opencodeDir, "oh-my-openagent.jsonc"),
    join(opencodeDir, "node_modules", "oh-my-opencode", "package.json"),
    join(opencodeDir, "node_modules", "oh-my-openagent", "package.json"),
  ];
  const hasOmo = (await Promise.all(omoCandidates.map((p) => Bun.file(p).exists()))).some(Boolean);

  if (hasOmo) {
    console.log(`✓ Oh My OpenCode detected — UserPromptSubmit hook covers OpenCode automatically.`);
    return;
  }

  console.log(`
ℹ️  OpenCode detected without Oh My OpenCode.
   The ~/.claude/settings.json UserPromptSubmit hook only fires in Claude Code.
   For the same context injection in OpenCode, we recommend:

     bunx oh-my-opencode install

   Oh My OpenCode is to OpenCode what oh-my-zsh is to zsh — you can run
   without it, but you probably shouldn't. It also picks up the Ei hook
   automatically via its Claude Code compatibility layer.
`);
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

  let result;
  if (targetType) {
    const module = await import(`./cli/commands/${targetType}.js`);
    result = await module.execute(query, limit, options);
    if (personaId && state) {
      result = filterTypeSpecificByPersona(result, state, personaId, targetType);
    }
    if (sourcePrefix && state) {
      result = filterTypeSpecificBySource(result, state, sourcePrefix, targetType);
    }
  } else {
    result = await retrieveBalanced(query, limit, options);
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

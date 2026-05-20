import { join } from "path";

export async function installMcpClients(): Promise<void> {
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

  const hasPi = await Bun.file(join(home, ".pi", "agent", "settings.json")).exists() ||
    await Bun.file(join(home, ".pi", "agent", "auth.json")).exists();
  const hasOmp = await Bun.file(join(home, ".omp", "agent", "settings.json")).exists() ||
    await Bun.file(join(home, ".omp", "agent", "auth.json")).exists();

  if (hasPi || hasOmp) {
    await installPi();
  } else {
    console.log(`ℹ️  Pi/OMP not detected — skipping Pi extension install.`);
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

async function installPi(): Promise<void> {
  const home = process.env.HOME || "~";
  const dataPath = process.env.EI_DATA_PATH ?? join(home, ".local", "share", "ei");

  const extensionContent = `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { $ } from "bun";

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

    const output = await $\`bunx ei-tui@latest \${args}\`
      .env({ ...process.env, EI_DATA_PATH: "${dataPath}" })
      .quiet()
      .text()
      .catch(() => "");

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
      const output = await $\`bunx ei-tui@latest \${args}\`
        .env({ ...process.env, EI_DATA_PATH: "${dataPath}" })
        .quiet()
        .text()
        .catch(() => "No results found");
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
      const output = await $\`bunx ei-tui@latest --id \${params.id}\`
        .env({ ...process.env, EI_DATA_PATH: "${dataPath}" })
        .quiet()
        .text()
        .catch(() => "Not found");
      return {
        content: [{ type: "text" as const, text: output.trim() || "Not found" }],
        details: {},
      };
    },
  });
}
`;

  const piExtDir = join(home, ".pi", "agent", "extensions");
  const ompExtDir = join(home, ".omp", "agent", "extensions");
  const extFilename = "ei-integration.ts";

  const hasPiAgent = await Bun.file(join(home, ".pi", "agent", "auth.json")).exists() ||
    await Bun.file(join(home, ".pi", "agent", "settings.json")).exists();
  const hasOmpAgent = await Bun.file(join(home, ".omp", "agent", "auth.json")).exists() ||
    await Bun.file(join(home, ".omp", "agent", "settings.json")).exists();

  if (hasPiAgent) {
    await Bun.$`mkdir -p ${piExtDir}`;
    await Bun.write(join(piExtDir, extFilename), extensionContent);
    console.log(`✓ Installed Ei extension to ~/.pi/agent/extensions/${extFilename}`);
  }

  if (hasOmpAgent) {
    await Bun.$`mkdir -p ${ompExtDir}`;
    await Bun.write(join(ompExtDir, extFilename), extensionContent);
    console.log(`✓ Installed Ei extension to ~/.omp/agent/extensions/${extFilename}`);
  }
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

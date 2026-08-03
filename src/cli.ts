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
import { retrieveBalanced, lookupById, lookupByIdentifier, resolveExternalMessage, loadLatestState, resolvePersonLogLength } from "./cli/retrieval";
import type { StorageState } from "./core/types";
import { resolvePersonaId, filterByPersona, filterTypeSpecificByPersona, filterBySource, filterTypeSpecificBySource } from "./cli/persona-filter.js";
import { installMcpClients } from "./cli/install.js";
import { getRecentSessionMessages } from "./cli/session-context.js";
import { createEntity, updateEntity, removeEntity, createQuoteEntity, fixQuoteEntity, CorrectionValidationError, CORRECTABLE_TYPES, UPDATABLE_TYPES } from "./cli/corrections-endpoints.js";
import { createPersonaEntity, updatePersonaEntity, removePersonaEntity } from "./cli/persona-corrections.js";
import type { CorrectableType } from "./core/corrections.js";
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

// Wider set accepted by `ei create/update/remove persona` — corrections-endpoints.ts's
// CORRECTABLE_TYPES/UPDATABLE_TYPES intentionally stay persona-free (personas bypass
// that module's shared SCHEMAS dispatch entirely, see persona-corrections.ts), so this
// CLI-only layer is what actually widens the accepted type set.
const CLI_CORRECTABLE_TYPES = [...CORRECTABLE_TYPES, "persona"] as const;
const CLI_UPDATABLE_TYPES = [...UPDATABLE_TYPES, "persona"] as const;

// Singular CorrectableType resolution for `ei create/update/remove` — derived
// from TYPE_ALIASES + CLI_CORRECTABLE_TYPES so the two alias systems can never
// silently diverge on which strings are accepted (e.g. "person"/"people"
// stay synonymous here too, since both funnel through TYPE_ALIASES first).
const PLURAL_TO_CORRECTABLE: Record<string, CorrectableType> = Object.fromEntries(
  CLI_CORRECTABLE_TYPES.map((t) => [TYPE_ALIASES[t], t])
);

function resolveCorrectableType(raw: string): CorrectableType | null {
  const plural = TYPE_ALIASES[raw];
  return plural ? PLURAL_TO_CORRECTABLE[plural] ?? null : null;
}

// Plural CorrectableType resolution for `ei update` — same TYPE_ALIASES
// lookup as resolveCorrectableType above, but sourced from CLI_UPDATABLE_TYPES
// instead of CLI_CORRECTABLE_TYPES since quotes are correctable via update
// (repointing data_item_ids after a split/merge, fixing mistranscribed
// text) but never created or removed.
const PLURAL_TO_UPDATABLE: Record<string, CorrectableType> = Object.fromEntries(
  CLI_UPDATABLE_TYPES.map((t) => [TYPE_ALIASES[t], t])
);
function resolveUpdatableType(raw: string): CorrectableType | null {
  const plural = TYPE_ALIASES[raw];
  return plural ? PLURAL_TO_UPDATABLE[plural] ?? null : null;
}

/**
 * Reads the value immediately following `flag` in `args` (e.g.
 * `readFlag(args, "--text")` for `... --text "foo" ...`), matching the
 * existing inline `args.indexOf("--json")` convention used by
 * create/update above — extracted once here since `ei create quote`/
 * `ei fix quote` each need several discrete flags rather than just one.
 */
function readFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  return idx !== -1 ? args[idx + 1] : undefined;
}

function printHelp(): void {
  console.log(`
Ei

Usage:
  ei                            Launch the TUI chat interface
  ei "search text"              Balanced search: facts/people/topics/quotes, no personas (top 10; use "ei personas")
  ei -n 5 "search text"         Limit results
  ei <type> "search text"       Search a specific data type
  ei <type> -n 5 "search text"  Type-specific with limit
  ei --recent                   Return most recently mentioned items
  ei --recent "query"           Filter recent items by query
  ei <type> --recent "query"    Type-specific recent search
  ei --persona "Name" "query"   Filter results to what a persona has learned
  ei --id <id>                  Look up a specific entity by ID
  echo <id> | ei --id           Look up entity by ID from stdin
  ei --identifier <type> <value>  Look up a person by identifier type + value, e.g. --identifier "GitHub" "flare576"
  ei mcp                        Start the Ei MCP stdio server (for Claude Code/Cursor/Codex)
  ei create <type> --json '<json>'  Create a new entity (fact/topic/person/persona)
  ei update <type> <id> --json '<json>'  Replace an entity by ID (full record, not a patch; fact/topic/person/quote/persona)
  ei remove <type> <id>         Remove an entity by ID (fact/topic/person/persona; not quotes)

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
  --identifier <type> <value>  Look up a person by identifier type + value (case-insensitive type, exact value; no stdin support)
  --install           Register Ei with Claude Code, Cursor, Codex, and OpenCode (skills + context hooks where supported; MCP is removed by default on Claude Code/Cursor/Codex — see README for manual MCP setup)
  --sync              Pull latest state from remote sync server into state.backup.json (no TUI required)
  --session <id>      Session ID to enrich the query with recent context (use with --hook-source)
  --hook-source <src> Source of the hook: "opencode-plugin" (OpenCode SQLite), "cursor", or "codex"
  --transcript <path> Path to a Claude Code JSONL transcript file for context enrichment
  --help, -h          Show this help message
  --json <json>       JSON body for create/update (full record for update, not a patch)

Examples:
  ei "debugging"                         # Search everything
  ei -n 5 "API design"                   # Top 5 across facts/people/topics/quotes (no personas)
  ei quote "you guessed it"              # Search quotes only
  ei --recent                            # Most recently mentioned items
  ei topics --recent "work"              # Recent work-related topics
  ei --persona "Architect" "work stuff"  # What Architect knows about work
  ei topics --source cursor "X"          # Topics learned from Cursor sessions
  ei --id abc-123                        # Look up entity by ID
  ei --identifier "GitHub" "flare576"    # Look up a person by identifier type + value
  ei "memory leak" | jq -r '.[0].id' | ei --id  # Pipe ID from search (every hit — including quotes — carries an id)
  ei create fact --json '{"name":"Field of Study","description":"CS","sentiment":0,"validated_date":""}'
  ei update fact abc-123 --json '{"name":"Field of Study","description":"Updated","sentiment":0,"validated_date":""}'
  ei update quote <id> --json '{"data_item_ids":["person-b-id"], ...}'  # Repoint a quote after splitting a bad merge (fetch the full record via 'ei --id <id>' first)
  ei create persona --json '{"display_name":"Yoda","long_description":"Speaks in inverted syntax, wise and patient.","traits":[{"name":"Inverted speech","description":"Talks like Yoda","sentiment":0.7}],"topics":[]}'
  ei update persona <id> --json '<full persona record from ei --id <id>, edited>'
  ei remove persona abc-123              # Remove a persona (reserved personas like "ei"/"emmet" must be archived instead)
  ei remove fact abc-123                 # Remove a fact by ID
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
  MCP (optional, manual)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Ei now ships as Agent Skills by default. Any existing Ei MCP registration
  in Claude Code, Cursor, or Codex was just removed in favor of the
  ei-search, ei-curate, and ei-persona skills. MCP is still available if you
  want it — add it back manually:

    codex mcp add ei --env EI_DATA_PATH="${process.env.EI_DATA_PATH ?? "~/.local/share/ei"}" -- bunx ei-tui mcp

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

  // Intercepted ahead of the generic `create <type>` dispatch below:
  // "quote" is deliberately absent from CLI_CORRECTABLE_TYPES (a quote can
  // only be created through this source-verified path, never the generic
  // upsert schema), so this must run first or `resolveCorrectableType`
  // would reject it as an invalid type before ever reaching here.
  if (args[0] === "create" && args[1] === "quote") {
    const body: Record<string, unknown> = {};
    const messageId = readFlag(args, "--message-id");
    const text = readFlag(args, "--text");
    if (messageId !== undefined) body.message_id = messageId;
    if (text !== undefined) body.text = text;
    for (const [flag, key] of [["--start", "start"], ["--end", "end"]] as const) {
      const raw = readFlag(args, flag);
      if (raw !== undefined) {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          console.error(`${flag} must be a number.`);
          process.exit(1);
        }
        body[key] = n;
      }
    }
    const jsonStr = readFlag(args, "--json");
    if (jsonStr !== undefined) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonStr);
      } catch (e) {
        console.error(`Invalid JSON: ${(e as Error).message}`);
        process.exit(1);
      }
      if (parsedJson && typeof parsedJson === "object") {
        Object.assign(body, parsedJson);
      }
    }
    try {
      const record = await createQuoteEntity(body);
      console.log(JSON.stringify(record, null, 2));
      process.exit(0);
    } catch (e) {
      console.error(e instanceof CorrectionValidationError ? e.message : (e as Error).message);
      process.exit(1);
    }
  }

  if (args[0] === "create") {
    const rawType = args[1];
    const entityType = rawType ? resolveCorrectableType(rawType) : null;
    if (!entityType) {
      console.error(`ei create requires a valid type (${CLI_CORRECTABLE_TYPES.join(", ")}). Got: ${rawType ?? "(none)"}`);
      process.exit(1);
    }
    const jsonIdx = args.indexOf("--json");
    const jsonStr = jsonIdx !== -1 ? args[jsonIdx + 1] : undefined;
    if (!jsonStr) {
      console.error("ei create requires --json '<json>'");
      process.exit(1);
    }
    let body: unknown;
    try {
      body = JSON.parse(jsonStr);
    } catch (e) {
      console.error(`Invalid JSON: ${(e as Error).message}`);
      process.exit(1);
    }
    try {
      const result = entityType === "persona" ? await createPersonaEntity(body) : await createEntity(entityType, body);
      console.log(JSON.stringify(result, null, 2));
      process.exit(0);
    } catch (e) {
      console.error(e instanceof CorrectionValidationError ? e.message : (e as Error).message);
      process.exit(1);
    }
  }

  if (args[0] === "update") {
    const rawType = args[1];
    const id = args[2];
    const entityType = rawType ? resolveUpdatableType(rawType) : null;
    if (!entityType || !id) {
      console.error(`Usage: ei update <type> <id> --json '<json>' (types: ${CLI_UPDATABLE_TYPES.join(", ")})`);
      process.exit(1);
    }
    const jsonIdx = args.indexOf("--json");
    const jsonStr = jsonIdx !== -1 ? args[jsonIdx + 1] : undefined;
    if (!jsonStr) {
      console.error("ei update requires --json '<json>'");
      process.exit(1);
    }
    let body: unknown;
    try {
      body = JSON.parse(jsonStr);
    } catch (e) {
      console.error(`Invalid JSON: ${(e as Error).message}`);
      process.exit(1);
    }
    try {
      const record = entityType === "persona" ? await updatePersonaEntity(id, body) : await updateEntity(entityType, id, body);
      console.log(JSON.stringify(record, null, 2));
      process.exit(0);
    } catch (e) {
      console.error(e instanceof CorrectionValidationError ? e.message : (e as Error).message);
      process.exit(1);
    }
  }

  if (args[0] === "remove") {
    const rawType = args[1];
    const id = args[2];
    const entityType = rawType ? resolveCorrectableType(rawType) : null;
    if (!entityType || !id) {
      console.error(`Usage: ei remove <type> <id> (types: ${CLI_CORRECTABLE_TYPES.join(", ")})`);
      process.exit(1);
    }
    try {
      if (entityType === "persona") {
        await removePersonaEntity(id);
      } else {
        await removeEntity(entityType, id);
      }
      console.log(JSON.stringify({ removed: true, id }, null, 2));
      process.exit(0);
    } catch (e) {
      console.error((e as Error).message);
      process.exit(1);
    }
  }

  // "fix" is a new, reserved top-level verb — quote-only, no other type
  // supports it — so an unrecognized second argument is a usage error
  // rather than falling through to the search path at the bottom of main().
  if (args[0] === "fix") {
    if (args[1] !== "quote") {
      console.error(`Usage: ei fix quote --quote-id <id> --text "<text>" [--start N --end N]`);
      process.exit(1);
    }
    const body: Record<string, unknown> = {};
    const quoteId = readFlag(args, "--quote-id");
    const text = readFlag(args, "--text");
    if (quoteId !== undefined) body.quote_id = quoteId;
    if (text !== undefined) body.text = text;
    for (const [flag, key] of [["--start", "start"], ["--end", "end"]] as const) {
      const raw = readFlag(args, flag);
      if (raw !== undefined) {
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          console.error(`${flag} must be a number.`);
          process.exit(1);
        }
        body[key] = n;
      }
    }
    const jsonStr = readFlag(args, "--json");
    if (jsonStr !== undefined) {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonStr);
      } catch (e) {
        console.error(`Invalid JSON: ${(e as Error).message}`);
        process.exit(1);
      }
      if (parsedJson && typeof parsedJson === "object") {
        Object.assign(body, parsedJson);
      }
    }
    try {
      const record = await fixQuoteEntity(body);
      console.log(JSON.stringify(record, null, 2));
      process.exit(0);
    } catch (e) {
      console.error(e instanceof CorrectionValidationError ? e.message : (e as Error).message);
      process.exit(1);
    }
  }

  if (args[0] === "--sync") {
    const { getDataPath } = await import("./cli/retrieval.js");
    const { RemoteSync } = await import("./storage/remote.js");
    const { decodeAllEmbeddings, encodeAllEmbeddings } = await import("./storage/embeddings.js");
    const { join } = await import("path");
    const { readFile, writeFile, rename, mkdir } = await import("fs/promises");

    const dataPath = getDataPath();
    const statePath = join(dataPath, "state.json");
    const lockPath = join(dataPath, "ei.lock");
    const backupPath = join(dataPath, "state.backup.json");

    // Fail if state.json exists — implies Ei ran here and a conflict would arise on next start
    try {
      await readFile(statePath);
      process.stderr.write(
        `\nei --sync aborted: state.json already exists at ${dataPath}\n\n` +
        `This machine has local Ei data. Running --sync here would create a conflict\n` +
        `the next time you start Ei.\n\n` +
        `If you want to pull from remote anyway, delete state.json first.\n\n`
      );
      process.exit(1);
    } catch { /* file doesn't exist — good */ }

    // Fail if ei.lock exists with a live process — Ei is actively running
    try {
      const lockText = await readFile(lockPath, "utf-8");
      const lock = JSON.parse(lockText) as { pid: number; started: string };
      try {
        process.kill(lock.pid, 0);
        process.stderr.write(
          `\nei --sync aborted: Ei is already running on this machine.\n` +
          `  PID:     ${lock.pid}\n` +
          `  Started: ${lock.started}\n\n` +
          `Stop Ei before syncing.\n\n`
        );
        process.exit(1);
      } catch { /* PID is dead — stale lock, proceed */ }
    } catch { /* no lock file — good */ }

    // Resolve sync credentials: prefer stored backup state, fall back to env vars
    let username: string | undefined;
    let passphrase: string | undefined;
    try {
      const backupText = await readFile(backupPath, "utf-8");
      const backup = decodeAllEmbeddings(JSON.parse(backupText));
      username = backup?.human?.settings?.sync?.username;
      passphrase = backup?.human?.settings?.sync?.passphrase;
    } catch { /* no backup — fall through to env vars */ }

    username ??= process.env.EI_SYNC_USERNAME;
    passphrase ??= process.env.EI_SYNC_PASSPHRASE;

    if (!username || !passphrase) {
      process.stderr.write(
        `\nei --sync aborted: no sync credentials found.\n\n` +
        `Set EI_SYNC_USERNAME and EI_SYNC_PASSPHRASE environment variables,\n` +
        `or run Ei normally first to store credentials in state.backup.json.\n\n`
      );
      process.exit(1);
    }

    const remote = new RemoteSync();
    await remote.configure({ username, passphrase });

    const result = await remote.fetch();
    if (!result.success || !result.state) {
      process.stderr.write(`\nei --sync failed: ${result.error ?? "unknown error"}\n\n`);
      process.exit(1);
    }

    await mkdir(dataPath, { recursive: true });
    const tempPath = `${backupPath}.tmp.${Date.now()}`;
    await writeFile(tempPath, JSON.stringify(encodeAllEmbeddings(result.state), null, 2), "utf-8");
    await rename(tempPath, backupPath);

    process.stdout.write(`\nei --sync complete. Remote state saved to state.backup.json.\n\n`);
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

  // Handle --identifier flag: look up a person by identifier type + value.
  // Deliberately simpler than --id: exactly two positional args, no
  // stdin-piping support (--id remains the primary pipe-drill-down target).
  const identifierFlagIndex = args.indexOf("--identifier");
  if (identifierFlagIndex !== -1) {
    const idType = args[identifierFlagIndex + 1]?.trim();
    const idValue = args[identifierFlagIndex + 2]?.trim();

    if (!idType || !idValue) {
      console.error("--identifier requires two values. Usage: ei --identifier <type> <value>");
      process.exit(1);
    }

    const entity = await lookupByIdentifier(idType, idValue);
    if (!entity) {
      console.error(`No person found with identifier ${idType}: ${idValue}`);
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
        format: { type: "string", short: "f" },
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

  const format = parsed.values.format?.trim();

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

    // --format prompt: output a formatted text block instead of JSON.
    // Currently supported for personas only; other types tracked in GitHub issue #77.
    if (format === "prompt" && targetType === "personas") {
      // BUG-1 fix: when no persona matches, emit nothing and exit clean.
      // Do NOT fall through to JSON — callers check block.trim() truthiness
      // and "[]".trim() is truthy, corrupting system prompts.
      if (!Array.isArray(result) || result.length === 0) {
        process.exit(0);
      }
      // Deliberately dynamic (not top-level static): personas.js pulls in
      // the embedding service and ceremony orchestrator, and this branch
      // only runs for the personas --format=prompt path, mirroring the
      // targetType-parameterized command import above.
      const { buildEiRelationshipBlock } = await import("./cli/commands/personas.js");
      const personLogState = state ?? await loadLatestState();
      const personLogLength = personLogState ? resolvePersonLogLength(result[0].id, personLogState) : undefined;
      process.stdout.write(buildEiRelationshipBlock(result[0], personLogLength) + "\n");
      process.exit(0);
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

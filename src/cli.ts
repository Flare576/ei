#!/usr/bin/env bun
/**
 * EI CLI - Memory retrieval interface for OpenCode integration
 *
 * Usage:
 *   ei "search text"               Search all data types
 *   ei -n 5 "search text"          Limit results
 *   ei quote "search text"         Search specific type
 *   ei quote -n 5 "search text"    Type-specific with limit
 */

import { parseArgs } from "util";
import { retrieveBalanced } from "./cli/retrieval";

const TYPE_ALIASES: Record<string, string> = {
  quote: "quotes",
  quotes: "quotes",
  fact: "facts",
  facts: "facts",
  trait: "traits",
  traits: "traits",
  person: "people",
  people: "people",
  topic: "topics",
  topics: "topics",
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

Types:
  quote / quotes    Quotes from conversation history
  fact / facts      Facts about the user
  trait / traits    Personality traits
  person / people   People from the user's life
  topic / topics    Topics of interest

Options:
  --number, -n     Maximum number of results (default: 10)
  --help, -h       Show this help message

Examples:
  ei "debugging"                         # Search everything
  ei -n 5 "API design"                   # Top 5 across all types
  ei quote "you guessed it"              # Search quotes only
  ei trait -n 3 "problem solving"        # Top 3 matching traits
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

  if (!query) {
    if (targetType) {
      console.error(`Search text required. Usage: ei ${targetType} "search text"`);
    } else {
      console.error(`Search text required. Usage: ei "search text"`);
    }
    process.exit(1);
  }

  if (isNaN(limit) || limit < 1) {
    console.error("--number must be a positive integer");
    process.exit(1);
  }

  let result;
  if (targetType) {
    const module = await import(`./cli/commands/${targetType}.js`);
    result = await module.execute(query, limit);
  } else {
    result = await retrieveBalanced(query, limit);
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});

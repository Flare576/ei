#!/usr/bin/env bun
/**
 * EI CLI - Memory retrieval interface for OpenCode integration
 * 
 * Usage:
 *   ei quotes --snippet "debugging" --snippet "async patterns"
 *   ei facts --snippet "API design"
 *   ei traits --snippet "problem solving"
 *   ei people --snippet "collaboration"
 *   ei topics --snippet "architecture"
 */

import { parseArgs } from "util";

const COMMANDS = ["quotes", "facts", "traits", "people", "topics"] as const;
type Command = typeof COMMANDS[number];

function printHelp(): void {
  console.log(`
Ei

Usage:
  ei                              Launch the TUI chat interface
  ei <command> --snippet "text"   Query the knowledge base (for OpenCode)

Commands:
  quotes    Retrieve relevant quotes from conversation history
  facts     Retrieve relevant facts about the user
  traits    Retrieve relevant personality traits
  people    Retrieve relevant people from the user's life
  topics    Retrieve relevant topics of interest

Options:
  --snippet, -s    Text snippet to match against (can specify multiple)
  --limit, -l      Maximum number of results (default: 10)
  --help, -h       Show this help message

Examples:
  ei                                          # Launch TUI
  ei quotes --snippet "debugging"             # Query quotes
  ei people -s "work" -s "collaboration" -l 5 # Query people
`);
}

async function main(): Promise<void> {
  const args = Bun.argv.slice(2);
  
  if (args.length === 0) {
    const tuiPath = new URL("../tui/src/index.tsx", import.meta.url).pathname;
    const proc = Bun.spawn(["bun", "--conditions=browser", "run", tuiPath], {
      stdio: ["inherit", "inherit", "inherit"],
      env: { ...process.env },
    });
    await proc.exited;
    process.exit(proc.exitCode ?? 0);
  }
  
  if (args[0] === "--help" || args[0] === "-h") {
    printHelp();
    process.exit(0);
  }
  
  const [subcommand, ...rest] = args;
  
  if (!COMMANDS.includes(subcommand as Command)) {
    console.error(`Unknown command: ${subcommand}`);
    console.error(`Valid commands: ${COMMANDS.join(", ")}`);
    process.exit(1);
  }
  
  let parsed;
  try {
    parsed = parseArgs({
      args: rest,
      options: {
        snippet: { type: "string", multiple: true, short: "s" },
        limit: { type: "string", short: "l" },
        help: { type: "boolean", short: "h" },
      },
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
  
  const snippets = parsed.values.snippet ?? [];
  const limit = parsed.values.limit ? parseInt(parsed.values.limit, 10) : 10;
  
  if (snippets.length === 0) {
    console.error("At least one --snippet is required");
    process.exit(1);
  }
  
  if (isNaN(limit) || limit < 1) {
    console.error("--limit must be a positive number");
    process.exit(1);
  }
  
  const command = subcommand as Command;
  const module = await import(`./cli/commands/${command}.js`);
  const result = await module.execute(snippets, limit);
  
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(`Fatal error: ${e.message}`);
  process.exit(1);
});

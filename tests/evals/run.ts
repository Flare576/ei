/**
 * Eval runner — discovers and runs *.eval.ts files.
 *
 * Usage:
 *   npx vite-node tests/evals/run.ts                        # all evals
 *   npx vite-node tests/evals/run.ts topic-scan             # files matching "topic-scan"
 *   npx vite-node tests/evals/run.ts topic                  # files matching "topic"
 *   npx vite-node tests/evals/run.ts topic --filter=regression  # file match + case filter
 *   npx vite-node tests/evals/run.ts --filter=regression    # case filter across all files
 *   npx vite-node tests/evals/run.ts --help
 *
 * Observe scripts (*.observe.ts) are NOT run by this script — they're dev tools.
 * Run them directly: npx vite-node tests/evals/<name>.observe.ts
 *
 * Environment variables:
 *   EVAL_PROVIDER    anthropic | openai | (default: local)
 *   EVAL_MODEL       override model name
 *   EVAL_FILTER      same as --filter, useful in CI
 */

import { execSync } from "child_process";
import { readdirSync } from "fs";
import { join, basename } from "path";

const EVALS_DIR = new URL(".", import.meta.url).pathname;

function showHelp(): void {
  console.log(`
Usage: npx vite-node tests/evals/run.ts [file-match] [-- --filter=<tag-or-substring>]

Arguments:
  file-match       Optional substring to match against eval file names (no extension needed)
                   Examples: "topic-scan", "topic", "person", "dedup"

Options:
  --filter=<str>   Run only cases whose description or tags match this string
  --help           Show this help

Examples:
  npm run test:evals                            Run all eval suites
  npm run test:evals -- topic-scan              Run topic-scan.eval.ts only
  npm run test:evals -- topic                   Run all topic-*.eval.ts files
  npm run test:evals -- topic --filter=regression   File match + case filter
  npm run test:evals -- --filter=regression     Case filter across all files

Observe scripts are separate dev tools — run directly:
  npx vite-node tests/evals/reflection-critic.observe.ts
`);
}

function parseArgs(): { fileMatch: string | null; filterArg: string | null; help: boolean } {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    return { fileMatch: null, filterArg: null, help: true };
  }

  const filterArg = args.find(a => a.startsWith("--filter=")) ?? null;
  const positional = args.find(a => !a.startsWith("--")) ?? null;

  return { fileMatch: positional, filterArg, help: false };
}

function discoverEvalFiles(dir: string): string[] {
  return readdirSync(dir)
    .filter(f => f.endsWith(".eval.ts"))
    .sort()
    .map(f => join(dir, f));
}

function filterFiles(files: string[], match: string | null): string[] {
  if (!match) return files;
  const needle = match.toLowerCase();
  const matched = files.filter(f => basename(f).toLowerCase().includes(needle));
  if (matched.length === 0) {
    console.error(`No eval files matched: "${match}"`);
    console.error(`Available: ${files.map(f => basename(f, ".eval.ts")).join(", ")}`);
    process.exit(1);
  }
  return matched;
}

const { fileMatch, filterArg, help } = parseArgs();

if (help) {
  showHelp();
  process.exit(0);
}

const allFiles = discoverEvalFiles(EVALS_DIR);
const filesToRun = filterFiles(allFiles, fileMatch);

const filterFlag = filterArg ?? (process.env.EVAL_FILTER ? `--filter=${process.env.EVAL_FILTER}` : null);

console.log(`Running ${filesToRun.length} eval suite(s)${fileMatch ? ` matching "${fileMatch}"` : ""}${filterFlag ? ` with ${filterFlag}` : ""}...\n`);

let anyFailed = false;

for (const file of filesToRun) {
  const name = basename(file, ".eval.ts");
  const cmd = ["npx", "vite-node", file, filterFlag].filter(Boolean).join(" ");

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Suite: ${name}`);
  console.log(`${"─".repeat(60)}`);

  try {
    execSync(cmd, { stdio: "inherit", cwd: join(EVALS_DIR, "../..") });
  } catch {
    anyFailed = true;
  }
}

console.log(`\n${"═".repeat(60)}`);
if (anyFailed) {
  console.log("RESULT: One or more eval suites failed.");
  process.exit(1);
} else {
  console.log("RESULT: All eval suites passed.");
  process.exit(0);
}

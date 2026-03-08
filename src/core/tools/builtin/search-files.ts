/**
 * search_files builtin tool (TUI / Node only)
 *
 * Recursively searches a directory for files whose names match a glob-style
 * pattern. Supports `*` (any chars except path sep) and `**` (any path segment).
 * Returns matching absolute paths.
 *
 * runtime: "node" — excluded from browser builds automatically.
 */
import { readdir, stat } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

const MAX_RESULTS = 200;

function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

/** Convert a glob pattern to a RegExp (name-only matching, not path). */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // escape regex specials except * ?
    .replace(/\*\*/g, ".+")               // ** → match anything including /
    .replace(/\*/g, "[^/]*")              // * → match anything except /
    .replace(/\?/g, "[^/]");              // ? → single non-separator char
  return new RegExp(`^${escaped}$`, "i");
}

async function searchDir(
  dir: string,
  nameRegex: RegExp,
  results: string[],
  excludeDirs: Set<string>
): Promise<void> {
  if (results.length >= MAX_RESULTS) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (results.length >= MAX_RESULTS) break;
    if (excludeDirs.has(entry)) continue;

    const fullPath = join(dir, entry);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      await searchDir(fullPath, nameRegex, results, excludeDirs);
    } else if (nameRegex.test(basename(fullPath))) {
      results.push(fullPath);
    }
  }
}

export const searchFilesExecutor: ToolExecutor = {
  name: "search_files",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    const pattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
    console.log(`[search_files] path="${rawPath}" pattern="${pattern}"`);

    if (!rawPath) return JSON.stringify({ error: "Missing required argument: path" });
    if (!pattern) return JSON.stringify({ error: "Missing required argument: pattern" });

    const absPath = resolve(expandHome(rawPath));

    // Common dirs to skip for sanity
    const excludeDirs = new Set(["node_modules", ".git", ".svn", "dist", "__pycache__", ".next"]);

    let nameRegex: RegExp;
    try {
      nameRegex = globToRegex(pattern);
    } catch {
      return JSON.stringify({ error: `Invalid pattern: ${pattern}` });
    }

    const results: string[] = [];
    try {
      await searchDir(absPath, nameRegex, results, excludeDirs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[search_files] error: ${msg}`);
      return JSON.stringify({ error: `Search failed: ${msg}` });
    }

    const truncated = results.length >= MAX_RESULTS;
    console.log(`[search_files] found ${results.length} match(es) in "${absPath}"`);

    return JSON.stringify({
      path: absPath,
      pattern,
      matches: results,
      count: results.length,
      truncated,
    });
  },
};

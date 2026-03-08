/**
 * grep builtin tool (TUI / Node only)
 *
 * Searches file contents for lines matching a regex pattern. Inspired by
 * OpenCode's grep tool — searches recursively through a directory, returns
 * file paths + matching line numbers + snippets.
 *
 * Read-only. runtime: "node" — excluded from browser builds automatically.
 */
import { readdir, stat, readFile } from "node:fs/promises";
import { resolve, join, extname } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

const MAX_MATCHES = 100;
const MAX_FILE_SIZE_BYTES = 512 * 1024; // 512KB — skip very large files

// Binary-ish extensions we skip
const BINARY_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".ico",
  ".pdf", ".zip", ".tar", ".gz", ".bz2", ".7z", ".rar",
  ".exe", ".bin", ".so", ".dylib", ".dll", ".wasm",
  ".mp3", ".mp4", ".wav", ".ogg", ".avi", ".mov",
  ".ttf", ".woff", ".woff2", ".eot",
  ".db", ".sqlite", ".sqlite3",
]);

function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

interface GrepMatch {
  file: string;
  line: number;
  text: string;
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".svn", "dist", "__pycache__", ".next", ".cache"]);

async function grepDir(
  dir: string,
  regex: RegExp,
  matches: GrepMatch[],
  includeGlob: RegExp | null
): Promise<void> {
  if (matches.length >= MAX_MATCHES) return;

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (matches.length >= MAX_MATCHES) break;
    if (SKIP_DIRS.has(entry)) continue;

    const fullPath = join(dir, entry);
    let s;
    try {
      s = await stat(fullPath);
    } catch {
      continue;
    }

    if (s.isDirectory()) {
      await grepDir(fullPath, regex, matches, includeGlob);
    } else {
      // Skip binary extensions
      const ext = extname(entry).toLowerCase();
      if (BINARY_EXTENSIONS.has(ext)) continue;

      // Apply include filter if provided
      if (includeGlob && !includeGlob.test(entry)) continue;

      // Skip large files
      if (s.size > MAX_FILE_SIZE_BYTES) continue;

      let contents: string;
      try {
        contents = await readFile(fullPath, "utf-8");
      } catch {
        continue;
      }

      const lines = contents.split("\n");
      for (let i = 0; i < lines.length; i++) {
        if (matches.length >= MAX_MATCHES) break;
        if (regex.test(lines[i])) {
          matches.push({
            file: fullPath,
            line: i + 1,
            text: lines[i].slice(0, 300), // cap line length in output
          });
        }
      }
    }
  }
}

export const grepExecutor: ToolExecutor = {
  name: "grep",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPattern = typeof args.pattern === "string" ? args.pattern.trim() : "";
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    const include = typeof args.include === "string" ? args.include.trim() : "";
    const caseInsensitive = args.case_insensitive === true;

    console.log(`[grep] pattern="${rawPattern}" path="${rawPath}" include="${include}"`);

    if (!rawPattern) return JSON.stringify({ error: "Missing required argument: pattern" });
    if (!rawPath) return JSON.stringify({ error: "Missing required argument: path" });

    const absPath = resolve(expandHome(rawPath));

    let regex: RegExp;
    try {
      regex = new RegExp(rawPattern, caseInsensitive ? "i" : undefined);
    } catch {
      return JSON.stringify({ error: `Invalid regex pattern: ${rawPattern}` });
    }

    // Build an include glob regex (e.g. "*.ts" → matches .ts files)
    let includeGlob: RegExp | null = null;
    if (include) {
      try {
        const escaped = include
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*");
        includeGlob = new RegExp(`^${escaped}$`, "i");
      } catch {
        // ignore invalid include glob
      }
    }

    const matches: GrepMatch[] = [];
    try {
      // Check if path is a file or directory
      const s = await stat(absPath);
      if (s.isDirectory()) {
        await grepDir(absPath, regex, matches, includeGlob);
      } else {
        if (s.size <= MAX_FILE_SIZE_BYTES) {
          const contents = await readFile(absPath, "utf-8");
          const lines = contents.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (matches.length >= MAX_MATCHES) break;
            if (regex.test(lines[i])) {
              matches.push({ file: absPath, line: i + 1, text: lines[i].slice(0, 300) });
            }
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[grep] error: ${msg}`);
      return JSON.stringify({ error: `Grep failed: ${msg}` });
    }

    const truncated = matches.length >= MAX_MATCHES;
    console.log(`[grep] ${matches.length} match(es) in "${absPath}"`);

    return JSON.stringify({
      pattern: rawPattern,
      path: absPath,
      matches,
      count: matches.length,
      truncated,
    });
  },
};

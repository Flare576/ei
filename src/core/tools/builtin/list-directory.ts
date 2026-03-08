/**
 * list_directory builtin tool (TUI / Node only)
 *
 * Lists the contents of a local directory by path.
 * Returns filenames with [FILE] or [DIR] prefixes, matching the MCP filesystem
 * server convention so LLMs trained on that standard behave as expected.
 * runtime: "node" — excluded from browser builds automatically.
 */
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

/** Expand ~ and $HOME to the actual home directory. */
function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

export const listDirectoryExecutor: ToolExecutor = {
  name: "list_directory",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    console.log(`[list_directory] called with path="${rawPath}"`);

    if (!rawPath) {
      console.warn("[list_directory] missing path argument");
      return JSON.stringify({ error: "Missing required argument: path" });
    }

    const absPath = resolve(expandHome(rawPath));
    console.log(`[list_directory] resolved to "${absPath}"`);

    try {
      const entries = await readdir(absPath);
      const items: { name: string; type: "file" | "directory" }[] = [];

      for (const entry of entries) {
        try {
          const entryPath = join(absPath, entry);
          const s = await stat(entryPath);
          items.push({ name: entry, type: s.isDirectory() ? "directory" : "file" });
        } catch {
          // Skip entries we can't stat (e.g. broken symlinks)
        }
      }

      // Sort: directories first, then files, alphabetically within each group
      items.sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });

      const listing = items.map(e => `[${e.type === "directory" ? "DIR" : "FILE"}] ${e.name}`);

      console.log(`[list_directory] listed ${items.length} entries in "${absPath}"`);

      return JSON.stringify({
        path: absPath,
        entries: listing,
        count: items.length,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[list_directory] failed to list "${absPath}": ${msg}`);
      return JSON.stringify({ error: `Cannot list directory: ${msg}` });
    }
  },
};

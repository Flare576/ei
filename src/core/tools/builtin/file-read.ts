/**
 * file_read builtin tool (TUI / Node only)
 *
 * Reads the contents of a local file by path.
 * runtime: "node" — excluded from browser builds automatically.
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

/** Max bytes returned to the LLM to avoid blowing up the context window. */
const MAX_BYTES = 32_000;

/** Expand ~ and $HOME to the actual home directory. */
function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

export const fileReadExecutor: ToolExecutor = {
  name: "file_read",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    console.log(`[file_read] called with path="${rawPath}"`);

    if (!rawPath) {
      console.warn("[file_read] missing path argument");
      return JSON.stringify({ error: "Missing required argument: path" });
    }

    const absPath = resolve(expandHome(rawPath));
    console.log(`[file_read] resolved to "${absPath}"`);

    try {
      const buf = await readFile(absPath);
      const full = buf.toString("utf8");
      const truncated = buf.byteLength > MAX_BYTES;
      const content = truncated ? full.slice(0, MAX_BYTES) : full;

      console.log(`[file_read] read ${buf.byteLength} bytes from "${absPath}"${truncated ? ` (truncated to ${MAX_BYTES})` : ""}`);

      return JSON.stringify({
        path: absPath,
        content,
        truncated,
        bytes_read: content.length,
        total_bytes: buf.byteLength,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[file_read] failed to read "${absPath}": ${msg}`);
      return JSON.stringify({ error: `Cannot read file: ${msg}` });
    }
  },
};

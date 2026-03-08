/**
 * get_file_info builtin tool (TUI / Node only)
 *
 * Returns metadata about a file or directory: size, type, permissions,
 * modification time, creation time. Matches MCP filesystem server shape.
 *
 * runtime: "node" — excluded from browser builds automatically.
 */
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

/** Convert numeric mode bits to a human-readable octal string like "755". */
function formatPermissions(mode: number): string {
  return (mode & 0o777).toString(8).padStart(3, "0");
}

export const getFileInfoExecutor: ToolExecutor = {
  name: "get_file_info",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    console.log(`[get_file_info] called with path="${rawPath}"`);

    if (!rawPath) {
      console.warn("[get_file_info] missing path argument");
      return JSON.stringify({ error: "Missing required argument: path" });
    }

    const absPath = resolve(expandHome(rawPath));
    console.log(`[get_file_info] resolved to "${absPath}"`);

    try {
      const s = await stat(absPath);
      const info = {
        path: absPath,
        type: s.isDirectory() ? "directory" : s.isSymbolicLink() ? "symlink" : "file",
        size: s.size,
        size_human: formatBytes(s.size),
        permissions: formatPermissions(s.mode),
        created: s.birthtime.toISOString(),
        modified: s.mtime.toISOString(),
        accessed: s.atime.toISOString(),
      };
      console.log(`[get_file_info] ${info.type} at "${absPath}", size=${info.size}`);
      return JSON.stringify(info);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[get_file_info] failed for "${absPath}": ${msg}`);
      return JSON.stringify({ error: `Cannot stat path: ${msg}` });
    }
  },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

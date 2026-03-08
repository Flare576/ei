/**
 * directory_tree builtin tool (TUI / Node only)
 *
 * Returns a recursive JSON tree of a directory up to a configurable depth.
 * Matches the MCP filesystem server shape: each node has `name`, `type`, and
 * optional `children` (for directories). Directories are shown even if their
 * children were not traversed (max_depth reached).
 *
 * runtime: "node" — excluded from browser builds automatically.
 */
import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import type { ToolExecutor } from "../types.js";

const DEFAULT_MAX_DEPTH = 3;
const HARD_MAX_DEPTH = 8;

function expandHome(p: string): string {
  const home = homedir();
  if (p === "~" || p.startsWith("~/")) return home + p.slice(1);
  return p.replace(/^\$HOME(?=\/|$)/, home);
}

interface TreeNode {
  name: string;
  type: "file" | "directory";
  children?: TreeNode[];
}

async function buildTree(absPath: string, name: string, depth: number, maxDepth: number): Promise<TreeNode> {
  let s;
  try {
    s = await stat(absPath);
  } catch {
    return { name, type: "file" };
  }

  if (!s.isDirectory()) {
    return { name, type: "file" };
  }

  if (depth >= maxDepth) {
    return { name, type: "directory" };
  }

  let entries: string[] = [];
  try {
    entries = await readdir(absPath);
  } catch {
    return { name, type: "directory" };
  }

  const children: TreeNode[] = [];
  for (const entry of entries) {
    const child = await buildTree(join(absPath, entry), entry, depth + 1, maxDepth);
    children.push(child);
  }

  // Sort: directories first, then files, alphabetically
  children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return { name, type: "directory", children };
}

export const directoryTreeExecutor: ToolExecutor = {
  name: "directory_tree",

  async execute(args: Record<string, unknown>): Promise<string> {
    const rawPath = typeof args.path === "string" ? args.path.trim() : "";
    console.log(`[directory_tree] called with path="${rawPath}"`);

    if (!rawPath) {
      console.warn("[directory_tree] missing path argument");
      return JSON.stringify({ error: "Missing required argument: path" });
    }

    const rawDepth = args.max_depth;
    let maxDepth = DEFAULT_MAX_DEPTH;
    if (typeof rawDepth === "number" && Number.isFinite(rawDepth)) {
      maxDepth = Math.min(Math.max(1, Math.floor(rawDepth)), HARD_MAX_DEPTH);
    }

    const absPath = resolve(expandHome(rawPath));
    console.log(`[directory_tree] resolved to "${absPath}", max_depth=${maxDepth}`);

    try {
      const tree = await buildTree(absPath, absPath, 0, maxDepth);
      console.log(`[directory_tree] built tree for "${absPath}"`);
      return JSON.stringify(tree, null, 2);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[directory_tree] failed for "${absPath}": ${msg}`);
      return JSON.stringify({ error: `Cannot build tree: ${msg}` });
    }
  },
};

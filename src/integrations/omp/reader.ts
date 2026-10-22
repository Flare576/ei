import type { OmpMessage, OmpProvenance, OmpSession, OmpTranscriptRecord, OmpTree } from "./types.js";
import type { join } from "path";
import type { readdir, lstat } from "fs/promises";
import type { existsSync, createReadStream, Dirent } from "fs";
import type { createHash } from "crypto";

const isBrowser = typeof document !== "undefined";

let _join: typeof join;
let _readdir: typeof readdir;
let _lstat: typeof lstat;
let _existsSync: typeof existsSync;
let _createReadStream: typeof createReadStream;
let _createHash: typeof createHash;
let _nodeModulesLoaded = false;

// Exception (platform-specific modules that don't exist everywhere): `path`/
// `fs`/`crypto` are Node-only and this reader is imported by browser-facing
// bundles too (mirrors `pi/reader.ts`'s own `isBrowser` guard, D1) — a
// static top-level import would break the browser build, so module
// resolution is deferred to first real use on a Node runtime.
async function ensureNodeModules(): Promise<boolean> {
  if (isBrowser) return false;
  if (_nodeModulesLoaded) return true;

  const PATH_MODULE = "path";
  const FS_MODULE = "fs/promises";
  const FS_SYNC_MODULE = "fs";
  const CRYPTO_MODULE = "crypto";

  const pathMod = await import(/* @vite-ignore */ PATH_MODULE);
  const fsMod = await import(/* @vite-ignore */ FS_MODULE);
  const fsSyncMod = await import(/* @vite-ignore */ FS_SYNC_MODULE);
  const cryptoMod = await import(/* @vite-ignore */ CRYPTO_MODULE);

  _join = pathMod.join;
  _readdir = fsMod.readdir;
  _lstat = fsMod.lstat;
  _existsSync = fsSyncMod.existsSync;
  _createReadStream = fsSyncMod.createReadStream;
  _createHash = cryptoMod.createHash;
  _nodeModulesLoaded = true;
  return true;
}

/**
 * D1's verified slug algorithm (Spec §4.13): for a project path under the
 * user's home directory, strip the home prefix and replace every remaining
 * "/" with "-" (confirmed against this session's own live
 * `~/.omp/agent/sessions/-Projects-Personal-ei/` and sibling examples). For
 * a project path NOT under home, fall back to the full absolute path with
 * "/" replaced by "--" — one observed data point (`--private-tmp--`, for
 * `/private/tmp`), implemented defensively (never crashes or silently
 * misresolves) rather than asserted with the same confidence as the
 * home-relative case.
 */
export function slugifyProjectPath(projectPath: string, home: string): string {
  if (home && (projectPath === home || projectPath.startsWith(`${home}/`))) {
    return projectPath.slice(home.length).replace(/\//g, "-");
  }
  return projectPath.replace(/\//g, "--");
}

/**
 * D2: the dot-chain in a nested filename names only the immediate child's
 * display label (the segment after the LAST dot) — never used for CD math.
 * A CD2 filename has zero dots, so its whole stem is its own label.
 */
function labelFromFilename(filename: string): string {
  const stem = filename.slice(0, -".jsonl".length);
  const lastDot = stem.lastIndexOf(".");
  return lastDot === -1 ? stem : stem.slice(lastDot + 1);
}

/**
 * A tree's id is the UUID segment of its root session file name: the text
 * after the first "_" in the stem (`<timestamp>_<uuid>`), the same
 * derivation the Pi reader uses. It comes from the name alone, so it is
 * known without opening the file and is the same for a copied tree. A stem
 * with no "_" has no id and is not a tree.
 */
function treeIdFromStem(stem: string): string | null {
  const underscoreIdx = stem.indexOf("_");
  if (underscoreIdx === -1) return null;
  return stem.slice(underscoreIdx + 1);
}

/** Joins the strings of an array-form `systemPrompt` into the one string whose hash is the revision. */
const SYSTEM_PROMPT_SEPARATOR = "\n\n";

function extractSystemPrompt(raw: unknown): string | undefined {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw) && raw.every((part) => typeof part === "string")) {
    return raw.join(SYSTEM_PROMPT_SEPARATOR);
  }
  return undefined;
}

async function readDirents(dir: string): Promise<Dirent[]> {
  try {
    return await _readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The mtime in ms of a regular file (never follows a symlink), or `null` when it cannot be statted. */
async function mtimeOf(filePath: string): Promise<number | null> {
  try {
    const stats = await _lstat(filePath);
    return stats.isFile() ? stats.mtimeMs : null;
  } catch {
    return null;
  }
}

interface OmpContentBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

function extractText(content: unknown): string {
  if (!content) return "";
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return (content as OmpContentBlock[])
    .filter((b): b is { type: "text"; text: string } => !!b && b.type === "text" && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n\n")
    .trim();
}

export class OmpReader {
  /**
   * Every CD2+ `.jsonl` file under `sessionRoot` (default: this project's
   * own `~/.omp/agent/sessions/<slug>/` directory), each with its computed
   * CD and immediate-parent label. CD1 root session files are excluded —
   * Non-Goal, the existing importers' handling of them is untouched.
   * Non-`.jsonl` siblings (`.md`, `.log`, any other extension) are never
   * even attempted (R2).
   */
  async listTranscripts(sessionRoot?: string): Promise<OmpTranscriptRecord[]> {
    if (!(await ensureNodeModules())) return [];

    const root = sessionRoot ?? _join(process.env.HOME || "/", ".omp", "agent", "sessions", slugifyProjectPath(process.cwd(), process.env.HOME ?? ""));
    if (!_existsSync(root)) return [];

    const records: OmpTranscriptRecord[] = [];
    await this.walk(root, 0, records);
    return records.sort((a, b) => a.path.localeCompare(b.path));
  }

  /**
   * Every session tree under `sessionsRoot` (default `~/.omp/agent/sessions`).
   * Every directory directly under the root is a project directory and is
   * searched, whatever its name; nothing about the process's working directory
   * or a session's own header is consulted. A tree is a root file
   * `<name>.jsonl` in a project directory plus every file under the sibling
   * directory `<name>/` at any depth; a directory with no root file is not a
   * tree. Only regular files are accepted. Listing only stats: no file is
   * opened or read. `newestMtimeMs` covers the root file and every file under
   * the sibling directory, `.jsonl` or not, so a change to a tool-output log
   * still counts as activity in the tree; `transcripts` lists only its
   * `.jsonl` files.
   */
  async listTrees(sessionsRoot?: string): Promise<OmpTree[]> {
    if (!(await ensureNodeModules())) return [];

    const root = sessionsRoot ?? _join(process.env.HOME || "/", ".omp", "agent", "sessions");
    if (!_existsSync(root)) return [];

    const trees: OmpTree[] = [];
    for (const project of await readDirents(root)) {
      if (!project.isDirectory()) continue;
      const projectDir = _join(root, project.name);
      const entries = await readDirents(projectDir);
      const siblingDirs = new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name));

      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
        const stem = entry.name.slice(0, -".jsonl".length);
        const id = treeIdFromStem(stem);
        if (!id) continue;

        const rootPath = _join(projectDir, entry.name);
        const rootMtime = await mtimeOf(rootPath);
        if (rootMtime === null) continue;

        const transcripts: OmpTranscriptRecord[] = [];
        let newestMtimeMs = rootMtime;
        if (siblingDirs.has(stem)) {
          newestMtimeMs = Math.max(newestMtimeMs, await this.walkTree(_join(projectDir, stem), 0, transcripts));
        }
        transcripts.sort((a, b) => a.path.localeCompare(b.path));
        trees.push({ id, rootPath, transcripts, newestMtimeMs });
      }
    }
    return trees.sort((a, b) => a.rootPath.localeCompare(b.rootPath));
  }

  /**
   * Collects the `.jsonl` regular files under a tree's sibling directory into
   * `out` (`depth` 0 is the sibling directory itself, so a file in it is CD2)
   * and returns the newest mtime among every regular file found there.
   */
  private async walkTree(dir: string, depth: number, out: OmpTranscriptRecord[]): Promise<number> {
    let newest = 0;
    for (const entry of await readDirents(dir)) {
      const fullPath = _join(dir, entry.name);
      if (entry.isDirectory()) {
        newest = Math.max(newest, await this.walkTree(fullPath, depth + 1, out));
        continue;
      }
      if (!entry.isFile()) continue;

      const mtime = await mtimeOf(fullPath);
      if (mtime === null) continue;
      newest = Math.max(newest, mtime);
      if (entry.name.endsWith(".jsonl")) {
        out.push({ path: fullPath, cd: depth + 2, label: labelFromFilename(entry.name) });
      }
    }
    return newest;
  }

  private async walk(dir: string, depth: number, out: OmpTranscriptRecord[]): Promise<void> {
    let entries: import("fs").Dirent[];
    try {
      entries = await _readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const fullPath = _join(dir, entry.name);

      if (entry.isDirectory()) {
        await this.walk(fullPath, depth + 1, out);
        continue;
      }
      // D9 (Beta review I4): reject any directory entry that is not a
      // regular file — a FIFO, socket, or symlink named `*.jsonl` is
      // skipped here, never opened or read, so it can never block and
      // wedge the enabled sync worker indefinitely.
      if (!entry.isFile()) continue;

      if (!entry.name.endsWith(".jsonl")) continue; // R2/§4.13: non-.jsonl siblings ignored

      // D2: CD is directory depth from sessionRoot, +1 — never dot-count.
      // depth 0 (directly in sessionRoot) = CD1, the root session file,
      // excluded; depth 1 = CD2; depth 2 = CD3; etc.
      const cd = depth + 1;
      if (cd <= 1) continue;

      out.push({ path: fullPath, cd, label: labelFromFilename(entry.name) });
    }
  }

  /**
   * Parses one transcript file's events, streaming the file line by line
   * (lines delimited by `\n`; an unterminated final line is a line like any
   * other). Returns `null`, never throws, for an unreadable file, a file
   * with no parseable entry, or a file with ANY unparseable non-blank line
   * — such a transcript is rejected whole, never accepted as partial
   * evidence. There is no size or entry-count limit. A transcript missing
   * `session_init`, or missing its `agent`/`systemPrompt` fields, is NOT
   * malformed — it still parses to a valid `OmpSession`, just with an
   * incomplete `provenance` (judged downstream by
   * `classifyObservationLens`).
   *
   * A message entry with no string `id` is identified as `line-<n>`, where
   * n is its 1-based physical line number in the file, counting every line
   * (header, blank and non-message lines included), so the id is stable
   * across reads.
   */
  async readTranscript(filePath: string): Promise<OmpSession | null> {
    if (!(await ensureNodeModules())) return null;

    // Re-assert regular-file identity immediately before the read, not
    // only at directory-enumeration time — `walk`'s `Dirent.isFile()`
    // check is a TOCTOU snapshot; a FIFO, socket, or symlink swapped in at
    // this exact path between enumeration and now is rejected here too,
    // via `lstat()` (never follows a symlink, unlike `stat()`), so it can
    // never be opened and block the read indefinitely.
    try {
      const stats = await _lstat(filePath);
      if (!stats.isFile()) return null;
    } catch {
      return null;
    }

    let entryCount = 0;
    let sessionInit: Record<string, unknown> | undefined;
    const messages: OmpMessage[] = [];
    let firstTs: string | null = null;
    let lastTs: string | null = null;
    let lineNo = 0;

    // Returns false when the line is non-blank and not valid JSON.
    const consume = (line: string): boolean => {
      lineNo++;
      const trimmed = line.trim();
      if (!trimmed) return true;
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        return false;
      }
      if (!parsed || typeof parsed !== "object") return true;
      entryCount++;
      const entry = parsed as Record<string, unknown>;

      if (entry.type === "session_init") {
        sessionInit ??= entry;
        return true;
      }
      if (entry.type !== "message") return true;
      const message = entry.message as { role?: unknown; content?: unknown; attribution?: unknown } | undefined;
      if (!message || typeof message !== "object") return true;

      const role = message.role;
      if (role !== "user" && role !== "assistant") return true;

      const content = extractText(message.content);
      if (!content) return true;

      const ts = typeof entry.timestamp === "string" ? entry.timestamp : new Date(0).toISOString();
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;

      // `agent` on the outer entry names the persona in a main session;
      // `attribution` says whether a user-role line is the parent agent's or
      // the human's. Either is left off when the entry does not carry it.
      const agent = typeof entry.agent === "string" ? entry.agent : undefined;
      const attribution =
        message.attribution === "agent" || message.attribution === "user" ? message.attribution : undefined;

      messages.push({
        id: typeof entry.id === "string" ? entry.id : `line-${lineNo}`,
        role,
        content,
        timestamp: ts,
        ...(agent !== undefined && { agent }),
        ...(attribution !== undefined && { attribution }),
      });
      return true;
    };

    try {
      const decoder = new TextDecoder();
      // Fragments of the current unfinished line; each decoded piece is
      // scanned for "\n" once and the line is joined once, when it ends.
      let fragments: string[] = [];
      const feed = (text: string): boolean => {
        let start = 0;
        for (let nl = text.indexOf("\n"); nl !== -1; nl = text.indexOf("\n", start)) {
          fragments.push(text.slice(start, nl));
          const line = fragments.join("");
          fragments = [];
          if (!consume(line)) return false;
          start = nl + 1;
        }
        if (start < text.length) fragments.push(start === 0 ? text : text.slice(start));
        return true;
      };
      for await (const chunk of _createReadStream(filePath)) {
        if (!feed(decoder.decode(chunk, { stream: true }))) return null;
      }
      if (!feed(decoder.decode())) return null;
      const last = fragments.join("");
      if (last && !consume(last)) return null;
    } catch {
      return null;
    }

    if (entryCount === 0) return null; // nothing parseable -> null

    const agentId = typeof sessionInit?.agent === "string" ? (sessionInit.agent as string) : undefined;
    const systemPrompt = extractSystemPrompt(sessionInit?.systemPrompt);

    const provenance: OmpProvenance = {
      harness: "omp",
      mode: "delegated",
      agent_id: agentId,
      agent_definition_ref: agentId ? `omp:${agentId}` : undefined,
      definition_revision: systemPrompt
        ? `sha256:${_createHash("sha256").update(systemPrompt, "utf-8").digest("hex")}`
        : undefined,
    };

    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return { path: filePath, provenance, messages, firstMessageAt: firstTs, lastMessageAt: lastTs };
  }
}

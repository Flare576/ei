import type { OmpMessage, OmpProvenance, OmpSession, OmpTranscriptRecord } from "./types.js";
import type { join } from "path";
import type { readdir, lstat } from "fs/promises";
import type { existsSync, createReadStream } from "fs";
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
      const message = entry.message as { role?: unknown; content?: unknown } | undefined;
      if (!message || typeof message !== "object") return true;

      const role = message.role;
      if (role !== "user" && role !== "assistant") return true;

      const content = extractText(message.content);
      if (!content) return true;

      const ts = typeof entry.timestamp === "string" ? entry.timestamp : new Date(0).toISOString();
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;

      messages.push({
        id: typeof entry.id === "string" ? entry.id : `line-${lineNo}`,
        role,
        content,
        timestamp: ts,
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
    const systemPrompt =
      typeof sessionInit?.systemPrompt === "string" ? (sessionInit.systemPrompt as string) : undefined;

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

import type { OmpMessage, OmpProvenance, OmpSession, OmpTranscriptRecord } from "./types.js";
import type { join } from "path";
import type { readdir, readFile, lstat } from "fs/promises";
import type { existsSync } from "fs";
import type { createHash } from "crypto";

const isBrowser = typeof document !== "undefined";

let _join: typeof join;
let _readdir: typeof readdir;
let _readFile: typeof readFile;
let _lstat: typeof lstat;
let _existsSync: typeof existsSync;
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
  _readFile = fsMod.readFile;
  _lstat = fsMod.lstat;
  _existsSync = fsSyncMod.existsSync;
  _createHash = cryptoMod.createHash;
  _nodeModulesLoaded = true;
  return true;
}

/**
 * D11 (Beta review I6): documented resource budgets for `readTranscript`,
 * enforced before allocating full in-memory structures — a file whose
 * on-disk size or parsed-entry count exceeds either budget is skipped,
 * treated as unreadable (D5's `null`-return convention), never fully
 * parsed. Chosen generously for a real CD2+ sub-agent transcript — this
 * Bolt's own implementer choice (Spec-permitted, D11), not asserted
 * against a specific production-representative number.
 */
export const MAX_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
export const MAX_TRANSCRIPT_ENTRIES = 5000;

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
      // skipped here, never opened, so it can never block `readFile()`
      // and wedge the enabled sync worker indefinitely.
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
   * Parses one transcript file's events. Returns `null`, never throws, for
   * an unreadable or malformed file (D5) — adopting `PiReader.readJsonl`'s
   * own verified silent-skip behavior, since no warning sink exists in
   * this codebase to log against. A transcript missing `session_init`, or
   * missing its `agent`/`systemPrompt` fields, is NOT malformed — it still
   * parses to a valid `OmpSession`, just with an incomplete `provenance`
   * (D3's fail-closed case, judged downstream by `classifyObservationLens`).
   */
  async readTranscript(filePath: string): Promise<OmpSession | null> {
    if (!(await ensureNodeModules())) return null;

    // D9/I6 (Stint holistic review Bucket 1, finding I6, 2026-08-11):
    // re-assert regular-file identity immediately before the read, not
    // only at directory-enumeration time — `walk`'s `Dirent.isFile()`
    // check (D9) is a TOCTOU snapshot; a FIFO, socket, or symlink swapped
    // in at this exact path between enumeration and now is rejected here
    // too, via `lstat()` (never follows a symlink, unlike `stat()`), so it
    // can never be opened and block `readFile()` indefinitely.
    //
    // D11 (Beta review I6): the documented byte-size budget, checked here
    // too, BEFORE ever reading the file's content into memory — an
    // oversized (but otherwise syntactically valid) transcript is skipped,
    // treated as unreadable (D5's null-return convention), rather than
    // fully allocated.
    try {
      const stats = await _lstat(filePath);
      if (!stats.isFile()) return null;
      if (stats.size > MAX_TRANSCRIPT_BYTES) return null;
    } catch {
      return null;
    }

    let raw: string;
    try {
      raw = await _readFile(filePath, "utf-8");
    } catch {
      return null;
    }

    const entries: Record<string, unknown>[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // D11: the entry-count budget, also enforced before allocating any
      // more of the full in-memory `entries`/`messages` structures — a
      // syntactically-valid file with an unreasonable number of JSONL
      // records is skipped rather than fully parsed.
      if (entries.length >= MAX_TRANSCRIPT_ENTRIES) return null;
      try {
        const parsed = JSON.parse(trimmed);
        if (parsed && typeof parsed === "object") entries.push(parsed as Record<string, unknown>);
      } catch {
        // I5 (Stint holistic review Bucket 1, 2026-08-11): ANY unparseable
        // non-blank line rejects the WHOLE transcript — D5's own
        // "malformed transcript returns null" text was previously
        // implemented as a per-line skip (entries.length === 0 below was
        // the only null-triggering condition), so a file with valid lines
        // plus one invalid one was wrongly accepted as partial evidence.
        return null;
      }
    }

    if (entries.length === 0) return null; // D5: nothing parseable -> null

    const sessionInit = entries.find((e) => e.type === "session_init");
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

    const messages: OmpMessage[] = [];
    let firstTs: string | null = null;
    let lastTs: string | null = null;

    for (const entry of entries) {
      if (entry.type !== "message") continue;
      const message = entry.message as { role?: unknown; content?: unknown } | undefined;
      if (!message || typeof message !== "object") continue;

      const role = message.role;
      if (role !== "user" && role !== "assistant") continue;

      const content = extractText(message.content);
      if (!content) continue;

      const ts = typeof entry.timestamp === "string" ? entry.timestamp : new Date(0).toISOString();
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;

      messages.push({
        id: typeof entry.id === "string" ? entry.id : crypto.randomUUID(),
        role,
        content,
        timestamp: ts,
      });
    }

    messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return { path: filePath, provenance, messages, firstMessageAt: firstTs, lastMessageAt: lastTs };
  }
}

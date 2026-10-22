import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * Generates OMP session transcripts at test time, in the shape the OMP producer writes:
 *
 *  - The `session` header comes first (real files usually put a fixed-width `title` record before it; add one as
 *    a verbatim string line when a test needs it). A sub-agent's header carries `parentSession`.
 *  - A sub-agent transcript has `session_init` (`agent`, `systemPrompt` as string or string[], `task`, `tools`);
 *    `agent` is absent on files that predate the field.
 *  - A user-role message carries `attribution` on `entry.message` ("agent" for the parent, "user" for a human
 *    typing to a sub-agent or to the main session); leave it off to build a line that has none. A main-session
 *    message carries the persona `agent` on the outer entry, next to `id`/`parentId`/`timestamp`.
 *  - Nested files: `<stem>.jsonl`, `<stem>/<P>.jsonl`, `<stem>/<P>/<P>.<C>.jsonl` (the file stem is the dotted id).
 *
 * Nothing here is copied from a real session. Pass `id: null` to a message to leave `id` off the entry, and a
 * string where a line is expected to write that text verbatim (blank, malformed or truncated lines). The
 * `ompSubAgent` and `ompMainSession` wrappers use one fixed header id; build the header with `ompHeader` to give
 * a tree its own `id`, `cwd` or `parentSession`.
 */

export type OmpLine = Record<string, unknown> | string;

const BASE_MS = Date.parse("2026-08-01T00:00:00.000Z");
const at = (n: number) => new Date(BASE_MS + n * 60_000).toISOString();

export function ompHeader(o: { id?: string; cwd?: string; parentSession?: string; timestamp?: string } = {}): OmpLine {
  return {
    type: "session",
    version: 3,
    id: o.id ?? "00000000-0000-7000-8000-000000000001",
    timestamp: o.timestamp ?? at(0),
    cwd: o.cwd ?? "/work/project",
    ...(o.parentSession !== undefined && { parentSession: o.parentSession }),
  };
}

export function ompSessionInit(o: { agent?: string; systemPrompt?: string | string[]; task?: string } = {}): OmpLine {
  return {
    type: "session_init",
    systemPrompt: o.systemPrompt ?? ["You are a test agent."],
    task: o.task ?? "Do the task.",
    tools: ["read"],
    ...(o.agent !== undefined && { agent: o.agent }),
  };
}

export function ompMessage(
  role: "user" | "assistant",
  text: string,
  o: { attribution?: "agent" | "user"; steering?: boolean; agent?: string; id?: string | null; timestamp?: string } = {}
): OmpLine {
  return {
    type: "message",
    ...(o.id !== undefined && { id: o.id }),
    ...(o.timestamp !== undefined && { timestamp: o.timestamp }),
    ...(o.agent !== undefined && { agent: o.agent }),
    message: {
      role,
      content: [{ type: "text", text }],
      ...(o.attribution !== undefined && { attribution: o.attribution }),
      ...(o.steering && { steering: true }),
    },
  };
}

/** A non-message row the producer writes between messages (an idle sub-agent woken by the parent). */
export function ompIrcIncoming(text: string): OmpLine {
  return { type: "custom_message", customType: "irc:incoming", content: text, attribution: "agent" };
}

export function ompSubAgent(o: {
  agent?: string;
  systemPrompt?: string | string[];
  parentSession?: string;
  messages: OmpLine[];
}): OmpLine[] {
  return [
    ompHeader({ parentSession: o.parentSession ?? "/work/root-session.jsonl" }),
    ompSessionInit({ agent: o.agent, systemPrompt: o.systemPrompt }),
    ...o.messages,
  ];
}

export function ompMainSession(o: { cwd?: string; messages: OmpLine[] }): OmpLine[] {
  return [ompHeader({ cwd: o.cwd }), ...o.messages];
}

/**
 * JSONL text for a transcript. Entries missing `id`, `parentId` or `timestamp` get them by position (a
 * 1-minute step from 2026-08-01); the header (`type: "session"`) and verbatim string lines are left as given.
 */
export function ompTranscriptText(lines: OmpLine[], o: { trailingNewline?: boolean } = {}): string {
  let parentId: string | null = null;
  const out = lines.map((line, i) => {
    if (typeof line === "string") return line;
    if (line.type === "session") return JSON.stringify(line);
    const timestamp = (line.timestamp as string | undefined) ?? at(i);
    const entry: Record<string, unknown> = {
      type: line.type,
      id: `e${i.toString(16).padStart(7, "0")}`,
      parentId,
      timestamp,
      ...line,
    };
    if (entry.id === null) delete entry.id;
    const message = entry.message as Record<string, unknown> | undefined;
    if (message && message.timestamp === undefined) entry.message = { ...message, timestamp: Date.parse(timestamp) };
    if (entry.id !== undefined) parentId = entry.id as string;
    return JSON.stringify(entry);
  });
  return out.join("\n") + (o.trailingNewline === false ? "" : "\n");
}

export interface OmpTreeSpec {
  /** Project directory under the sessions root; any name works. */
  projectDir?: string;
  /** Root session file stem (the file is `<stem>.jsonl`). */
  stem: string;
  main: OmpLine[] | string;
  /** Sub-agent transcripts by dotted id: `"P"` for depth 1, `"P.C"` for depth 2, `"P.C.D"` for depth 3. */
  children?: Record<string, OmpLine[] | string>;
  /** Other files in the artifacts directory `<stem>/`, by relative path (`P.md`, `1.bash.log`). */
  extraFiles?: Record<string, string>;
  /** Applied to every written file; defaults to a date long before any quiet-tree guard window. */
  mtime?: Date;
}

/** Writes a root session and its nested sub-agent transcripts under `sessionsRoot`; returns each path written. */
export async function writeOmpTree(
  sessionsRoot: string,
  tree: OmpTreeSpec
): Promise<{ rootFile: string; children: Record<string, string>; extraFiles: Record<string, string> }> {
  const projectDir = path.join(sessionsRoot, tree.projectDir ?? "-project");
  const artifacts = path.join(projectDir, tree.stem);
  const mtime = tree.mtime ?? new Date("2026-01-01T00:00:00.000Z");

  const write = async (file: string, content: string): Promise<string> => {
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, content);
    await fs.utimes(file, mtime, mtime);
    return file;
  };

  const rootFile = await write(
    path.join(projectDir, `${tree.stem}.jsonl`),
    typeof tree.main === "string" ? tree.main : ompTranscriptText(tree.main)
  );
  const children: Record<string, string> = {};
  for (const [id, content] of Object.entries(tree.children ?? {})) {
    const parts = id.split(".");
    const dirs = parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join("."));
    const body = typeof content === "string" ? content : ompTranscriptText(content);
    children[id] = await write(path.join(artifacts, ...dirs, `${id}.jsonl`), body);
  }
  const extraFiles: Record<string, string> = {};
  for (const [rel, content] of Object.entries(tree.extraFiles ?? {})) {
    extraFiles[rel] = await write(path.join(artifacts, rel), content);
  }
  return { rootFile, children, extraFiles };
}

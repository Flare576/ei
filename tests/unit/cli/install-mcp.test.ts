import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync, statSync, utimesSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ── Bun global polyfill ──────────────────────────────────────────────────────
// install.ts is written against the Bun runtime (Bun.$, Bun.file, Bun.write,
// Bun.spawn, Bun.TOML), but this suite runs under plain Node (see repo
// tooling notes: `node` on this machine resolves to a Bun shim that can't run
// vitest, so tests run through a real Node binary with no `Bun` global at
// all). Rather than mock the code under test's *behavior* away, this
// polyfill backs Bun.$/file/write with real filesystem/shell operations
// (child_process + fs, mirroring tests/unit/cli/install-skills.test.ts
// exactly) so file-mutation logic is exercised end-to-end. Bun.spawn is
// call-tracked instead of shelling out for real — the whole point of these
// tests is to prove the `codex` subprocess is (or isn't) invoked, and doing
// that against a real `codex` binary would depend on what's installed on
// whatever machine happens to run the suite. Bun.TOML.parse is a tiny
// hand-rolled reader — no TOML parsing package is a project dependency, and
// the only fixtures it ever sees are the literal strings these tests write,
// not arbitrary real-world TOML.
function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

class FakeShellCall implements PromiseLike<void> {
  private cmd: string;
  private isQuiet = false;

  constructor(cmd: string) {
    this.cmd = cmd;
  }

  quiet(): this {
    this.isQuiet = true;
    return this;
  }

  private run(): string {
    return execSync(this.cmd, {
      shell: "/bin/sh",
      encoding: "utf-8",
      stdio: ["ignore", "pipe", this.isQuiet ? "ignore" : "pipe"],
    });
  }

  async text(): Promise<string> {
    return this.run();
  }

  then<TResult1 = void, TResult2 = never>(
    onFulfilled?: ((value: void) => TResult1 | PromiseLike<TResult1>) | null,
    onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    try {
      this.run();
      return Promise.resolve(onFulfilled ? onFulfilled(undefined) : (undefined as unknown as TResult1));
    } catch (e) {
      if (onRejected) return Promise.resolve(onRejected(e));
      return Promise.reject(e);
    }
  }
}

function fakeBunShell(strings: TemplateStringsArray, ...values: unknown[]): FakeShellCall {
  let cmd = strings[0];
  for (let i = 0; i < values.length; i++) {
    cmd += quoteShellArg(String(values[i])) + strings[i + 1];
  }
  return new FakeShellCall(cmd);
}

function fakeBunFile(path: string) {
  return {
    async exists(): Promise<boolean> {
      try {
        return statSync(path).isFile();
      } catch {
        return false;
      }
    },
    async text(): Promise<string> {
      return readFileSync(path, "utf-8");
    },
  };
}

async function fakeBunWrite(path: string, content: string): Promise<number> {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return Buffer.byteLength(content);
}

/** Minimal TOML scalar reader — strings, bools, numbers, flat arrays of the above. */
function parseTomlScalar(raw: string): unknown {
  if (raw.startsWith('"') && raw.endsWith('"')) return raw.slice(1, -1);
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (raw.startsWith("[") && raw.endsWith("]")) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((segment) => parseTomlScalar(segment.trim()));
  }
  const num = Number(raw);
  return Number.isNaN(num) ? raw : num;
}

/**
 * Minimal `[a.b.c]` table-header + `key = value` line reader — enough to
 * reconstruct the exact shape installCodex() reads (`parsed.mcp_servers.ei`)
 * from the literal TOML fixtures these tests write. Not a general TOML
 * parser (no inline tables, no multi-line strings, no dotted keys outside
 * headers) — deliberately scoped to what the fixtures below actually use.
 */
function fakeTomlParse(text: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let current: Record<string, unknown> = root;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) {
      current = root;
      for (const key of sectionMatch[1].split(".").map((segment) => segment.trim())) {
        const existing = current[key];
        if (typeof existing !== "object" || existing === null) {
          current[key] = {};
        }
        current = current[key] as Record<string, unknown>;
      }
      continue;
    }

    const kvMatch = line.match(/^([^=]+)=(.*)$/);
    if (!kvMatch) continue;
    current[kvMatch[1].trim()] = parseTomlScalar(kvMatch[2].trim());
  }

  return root;
}

interface FakeSpawnCall {
  args: string[];
}

let spawnCalls: FakeSpawnCall[] = [];

/**
 * Call-tracking Bun.spawn fake. `codex --version` (the commandExists() probe
 * used by installMcpClients() to decide whether Codex is even present)
 * throws synchronously to simulate a missing binary — exactly what a real
 * ENOENT from Bun.spawn on a machine without the codex CLI produces, and
 * what installMcpClients()'s try/catch around that probe is built to
 * tolerate. Every other invocation (i.e. `codex mcp remove ei`) succeeds
 * with an empty stdout/stderr and exit code 0.
 */
function fakeBunSpawn(args: string[], _opts?: unknown) {
  spawnCalls.push({ args: [...args] });
  if (args[0] === "codex" && args[1] === "--version") {
    throw new Error("spawn codex ENOENT");
  }
  return {
    stdout: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    stderr: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    exited: Promise.resolve(0),
    exitCode: 0,
  };
}

beforeAll(() => {
  vi.stubGlobal("Bun", { $: fakeBunShell, file: fakeBunFile, write: fakeBunWrite, spawn: fakeBunSpawn, TOML: { parse: fakeTomlParse } });
  // install.ts logs a `✓ ...`/`ℹ️  ...` line per harness on success/no-op —
  // expected and harmless, just noisy in test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Imported after the Bun stub is registered above, matching
// install-skills.test.ts's import ordering (harmless here too, since every
// Bun call in the functions under test happens inside function bodies
// evaluated at call time, not at module load).
import { installClaudeCode, installCursor, installCodex, installMcpClients } from "../../../src/cli/install.js";

// ── test fixture helpers ──────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Runs `fn` with process.env.HOME temporarily pointed at `home`, always restoring it after. */
async function runWithHome<T>(home: string, fn: () => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn();
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  }
}

afterEach(() => {
  spawnCalls = [];
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── shared-skills-directory lock ─────────────────────────────────────────────
// installClaudeCode() and installMcpClients() both end up calling
// installSkillsTo() with no source override, which resolves to Ei's real,
// shared repo-root skills/ directory (same as
// tests/unit/cli/install-skills.test.ts's own wiring describe block, for the
// exact same reason: no isolated per-test tmpdir is available at that call
// site). That's a genuinely shared OS-level resource across any two
// processes touching it concurrently — a second `vitest run`, a `vitest
// watch` left running, or this file racing the sibling install-skills
// suite's own wiring tests. This lock reuses the exact same lock directory
// path (same tmpdir()-based name) as that sibling file so the two suites
// serialize against each other too, not just against themselves.
const SKILLS_LOCK_DIR = join(tmpdir(), "ei-install-skills-wiring.lock");

function acquireSkillsLock(): void {
  const script = `
i=0
while ! mkdir ${quoteShellArg(SKILLS_LOCK_DIR)} 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 400 ]; then
    echo "timed out waiting for the ei-install-skills-wiring lock" >&2
    exit 1
  fi
  # Self-heal a lock abandoned by a crashed/killed prior run.
  find ${quoteShellArg(SKILLS_LOCK_DIR)} -maxdepth 0 -mmin +1 -exec rmdir {} \\; 2>/dev/null
  sleep 0.05
done
`;
  execSync(script, { shell: "/bin/sh" });
}

function releaseSkillsLock(): void {
  try {
    rmdirSync(SKILLS_LOCK_DIR);
  } catch {
    // Already gone — fine.
  }
}

// ── installClaudeCode / installCursor — Ei MCP entry removal ────────────────
// Both functions share the exact same JSON-file-surgery shape (read
// ~/.claude.json or ~/.cursor/mcp.json, delete mcpServers.ei if present,
// atomic write-then-rename only when something actually changed), so their
// contracts are exercised with the same two helpers against each function's
// own config path.

/**
 * Deletes exactly the `ei` entry from `configPath`'s `mcpServers` object and
 * asserts every other key/entry — sibling mcpServers entries AND unrelated
 * top-level fields — survives byte-for-byte in the parsed result. A
 * whole-document `toEqual` against "original minus ei" is a strictly
 * stronger assertion than separately checking "ei is gone" and "otherServer
 * is still there": it also catches a bug that clobbers or reformats
 * anything else in the file.
 */
async function expectRemovesOnlyEiEntry(install: () => Promise<void>, configPath: string, withSkillsLock: boolean): Promise<void> {
  const original = {
    theme: "dark",
    numStartups: 42,
    customArray: [1, 2, 3],
    nested: { keep: true, deep: { value: "unchanged" } },
    mcpServers: {
      ei: { command: "npx", args: ["-y", "ei-tui", "mcp"] },
      otherServer: { command: "some-other-cmd", args: ["--flag"], env: { FOO: "bar" } },
    },
  };
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(original, null, 2) + "\n");

  if (withSkillsLock) acquireSkillsLock();
  try {
    await install();
  } finally {
    if (withSkillsLock) releaseSkillsLock();
  }

  const result = JSON.parse(readFileSync(configPath, "utf-8"));
  const expected = structuredClone(original) as { mcpServers: Record<string, unknown> };
  delete expected.mcpServers.ei;

  expect(result).toEqual(expected);
}

/**
 * Verifies a true no-op: no write happens at all when there is no `ei`
 * entry to remove — not "the final state has no ei key" (which a
 * write-identical-content-back bug would also satisfy), but "the file was
 * never touched". For a pre-existing file this is proven two ways: the raw
 * bytes are unchanged (a real write reformats via `JSON.stringify(..., null,
 * 2)`, so any accidental round-trip would visibly reformat this
 * deliberately-compact fixture), and the mtime — backdated before the call
 * — is still exactly the backdated value, not "now". For a missing file,
 * it's proven by the file still not existing afterward.
 */
async function expectTrueNoOp(install: () => Promise<void>, configPath: string, seedContent: string | undefined, withSkillsLock: boolean): Promise<void> {
  const BACKDATED = new Date(2000, 0, 1);
  if (seedContent !== undefined) {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, seedContent);
    utimesSync(configPath, BACKDATED, BACKDATED);
  }

  if (withSkillsLock) acquireSkillsLock();
  try {
    await install();
  } finally {
    if (withSkillsLock) releaseSkillsLock();
  }

  if (seedContent === undefined) {
    expect(existsSync(configPath)).toBe(false);
    return;
  }
  expect(readFileSync(configPath, "utf-8")).toBe(seedContent);
  expect(statSync(configPath).mtime.getTime()).toBe(BACKDATED.getTime());
}

describe("installClaudeCode — Ei MCP entry removal (~/.claude.json)", () => {
  it("deletes exactly the ei entry, preserving every other mcpServers entry and top-level field", async () => {
    const home = makeTempDir("ei-claude-removal-home-");
    await runWithHome(home, () => expectRemovesOnlyEiEntry(installClaudeCode, join(home, ".claude.json"), true));
  });

  it("is a true no-op when ~/.claude.json does not exist at all", async () => {
    const home = makeTempDir("ei-claude-noop-home-");
    await runWithHome(home, () => expectTrueNoOp(installClaudeCode, join(home, ".claude.json"), undefined, true));
  });

  it("is a true no-op when ~/.claude.json exists but has no mcpServers key", async () => {
    const home = makeTempDir("ei-claude-noop-home-");
    await runWithHome(home, () => expectTrueNoOp(installClaudeCode, join(home, ".claude.json"), JSON.stringify({ theme: "dark", numStartups: 3 }), true));
  });

  it("is a true no-op when ~/.claude.json has mcpServers but no ei entry", async () => {
    const home = makeTempDir("ei-claude-noop-home-");
    const seed = JSON.stringify({ mcpServers: { otherServer: { command: "foo" } } });
    await runWithHome(home, () => expectTrueNoOp(installClaudeCode, join(home, ".claude.json"), seed, true));
  });
});

describe("installCursor — Ei MCP entry removal (~/.cursor/mcp.json)", () => {
  it("deletes exactly the ei entry, preserving every other mcpServers entry and top-level field", async () => {
    const home = makeTempDir("ei-cursor-removal-home-");
    // installCursor() never touches installSkillsTo/the shared skills/
    // resource (unlike installClaudeCode) — no lock needed.
    await runWithHome(home, () => expectRemovesOnlyEiEntry(installCursor, join(home, ".cursor", "mcp.json"), false));
  });

  it("is a true no-op when ~/.cursor/mcp.json does not exist at all", async () => {
    const home = makeTempDir("ei-cursor-noop-home-");
    await runWithHome(home, () => expectTrueNoOp(installCursor, join(home, ".cursor", "mcp.json"), undefined, false));
  });

  it("is a true no-op when ~/.cursor/mcp.json exists but has no mcpServers key", async () => {
    const home = makeTempDir("ei-cursor-noop-home-");
    await runWithHome(home, () => expectTrueNoOp(installCursor, join(home, ".cursor", "mcp.json"), JSON.stringify({ editor: { fontSize: 14 } }), false));
  });

  it("is a true no-op when ~/.cursor/mcp.json has mcpServers but no ei entry", async () => {
    const home = makeTempDir("ei-cursor-noop-home-");
    const seed = JSON.stringify({ mcpServers: { otherServer: { command: "foo" } } });
    await runWithHome(home, () => expectTrueNoOp(installCursor, join(home, ".cursor", "mcp.json"), seed, false));
  });
});

// ── installCodex — Ei MCP entry removal via `codex mcp remove` ─────────────
// installCodex() doesn't edit ~/.codex/config.toml directly — it pre-checks
// the file with Bun.TOML.parse and only shells out to the codex CLI (which
// owns rewriting its own config) when an [mcp_servers.ei] table is actually
// present. These tests assert against spawnCalls (the fake Bun.spawn's call
// log) rather than file contents, since the file itself is never touched by
// installCodex() in either branch.

describe("installCodex — Ei MCP entry removal via `codex mcp remove`", () => {
  it("never invokes the codex subprocess when ~/.codex/config.toml does not exist", async () => {
    const home = makeTempDir("ei-codex-home-");
    await runWithHome(home, () => installCodex());
    expect(spawnCalls).toEqual([]);
  });

  it("never invokes the codex subprocess when config.toml exists but has no [mcp_servers.ei] table", async () => {
    const home = makeTempDir("ei-codex-home-");
    const configPath = join(home, ".codex", "config.toml");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `[mcp_servers.other]\ncommand = "some-other-cmd"\n`);

    await runWithHome(home, () => installCodex());

    expect(spawnCalls).toEqual([]);
  });

  it("invokes `codex mcp remove ei` with exactly those args when [mcp_servers.ei] is present", async () => {
    const home = makeTempDir("ei-codex-home-");
    const configPath = join(home, ".codex", "config.toml");
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, `[mcp_servers.ei]\ncommand = "npx"\nargs = ["-y", "ei-tui", "mcp"]\n`);

    await runWithHome(home, () => installCodex());

    expect(spawnCalls).toEqual([{ args: ["codex", "mcp", "remove", "ei"] }]);
  });
});

// ── installMcpClients — shared skills directory install ─────────────────────

describe("installMcpClients — shared skills directory install", () => {
  // Mirrors install-skills.test.ts's own wiring describe block: a real
  // fixture skill seeded (and later removed) under the real, shared
  // repo-root skills/ directory, since installSkillsTo's default source
  // resolution isn't overridable from this call site.
  const repoSkillsDir = new URL("../../../skills", import.meta.url).pathname;

  let originalHome: string | undefined;
  let fakeHome: string;
  let fixtureSkillDir: string;
  let fixtureSkillName: string;

  beforeEach(() => {
    acquireSkillsLock();
    originalHome = process.env.HOME;
    fakeHome = makeTempDir("ei-mcp-shared-skills-home-");
    fixtureSkillName = `__install-mcp-shared-skills-fixture-${randomUUID()}__`;
    fixtureSkillDir = join(repoSkillsDir, fixtureSkillName);
    mkdirSync(join(fixtureSkillDir, "references"), { recursive: true });
    writeFileSync(join(fixtureSkillDir, "SKILL.md"), "shared skills fixture content");
    writeFileSync(join(fixtureSkillDir, "references", "notes.md"), "shared skills fixture reference");
  });

  afterEach(() => {
    rmSync(fixtureSkillDir, { recursive: true, force: true });
    try {
      rmdirSync(repoSkillsDir); // no-op (throws, caught) if anything else still lives there
    } catch {
      // Not empty (another concurrent fixture / real content) or already gone — leave it alone.
    }
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    releaseSkillsLock();
  });

  it('installs to ~/.agents/skills unconditionally, even when every per-tool detection check reports "not detected"', async () => {
    process.env.HOME = fakeHome;

    // fakeHome has none of the marker files/dirs installMcpClients() probes
    // for Cursor, OpenCode, Pi, or OMP, and the fake Bun.spawn throws for
    // `codex --version` (simulating a missing binary) — so every gated
    // harness in installMcpClients() logs "not detected" and is skipped.
    // Claude Code has no detection gate (it always runs), which is
    // orthogonal to what's being asserted: the shared skills step is the
    // one unconditional install target that must fire regardless of what
    // else is or isn't present on the machine.
    await installMcpClients();

    const installedSkillMd = join(fakeHome, ".agents", "skills", fixtureSkillName, "SKILL.md");
    expect(existsSync(installedSkillMd)).toBe(true);
    expect(readFileSync(installedSkillMd, "utf-8")).toBe("shared skills fixture content");
  });
});
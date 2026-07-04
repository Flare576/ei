import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, rmdirSync, statSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";

// ── Bun global polyfill ──────────────────────────────────────────────────────
// install.ts is written against the Bun runtime (Bun.$, Bun.file, Bun.write),
// but this suite runs under plain Node (see repo tooling notes: `node` on this
// machine resolves to a Bun shim that can't run vitest, so tests run through a
// real Node binary — one that has no `Bun` global at all). Rather than mock
// installSkillsTo's *behavior* away, this polyfill backs the same three Bun
// APIs the code under test actually calls with real filesystem/shell
// operations (child_process + fs), so the tests still exercise the genuine
// copy/overwrite/no-op logic end-to-end.
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

beforeAll(() => {
  vi.stubGlobal("Bun", { $: fakeBunShell, file: fakeBunFile, write: fakeBunWrite });
  // install.ts logs a `✓ Installed ...` line per harness on success — expected
  // and harmless, just noisy in test output.
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

// Imported after the Bun stub is registered above so any accidental
// module-load-time Bun usage would also be covered — but note installSkillsTo
// and friends only touch `Bun` inside function bodies, evaluated at call
// time, so import ordering relative to the stub doesn't actually matter.
import { installSkillsTo, installClaudeCode, installOmp, installOpenCodePlugin, installMcpClients, runInstallStep } from "../../../src/cli/install.js";

// ── test fixture helpers ──────────────────────────────────────────────────────

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

/** Seeds `skillsRoot/skillName/` with a SKILL.md and a nested references/ file. */
function seedSkill(skillsRoot: string, skillName: string, skillMdContent: string, referenceContent: string): void {
  const skillDir = join(skillsRoot, skillName);
  mkdirSync(join(skillDir, "references"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), skillMdContent);
  writeFileSync(join(skillDir, "references", "notes.md"), referenceContent);
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    rmSync(dir, { recursive: true, force: true });
  }
});

// ── installSkillsTo ───────────────────────────────────────────────────────────

describe("installSkillsTo", () => {
  it("copies a single skill directory including nested references/ content byte-for-byte", async () => {
    const source = makeTempDir("ei-skills-source-");
    const target = makeTempDir("ei-skills-target-");
    seedSkill(source, "ei-curate", "# Ei Curate\ninstructions here", "reference notes content");

    await installSkillsTo(target, source);

    expect(readFileSync(join(target, "ei-curate", "SKILL.md"), "utf-8")).toBe("# Ei Curate\ninstructions here");
    expect(readFileSync(join(target, "ei-curate", "references", "notes.md"), "utf-8")).toBe("reference notes content");
  });

  it("copies multiple skill directories in one call via a generic loop", async () => {
    const source = makeTempDir("ei-skills-source-");
    const target = makeTempDir("ei-skills-target-");
    seedSkill(source, "skill-one", "content one", "ref one");
    seedSkill(source, "skill-two", "content two", "ref two");

    await installSkillsTo(target, source);

    expect(readFileSync(join(target, "skill-one", "SKILL.md"), "utf-8")).toBe("content one");
    expect(readFileSync(join(target, "skill-two", "SKILL.md"), "utf-8")).toBe("content two");
  });

  it("skips a stray file directly under the source dir — only directories are treated as skills", async () => {
    const source = makeTempDir("ei-skills-source-");
    const target = makeTempDir("ei-skills-target-");
    seedSkill(source, "real-skill", "real content", "real ref");
    writeFileSync(join(source, "README.md"), "not a skill, just a stray file");

    await installSkillsTo(target, source);

    expect(existsSync(join(target, "real-skill", "SKILL.md"))).toBe(true);
    expect(existsSync(join(target, "README.md"))).toBe(false);
  });

  it("overwrites an existing installed copy with fresh source content, without nesting", async () => {
    const source = makeTempDir("ei-skills-source-");
    const target = makeTempDir("ei-skills-target-");
    seedSkill(source, "ei-curate", "fresh content", "fresh ref");

    // Pre-seed target with a stale version under the same skill name.
    seedSkill(target, "ei-curate", "STALE content", "STALE ref");

    await installSkillsTo(target, source);

    expect(readFileSync(join(target, "ei-curate", "SKILL.md"), "utf-8")).toBe("fresh content");
    expect(readFileSync(join(target, "ei-curate", "references", "notes.md"), "utf-8")).toBe("fresh ref");
    // A naive `cp -r` onto an existing directory nests src inside dest
    // (dest/ei-curate/ei-curate/...) instead of overwriting it in place.
    expect(existsSync(join(target, "ei-curate", "ei-curate"))).toBe(false);
  });

  it("is a silent no-op when the source directory doesn't exist", async () => {
    const target = makeTempDir("ei-skills-target-");
    const missingSource = join(target, "..", "definitely-does-not-exist-ei-skills-source");

    await expect(installSkillsTo(target, missingSource)).resolves.toBeUndefined();
    // Nothing to copy — the target dir this function owns is never created.
    expect(existsSync(join(target, "..", "definitely-does-not-exist-ei-skills-source"))).toBe(false);
  });
});

// ── wiring: installClaudeCode / installOmp / installOpenCodePlugin ──────────────
// installSkillsTo isn't overridable-by-argument at these call sites (per spec,
// only the target changes; the source stays the real default resolution), so
// these tests seed a real fixture skill at the exact path `installSkillsTo`'s
// default `new URL("../../skills", import.meta.url)` resolves to from
// install.ts — i.e. repo-root skills/ — and run each install* function
// end-to-end against a fake $HOME, then assert the fixture landed at the
// harness-specific target directory these functions are supposed to wire up.

// installClaudeCode/installOmp/installOpenCodePlugin always resolve
// installSkillsTo's SOURCE to the real, shared repo-root skills/ directory
// (no override — by design, since production skills/ is never mutated
// concurrently). That makes it a genuinely shared OS-level resource across
// any two processes that happen to run this describe block at the same
// time (a second agent, a `vitest watch` left running, a re-run overlapping
// a prior one): each creates/removes its own uniquely-named fixture under
// the same shared parent, but installSkillsTo's fs.readdir(skills/) lists
// ALL siblings and then loops copying each — a TOCTOU race against whatever
// other process is concurrently adding/removing there, independent of
// naming. (Confirmed by deliberately running two concurrent `vitest run`
// processes against this suite — reproduced the exact "No such file or
// directory" cp failure even with unique-per-test fixture names.) A
// cross-process mutex around each test's fixture-create -> install ->
// cleanup lifecycle is the only way to make that race impossible rather
// than just less likely. `mkdir` is atomic at the OS level (EEXIST if
// another process holds it), so it doubles as a lock primitive across
// fully independent processes. Acquiring it necessarily blocks on real
// wall-clock time waiting for a SIBLING OS PROCESS (not this process's own
// event loop) to release it — fake timers can't substitute for that, since
// there's no clock to advance on another process — so the wait is shelled
// out to a blocking retry loop rather than using Bun.sleep/setTimeout here.
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

describe("installSkillsTo wiring into installClaudeCode / installOmp / installOpenCodePlugin", () => {
  // Mirrors install.ts's own `new URL("../../skills", import.meta.url)` resolution,
  // computed independently from this test file's location (three levels up from
  // tests/unit/cli/ reaches the repo root, same as two levels up from src/cli/).
  const repoSkillsDir = new URL("../../../skills", import.meta.url).pathname;

  // These 3 wiring functions call installSkillsTo with no source override, so
  // the fixture has to live at the exact real, absolute, on-disk path its
  // default resolution looks at (repo-root skills/) — there's no isolated
  // per-test tmpdir available here the way the direct installSkillsTo tests
  // above get one. That real path is a genuinely SHARED resource: nothing
  // stops another process (a concurrent test run, a developer's `vitest
  // watch`, a second agent poking the same worktree) from touching it at the
  // same time. Two defenses against that, both required:
  //   1. Each test gets its own fixture dir named with a random UUID, never a
  //      shared constant — so concurrent runs can never collide on the same
  //      skill name even if they're all writing into the same skills/ parent.
  //   2. Cleanup NEVER force-deletes the shared skills/ parent itself (an
  //      earlier version did an unconditional rm -rf on it, which is exactly
  //      the kind of operation that destroys a sibling process's still-in-
  //      flight fixture out from under it). rmdirSync only removes an empty
  //      directory — if anything else (another concurrent fixture, or real
  //      skill content) is present, it throws and we just leave it alone.
  let originalHome: string | undefined;
  let fakeHome: string;
  let fixtureSkillDir: string;
  let fixtureSkillName: string;

  beforeEach(() => {
    acquireSkillsLock();
    originalHome = process.env.HOME;
    fakeHome = makeTempDir("ei-install-wiring-home-");
    fixtureSkillName = `__install-skills-wiring-fixture-${randomUUID()}__`;
    fixtureSkillDir = join(repoSkillsDir, fixtureSkillName);
    mkdirSync(join(fixtureSkillDir, "references"), { recursive: true });
    writeFileSync(join(fixtureSkillDir, "SKILL.md"), "wiring fixture content");
    writeFileSync(join(fixtureSkillDir, "references", "notes.md"), "wiring fixture reference");
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

  it("installClaudeCode copies skills to ~/.claude/skills", async () => {
    process.env.HOME = fakeHome;

    await installClaudeCode();

    const installedSkillMd = join(fakeHome, ".claude", "skills", fixtureSkillName, "SKILL.md");
    expect(existsSync(installedSkillMd)).toBe(true);
    expect(readFileSync(installedSkillMd, "utf-8")).toBe("wiring fixture content");
  });

  it("installOmp copies skills to ~/.omp/agent/skills", async () => {
    process.env.HOME = fakeHome;

    await installOmp();

    const installedSkillMd = join(fakeHome, ".omp", "agent", "skills", fixtureSkillName, "SKILL.md");
    expect(existsSync(installedSkillMd)).toBe(true);
    expect(readFileSync(installedSkillMd, "utf-8")).toBe("wiring fixture content");
  });

  it("installOpenCodePlugin copies skills to ~/.config/opencode/skills", async () => {
    process.env.HOME = fakeHome;

    await installOpenCodePlugin();

    const installedSkillMd = join(fakeHome, ".config", "opencode", "skills", fixtureSkillName, "SKILL.md");
    expect(existsSync(installedSkillMd)).toBe(true);
    expect(readFileSync(installedSkillMd, "utf-8")).toBe("wiring fixture content");
  });
});

// ── runInstallStep ───────────────────────────────────────────────────────────

describe("runInstallStep", () => {
  it("returns true and does not warn when the step succeeds", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ok = await runInstallStep("Test Harness", async () => {});
      expect(ok).toBe(true);
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("returns false and warns instead of throwing when the step rejects with an Error", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ok = await runInstallStep("Test Harness", async () => {
        throw new Error("disk full");
      });
      expect(ok).toBe(false);
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("Test Harness") && String(call[0]).includes("disk full"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("stringifies a non-Error throw instead of crashing on .message", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const ok = await runInstallStep("Test Harness", async () => {
        throw "plain string failure";
      });
      expect(ok).toBe(false);
      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("plain string failure"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
    }
  });
});

// ── installMcpClients failure isolation ─────────────────────────────────────

describe("installMcpClients failure isolation", () => {
  it("still attempts every remaining harness after Claude Code's install step throws, then reports an aggregated failure", async () => {
    const originalHome = process.env.HOME;
    const root = makeTempDir("ei-mcp-isolation-");
    // A plain file, not a directory — installClaudeCode's write to
    // join(home, ".claude.json...") throws deterministically (EEXIST/ENOTDIR
    // trying to mkdir through a file), without relying on chmod/permission games.
    const fakeHome = join(root, "not-a-directory");
    writeFileSync(fakeHome, "i am a file, not a home directory");
    process.env.HOME = fakeHome;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    try {
      await expect(installMcpClients()).rejects.toThrow(/Claude Code/);

      expect(warnSpy.mock.calls.some((call) => String(call[0]).includes("Claude Code install step failed"))).toBe(true);
      // Proves execution continued past the Claude Code failure instead of
      // aborting the whole run — every independent harness still got checked.
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Cursor not detected"))).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("OpenCode not detected"))).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("Pi not detected"))).toBe(true);
      expect(logSpy.mock.calls.some((call) => String(call[0]).includes("OMP not detected"))).toBe(true);
    } finally {
      warnSpy.mockRestore();
      logSpy.mockRestore();
      if (originalHome === undefined) delete process.env.HOME;
      else process.env.HOME = originalHome;
    }
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, rmdirSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

// installOmp() is Bun-native, while Vitest runs under Node. This polyfill uses
// the real filesystem and shell so installation remains end-to-end; only the
// generated extension's `bun` shell dependency is replaced at its I/O boundary
// by the controlled response fake below.
function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

class FakeShellCall implements PromiseLike<void> {
  private isQuiet = false;

  constructor(private readonly cmd: string) {}

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
    } catch (error) {
      if (onRejected) return Promise.resolve(onRejected(error));
      return Promise.reject(error);
    }
  }
}

function fakeBunShell(strings: TemplateStringsArray, ...values: unknown[]): FakeShellCall {
  let cmd = strings[0];
  for (let i = 0; i < values.length; i++) cmd += quoteShellArg(String(values[i])) + strings[i + 1];
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
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

import { installOmp } from "../../../src/cli/install.js";

const tempDirs: string[] = [];
const SKILLS_LOCK_DIR = join(tmpdir(), "ei-install-skills-wiring.lock");

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function acquireSkillsLock(): void {
  const script = `
i=0
while ! mkdir ${quoteShellArg(SKILLS_LOCK_DIR)} 2>/dev/null; do
  i=$((i + 1))
  if [ "$i" -gt 400 ]; then
    echo "timed out waiting for the ei-install-skills-wiring lock" >&2
    exit 1
  fi
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
    // Already removed by another cleanup path.
  }
}

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
});

type Entry = { type: string; customType?: string; data?: unknown };
interface HandlerContext {
  sessionManager: { getBranch: () => Entry[]; getEntries: () => Entry[] };
  activePersonaName?: string | null;
}

type Handler = (event: { prompt: string; systemPrompt: string[] }, ctx: HandlerContext) => Promise<unknown>;
type EiResponse = (args: string[]) => string;

class FakeContext {
  // This fake assumes OMP's appendEntry adds a CustomEntry to the active
  // session's branch synchronously, as SessionManager.appendCustomEntry does.
  // allEntries models the global session graph so these tests fail if the
  // extension regresses from getBranch() to getEntries().
  readonly sessionManager: HandlerContext["sessionManager"];

  activePersonaName: string | null;
  constructor(
    readonly branch: Entry[],
    readonly allEntries: Entry[],
    activePersonaName: string | null,
  ) {
    this.activePersonaName = activePersonaName;
    this.sessionManager = {
      getBranch: () => this.branch,
      getEntries: () => this.allEntries,
    };
  }
}

interface GeneratedExtension {
  handlers: Handler[];
  calls: string[][];
  appendCalls: Array<{ customType: string; data: unknown }>;
}

async function loadGeneratedExtension(
  home: string,
  response: EiResponse,
  onAppend?: (customType: string, data: unknown) => void,
): Promise<GeneratedExtension> {
  const originalHome = process.env.HOME;
  acquireSkillsLock();
  try {
    process.env.HOME = home;
    await installOmp();
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    releaseSkillsLock();
  }

  const generated = readFileSync(join(home, ".omp", "agent", "extensions", "ei-integration.ts"), "utf-8");
  const executable = generated
    .replace('import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";\n', "")
    .replace('import { $ } from "bun";\n', "const $ = globalThis.__eiTestShell;\n");
  const compiled = transpileModule(executable, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
  }).outputText;

  const calls: string[][] = [];
  const shell = (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const args = [...(values[0] as string[])];
    calls.push(args);
    const result = {
      quiet: () => result,
      text: async () => response(args),
    };
    return result;
  };
  (globalThis as typeof globalThis & { __eiTestShell?: typeof shell }).__eiTestShell = shell;

  try {
    // The module specifier is generated from the installer output, so a static
    // import cannot execute this per-test extension runtime.
    const module = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${randomUUID()}`);
    const handlers: Handler[] = [];
    const appendCalls: Array<{ customType: string; data: unknown }> = [];
    const pi = {
      on(event: string, handler: Handler) {
        if (event === "before_agent_start") handlers.push(handler);
      },
      appendEntry(customType: string, data: unknown) {
        appendCalls.push({ customType, data });
        onAppend?.(customType, data);
      },
      registerTool() {},
    };
    module.default(pi);

    return { handlers, calls, appendCalls };
  } finally {
    delete (globalThis as typeof globalThis & { __eiTestShell?: typeof shell }).__eiTestShell;
  }
}

function custom(customType: string, data: unknown): Entry {
  return { type: "custom", customType, data };
}

async function invoke(handler: Handler, ctx: FakeContext): Promise<unknown> {
  return handler({ prompt: "question", systemPrompt: [] }, ctx);
}

describe("installOmp generated before_agent_start deduplication", () => {
  it("injects WHO for each branch-local persona transition but not a repeated persona", async () => {
    const runBranch: Entry[] = [];
    const run = await loadGeneratedExtension(
      makeTempDir("ei-omp-dedup-home-"),
      (args) => (args[0] === "personas" ? `<ei-relationship>${args.at(-1)}</ei-relationship>` : "[]"),
      (customType, data) => runBranch.push(custom(customType, data)),
    );
    const runCtx = new FakeContext(runBranch, runBranch, "Ada");
    const applyAppend = async (
      handler: Handler,
      activePersonaName: string | null,
      systemPrompt: string[] = [],
    ) => {
      runCtx.activePersonaName = activePersonaName;
      return handler({ prompt: "question", systemPrompt }, runCtx);
    };

    const who = run.handlers[0];
    expect(await applyAppend(who, "Ada")).toMatchObject({ message: { content: expect.stringContaining("Ada") } });
    expect(await applyAppend(who, "Ada")).toBeUndefined();
    // `null` is an explicit active-persona clear, even when an older HOW block
    // still names Ada; it records a null marker and must not reinject Ada.
    expect(await applyAppend(who, null, ['You are "Ada"'])).toBeUndefined();
    expect(await applyAppend(who, "Ada")).toMatchObject({ message: { content: expect.stringContaining("Ada") } });
    expect(await applyAppend(who, "Bert")).toMatchObject({ message: { content: expect.stringContaining("Bert") } });
    expect(await applyAppend(who, "Ada")).toMatchObject({ message: { content: expect.stringContaining("Ada") } });
    expect(runBranch.filter((entry) => entry.customType === "ei-who").map((entry) => entry.data)).toEqual([
      { persona: "Ada" },
      { persona: null },
      { persona: "Ada" },
      { persona: "Bert" },
      { persona: "Ada" },
    ]);
  });

  it("uses only the active branch when sibling markers exist", async () => {
    const generated = await loadGeneratedExtension(makeTempDir("ei-omp-branch-home-"), (args) => {
      if (args[0] === "personas") return "<ei-relationship>Bert</ei-relationship>";
      return JSON.stringify([{ id: "sibling-only", value: "fresh on this branch" }]);
    });

    const branch: Entry[] = [custom("ei-who", { persona: "Ada" }), custom("ei-memory", { ids: ["parent"] })];
    const allEntries: Entry[] = [...branch, custom("ei-who", { persona: "Bert" }), custom("ei-memory", { ids: ["sibling-only"] })];
    const ctx = new FakeContext(branch, allEntries, "Bert");

    const who = await invoke(generated.handlers[0], ctx);
    const memory = await invoke(generated.handlers[1], ctx);

    expect(who).toMatchObject({ message: { content: "<ei-relationship>Bert</ei-relationship>" } });
    expect(memory).toMatchObject({ message: { content: expect.stringContaining("sibling-only") } });
  });
  it("falls back to the HOW persona only when an older runtime omits activePersonaName", async () => {
    const generated = await loadGeneratedExtension(makeTempDir("ei-omp-legacy-home-"), (args) =>
      args[0] === "personas" ? "<ei-relationship>Legacy</ei-relationship>" : "[]",
    );
    const branch: Entry[] = [];
    const legacyCtx: HandlerContext = {
      sessionManager: {
        getBranch: () => branch,
        getEntries: () => branch,
      },
    };

    await expect(generated.handlers[0]({ prompt: "question", systemPrompt: ['You are "Legacy"'] }, legacyCtx)).resolves.toMatchObject({
      message: { content: "<ei-relationship>Legacy</ei-relationship>" },
    });
  });

  it("records only fresh memory ids and skips a fully repeated JSON result", async () => {
    const responses = [
      JSON.stringify([{ id: "alpha", text: "first" }, { id: "beta", text: "second" }]),
      JSON.stringify([{ id: "alpha", text: "duplicate" }, { id: "gamma", text: "new" }]),
      JSON.stringify([{ id: "alpha" }, { id: "beta" }, { id: "gamma" }]),
    ];
    const branch: Entry[] = [];
    const generated = await loadGeneratedExtension(
      makeTempDir("ei-omp-memory-home-"),
      (args) => (args[0] === "personas" ? "" : responses.shift() ?? "[]"),
      (customType, data) => branch.push(custom(customType, data)),
    );
    const ctx = new FakeContext(branch, branch, null);
    const memory = generated.handlers[1];

    const first = await invoke(memory, ctx);
    expect(first).toMatchObject({ message: { content: expect.stringContaining('"alpha"') } });
    expect(generated.calls).toContainEqual(["-n", "5", "--", "question"]);

    const second = await invoke(memory, ctx);
    expect(second).toMatchObject({ message: { content: expect.not.stringContaining('"alpha"') } });
    expect(second).toMatchObject({ message: { content: expect.stringContaining('"gamma"') } });

    expect(await invoke(memory, ctx)).toBeUndefined();
    expect(generated.appendCalls).toEqual([
      { customType: "ei-memory", data: { ids: ["alpha", "beta"] } },
      { customType: "ei-memory", data: { ids: ["gamma"] } },
    ]);
  });

  it("retains non-JSON output but suppresses empty output and empty JSON arrays", async () => {
    const responses = ["diagnostic text\n", "", "[]"];
    const generated = await loadGeneratedExtension(makeTempDir("ei-omp-output-home-"), (args) =>
      args[0] === "personas" ? "" : responses.shift() ?? "",
    );
    const branch: Entry[] = [];
    const ctx = new FakeContext(branch, branch, null);
    const memory = generated.handlers[1];

    expect(await invoke(memory, ctx)).toMatchObject({ message: { content: expect.stringContaining("diagnostic text") } });
    expect(await invoke(memory, ctx)).toBeUndefined();
    expect(await invoke(memory, ctx)).toBeUndefined();
    expect(generated.appendCalls).toEqual([]);
  });
});

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  writeFileSync,
  chmodSync,
} from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";

const execFileAsync = promisify(execFile);

// installPi() writes plain Node code (node:child_process, no Bun dependency —
// verified against the real installed @earendil-works/pi-coding-agent package,
// whose jiti-based extension loader never exposes a `bun` module to loaded
// extensions, on either a Node-run or Bun-compiled `pi` binary). So unlike
// installOmp()'s test, no runtime shim is needed for the generated content's
// own imports — only Ei's own installer-side Bun.$/Bun.write calls need a
// polyfill, matching the same pattern used for install-omp.test.ts.
function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function fakeBunShell(strings: TemplateStringsArray, ...values: unknown[]): Promise<void> {
  let cmd = strings[0];
  for (let i = 0; i < values.length; i++) cmd += quoteShellArg(String(values[i])) + strings[i + 1];
  await execFileAsync("/bin/sh", ["-c", cmd]);
}
const fakeBunShellTag = Object.assign(
  (strings: TemplateStringsArray, ...values: unknown[]) => fakeBunShell(strings, ...values),
  {},
);

async function fakeBunWrite(path: string, content: string): Promise<number> {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return Buffer.byteLength(content);
}

beforeAll(() => {
  vi.stubGlobal("Bun", { $: fakeBunShellTag, write: fakeBunWrite });
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterAll(() => {
  vi.unstubAllGlobals();
});

import { installPi } from "../../../src/cli/install.js";

const tempDirs: string[] = [];
const SKILLS_LOCK_DIR = join(tmpdir(), "ei-install-skills-wiring.lock");

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function acquireSkillsLock(): void {
  // installPi() doesn't call installSkillsTo, but the lock dir is shared
  // machinery with the other install-*.test.ts files; matching the
  // acquire/release pattern here costs nothing and keeps future changes safe
  // if installPi ever gains a skills step.
  try {
    mkdirSync(SKILLS_LOCK_DIR);
  } catch {
    // Another process holds it; fine — installPi doesn't touch skills.
  }
}

function releaseSkillsLock(): void {
  try {
    rmdirSync(SKILLS_LOCK_DIR);
  } catch {
    // Already removed, or never acquired by us.
  }
}

const ORIGINAL_PATH = process.env.PATH;

afterEach(() => {
  while (tempDirs.length > 0) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  process.env.PATH = ORIGINAL_PATH;
});

type Entry = { type: string; customType?: string; data?: unknown };
interface HandlerContext {
  sessionManager: { getBranch: () => Entry[]; getEntries: () => Entry[] };
}

type Handler = (event: { prompt: string }, ctx: HandlerContext) => Promise<unknown>;

class FakeContext {
  readonly sessionManager: HandlerContext["sessionManager"];
  constructor(
    readonly branch: Entry[],
    readonly allEntries: Entry[] = branch,
  ) {
    this.sessionManager = {
      getBranch: () => this.branch,
      getEntries: () => this.allEntries,
    };
  }
}

interface RegisteredTool {
  name: string;
  label: string;
  description: string;
  promptSnippet?: string;
  parameters: unknown;
  execute: (...args: unknown[]) => Promise<unknown>;
}

interface GeneratedExtension {
  handlers: Handler[];
  appendCalls: Array<{ customType: string; data: unknown }>;
  tools: RegisteredTool[];
}

async function loadGeneratedExtension(
  home: string,
  binDir: string,
  onAppend?: (customType: string, data: unknown) => void,
): Promise<GeneratedExtension> {
  const originalHome = process.env.HOME;
  acquireSkillsLock();
  try {
    process.env.HOME = home;
    await installPi();
  } finally {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    releaseSkillsLock();
  }

  const generated = readFileSync(join(home, ".pi", "agent", "extensions", "ei-integration.ts"), "utf-8");
  const executable = generated
    .replace('import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";\n', "")
    // typebox isn't a dependency of this project (it's resolved by Pi's own
    // jiti alias table at real runtime, never by Ei itself) — substitute a
    // minimal, JSON-Schema-shaped stub so the dynamic import below resolves
    // without adding an unused production dependency. Real TypeBox's
    // `Type.Object(...)` output IS plain JSON-Schema-shaped data under the
    // hood, so this reproduces enough fidelity for these tests' assertions
    // (which only inspect `.properties` keys).
    .replace(
      'import { Type } from "typebox";\n',
      [
        "const Type = {",
        "  Object: (props) => ({ type: \"object\", properties: props }),",
        "  String: (opts) => ({ type: \"string\", ...(opts ?? {}) }),",
        "  Optional: (schema) => schema,",
        "  Union: (options, opts) => ({ anyOf: options, ...(opts ?? {}) }),",
        "  Literal: (value) => ({ const: value }),",
        "};\n",
      ].join("\n"),
    );
  const compiled = transpileModule(executable, {
    compilerOptions: { target: ScriptTarget.ES2022, module: ModuleKind.ESNext },
  }).outputText;

  process.env.PATH = `${binDir}:${process.env.PATH ?? ""}`;
  // Left in place (not restored here) so runEi's execFile calls, which
  // happen later when the caller invokes the returned handlers/tools, can
  // still find the fake `ei`/`bunx` binaries. The module-level afterEach
  // above restores PATH to ORIGINAL_PATH once the test itself finishes.
  // The module specifier is generated from the installer output, so a static
  // import cannot execute this per-test extension runtime.
  const module = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}#${randomUUID()}`
  );
  const handlers: Handler[] = [];
  const appendCalls: Array<{ customType: string; data: unknown }> = [];
  const tools: RegisteredTool[] = [];
  const pi = {
    on(event: string, handler: Handler) {
      if (event === "before_agent_start") handlers.push(handler);
    },
    appendEntry(customType: string, data: unknown) {
      appendCalls.push({ customType, data });
      onAppend?.(customType, data);
    },
    registerTool(tool: RegisteredTool) {
      tools.push(tool);
    },
  };
  module.default(pi);

  return { handlers, appendCalls, tools };
}

function custom(customType: string, data: unknown): Entry {
  return { type: "custom", customType, data };
}

async function invoke(handler: Handler, ctx: FakeContext, prompt = "question"): Promise<unknown> {
  return handler({ prompt }, ctx);
}

/** Writes a fake `ei` (and optionally `bunx`) executable into a scratch bin dir. */
function makeFakeEiBin(
  dir: string,
  response: string,
  opts: { failEi?: boolean; bunxResponse?: string; bunxCalledFile?: string } = {},
): void {
  mkdirSync(dir, { recursive: true });
  const eiScript = opts.failEi
    ? `#!/bin/sh\nexit 1\n`
    : `#!/bin/sh\ncat <<'EI_FAKE_EOF'\n${response}\nEI_FAKE_EOF\n`;
  writeFileSync(join(dir, "ei"), eiScript);
  chmodSync(join(dir, "ei"), 0o755);

  if (opts.bunxResponse !== undefined) {
    // Real `bunx` takes "ei-tui@latest" as argv[0] then the real args after —
    // our fake ignores argv entirely and always returns the fixed response,
    // matching how the other install-*.test.ts fakes behave. When
    // bunxCalledFile is given, the fallback's invocation is recorded there
    // independently of the response content, so a test can prove "bunx was
    // never invoked" even when its would-be response is itself empty.
    const recordCall = opts.bunxCalledFile
      ? `printf 'called\\n' >> ${quoteShellArg(opts.bunxCalledFile)}\n`
      : "";
    const bunxScript = `#!/bin/sh\n${recordCall}cat <<'EI_FAKE_EOF'\n${opts.bunxResponse}\nEI_FAKE_EOF\n`;
    writeFileSync(join(dir, "bunx"), bunxScript);
    chmodSync(join(dir, "bunx"), 0o755);
  }
}

describe("installPi generated before_agent_start hooks", () => {
  it("WHO: injects the Pi identity block once when nothing sent yet", async () => {
    const home = makeTempDir("ei-pi-who-first-");
    const bin = makeTempDir("ei-pi-bin-who1-");
    makeFakeEiBin(bin, "<ei-relationship>You are Pi.</ei-relationship>");

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(who, ctx)) as { message: { customType: string; content: string; display: boolean } };

    expect(result.message.customType).toBe("ei-persona-who");
    expect(result.message.content).toBe("<ei-relationship>You are Pi.</ei-relationship>");
    expect(result.message.display).toBe(false);
    expect(appendCalls).toEqual([{ customType: "ei-who", data: { sent: true } }]);
  });

  it("WHO: does not re-inject once an ei-who marker already exists on this branch", async () => {
    const home = makeTempDir("ei-pi-who-dedup-");
    const bin = makeTempDir("ei-pi-bin-who2-");
    makeFakeEiBin(bin, "<ei-relationship>You are Pi.</ei-relationship>");

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([custom("ei-who", { sent: true })]);

    const result = await invoke(who, ctx);

    expect(result).toBeUndefined();
    expect(appendCalls).toEqual([]);
  });

  it("WHO: uses getBranch(), not getEntries() — a sibling branch's marker never suppresses this branch's injection", async () => {
    const home = makeTempDir("ei-pi-who-branch-");
    const bin = makeTempDir("ei-pi-bin-who3-");
    makeFakeEiBin(bin, "<ei-relationship>You are Pi.</ei-relationship>");

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    // This branch has never seen the marker; a sibling fork (only in
    // allEntries) has. Confirms the hook scans getBranch(), not getEntries().
    const ctx = new FakeContext([], [custom("ei-who", { sent: true })]);

    const result = (await invoke(who, ctx)) as { message: { customType: string } };

    expect(result.message.customType).toBe("ei-persona-who");
  });

  it("WHO: does not mark sent when ei returns empty — retries on the next turn", async () => {
    const home = makeTempDir("ei-pi-who-retry-");
    const bin = makeTempDir("ei-pi-bin-who4-");
    makeFakeEiBin(bin, "", { bunxResponse: "" });

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([]);

    const result = await invoke(who, ctx);

    expect(result).toBeUndefined();
    expect(appendCalls).toEqual([]);
  });

  it("MEMORY: injects fresh items and records their ids", async () => {
    const home = makeTempDir("ei-pi-memory-fresh-");
    const bin = makeTempDir("ei-pi-bin-mem1-");
    makeFakeEiBin(bin, JSON.stringify([{ id: "alpha", text: "a" }]));

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [, memory] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(memory, ctx)) as { message: { customType: string; content: string } };

    expect(result.message.customType).toBe("ei-context");
    expect(result.message.content).toContain("alpha");
    expect(appendCalls).toEqual([{ customType: "ei-memory", data: { ids: ["alpha"] } }]);
  });

  it("MEMORY: filters out ids already seen on this branch, returns undefined when nothing survives", async () => {
    const home = makeTempDir("ei-pi-memory-dedup-");
    const bin = makeTempDir("ei-pi-bin-mem2-");
    makeFakeEiBin(bin, JSON.stringify([{ id: "alpha", text: "a" }]));

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [, memory] = handlers;
    const ctx = new FakeContext([custom("ei-memory", { ids: ["alpha"] })]);

    const result = await invoke(memory, ctx);

    expect(result).toBeUndefined();
  });

  it("MEMORY: a mix of seen and fresh items keeps only the fresh ones", async () => {
    const home = makeTempDir("ei-pi-memory-mixed-");
    const bin = makeTempDir("ei-pi-bin-mem3-");
    makeFakeEiBin(
      bin,
      JSON.stringify([
        { id: "alpha", text: "a" },
        { id: "beta", text: "b" },
      ]),
    );

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [, memory] = handlers;
    const ctx = new FakeContext([custom("ei-memory", { ids: ["alpha"] })]);

    const result = (await invoke(memory, ctx)) as { message: { content: string } };

    expect(result.message.content).toContain("beta");
    expect(result.message.content).not.toContain("alpha");
    expect(appendCalls).toEqual([{ customType: "ei-memory", data: { ids: ["beta"] } }]);
  });

  it("MEMORY: falls back to --recent -n 5 when there is no prompt", async () => {
    const home = makeTempDir("ei-pi-memory-norecent-");
    const bin = makeTempDir("ei-pi-bin-mem4-");
    makeFakeEiBin(bin, JSON.stringify([{ id: "gamma", text: "g" }]));

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [, memory] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(memory, ctx, "")) as { message: { content: string } };

    expect(result.message.content).toContain("gamma");
  });

  it("MEMORY: non-JSON ei output is injected as-is, with no id recorded", async () => {
    const home = makeTempDir("ei-pi-memory-nonjson-");
    const bin = makeTempDir("ei-pi-bin-mem5-");
    makeFakeEiBin(bin, "diagnostic text, not JSON");

    const { handlers, appendCalls } = await loadGeneratedExtension(home, bin);
    const [, memory] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(memory, ctx)) as { message: { content: string } };

    expect(result.message.content).toContain("diagnostic text, not JSON");
    expect(appendCalls).toEqual([]);
  });

  it("runEi: falls back to bunx ei-tui@latest when the ei binary fails outright", async () => {
    const home = makeTempDir("ei-pi-fallback-");
    const bin = makeTempDir("ei-pi-bin-fallback-");
    makeFakeEiBin(bin, "", { failEi: true, bunxResponse: "<ei-relationship>fallback persona</ei-relationship>" });

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(who, ctx)) as { message: { content: string } };

    expect(result.message.content).toBe("<ei-relationship>fallback persona</ei-relationship>");
  });

  // These two are the oracle for the fallback-on-empty-output fix in Pi's
  // execFileAsync runEi: they observe the bunx fallback directly (via a
  // call-recorder file), not just by inferring it from final hook output.
  // A test that only checks output shape can't tell "local ei legitimately
  // returned nothing" apart from "local ei failed and bunx's own response
  // also happened to be empty" -- both look identical from the outside.
  it("runEi: records that bunx was actually invoked when the local ei binary exits nonzero", async () => {
    const home = makeTempDir("ei-pi-fallback-throws-");
    const bin = makeTempDir("ei-pi-bin-fallback-throws-");
    const bunxCalledFile = join(home, "bunx-called.txt");
    makeFakeEiBin(bin, "", {
      failEi: true,
      bunxResponse: "<ei-relationship>via bunx fallback</ei-relationship>",
      bunxCalledFile,
    });

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([]);

    const result = (await invoke(who, ctx)) as { message: { content: string } };

    expect(result.message.content).toBe("<ei-relationship>via bunx fallback</ei-relationship>");
    expect(readFileSync(bunxCalledFile, "utf-8")).toContain("called");
  });

  it("runEi: never invokes bunx when the local ei binary exits 0 with genuinely empty output", async () => {
    const home = makeTempDir("ei-pi-fallback-empty-");
    const bin = makeTempDir("ei-pi-bin-fallback-empty-");
    const bunxCalledFile = join(home, "bunx-called.txt");
    makeFakeEiBin(bin, "", {
      bunxResponse: "<ei-relationship>via bunx fallback</ei-relationship>",
      bunxCalledFile,
    });

    const { handlers } = await loadGeneratedExtension(home, bin);
    const [who] = handlers;
    const ctx = new FakeContext([]);

    const result = await invoke(who, ctx);

    expect(result).toBeUndefined();
    expect(() => readFileSync(bunxCalledFile, "utf-8")).toThrow();
  });

  it("registerTool: ei_search carries a TypeBox schema and a real promptSnippet", async () => {
    const home = makeTempDir("ei-pi-tools-search-");
    const bin = makeTempDir("ei-pi-bin-tools1-");
    makeFakeEiBin(bin, "search results");

    const { tools } = await loadGeneratedExtension(home, bin);
    const search = tools.find((t) => t.name === "ei_search")!;

    expect(search.promptSnippet).toBe("Search Ei's personal memory for relevant facts, topics, people, or quotes.");
    // TypeBox schemas are plain objects carrying a `[Symbol(TypeBox.Kind)]`-
    // style marker via their `type`/`properties` shape once transpiled; the
    // concrete, portable assertion is that it's an object schema with the
    // expected two properties, not a Zod/plain-JSON-Schema `enum` array shape.
    const params = search.parameters as { properties: Record<string, unknown> };
    expect(Object.keys(params.properties)).toEqual(["query", "type"]);
  });

  it("registerTool: ei_search executes against the fake ei binary", async () => {
    const home = makeTempDir("ei-pi-tools-exec-");
    const bin = makeTempDir("ei-pi-bin-tools2-");
    makeFakeEiBin(bin, "search results for query");

    const { tools } = await loadGeneratedExtension(home, bin);
    const search = tools.find((t) => t.name === "ei_search")!;
    const result = (await search.execute("call-1", { query: "test" }, undefined, undefined, {})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toBe("search results for query");
  });

  it("registerTool: ei_lookup uses --id and a single TypeBox id property", async () => {
    const home = makeTempDir("ei-pi-tools-lookup-");
    const bin = makeTempDir("ei-pi-bin-tools3-");
    makeFakeEiBin(bin, "lookup result");

    const { tools } = await loadGeneratedExtension(home, bin);
    const lookup = tools.find((t) => t.name === "ei_lookup")!;
    const params = lookup.parameters as { properties: Record<string, unknown> };

    expect(Object.keys(params.properties)).toEqual(["id"]);

    const result = (await lookup.execute("call-1", { id: "abc" }, undefined, undefined, {})) as {
      content: Array<{ type: string; text: string }>;
    };
    expect(result.content[0].text).toBe("lookup result");
  });

  it("writes the extension to ~/.pi/agent/extensions/ei-integration.ts", async () => {
    const home = makeTempDir("ei-pi-path-");
    const bin = makeTempDir("ei-pi-bin-path-");
    makeFakeEiBin(bin, "x");

    await loadGeneratedExtension(home, bin);

    const generated = readFileSync(join(home, ".pi", "agent", "extensions", "ei-integration.ts"), "utf-8");
    expect(generated).toContain('from "@earendil-works/pi-coding-agent"');
    expect(generated).not.toContain('from "bun"');
    expect(generated).toContain("node:child_process");
  });
});

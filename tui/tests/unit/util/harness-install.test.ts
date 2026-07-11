import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { mkdtemp, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

// Swap out src/cli/install.ts's installMcpClients with a test-controlled
// stub. Registered BEFORE importing harness-install.ts (which imports the
// real module) so every load of the specifier resolves to this mock, not
// the real installer. `../../../../src/cli/install` is a project-local
// module (not a Node builtin) — nothing else in this package's `bun test`
// run imports `src/cli/install`, so there is nothing else in the same
// process for this particular mock to leak into.
//
// IMPORTANT (found while writing this test — see notepad issues.md): the
// FIRST version of this mock used the wrong relative depth
// ("../../../src/cli/install", one `..` short) — it resolved to a
// nonexistent tui/src/cli/install, so Bun silently left the REAL
// specifier un-mocked and every test call actually ran the production
// installMcpClients() against this machine's real ~/.claude,
// ~/.codex, ~/.config/opencode, ~/.pi, ~/.omp, ~/.agents/skills. Those
// installers are idempotent/overwrite-only and happened to target this
// same Ei checkout, so it was a no-op in effect, but it was NOT
// hermetic. Always sanity-check a new mock.module() specifier resolves
// to the intended absolute file (e.g. by temporarily asserting on a
// call counter) before trusting it silently "just worked" because the
// suite went green.
let installImpl: () => Promise<void> = async () => {};
mock.module("../../../../src/cli/install", () => ({
  installMcpClients: () => installImpl(),
}));

// Self-mock the logger too, matching the shape editor.test.ts / layout.test.tsx
// already use elsewhere in this suite (logger/default/clearLog no-ops) so this
// file behaves identically whether run alone or as part of the full `bun test`
// batch. bun:test's mock.module() replaces a module in the GLOBAL registry for
// the rest of the PROCESS, not just this file (confirmed independently here:
// running this file alongside editor.test.ts, whose mock.module() call on this
// same "../../../src/util/logger" specifier runs first alphabetically and stubs
// interceptConsole to a true no-op, made this file's own
// "interception actually changes console" assertion silently vacuous — it
// inherited editor.test.ts's no-op instead of the real logger). Re-registering
// our OWN factory here (last call for this specifier wins, applied at this
// file's own import time) makes this file immune to that ordering, in either
// direction — see learnings.md for the writeup.
//
// Unlike the pure no-ops elsewhere, THIS interceptConsole is functionally real
// (it reassigns console.log/warn/error/debug/info to fresh wrapper closures
// that still delegate to the current implementation) — a true no-op would
// leave console references untouched, making the "runHarnessInstall restores
// console by identity" assertions below pass trivially even with a broken
// restore path in harness-install.ts itself. It just skips the real logger's
// disk-writing (writeLogSync/appendFileSync) side effect, which is the only
// part any sibling test file relies on being suppressed.
mock.module("../../../src/util/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  default: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
  clearLog: () => {},
  rotateLog: () => {},
  interceptConsole: () => {
    const log = console.log;
    const warn = console.warn;
    const error = console.error;
    const debug = console.debug;
    const info = console.info;
    console.log = (...args: unknown[]) => log(...args);
    console.warn = (...args: unknown[]) => warn(...args);
    console.error = (...args: unknown[]) => error(...args);
    console.debug = (...args: unknown[]) => debug(...args);
    console.info = (...args: unknown[]) => info(...args);
  },
}));

import { runHarnessInstall, stampInstalled } from "../../../src/util/harness-install";
import { getInstalledVersion } from "../../../src/util/local-state";

describe("runHarnessInstall", () => {
  beforeEach(() => {
    installImpl = async () => {};
  });

  it("intercepts console during install and restores the exact original functions after success", async () => {
    const beforeLog = console.log;
    const beforeWarn = console.warn;
    const beforeError = console.error;
    const beforeDebug = console.debug;
    const beforeInfo = console.info;

    let duringLog: typeof console.log | undefined;
    installImpl = async () => {
      // Captured from inside the mocked install step — proves interception
      // is already active BEFORE installMcpClients() runs, not just at some
      // point during runHarnessInstall().
      duringLog = console.log;
    };

    const result = await runHarnessInstall();

    expect(result).toEqual({ ok: true, failures: [] });
    expect(duringLog).not.toBe(beforeLog);
    // Identity, not just behavior: these must be the SAME function
    // references as before, not merely "console.log exists and logs".
    expect(console.log).toBe(beforeLog);
    expect(console.warn).toBe(beforeWarn);
    expect(console.error).toBe(beforeError);
    expect(console.debug).toBe(beforeDebug);
    expect(console.info).toBe(beforeInfo);
  });

  it("restores console by identity and returns {ok:false, failures:[...]} when installMcpClients throws its aggregate error", async () => {
    const beforeLog = console.log;
    const beforeWarn = console.warn;
    const beforeError = console.error;

    installImpl = async () => {
      throw new Error("2 integration(s) failed to install: Claude Code, Codex. See warnings above for details.");
    };

    const result = await runHarnessInstall();

    expect(result).toEqual({ ok: false, failures: ["Claude Code", "Codex"] });
    expect(console.log).toBe(beforeLog);
    expect(console.warn).toBe(beforeWarn);
    expect(console.error).toBe(beforeError);
  });

  it("parses a single-integration aggregate failure into a one-element failures array", async () => {
    installImpl = async () => {
      throw new Error("1 integration(s) failed to install: Cursor. See warnings above for details.");
    };

    const result = await runHarnessInstall();

    expect(result).toEqual({ ok: false, failures: ["Cursor"] });
  });

  it("falls back to the raw error message when the thrown error doesn't match the aggregate shape", async () => {
    installImpl = async () => {
      throw new Error("boom, unrelated failure");
    };

    const result = await runHarnessInstall();

    expect(result).toEqual({ ok: false, failures: ["boom, unrelated failure"] });
  });

  it("never throws — even a non-Error rejection resolves to {ok:false}, with console restored", async () => {
    const beforeWarn = console.warn;
    installImpl = async () => {
      // Exercises the defensive non-Error-instance branch of
      // runHarnessInstall's catch (e.g. a thrown string).
      throw "raw string rejection";
    };

    // If runHarnessInstall() let this escape, `await` here would reject
    // instead of resolve, failing the test outright — and Bun would
    // additionally surface an unhandled rejection warning for the
    // untracked installMcpClients() promise.
    await expect(runHarnessInstall()).resolves.toEqual({
      ok: false,
      failures: ["raw string rejection"],
    });
    expect(console.warn).toBe(beforeWarn);
  });
});

describe("stampInstalled", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await mkdtemp(join(tmpdir(), "ei-harness-install-stamp-test-"));
  });

  afterEach(async () => {
    await rm(dataPath, { recursive: true, force: true });
  });

  it("delegates to local-state.ts's setInstalledVersion, stamping installed_version", async () => {
    await stampInstalled(dataPath, "1.9.0");
    expect(await getInstalledVersion(dataPath)).toBe("1.9.0");
  });

  it("a later stamp overwrites the previous version (read-merge-write, not a fresh file)", async () => {
    await stampInstalled(dataPath, "1.9.0");
    await stampInstalled(dataPath, "1.10.0");
    expect(await getInstalledVersion(dataPath)).toBe("1.10.0");
  });
});

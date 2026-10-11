import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const coreDir = resolve(here, "../../../src/core");
const leafPath = resolve(coreDir, "types/tool-calls.ts");

// Enumerated from the directory at test time so a direct handler import (not
// only the handlers barrel) is caught.
const handlerFiles = readdirSync(resolve(coreDir, "handlers"))
  .filter((f) => f.endsWith(".ts"))
  .map((f) => resolve(coreDir, "handlers", f));

function throwOnImport(label: string) {
  return () => {
    throw new Error(`leaf imported forbidden module: ${label}`);
  };
}

describe("TOOLS_RAN_NO_REPLY_SILENCE_REASON leaf module isolation", () => {
  beforeEach(() => {
    vi.resetModules();
    expect(handlerFiles.length).toBeGreaterThan(0);
    vi.doMock(resolve(coreDir, "processor.ts"), throwOnImport("processor"));
    vi.doMock(resolve(coreDir, "queue-processor.ts"), throwOnImport("queue-processor"));
    for (const file of handlerFiles) {
      vi.doMock(file, throwOnImport(file));
    }
    for (const builtin of ["node:fs", "node:path", "node:os"]) {
      vi.doMock(builtin, throwOnImport(builtin));
    }
  });

  afterEach(() => {
    vi.doUnmock(resolve(coreDir, "processor.ts"));
    vi.doUnmock(resolve(coreDir, "queue-processor.ts"));
    for (const file of handlerFiles) vi.doUnmock(file);
    for (const builtin of ["node:fs", "node:path", "node:os"]) vi.doUnmock(builtin);
    vi.resetModules();
  });

  it("imports alone, with processor, queue-processor, every handler and node:fs/path/os set to throw on import", async () => {
    // Dynamic import is required: the module must load after the doMock calls above (a static import would hoist and bypass them).
    const mod = await import(leafPath);
    expect(typeof mod.TOOLS_RAN_NO_REPLY_SILENCE_REASON).toBe("string");
    expect(mod.TOOLS_RAN_NO_REPLY_SILENCE_REASON.length).toBeGreaterThan(0);
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// The installer itself is mocked: it writes to the real home directory and
// shares the repo's skills/ with the install-* suites. What is under test is
// the `ei --install` contract around it: stamp on success only.
const installMcpClients = vi.fn<() => Promise<void>>();
vi.mock("../../../src/cli/install.js", () => ({
  installMcpClients: () => installMcpClients(),
}));

import { installAndStamp } from "../../../src/cli/install-and-stamp.js";

let dataDir: string;
let previousDataPath: string | undefined;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "ei-install-and-stamp-"));
  previousDataPath = process.env.EI_DATA_PATH;
  process.env.EI_DATA_PATH = dataDir;
  installMcpClients.mockReset();
});

afterEach(() => {
  if (previousDataPath === undefined) delete process.env.EI_DATA_PATH;
  else process.env.EI_DATA_PATH = previousDataPath;
  rmSync(dataDir, { recursive: true, force: true });
});

const localJson = () => JSON.parse(readFileSync(join(dataDir, "local.json"), "utf-8")) as Record<string, unknown>;

describe("ei --install stamping", () => {
  it("stamps installed_version in $EI_DATA_PATH/local.json after a successful install, preserving other keys", async () => {
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ keep_me: "yes", installed_version: "0.0.1" }));
    installMcpClients.mockResolvedValue(undefined);

    await installAndStamp("9.8.7");

    expect(installMcpClients).toHaveBeenCalledTimes(1);
    expect(localJson()).toEqual({ keep_me: "yes", installed_version: "9.8.7" });
  });

  it("creates local.json when the install succeeds and none exists", async () => {
    installMcpClients.mockResolvedValue(undefined);
    await installAndStamp("9.8.7");
    expect(localJson()).toEqual({ installed_version: "9.8.7" });
  });

  it("propagates the aggregate failure and leaves a stale stamp untouched", async () => {
    writeFileSync(join(dataDir, "local.json"), JSON.stringify({ installed_version: "0.0.1" }));
    installMcpClients.mockRejectedValue(new Error("1 integration(s) failed to install: cursor. See warnings above for details."));

    await expect(installAndStamp("9.8.7")).rejects.toThrow(/failed to install: cursor/);

    expect(localJson()).toEqual({ installed_version: "0.0.1" });
  });

  it("does not create local.json when the install fails and no stamp existed", async () => {
    installMcpClients.mockRejectedValue(new Error("1 integration(s) failed to install: codex. See warnings above for details."));

    await expect(installAndStamp("9.8.7")).rejects.toThrow();

    expect(existsSync(join(dataDir, "local.json"))).toBe(false);
  });
});

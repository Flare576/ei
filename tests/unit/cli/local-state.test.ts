import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readdir, readFile, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import {
  readLocalState,
  writeLocalState,
  getInstalledVersion,
  setInstalledVersion,
  type LocalState,
} from "../../../src/cli/local-state.js";

describe("local-state", () => {
  let dataPath: string;

  beforeEach(async () => {
    dataPath = await mkdtemp(join(tmpdir(), "ei-local-state-test-"));
  });

  afterEach(async () => {
    await rm(dataPath, { recursive: true, force: true });
  });

  describe("readLocalState", () => {
    it("returns {} when local.json does not exist", async () => {
      const state = await readLocalState(dataPath);
      expect(state).toEqual({});
    });

    it("returns {} when the data directory itself does not exist", async () => {
      const state = await readLocalState(join(dataPath, "nested", "missing"));
      expect(state).toEqual({});
    });

    it("returns {} (never throws) on corrupt JSON", async () => {
      await writeFile(join(dataPath, "local.json"), "{ not: valid json ][");
      const state = await readLocalState(dataPath);
      expect(state).toEqual({});
    });

    it("reads back a valid file", async () => {
      await writeFile(join(dataPath, "local.json"), JSON.stringify({ installed_version: "1.2.3" }));
      const state = await readLocalState(dataPath);
      expect(state).toEqual({ installed_version: "1.2.3" });
    });
  });

  describe("writeLocalState", () => {
    it("write then read round-trips", async () => {
      await writeLocalState(dataPath, { installed_version: "2.0.0" });
      const state = await readLocalState(dataPath);
      expect(state).toEqual({ installed_version: "2.0.0" });
    });

    it("creates the data directory (including nested parents) if missing", async () => {
      const nested = join(dataPath, "a", "b", "c");
      await writeLocalState(nested, { installed_version: "9.9.9" });
      const state = await readLocalState(nested);
      expect(state).toEqual({ installed_version: "9.9.9" });
    });

    it("a partial patch preserves unrelated keys already on disk", async () => {
      // Write a raw JSON file with a key outside the typed LocalState shape,
      // proving the merge is read-current+spread, not a blind overwrite.
      await writeFile(join(dataPath, "local.json"), JSON.stringify({ a: 1 }));

      await writeLocalState(dataPath, { installed_version: "3.1.4" } as Partial<LocalState>);

      const raw = JSON.parse(await readFile(join(dataPath, "local.json"), "utf-8")) as Record<string, unknown>;
      expect(raw.a).toBe(1);
      expect(raw.installed_version).toBe("3.1.4");
    });

    it("a later patch overrides a matching key while leaving others intact", async () => {
      await writeFile(join(dataPath, "local.json"), JSON.stringify({ a: 1, installed_version: "0.0.1" }));
      await writeLocalState(dataPath, { installed_version: "0.0.2" });

      const raw = JSON.parse(await readFile(join(dataPath, "local.json"), "utf-8")) as Record<string, unknown>;
      expect(raw.a).toBe(1);
      expect(raw.installed_version).toBe("0.0.2");
    });

    it("leaves only local.json behind — no temp files remain after the atomic write", async () => {
      await writeLocalState(dataPath, { installed_version: "5.5.5" });
      await writeLocalState(dataPath, { installed_version: "5.5.6" });

      expect(await readdir(dataPath)).toEqual(["local.json"]);
      expect(await readLocalState(dataPath)).toEqual({ installed_version: "5.5.6" });
    });
  });

  describe("getInstalledVersion / setInstalledVersion", () => {
    it("getInstalledVersion returns undefined when nothing is stamped", async () => {
      expect(await getInstalledVersion(dataPath)).toBeUndefined();
    });

    it("setInstalledVersion stamps a version readable via getInstalledVersion", async () => {
      await setInstalledVersion(dataPath, "1.8.0");
      expect(await getInstalledVersion(dataPath)).toBe("1.8.0");
    });

    it("setInstalledVersion preserves unrelated keys written directly to disk", async () => {
      await writeFile(join(dataPath, "local.json"), JSON.stringify({ some_future_key: "keep-me" }));
      await setInstalledVersion(dataPath, "1.8.1");

      const raw = JSON.parse(await readFile(join(dataPath, "local.json"), "utf-8")) as Record<string, unknown>;
      expect(raw.some_future_key).toBe("keep-me");
      expect(raw.installed_version).toBe("1.8.1");
    });
  });
});

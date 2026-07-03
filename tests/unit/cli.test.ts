import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import type { StorageState } from "../../src/core/types/integrations.js";

const NOW = "2026-01-01T00:00:00.000Z";
const CLI_ARGS = ["src/cli.ts"];

function makeState(): StorageState {
  return {
    version: 1,
    timestamp: NOW,
    human: {
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: NOW,
    },
    personas: {},
    queue: [],
    providers: [],
    tools: [],
  };
}

let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ei-cli-process-"));
  writeFileSync(join(tempDir, "state.json"), JSON.stringify(makeState()));
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = undefined as unknown as string;
});

function runCli(args: string[]) {
  return spawnSync("bun", [...CLI_ARGS, ...args], {
    cwd: process.cwd(),
    env: { ...process.env, EI_DATA_PATH: tempDir },
    encoding: "utf8",
  });
}

describe("CLI CRUD process behavior", () => {
  it("exits non-zero and reports invalid JSON before create validation", () => {
    const result = runCli(["create", "fact", "--json", "{not-json"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/^Invalid JSON:/);
  });

  it("exits non-zero and reports every missing fact field for invalid create shape", () => {
    const result = runCli(["create", "fact", "--json", JSON.stringify({ name: "Missing fields" })]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid fact:");
    expect(result.stderr).toContain("description:");
    expect(result.stderr).toContain("sentiment:");
    expect(result.stderr).toContain("validated_date:");
  });

  it("exits non-zero and requires a valid type for create", () => {
    const result = runCli(["create", "not-a-type", "--json", "{}"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ei create requires a valid type (fact, topic, person). Got: not-a-type");
  });

  it("exits non-zero and requires --json for create", () => {
    const result = runCli(["create", "fact"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ei create requires --json '<json>'");
  });

  it("exits non-zero and reports missing fact ids for update", () => {
    const result = runCli([
      "update",
      "fact",
      "missing",
      "--json",
      JSON.stringify({
        name: "Updated fact",
        description: "A valid fact body for the missing id path",
        sentiment: 0,
        validated_date: NOW,
      }),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No fact found with id: missing");
  });

  it("exits non-zero and prints remove usage when the id is omitted", () => {
    const result = runCli(["remove", "fact"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage: ei remove <type> <id> (types: fact, topic, person)");
  });

  it("creates a fact and prints the generated id with the requested record", () => {
    const result = runCli([
      "create",
      "fact",
      "--json",
      JSON.stringify({
        name: "Process-created fact",
        description: "Created through the CLI child process",
        sentiment: 0.25,
        validated_date: NOW,
      }),
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.id).toEqual(expect.any(String));
    expect(parsed.record).toMatchObject({
      id: parsed.id,
      name: "Process-created fact",
      description: "Created through the CLI child process",
      sentiment: 0.25,
      validated_date: NOW,
    });
  });
});

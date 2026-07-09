import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { Person } from "../../src/core/types/data-items.js";

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
    expect(result.stderr).toContain("ei create requires a valid type (fact, topic, person, persona). Got: not-a-type");
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
    expect(result.stderr).toContain("Usage: ei remove <type> <id> (types: fact, topic, person, persona)");
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

  it("exits non-zero and rejects quote as an invalid type for create (quotes are update-only)", () => {
    const result = runCli(["create", "quote", "--json", "{}"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ei create requires a valid type (fact, topic, person, persona). Got: quote");
  });

  it("exits non-zero and rejects quote as an invalid type for remove (quotes are non-removable)", () => {
    const result = runCli(["remove", "quote", "some-id"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage: ei remove <type> <id> (types: fact, topic, person, persona)");
  });

  it("resolves quote as a valid type for update and reaches the quote not-found error (not a type-usage error)", () => {
    const result = runCli([
      "update",
      "quote",
      "missing-quote-id",
      "--json",
      JSON.stringify({
        message_id: null,
        data_item_ids: [],
        persona_groups: [],
        text: "Corrected text",
        speaker: "human",
        timestamp: NOW,
        start: null,
        end: null,
        created_at: NOW,
        created_by: "human",
      }),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("Usage: ei update");
    expect(result.stderr).toContain("No quote found with id: missing-quote-id");
  });

  it("creates a persona and prints the generated id with the requested record", () => {
    const result = runCli([
      "create",
      "persona",
      "--json",
      JSON.stringify({ display_name: "Process-created Persona" }),
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.id).toEqual(expect.any(String));
    expect(parsed.record).toMatchObject({
      id: parsed.id,
      display_name: "Process-created Persona",
    });
  });

  it("exits non-zero and reports the missing display_name field for invalid persona create shape", () => {
    const result = runCli(["create", "persona", "--json", "{}"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid persona:");
    expect(result.stderr).toContain("display_name:");
  });

  it("exits non-zero and reports 'No persona found' for update with a nonexistent id", () => {
    const result = runCli([
      "update",
      "persona",
      "nonexistent-persona-id",
      "--json",
      JSON.stringify({ display_name: "Ghost Persona" }),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No persona found with id: nonexistent-persona-id");
  });

  it("exits non-zero removing the reserved 'ei' persona and leaves state.json byte-identical", () => {
    const statePath = join(tempDir, "state.json");
    const stateWithEi: StorageState = {
      ...makeState(),
      personas: {
        ei: {
          entity: {
            id: "ei",
            display_name: "Ei",
            entity: "system",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: true,
            last_updated: NOW,
          },
          messages: [],
        },
      },
    };
    writeFileSync(statePath, JSON.stringify(stateWithEi));
    const before = readFileSync(statePath, "utf-8");

    const result = runCli(["remove", "persona", "ei"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Cannot delete reserved persona "ei". Use archive instead.');
    expect(readFileSync(statePath, "utf-8")).toBe(before);
  });
});

function makePerson(id: string, identifiers: Person["identifiers"]): Person {
  return {
    id,
    name: identifiers?.find(i => i.is_primary)?.value ?? identifiers?.[0]?.value ?? id,
    description: "A test person",
    sentiment: 0.5,
    relationship: "friend",
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: NOW,
    identifiers,
  };
}

function writeStateWithPeople(people: Person[]) {
  const statePath = join(tempDir, "state.json");
  const state: StorageState = { ...makeState(), human: { ...makeState().human, people } };
  writeFileSync(statePath, JSON.stringify(state));
}

describe("CLI --identifier flag process behavior", () => {
  it("finds a person by exact type+value match and prints the enriched record", () => {
    writeStateWithPeople([
      makePerson("person-flare", [{ type: "GitHub", value: "flare576", is_primary: true }]),
    ]);

    const result = runCli(["--identifier", "GitHub", "flare576"]);

    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.type).toBe("person");
    expect(printed.id).toBe("person-flare");
  });

  it("matches the identifier type case-insensitively", () => {
    writeStateWithPeople([
      makePerson("person-yoda", [{ type: "Ei Persona", value: "yoda-persona-id" }]),
    ]);

    const result = runCli(["--identifier", "ei persona", "yoda-persona-id"]);

    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.id).toBe("person-yoda");
  });

  it("prints the not-found message and exits non-zero when no identifier matches", () => {
    writeStateWithPeople([
      makePerson("person-flare", [{ type: "GitHub", value: "flare576" }]),
    ]);

    const result = runCli(["--identifier", "GitHub", "someone-else"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("No person found with identifier GitHub: someone-else");
  });

  it("exits non-zero with a usage error when --identifier is given no values", () => {
    const result = runCli(["--identifier"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--identifier requires two values. Usage: ei --identifier <type> <value>");
  });

  it("exits non-zero with a usage error when --identifier is given only one value", () => {
    const result = runCli(["--identifier", "GitHub"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--identifier requires two values. Usage: ei --identifier <type> <value>");
  });
});

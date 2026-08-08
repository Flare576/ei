import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { spawnSync } from "child_process";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { Person, Quote } from "../../src/core/types/data-items.js";
import { ContextStatus } from "../../src/core/types/enums.js";
import { PERSON_LOG_REFLECTION_THRESHOLD } from "../../src/core/orchestrators/ceremony.js";

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
    expect(result.stderr).toContain("ei create requires a valid type (fact, topic, person, quote, persona). Got: not-a-type");
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
    expect(result.stderr).toContain("Usage: ei remove <type> <id> (types: fact, topic, person, quote, persona)");
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

  // Plan 1 (r4 / TODO 6): --json-file <path> — a non-argv input mode for
  // create/update, alongside the existing --json <json>. The argv-privacy
  // oracle needs no /proc polling: this file's own runCli() spawns the
  // real binary via spawnSync("bun", [...CLI_ARGS, ...args]), so `args` IS
  // the subprocess's own argv — a marker string that lives only inside the
  // temp file, and never in `args`, is proof the payload never touched argv.
  describe("--json-file <path> (r4 non-argv input mode)", () => {
    it("creates a topic via --json-file, with the marker string never appearing in the process's own argv", () => {
      const marker = "MARKER-f3a9c1-topic-create";
      const jsonPath = join(tempDir, "create-topic.json");
      writeFileSync(jsonPath, JSON.stringify({
        name: "Process-created topic",
        description: `Created through --json-file, marker ${marker}`,
        sentiment: 0.4,
        category: "Interest",
      }));
      const args = ["create", "topic", "--json-file", jsonPath];

      // The argv-privacy oracle: args is the subprocess's own argv.
      expect(args.join(" ")).not.toContain(marker);

      const result = runCli(args);

      expect(result.status).toBe(0);
      const parsed = JSON.parse(result.stdout);
      expect(parsed.record.description).toContain(marker);
    });

    it("exits non-zero with a clear error for a nonexistent --json-file path", () => {
      const result = runCli(["create", "topic", "--json-file", join(tempDir, "does-not-exist.json")]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("Could not read --json-file");
    });

    it("exits non-zero with a clear error for malformed JSON in the --json-file", () => {
      const jsonPath = join(tempDir, "malformed.json");
      writeFileSync(jsonPath, "{not-json");

      const result = runCli(["create", "topic", "--json-file", jsonPath]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/^Invalid JSON:/);
    });

    it("exits non-zero when both --json and --json-file are supplied", () => {
      const jsonPath = join(tempDir, "both.json");
      writeFileSync(jsonPath, JSON.stringify({ name: "x" }));

      const result = runCli(["create", "topic", "--json", "{}", "--json-file", jsonPath]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("pass either --json or --json-file, not both");
    });

    it("exits non-zero when neither --json nor --json-file is supplied", () => {
      const result = runCli(["create", "topic"]);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain("requires --json '<json>' or --json-file <path>");
    });

    it("existing --json <json> create still works unchanged (backward-compat regression check)", () => {
      const result = runCli([
        "create", "topic", "--json",
        JSON.stringify({ name: "Still works", description: "d", sentiment: 0.1 }),
      ]);

      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout).record.name).toBe("Still works");
    });

    it("updates a topic via --json-file with only the changed field — a distinct command path from create, so this needs its own oracle", () => {
      const createResult = runCli([
        "create", "topic", "--json",
        JSON.stringify({ name: "Original Topic", description: "Original description", sentiment: 0.2, category: "Interest" }),
      ]);
      expect(createResult.status).toBe(0);
      const topicId = JSON.parse(createResult.stdout).id as string;

      const marker = "MARKER-9b2e7d-topic-update";
      const jsonPath = join(tempDir, "update-topic.json");
      writeFileSync(jsonPath, JSON.stringify({ description: `Updated via --json-file, marker ${marker}` }));
      const args = ["update", "topic", topicId, "--json-file", jsonPath];
      expect(args.join(" ")).not.toContain(marker);

      const updateResult = runCli(args);

      expect(updateResult.status).toBe(0);
      const updated = JSON.parse(updateResult.stdout);
      expect(updated.description).toContain(marker);
      // The field the file omitted (`category`) is unchanged -- proves this
      // is a merge patch, not a full-record write, through --json-file too.
      expect(updated.category).toBe("Interest");

      const readBack = runCli(["--id", topicId]);
      expect(JSON.parse(readBack.stdout).category).toBe("Interest");
    });
  });

  it("exits non-zero and reports missing message_id/text for an empty create-quote body (Plan 2: create quote is now a real attested command, no longer update-only)", () => {
    const result = runCli(["create", "quote", "--json", "{}"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quote (create): message_id: Required; text: Required");
  });

  it("resolves quote as a valid type for remove and reaches the quote not-found error (Plan 2: ei remove quote is now real)", () => {
    const result = runCli(["remove", "quote", "some-id"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("Usage: ei remove");
    expect(result.stderr).toContain("Cannot remove quote: no quote found with the supplied id");
  });

  it("ei update quote always rejects with the ADR-012 tombstone message, not the not-found contract (Plan 2: ei update quote is retired)", () => {
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
    expect(result.stderr).not.toContain("No quote found with id");
    expect(result.stderr).toContain('"ei update quote" is retired');
    expect(result.stderr).toContain('"ei fix quote"');
    expect(result.stderr).toContain('"ei relink quote"');
    expect(result.stderr).toContain('"ei remove quote"');
    expect(result.stderr).toContain("Scheduled for removal");
  });

  it("ei update quote rejects with the ADR-012 tombstone even when --json is entirely omitted (I2)", () => {
    const statePath = join(tempDir, "state.json");
    const stateBefore = readFileSync(statePath, "utf-8");

    const result = runCli(["update", "quote", "missing-quote-id"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("requires --json");
    expect(result.stderr).not.toContain("Usage: ei update");
    expect(result.stderr).toContain('"ei update quote" is retired');
    expect(result.stderr).toContain('"ei fix quote"');
    expect(result.stderr).toContain('"ei relink quote"');
    expect(result.stderr).toContain('"ei remove quote"');
    expect(readFileSync(statePath, "utf-8")).toBe(stateBefore);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
  });

  it("ei update quote rejects with the ADR-012 tombstone even when --json is malformed JSON (I2)", () => {
    const statePath = join(tempDir, "state.json");
    const stateBefore = readFileSync(statePath, "utf-8");

    const result = runCli(["update", "quote", "missing-quote-id", "--json", "{not-json"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).not.toContain("Invalid JSON");
    expect(result.stderr).toContain('"ei update quote" is retired');
    expect(result.stderr).toContain('"ei fix quote"');
    expect(result.stderr).toContain('"ei relink quote"');
    expect(result.stderr).toContain('"ei remove quote"');
    expect(readFileSync(statePath, "utf-8")).toBe(stateBefore);
    expect(existsSync(join(tempDir, "corrections.json"))).toBe(false);
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
    expect(result.stderr).toContain('Cannot delete reserved persona "ei" — reserved personas can\'t be deleted via this CLI/MCP path at all; use the TUI\'s /archive command instead.');
    expect(readFileSync(statePath, "utf-8")).toBe(before);
  });

  it("renders a matching persona as a relationship prompt block", () => {
    const personaName = "Prompt Process Persona";
    const basePrompt = "DISTINCTIVE_BASE_PROMPT: Helps turn uncertain evidence into reliable decisions.";
    const traitName = "Evidence-first judgment";
    const traitDescription = "DISTINCTIVE_TRAIT_DESCRIPTION: Separates verified facts from inference before advising.";
    const topicName = "Release quality";
    const topicPerspective = "DISTINCTIVE_TOPIC_PERSPECTIVE: Quality is a product decision, not a final checkpoint.";
    const topicApproach = "DISTINCTIVE_TOPIC_APPROACH: Define observable acceptance criteria before implementation.";
    const state: StorageState = {
      ...makeState(),
      personas: {
        "prompt-process-persona": {
          entity: {
            id: "prompt-process-persona",
            display_name: personaName,
            entity: "system",
            long_description: basePrompt,
            traits: [{
              id: "evidence-first-judgment",
              name: traitName,
              description: traitDescription,
              sentiment: 0.9,
              strength: 0.8,
              last_updated: NOW,
            }],
            topics: [{
              id: "release-quality",
              name: topicName,
              perspective: topicPerspective,
              approach: topicApproach,
              personal_stake: "Reliable releases protect the people who rely on the software.",
              sentiment: 0.9,
              exposure_current: 0.8,
              exposure_desired: 0.8,
              last_updated: NOW,
            }],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: NOW,
          },
          messages: [],
        },
      },
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["personas", personaName, "--format", "prompt"]);

    expect(result.status).toBe(0);
    expect(result.stdout.split("\n")[0]).toBe("<!-- ei-relationship-injected -->");
    expect(result.stdout).toContain("<ei-relationship>");
    expect(result.stdout).toContain("</ei-relationship>");
    expect(result.stdout).toContain(basePrompt);
    expect(result.stdout).toContain(traitName);
    expect(result.stdout).toContain(traitDescription);
    expect(result.stdout).toContain(topicName);
    expect(result.stdout).toContain(topicPerspective);
    expect(result.stdout).toContain(topicApproach);
    expect(() => JSON.parse(result.stdout)).toThrow();
  });
});

function makePerson(id: string, identifiers: Person["identifiers"], description = "A test person"): Person {
  return {
    id,
    name: identifiers?.find(i => i.is_primary)?.value ?? identifiers?.[0]?.value ?? id,
    description,
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

describe("CLI --id --before/--after flags on a message ID (v1.8.0 CLI/MCP parity, ADR-028)", () => {
  const personaId = "66666666-6666-4666-8666-666666666666";
  function writeStateWithMessages(messages: { id: string; role: "human" | "system"; content: string }[]) {
    const state: StorageState = {
      ...makeState(),
      personas: {
        [personaId]: {
          entity: {
            id: personaId,
            display_name: "Context Window Persona",
            aliases: [],
            entity: "system",
            short_description: "t",
            long_description: "t",
            model: "Local LLM:test-model",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: NOW,
          },
          messages: messages.map((m, i) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            timestamp: new Date(Date.parse(NOW) + i * 1000).toISOString(),
            read: true,
            context_status: ContextStatus.Default,
          })),
        },
      },
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  }

  it("defaults to no surrounding context when --before/--after are omitted", () => {
    writeStateWithMessages([
      { id: "ei:m0", role: "human", content: "zero" },
      { id: "ei:m1", role: "system", content: "one" },
      { id: "ei:m2", role: "human", content: "two" },
    ]);

    const result = runCli(["--id", "ei:m1"]);

    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.content).toBe("one");
    expect(printed.before).toEqual([]);
    expect(printed.after).toEqual([]);
  });

  it("returns exactly N preceding and following messages when requested", () => {
    writeStateWithMessages([
      { id: "ei:m0", role: "human", content: "zero" },
      { id: "ei:m1", role: "system", content: "one" },
      { id: "ei:m2", role: "human", content: "two" },
      { id: "ei:m3", role: "system", content: "three" },
      { id: "ei:m4", role: "human", content: "four" },
    ]);

    const result = runCli(["--id", "ei:m2", "--before", "1", "--after", "1"]);

    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.content).toBe("two");
    expect(printed.before.map((m: { content: string }) => m.content)).toEqual(["one"]);
    expect(printed.after.map((m: { content: string }) => m.content)).toEqual(["three"]);
  });

  it("clamps at the edges of the conversation instead of erroring", () => {
    writeStateWithMessages([
      { id: "ei:m0", role: "human", content: "zero" },
      { id: "ei:m1", role: "system", content: "one" },
    ]);

    const result = runCli(["--id", "ei:m0", "--before", "10", "--after", "10"]);

    expect(result.status).toBe(0);
    const printed = JSON.parse(result.stdout);
    expect(printed.content).toBe("zero");
    expect(printed.before).toEqual([]);
    expect(printed.after.map((m: { content: string }) => m.content)).toEqual(["one"]);
  });

  it("treats malformed, negative, and non-finite counts as zero instead of crashing or unbounded-slicing", () => {
    writeStateWithMessages([
      { id: "ei:m0", role: "human", content: "zero" },
      { id: "ei:m1", role: "system", content: "one" },
      { id: "ei:m2", role: "human", content: "two" },
    ]);

    for (const badValue of ["abc", "-3", "Infinity", "-Infinity", "NaN"]) {
      const result = runCli(["--id", "ei:m1", "--before", badValue, "--after", badValue]);
      expect(result.status).toBe(0);
      const printed = JSON.parse(result.stdout);
      expect(printed.content).toBe("one");
      expect(printed.before).toEqual([]);
      expect(printed.after).toEqual([]);
    }
  });
});

describe("CLI --help balanced-search contract", () => {
  // Regression guard for the ei-cli-skills-review findings (I1 / R-mcp.ts): --help
  // text used to say plain `ei "query"` searches "all data types" / "all types",
  // which falsely implied personas were included. retrieveBalanced() (src/cli/retrieval.ts)
  // never returns personas — only quote/fact/person/topic. Phrases implying "all
  // types"/"all five" are only acceptable when paired with language that explicitly
  // excludes personas from that set.
  function impliesPersonasInBalancedSearch(text: string): boolean {
    const claimsAllTypes = /\ball\s+(data\s+)?types\b/i.test(text) || /\ball\s+five\b/i.test(text) || /\ball\s+5\b/i.test(text);
    if (!claimsAllTypes) return false;
    const explicitlyExcludesPersonas = /persona/i.test(text) && /exclud/i.test(text);
    return !explicitlyExcludesPersonas;
  }

  it("--help output never claims balanced search covers personas", () => {
    const result = runCli(["--help"]);

    expect(result.status).toBe(0);
    expect(impliesPersonasInBalancedSearch(result.stdout)).toBe(false);
    // Positive half: the balanced-search usage line explicitly names the four
    // covered types and steers persona lookups to `ei personas`.
    expect(result.stdout).toMatch(/facts\/people\/topics\/quotes/i);
    expect(result.stdout).toMatch(/ei personas/);
  });
});

// ── CLI --format prompt: Ei Person Log composition seam ──────────────────────
// resolvePersonLogLength() and buildEiRelationshipBlock() are each covered
// directly (tests/unit/cli/personas.test.ts), but a helper-level test can't
// see whether the real `--format prompt` route (src/cli.ts) actually wires
// the resolver's output into the formatter correctly. This exercises the
// full process: a persisted persona linked to a real Person record, through
// `ei personas <name> --format prompt`, asserting the privacy boundary holds
// end-to-end and not just at the helper seam.
describe("CLI --format prompt process behavior — Ei Person Log section", () => {
  const personaId = "person-log-persona";
  const personaName = "Person Log Persona";

  function writeStateWithPersonaAndPeople(people: Person[]) {
    const statePath = join(tempDir, "state.json");
    const state: StorageState = {
      ...makeState(),
      personas: {
        [personaId]: {
          entity: {
            id: personaId,
            display_name: personaName,
            entity: "system",
            long_description: "Base prompt for person log tests.",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: NOW,
          },
          messages: [],
        },
      },
      human: { ...makeState().human, people },
    };
    writeFileSync(statePath, JSON.stringify(state));
  }

  it("emits no Person Log section when the persona has no linked Person record", () => {
    writeStateWithPersonaAndPeople([]);

    const result = runCli(["personas", personaName, "--format", "prompt"]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("Ei Person Log");
  });

  it("reports the count and the reflection cue when the linked record is over threshold, and never leaks the log content", () => {
    const sentinel = "SENTINEL_PROCESS_LEVEL_DO_NOT_LEAK_9d21ff";
    const description = sentinel + "z".repeat(PERSON_LOG_REFLECTION_THRESHOLD + 100);
    writeStateWithPersonaAndPeople([
      makePerson("linked-person", [{ type: "Ei Persona", value: personaId, is_primary: true }], description),
    ]);

    const result = runCli(["personas", personaName, "--format", "prompt"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("# Ei Person Log");
    expect(result.stdout).toContain(`currently ${description.length} characters`);
    expect(result.stdout).toMatch(/prompt the user to perform a reflection soon/i);
    expect(result.stdout).not.toContain(sentinel);
    expect(result.stdout).not.toContain(description);
  });

  it("reports the count with no reflection cue at exactly the threshold (strict >, matching ceremony.ts)", () => {
    const description = "a".repeat(PERSON_LOG_REFLECTION_THRESHOLD);
    writeStateWithPersonaAndPeople([
      makePerson("linked-person", [{ type: "Ei Persona", value: personaId, is_primary: true }], description),
    ]);

    const result = runCli(["personas", personaName, "--format", "prompt"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`currently ${PERSON_LOG_REFLECTION_THRESHOLD} characters`);
    expect(result.stdout).not.toMatch(/reflection/i);
  });
});

// ── T1: successful CLI create/fix quote through a real spawned process ──────
// (.sisyphus/reviews/quote-attestation-final-implementation.md): only the
// FAILURE branches of `ei create quote`/`ei fix quote` had permanent
// process-level coverage before this -- the successful, source-verified
// write paths were only exercised manually during final review, never
// locked down as a regression.
describe("CLI create/fix quote — a successful write through a real spawned process (T1)", () => {
  const t1PersonaId = "66666666-6666-4666-8666-666666666666";
  const t1MsgId = "ei:00000000-1111-4111-8111-111111111111";
  const t1Content = "The migration script silently drops records when the batch size exceeds one thousand";

  function writeT1SourcedState(quotes: Quote[] = []) {
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes, last_updated: NOW },
      personas: {
        [t1PersonaId]: {
          entity: {
            id: t1PersonaId,
            display_name: "T1 Persona",
            aliases: [],
            entity: "system",
            short_description: "t",
            long_description: "t",
            model: "Local LLM:test-model",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: NOW,
          },
          messages: [{ id: t1MsgId, role: "human", content: t1Content, timestamp: NOW, read: false, context_status: ContextStatus.Default }],
        },
      },
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
  }

  it("creates a source-verified quote, persisting server-derived speaker/channel/timestamp -- exit 0, parseable JSON output (T1)", () => {
    writeT1SourcedState();

    const result = runCli([
      "create", "quote",
      "--message-id", t1MsgId,
      "--text", "silently drops records when the batch size exceeds one thousand",
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.id).toEqual(expect.any(String));
    expect(parsed.text).toBe("silently drops records when the batch size exceeds one thousand");
    expect(parsed.message_id).toBe(t1MsgId);
    expect(parsed.speaker).toBe("human");
    expect(parsed.channel).toBe("T1 Persona");
    expect(parsed.timestamp).toBe(NOW);
    expect(parsed.created_by).toBe("extraction");
    expect(parsed.data_item_ids).toEqual([]);
    expect(parsed.persona_groups).toEqual([]);

    const persisted = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    const persistedQuote = persisted.human.quotes.find((q) => q.id === parsed.id);
    expect(persistedQuote).toBeDefined();
    expect(persistedQuote!.text).toBe(parsed.text);
  }, 20000);

  it("fixes an existing quote's text, persisting ONLY text/start/end/embedding changes -- exit 0, parseable JSON output (T1)", () => {
    const existing: Quote = {
      id: "t1-fix-quote-1",
      message_id: t1MsgId,
      data_item_ids: ["some-fact-id"],
      persona_groups: ["General"],
      text: "silently drops records",
      speaker: "human",
      channel: "T1 Persona",
      timestamp: NOW,
      start: 0,
      end: 23,
      created_at: "2020-01-01T00:00:00.000Z",
      created_by: "human",
    };
    writeT1SourcedState([existing]);

    const result = runCli([
      "fix", "quote",
      "--quote-id", "t1-fix-quote-1",
      "--text", "drops records when the batch size exceeds one thousand",
    ]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.id).toBe("t1-fix-quote-1");
    expect(parsed.text).toBe("drops records when the batch size exceeds one thousand");
    // Everything else preserved from the existing record, untouched by the fix.
    expect(parsed.message_id).toBe(t1MsgId);
    expect(parsed.speaker).toBe("human");
    expect(parsed.channel).toBe("T1 Persona");
    expect(parsed.data_item_ids).toEqual(["some-fact-id"]);
    expect(parsed.persona_groups).toEqual(["General"]);
    expect(parsed.created_at).toBe("2020-01-01T00:00:00.000Z");
    expect(parsed.created_by).toBe("human");

    const persisted = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    const persistedQuote = persisted.human.quotes.find((q) => q.id === "t1-fix-quote-1")!;
    expect(persistedQuote.text).toBe(parsed.text);
    expect(persistedQuote.data_item_ids).toEqual(["some-fact-id"]);
  }, 20000);
});

// ── I1: create/fix quote numeric flag errors never echo the raw input ────────
// src/cli.ts's --start/--end numeric validation used to interpolate the raw
// flag value verbatim into its error message. A quick, real-process
// regression: a control-character-bearing invalid value must never surface
// in stderr, just the stable "<flag> must be a number." message.
describe("CLI create/fix quote — numeric flag error output is sanitized (I1)", () => {
  it("does not echo the raw invalid --start value into the create-quote numeric flag error", () => {
    const evilValue = "not-a-number\x1b[31mRED\x1b[0m";
    const result = runCli([
      "create", "quote",
      "--message-id", "ei:00000000-0000-4000-8000-000000000000",
      "--text", "anything",
      "--start", evilValue,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--start must be a number.");
    expect(result.stderr).not.toContain(evilValue);
    expect(result.stderr).not.toContain("not-a-number");
  });

  it("does not echo the raw invalid --start value into the fix-quote numeric flag error", () => {
    const evilValue = "\x07alsoNotANumber";
    const result = runCli([
      "fix", "quote",
      "--quote-id", "does-not-matter",
      "--text", "anything",
      "--start", evilValue,
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("--start must be a number.");
    expect(result.stderr).not.toContain(evilValue);
    expect(result.stderr).not.toContain("alsoNotANumber");
  });

  it("does not echo a control-character-bearing --quote-id into the fix-quote not-found error (I1 round 2)", () => {
    const evilQuoteId = "does-not-exist\x1b[31mRED\x1b[0m";
    const result = runCli([
      "fix", "quote",
      "--quote-id", evilQuoteId,
      "--text", "anything",
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot fix quote: no quote found with the supplied id");
    expect(result.stderr).not.toContain(evilQuoteId);
    expect(result.stderr).not.toContain("does-not-exist");
  });
});

// ── T14 (round 3): a genuinely SKIPPED fix must never echo the raw quote
// id or the internal skip diagnostic through the CLI transport ─────────
// The review's own reproduction races a concurrent quote.remove between
// verification and self-drain -- not reproducible deterministically
// across two real OS processes without introducing a flaky test (see
// decisions.md). This reaches the IDENTICAL public-error code path (a
// post-write skip surfacing through fixQuoteEntity's attempt_id check)
// via a deterministic trigger instead: a malformed carried-forward
// `speaker` field the wire grammar rejects on write, exactly like I5's
// corrections-endpoints.test.ts reproduction.
describe("CLI fix quote — a genuinely skipped write never echoes the raw id or internal reason (T14, round 3)", () => {
  it("does not echo a control-character-bearing quote id or the internal skip diagnostic when the queued fix is itself rejected", () => {
    const evilQuoteId = "attest\x1b[31mRED\x1b[0mquote-1";
    const personaId = "55555555-5555-4555-8555-555555555555";
    const msgId = "ei:ffffffff-ffff-4fff-8fff-ffffffffffff";
    const content = "some resolvable content lives here for the CLI fix quote test";
    const quote: Quote = {
      id: evilQuoteId,
      message_id: msgId,
      data_item_ids: [],
      persona_groups: [],
      text: content,
      // Malformed: the wire grammar requires a non-empty speaker on any
      // real write. Simulates hand-edited/pre-migration state.
      speaker: "",
      timestamp: NOW,
      start: 0,
      end: content.length,
      created_at: NOW,
      created_by: "human",
    };
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes: [quote], last_updated: NOW },
      personas: {
        [personaId]: {
          entity: {
            id: personaId,
            display_name: "Attest Persona",
            aliases: [],
            entity: "system",
            short_description: "t",
            long_description: "t",
            model: "Local LLM:test-model",
            traits: [],
            topics: [],
            is_paused: false,
            is_archived: false,
            is_static: false,
            last_updated: NOW,
          },
          messages: [{ id: msgId, role: "human", content, timestamp: NOW, read: false, context_status: ContextStatus.Default }],
        },
      },
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["fix", "quote", "--quote-id", evilQuoteId, "--text", content]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot fix quote: the write could not be verified");
    expect(result.stderr).not.toContain(evilQuoteId);
    expect(result.stderr).not.toContain("\x1b[31m");
    expect(result.stderr).not.toContain("does not exist");
    expect(result.stderr).not.toContain("speaker");
  }, 20000);
});

// ── I6/T17 (round 4/5): an extra --json property is merged straight into
// the endpoint body before it ever reaches quoteCreateInputSchema/
// quoteFixInputSchema's z.strictObject. Zod's own "unrecognized_keys"
// issue built its message directly from the caller's literal property
// name -- echoing that verbatim let a --json key decoded from terminal
// control/ANSI bytes reach CLI stderr unsanitized
// (.sisyphus/reviews/wave-2-quote-attestation.md). The fix must report a
// stable, generic "unrecognized field(s) present" refusal instead of the
// raw key text, for both create quote and fix quote.
describe("CLI create/fix quote — an extra --json key name is sanitized, never echoed (I6/T17)", () => {
  it("does not echo a control/ANSI-bearing extra --json key into the create-quote validation error", () => {
    const evilKey = "\x1b[31mFORGED\x1b[0m";
    const result = runCli([
      "create", "quote",
      "--message-id", "ei:00000000-0000-4000-8000-000000000000",
      "--text", "anything",
      "--json", JSON.stringify({ [evilKey]: "x" }),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quote (create): unrecognized field(s) present");
    expect(result.stderr).not.toContain(evilKey);
    expect(result.stderr).not.toContain("FORGED");
    expect(result.stderr).not.toContain("\x1b[31m");
  });

  it("does not echo a control/ANSI-bearing extra --json key into the fix-quote validation error", () => {
    const evilKey = "\x07bell\x1b[31mFORGED\x1b[0m";
    const result = runCli([
      "fix", "quote",
      "--quote-id", "does-not-matter",
      "--text", "anything",
      "--json", JSON.stringify({ [evilKey]: "x" }),
    ]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quote (fix): unrecognized field(s) present");
    expect(result.stderr).not.toContain(evilKey);
    expect(result.stderr).not.toContain("FORGED");
    expect(result.stderr).not.toContain("\x07");
    expect(result.stderr).not.toContain("\x1b[31m");
  });
});

// ── T4: ei relink quote — process behavior ────────────────────────────────
describe("CLI relink quote — process behavior (T4)", () => {
  it("relinks a quote's data_item_ids to a new valid target via a real CLI process", () => {
    const quote: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: [],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: NOW,
      start: null,
      end: null,
      created_at: NOW,
      created_by: "human",
    };
    const person = makePerson("person-1", [{ type: "GitHub", value: "octocat", is_primary: true }]);
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [person], quotes: [quote], last_updated: NOW },
      personas: {},
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["relink", "quote", "quote-1", "--to", "person-1"]);

    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toMatchObject({ id: "quote-1", data_item_ids: ["person-1"] });
  });

  it("fails when relinking to a nonexistent entity id, without echoing the invalid id in stderr (I1)", () => {
    const quote: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: [],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: NOW,
      start: null,
      end: null,
      created_at: NOW,
      created_by: "human",
    };
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes: [quote], last_updated: NOW },
      personas: {},
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["relink", "quote", "quote-1", "--to", "does-not-exist"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quote (relink): data_item_ids references unknown or disallowed entities");
    expect(result.stderr).not.toContain("does-not-exist");
  });


  it("fails immediately with a named 'quote not found' error, distinct from the invalid-target error, when relinking a quote id that does not exist at all", () => {
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes: [], last_updated: NOW },
      personas: {},
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["relink", "quote", "does-not-exist", "--to", "anything"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cannot relink quote: no quote found with the supplied id");
    expect(result.stderr).not.toContain("does-not-exist");
  });

  it("exits non-zero with a usage error for 'ei relink <not-quote>'", () => {
    const result = runCli(["relink", "fact", "some-id"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Usage: ei relink quote");
  });
});

// ── T1 (Wave 3, I1): a control/ANSI-bearing invalid relink target never
// echoes into the CLI's stderr, matching the numeric-flag/quote-id
// sanitization above ──────────────────────────────────────────────────
describe("CLI relink quote — an invalid relink target is never echoed into stderr (I1, T1)", () => {
  it("does not echo a control/ANSI-bearing --to target into the invalid-target error", () => {
    const quote: Quote = {
      id: "quote-1",
      message_id: null,
      data_item_ids: [],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: NOW,
      start: null,
      end: null,
      created_at: NOW,
      created_by: "human",
    };
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [], quotes: [quote], last_updated: NOW },
      personas: {},
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));
    const evilId = "not-a-real-id\x1b[31mRED\x1b[0m";

    const result = runCli(["relink", "quote", "quote-1", "--to", evilId]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quote (relink): data_item_ids references unknown or disallowed entities");
    expect(result.stderr).not.toContain(evilId);
    expect(result.stderr).not.toContain("not-a-real-id");
    expect(result.stderr).not.toContain("\x1b[31m");
  });
});

// ── T3 (Wave 3, I3): singular/plural quote alias parity across every
// quote-accepting verb ──────────────────────────────────────────────────
// TYPE_ALIASES treats "quote" and "quotes" as synonyms, but only create's
// generic dispatch resolved aliases via CORRECTABLE_TYPES/
// resolveCorrectableType -- fix/relink were each gated by a literal
// `=== "quote"` string compare with no alias awareness at all. Once T4
// added "quote" to CORRECTABLE_TYPES, "ei create quotes" silently
// resolved to the generic createEntity("quote", ...) dispatch, which has
// no "quote" schema entry and crashed with a raw runtime error instead of
// reaching create's own dedicated, source-verified validation. Each verb
// below is checked against BOTH spellings reaching the IDENTICAL outcome.
describe("CLI quote verbs — singular/plural alias parity (I3)", () => {
  it("'ei create quotes' reaches the same attested-create validation as 'ei create quote', never the generic schema dispatcher, and writes neither state.json nor corrections.json (I3, I4/R2-T2)", () => {
    const statePath = join(tempDir, "state.json");
    const correctionsPath = join(tempDir, "corrections.json");
    const stateBefore = readFileSync(statePath, "utf-8");
    expect(existsSync(correctionsPath)).toBe(false);

    const singular = runCli(["create", "quote", "--json", "{}"]);
    const plural = runCli(["create", "quotes", "--json", "{}"]);

    expect(plural.status).not.toBe(0);
    expect(plural.status).toBe(singular.status);
    expect(plural.stderr).toBe(singular.stderr);
    expect(plural.stderr).toContain("Invalid quote (create): message_id: Required; text: Required");
    // The generic dispatcher's crash, pre-fix, surfaced as a raw runtime
    // TypeError rather than this controlled validation message.
    expect(plural.stderr).not.toMatch(/is not an object|is not a function|TypeError/);

    // I4 (round 2): T3's own stated oracle requires no state or
    // correction-queue write on this controlled validation failure --
    // assert it directly through the real CLI process fixture rather
    // than inferring it from the endpoint's early validation.
    expect(readFileSync(statePath, "utf-8")).toBe(stateBefore);
    expect(existsSync(correctionsPath)).toBe(false);
  });

  it("'ei fix quotes' reaches fixQuoteEntity, not a usage error", () => {
    const singular = runCli(["fix", "quote", "--quote-id", "does-not-exist", "--text", "anything"]);
    const plural = runCli(["fix", "quotes", "--quote-id", "does-not-exist", "--text", "anything"]);

    expect(plural.status).not.toBe(0);
    expect(plural.stderr).toBe(singular.stderr);
    expect(plural.stderr).toContain("Cannot fix quote: no quote found with the supplied id");
    expect(plural.stderr).not.toContain("Usage: ei fix quote");
  });

  it("'ei relink quotes' reaches relinkQuoteEntity, not a usage error", () => {
    const singular = runCli(["relink", "quote", "does-not-exist", "--to", "anything"]);
    const plural = runCli(["relink", "quotes", "does-not-exist", "--to", "anything"]);

    expect(plural.status).not.toBe(0);
    expect(plural.stderr).toBe(singular.stderr);
    expect(plural.stderr).toContain("Cannot relink quote: no quote found with the supplied id");
    expect(plural.stderr).not.toContain("Usage: ei relink quote");
  });

  it("'ei remove quotes' already reaches removeQuoteEntity (regression lock -- CORRECTABLE_TYPES' generic dispatch already resolved this alias correctly before this fix)", () => {
    const singular = runCli(["remove", "quote", "does-not-exist"]);
    const plural = runCli(["remove", "quotes", "does-not-exist"]);

    expect(plural.status).not.toBe(0);
    expect(plural.stderr).toBe(singular.stderr);
    expect(plural.stderr).toContain("Cannot remove quote: no quote found with the supplied id");
  });

  it("'ei update quotes' already reaches the ADR-012 tombstone (regression lock -- already correct before this fix)", () => {
    const body = JSON.stringify({
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
    });
    const singular = runCli(["update", "quote", "missing-quote-id", "--json", body]);
    const plural = runCli(["update", "quotes", "missing-quote-id", "--json", body]);

    expect(plural.status).not.toBe(0);
    expect(plural.stderr).toBe(singular.stderr);
    expect(plural.stderr).toContain('"ei update quote" is retired');
  });
});

// ── T5 (Wave 3): a successful 'ei remove quote' through the spawned CLI,
// not only its error path ────────────────────────────────────────────
describe("CLI remove quote — a successful removal through a real CLI process (T5)", () => {
  it("removes an existing quote and leaves an unrelated person untouched", () => {
    const quote: Quote = {
      id: "quote-to-remove",
      message_id: null,
      data_item_ids: [],
      persona_groups: [],
      text: "Existing quote text",
      speaker: "human",
      timestamp: NOW,
      start: null,
      end: null,
      created_at: NOW,
      created_by: "human",
    };
    const person = makePerson("unrelated-person", [{ type: "GitHub", value: "octocat", is_primary: true }]);
    const state: StorageState = {
      version: 1,
      timestamp: NOW,
      human: { entity: "human", facts: [], topics: [], people: [person], quotes: [quote], last_updated: NOW },
      personas: {},
      queue: [],
      providers: [],
      tools: [],
    };
    writeFileSync(join(tempDir, "state.json"), JSON.stringify(state));

    const result = runCli(["remove", "quote", "quote-to-remove"]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({ removed: true, id: "quote-to-remove" });

    const persisted = JSON.parse(readFileSync(join(tempDir, "state.json"), "utf-8")) as StorageState;
    expect(persisted.human.quotes.find((q) => q.id === "quote-to-remove")).toBeUndefined();
    expect(persisted.human.people.find((p) => p.id === "unrelated-person")).toBeDefined();
  });
});

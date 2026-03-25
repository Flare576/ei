import { test, expect, describe } from "bun:test";
import { parseRoomYAML, buildRoomYAMLTemplate } from "../../src/util/room-parser";
import { checkAllPersonasResponded } from "../../src/util/room-logic";
import type { PersonaSummary } from "../../../src/core/types";
import { RoomMode } from "../../../src/core/types";

function makePersona(id: string, display_name: string, is_archived = false): PersonaSummary {
  return {
    id,
    display_name,
    aliases: [],
    is_paused: false,
    is_archived,
    unread_count: 0,
  };
}

const alice = makePersona("alice-id", "Alice");
const bob = makePersona("bob-id", "Bob");
const charlie = makePersona("charlie-id", "Charlie");
const defaultPersonas = [alice, bob, charlie];

describe("parseRoomYAML — map format (new)", () => {
  test("parses display_name, mode, and initial_message", () => {
    const yaml = `
display_name: "My Room"
mode: free_for_all
persona_ids:
  Alice: true
judge_persona_id: ""
initial_message: "Hello everyone"
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.display_name).toBe("My Room");
    expect(result.mode).toBe(RoomMode.FreeForAll);
    expect(result.initial_message).toBe("Hello everyone");
  });

  test("only true entries become persona_ids", () => {
    const yaml = `
display_name: "Test Room"
mode: free_for_all
persona_ids:
  Alice: true
  Bob: false
  Charlie: true
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.persona_ids).toEqual(["alice-id", "charlie-id"]);
    expect(result.persona_ids).not.toContain("bob-id");
  });

  test("resolves display_name to ID via persona lookup", () => {
    const yaml = `
display_name: "Test Room"
mode: free_for_all
persona_ids:
  Bob: true
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.persona_ids).toEqual(["bob-id"]);
  });

  test("persona not found by display_name falls back to raw name as ID", () => {
    const yaml = `
display_name: "Test Room"
mode: free_for_all
persona_ids:
  Alice: true
  GhostPersona: true
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.persona_ids).toContain("alice-id");
    expect(result.persona_ids).toContain("GhostPersona");
  });

  test("judge_persona_id empty string becomes undefined", () => {
    const yaml = `
display_name: "Test Room"
mode: free_for_all
persona_ids:
  Alice: true
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.judge_persona_id).toBeUndefined();
  });

  test("judge_persona_id display_name resolves to ID", () => {
    const yaml = `
display_name: "Debate Room"
mode: messages_against_persona
persona_ids:
  Alice: true
  Bob: true
judge_persona_id: "Alice"
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.judge_persona_id).toBe("alice-id");
  });

  test("MAP mode + judge_persona_id: both persona_ids and judge present in output", () => {
    const yaml = `
display_name: "MAP Room"
mode: messages_against_persona
persona_ids:
  Alice: true
  Bob: true
judge_persona_id: "Alice"
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.mode).toBe(RoomMode.MessagesAgainstPersona);
    expect(result.persona_ids).toContain("alice-id");
    expect(result.persona_ids).toContain("bob-id");
    expect(result.judge_persona_id).toBe("alice-id");
  });

  test("parses all three mode values", () => {
    const makeYaml = (mode: string) => `
display_name: "Room"
mode: ${mode}
persona_ids:
  Alice: true
judge_persona_id: ""
initial_message: ""
`;
    expect(parseRoomYAML(makeYaml("choose_your_path"), defaultPersonas).mode).toBe(RoomMode.ChooseYourPath);
    expect(parseRoomYAML(makeYaml("free_for_all"), defaultPersonas).mode).toBe(RoomMode.FreeForAll);
    expect(parseRoomYAML(makeYaml("messages_against_persona"), defaultPersonas).mode).toBe(RoomMode.MessagesAgainstPersona);
  });

  test("throws if display_name is missing", () => {
    const yaml = `
mode: free_for_all
persona_ids:
  Alice: true
judge_persona_id: ""
initial_message: ""
`;
    expect(() => parseRoomYAML(yaml, defaultPersonas)).toThrow("display_name is required");
  });
});

describe("parseRoomYAML — old array format (backward compat)", () => {
  test("parses inline array of IDs", () => {
    const yaml = `
display_name: "Old Format Room"
mode: free_for_all
persona_ids: [alice-id, bob-id]
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.persona_ids).toEqual(["alice-id", "bob-id"]);
  });

  test("strips quotes from IDs in array format", () => {
    const yaml = `
display_name: "Old Format Room"
mode: free_for_all
persona_ids: ["alice-id", "bob-id"]
judge_persona_id: ""
initial_message: ""
`;
    const result = parseRoomYAML(yaml, defaultPersonas);
    expect(result.persona_ids).toEqual(["alice-id", "bob-id"]);
  });
});

describe("parseRoomYAML — TUI TEST round-trip bug", () => {
  test("display_name from buildRoomYAMLTemplate survives parseRoomYAML without quotes", () => {
    const template = buildRoomYAMLTemplate(defaultPersonas, "TUI TEST");
    const result = parseRoomYAML(template, defaultPersonas);
    expect(result.display_name).toBe("TUI TEST");
  });

  test("display_name with spaces and quotes in template is parsed correctly", () => {
    const template = buildRoomYAMLTemplate(defaultPersonas, "My Cool Room");
    const result = parseRoomYAML(template, defaultPersonas);
    expect(result.display_name).toBe("My Cool Room");
  });

  test("buildRoomYAMLTemplate excludes archived personas", () => {
    const archivedPersona = makePersona("archived-id", "ArchivedBot", true);
    const template = buildRoomYAMLTemplate([alice, archivedPersona], "Room");
    expect(template).toContain("Alice: false");
    expect(template).not.toContain("ArchivedBot");
  });
});

describe("checkAllPersonasResponded", () => {
  test("returns true when all non-judge personas have responded", () => {
    const responded = new Set(["alice-id", "bob-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id"], undefined, responded)).toBe(true);
  });

  test("returns false when any non-judge persona has not responded", () => {
    const responded = new Set(["alice-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id"], undefined, responded)).toBe(false);
  });

  test("returns false when no personas exist (empty room)", () => {
    expect(checkAllPersonasResponded([], undefined, new Set())).toBe(false);
  });

  test("returns false when all personas are the judge", () => {
    const responded = new Set(["alice-id"]);
    expect(checkAllPersonasResponded(["alice-id"], "alice-id", responded)).toBe(false);
  });

  test("judge responding does not affect the result — non-judges still required", () => {
    const responded = new Set(["alice-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id"], "alice-id", responded)).toBe(false);
  });

  test("returns true when all non-judges responded, judge has not", () => {
    const responded = new Set(["bob-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id"], "alice-id", responded)).toBe(true);
  });

  test("FFA room with no judge: all personas must respond", () => {
    const all = new Set(["alice-id", "bob-id", "charlie-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id", "charlie-id"], undefined, all)).toBe(true);
  });

  test("FFA room with no judge: partial responses return false", () => {
    const partial = new Set(["alice-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id", "charlie-id"], undefined, partial)).toBe(false);
  });

  test("room with 2 non-judges + 1 judge: only non-judges checked", () => {
    const responded = new Set(["bob-id", "charlie-id"]);
    expect(checkAllPersonasResponded(["alice-id", "bob-id", "charlie-id"], "alice-id", responded)).toBe(true);
  });
});

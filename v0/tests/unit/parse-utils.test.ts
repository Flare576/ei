import { describe, it, expect } from "vitest";
import { parseQuotedArgs, parseCommandArgs } from "../../src/parse-utils.js";

describe("parseQuotedArgs", () => {
  it("should return empty string for empty input", () => {
    expect(parseQuotedArgs("")).toBe("");
    expect(parseQuotedArgs("   ")).toBe("");
  });

  it("should return trimmed input for unquoted strings", () => {
    expect(parseQuotedArgs("mike")).toBe("mike");
    expect(parseQuotedArgs("  mike  ")).toBe("mike");
  });

  it("should return first word only for unquoted multi-word strings", () => {
    expect(parseQuotedArgs("Bob the Builder")).toBe("Bob");
    expect(parseQuotedArgs("  Mike the Mechanic  ")).toBe("Mike");
  });

  it("should extract content from double-quoted strings", () => {
    expect(parseQuotedArgs('"Bob the Builder"')).toBe("Bob the Builder");
    expect(parseQuotedArgs('  "Bob the Builder"  ')).toBe("Bob the Builder");
  });

  it("should extract content from single-quoted strings", () => {
    expect(parseQuotedArgs("'Bob the Builder'")).toBe("Bob the Builder");
    expect(parseQuotedArgs("  'Bob the Builder'  ")).toBe("Bob the Builder");
  });

  it("should handle unclosed quotes gracefully (return rest of string)", () => {
    expect(parseQuotedArgs('"Bob the Builder')).toBe("Bob the Builder");
    expect(parseQuotedArgs("'Bob the Builder")).toBe("Bob the Builder");
  });

  it("should only extract up to closing quote", () => {
    expect(parseQuotedArgs('"Bob the" Builder')).toBe("Bob the");
    expect(parseQuotedArgs("'Bob the' Builder")).toBe("Bob the");
  });

  it("should handle empty quoted strings", () => {
    expect(parseQuotedArgs('""')).toBe("");
    expect(parseQuotedArgs("''")).toBe("");
  });

  it("should return first word when quotes not at start", () => {
    expect(parseQuotedArgs('some "quoted" text')).toBe('some');
  });
});

describe("parseCommandArgs", () => {
  it("should return empty array for empty input", () => {
    expect(parseCommandArgs("")).toEqual([]);
    expect(parseCommandArgs("   ")).toEqual([]);
  });

  it("should split unquoted arguments by spaces", () => {
    expect(parseCommandArgs("add mike")).toEqual(["add", "mike"]);
    expect(parseCommandArgs("  add   mike  ")).toEqual(["add", "mike"]);
  });

  it("should preserve quoted multi-word arguments", () => {
    expect(parseCommandArgs('add "Bob the Builder"')).toEqual(["add", "Bob the Builder"]);
    expect(parseCommandArgs("add 'Mike the Mechanic'")).toEqual(["add", "Mike the Mechanic"]);
  });

  it("should handle multiple arguments with quotes", () => {
    expect(parseCommandArgs('remove "Bob the" something')).toEqual(["remove", "Bob the", "something"]);
  });

  it("should handle unclosed quotes by including to end", () => {
    expect(parseCommandArgs('add "Bob the Builder')).toEqual(["add", "Bob the Builder"]);
  });

  it("should reject unquoted multi-word as multiple args", () => {
    expect(parseCommandArgs("add Bob the Builder")).toEqual(["add", "Bob", "the", "Builder"]);
  });

  it("should handle empty quoted strings", () => {
    expect(parseCommandArgs('add ""')).toEqual(["add", ""]);
  });

  it("should handle mixed quoted and unquoted args", () => {
    expect(parseCommandArgs('cmd arg1 "quoted arg" arg2')).toEqual(["cmd", "arg1", "quoted arg", "arg2"]);
  });
});

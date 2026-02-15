import { test, expect, describe } from "bun:test";
import { parseDuration, formatDuration } from "../../../src/util/duration";

describe("parseDuration", () => {
  test("parses short minute format", () => {
    expect(parseDuration("30m")).toBe(30 * 60 * 1000);
    expect(parseDuration("1m")).toBe(60 * 1000);
  });

  test("parses long minute format", () => {
    expect(parseDuration("30min")).toBe(30 * 60 * 1000);
    expect(parseDuration("30mins")).toBe(30 * 60 * 1000);
  });

  test("parses short hour format", () => {
    expect(parseDuration("2h")).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration("1h")).toBe(60 * 60 * 1000);
  });

  test("parses long hour format", () => {
    expect(parseDuration("2hour")).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration("2hours")).toBe(2 * 60 * 60 * 1000);
  });

  test("parses short day format", () => {
    expect(parseDuration("1d")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("7d")).toBe(7 * 24 * 60 * 60 * 1000);
  });

  test("parses long day format", () => {
    expect(parseDuration("1day")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("2days")).toBe(2 * 24 * 60 * 60 * 1000);
  });

  test("parses short week format", () => {
    expect(parseDuration("1w")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("2w")).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  test("parses long week format", () => {
    expect(parseDuration("1week")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("2weeks")).toBe(2 * 7 * 24 * 60 * 60 * 1000);
  });

  test("is case-insensitive", () => {
    expect(parseDuration("30M")).toBe(30 * 60 * 1000);
    expect(parseDuration("2H")).toBe(2 * 60 * 60 * 1000);
    expect(parseDuration("1D")).toBe(24 * 60 * 60 * 1000);
    expect(parseDuration("1W")).toBe(7 * 24 * 60 * 60 * 1000);
    expect(parseDuration("30MIN")).toBe(30 * 60 * 1000);
    expect(parseDuration("2HOURS")).toBe(2 * 60 * 60 * 1000);
  });

  test("returns null for invalid input", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("30")).toBeNull();
    expect(parseDuration("m")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("30x")).toBeNull();
    expect(parseDuration("-30m")).toBeNull();
    expect(parseDuration("30 m")).toBeNull();
  });

  test("returns 0 for zero values", () => {
    expect(parseDuration("0m")).toBe(0);
    expect(parseDuration("0h")).toBe(0);
    expect(parseDuration("0d")).toBe(0);
  });
});

describe("formatDuration", () => {
  test("formats weeks correctly", () => {
    expect(formatDuration(7 * 24 * 60 * 60 * 1000)).toBe("1w");
    expect(formatDuration(14 * 24 * 60 * 60 * 1000)).toBe("2w");
    expect(formatDuration(10 * 24 * 60 * 60 * 1000)).toBe("1w");
  });

  test("formats days correctly", () => {
    expect(formatDuration(24 * 60 * 60 * 1000)).toBe("1d");
    expect(formatDuration(2 * 24 * 60 * 60 * 1000)).toBe("2d");
    expect(formatDuration(6 * 24 * 60 * 60 * 1000)).toBe("6d");
  });

  test("formats hours correctly", () => {
    expect(formatDuration(60 * 60 * 1000)).toBe("1h");
    expect(formatDuration(2 * 60 * 60 * 1000)).toBe("2h");
    expect(formatDuration(23 * 60 * 60 * 1000)).toBe("23h");
  });

  test("formats minutes correctly", () => {
    expect(formatDuration(60 * 1000)).toBe("1m");
    expect(formatDuration(30 * 60 * 1000)).toBe("30m");
    expect(formatDuration(59 * 60 * 1000)).toBe("59m");
  });

  test("uses largest appropriate unit", () => {
    expect(formatDuration(90 * 60 * 1000)).toBe("1h");
    expect(formatDuration(25 * 60 * 60 * 1000)).toBe("1d");
    expect(formatDuration(8 * 24 * 60 * 60 * 1000)).toBe("1w");
  });

  test("handles zero", () => {
    expect(formatDuration(0)).toBe("0m");
  });

  test("handles sub-minute values", () => {
    expect(formatDuration(1000)).toBe("0m");
    expect(formatDuration(30 * 1000)).toBe("0m");
  });
});

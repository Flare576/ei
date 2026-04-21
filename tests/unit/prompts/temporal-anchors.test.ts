import { describe, it, expect } from "vitest";
import { buildTemporalAnchorsSection } from "../../../src/prompts/response/sections.js";
import type { TemporalAnchor } from "../../../src/prompts/response/types.js";

const HUMAN_NAME = "Flare";

function makeAnchor(overrides: Partial<TemporalAnchor> & { role: "human" | "system" }): TemporalAnchor {
  return {
    content: "some message",
    timestamp: "2026-01-15T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildTemporalAnchorsSection", () => {
  it("returns empty string when anchors array is empty", () => {
    expect(buildTemporalAnchorsSection([], HUMAN_NAME)).toBe("");
  });

  it("includes the Temporal Anchors heading", () => {
    const anchors = [makeAnchor({ role: "system", content: "Hello there" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain("## Temporal Anchors");
  });

  it("labels system-role messages as 'You'", () => {
    const anchors = [makeAnchor({ role: "system", content: "I remember this" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain("You: I remember this");
  });

  it("labels human-role messages with humanName", () => {
    const anchors = [makeAnchor({ role: "human", content: "This meant a lot" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain(`${HUMAN_NAME}: This meant a lot`);
  });

  it("always includes a timestamp regardless of persona settings", () => {
    const anchors = [makeAnchor({ role: "human", content: "test" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toMatch(/\[.+\]/);
  });

  it("separates multiple anchors with a blank line", () => {
    const anchors = [
      makeAnchor({ role: "human", content: "first" }),
      makeAnchor({ role: "system", content: "second" }),
    ];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    const lines = result.split("\n");
    const firstIdx = lines.findIndex(l => l.includes("first"));
    const secondIdx = lines.findIndex(l => l.includes("second"));
    expect(firstIdx).toBeGreaterThanOrEqual(0);
    expect(secondIdx).toBeGreaterThan(firstIdx);
    expect(lines[firstIdx + 1]).toBe("");
  });

  it("renders synthesis messages with image wrapper", () => {
    const anchors = [makeAnchor({ role: "human", content: "a glowing city at dusk", _synthesis: true })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain(`${HUMAN_NAME} used your conversation to generate an image`);
    expect(result).toContain("a glowing city at dusk");
    expect(result).not.toContain(`${HUMAN_NAME}: a glowing city at dusk`);
  });

  it("renders human silence with human name", () => {
    const anchors = [makeAnchor({ role: "human", content: undefined, silence_reason: "needed space" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain(`${HUMAN_NAME} chose not to respond because: needed space`);
    expect(result).not.toContain("You chose not to respond");
  });

  it("renders persona silence with 'You'", () => {
    const anchors = [makeAnchor({ role: "system", content: undefined, silence_reason: "nothing to add" })];
    const result = buildTemporalAnchorsSection(anchors, HUMAN_NAME);

    expect(result).toContain("You chose not to respond because: nothing to add");
    expect(result).not.toContain(`${HUMAN_NAME} chose not to respond`);
  });
});

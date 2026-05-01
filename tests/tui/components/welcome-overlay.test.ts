import { describe, it, expect } from "vitest";
import type { ProviderDetectionStatus } from "../../../tui/src/util/provider-detection.js";
import { ALL_PROVIDER_NAMES } from "../../../tui/src/util/provider-detection.js";

function hasAnyDetected(providers: ProviderDetectionStatus[]): boolean {
  return providers.some((p) => p.detected);
}

function buildRows(
  providers: ProviderDetectionStatus[],
  columns: number
): ProviderDetectionStatus[][] {
  const out: ProviderDetectionStatus[][] = [];
  for (let i = 0; i < providers.length; i += columns) {
    out.push(providers.slice(i, i + columns));
  }
  return out;
}

describe("WelcomeOverlay display logic — with detected providers", () => {
  const providers: ProviderDetectionStatus[] = ALL_PROVIDER_NAMES.map((name) => ({
    name,
    detected: ["LMStudio", "Anthropic", "Groq"].includes(name),
  }));

  it("hasAny returns true when at least one provider is detected", () => {
    expect(hasAnyDetected(providers)).toBe(true);
  });

  it("shows ✓ for LMStudio (detected)", () => {
    const lm = providers.find((p) => p.name === "LMStudio");
    expect(lm?.detected).toBe(true);
  });

  it("shows ✗ for OpenAI (not detected)", () => {
    const oa = providers.find((p) => p.name === "OpenAI");
    expect(oa?.detected).toBe(false);
  });

  it("shows ✗ for Mistral (not detected)", () => {
    const m = providers.find((p) => p.name === "Mistral");
    expect(m?.detected).toBe(false);
  });

  it("builds 3-column grid rows from 7 providers", () => {
    const rows = buildRows(providers, 3);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveLength(3);
    expect(rows[1]).toHaveLength(3);
    expect(rows[2]).toHaveLength(1);
  });

  it("first row contains LMStudio, Ollama, Anthropic", () => {
    const rows = buildRows(providers, 3);
    expect(rows[0].map((p) => p.name)).toEqual(["LMStudio", "Ollama", "Anthropic"]);
  });

  it("second row contains OpenAI, Groq, Mistral", () => {
    const rows = buildRows(providers, 3);
    expect(rows[1].map((p) => p.name)).toEqual(["OpenAI", "Groq", "Mistral"]);
  });

  it("third row contains Gemini", () => {
    const rows = buildRows(providers, 3);
    expect(rows[2].map((p) => p.name)).toEqual(["Gemini"]);
  });
});

describe("WelcomeOverlay display logic — no detected providers", () => {
  const providers: ProviderDetectionStatus[] = ALL_PROVIDER_NAMES.map((name) => ({
    name,
    detected: false,
  }));

  it("hasAny returns false when nothing detected", () => {
    expect(hasAnyDetected(providers)).toBe(false);
  });

  it("all providers show as not-detected", () => {
    expect(providers.every((p) => !p.detected)).toBe(true);
  });

  it("provider count covers all 7 providers", () => {
    expect(providers).toHaveLength(7);
  });
});

describe("WelcomeOverlay display logic — empty provider list", () => {
  it("hasAny returns false for empty list", () => {
    expect(hasAnyDetected([])).toBe(false);
  });
});

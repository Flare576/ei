import { describe, it, expect } from "vitest";
import { getKnownContextWindow, DEFAULT_TOKEN_LIMIT } from "../../../src/core/model-context-windows.js";

describe("model-context-windows", () => {
  describe("getKnownContextWindow", () => {
    it("returns token count for exact prefix match", () => {
      expect(getKnownContextWindow("gpt-4o")).toBe(128_000);
      expect(getKnownContextWindow("claude-3.5")).toBe(200_000);
      expect(getKnownContextWindow("llama-3.3")).toBe(131_072);
    });

    it("matches model names with suffixes (prefix-based)", () => {
      expect(getKnownContextWindow("gpt-4o-2024-08-06")).toBe(128_000);
      expect(getKnownContextWindow("gpt-4o-mini")).toBe(128_000);
      expect(getKnownContextWindow("claude-3.5-sonnet")).toBe(200_000);
      expect(getKnownContextWindow("llama-3.1-8b-instruct")).toBe(131_072);
    });

    it("is case-insensitive", () => {
      expect(getKnownContextWindow("GPT-4o")).toBe(128_000);
      expect(getKnownContextWindow("Claude-3.5")).toBe(200_000);
      expect(getKnownContextWindow("LLAMA-3.3")).toBe(131_072);
    });

    it("returns undefined for unknown models", () => {
      expect(getKnownContextWindow("some-random-model")).toBeUndefined();
      expect(getKnownContextWindow("")).toBeUndefined();
      expect(getKnownContextWindow("phi-3")).toBeUndefined();
    });

    it("matches first prefix in order (more specific wins)", () => {
      // "gpt-4.1" should match before "gpt-4o" would
      expect(getKnownContextWindow("gpt-4.1-mini")).toBe(1_048_576);
      // "deepseek-coder-v2" matches before "deepseek"
      expect(getKnownContextWindow("deepseek-coder-v2-lite")).toBe(163_840);
      // "deepseek-v3" matches before generic "deepseek"
      expect(getKnownContextWindow("deepseek-v3-0324")).toBe(131_072);
    });
  });

  describe("DEFAULT_TOKEN_LIMIT", () => {
    it("is 8192", () => {
      expect(DEFAULT_TOKEN_LIMIT).toBe(8192);
    });
  });
});

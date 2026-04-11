import { describe, it, expect } from "vitest";
import {
  encodeTheme,
  decodeTheme,
  themeToStyleString,
  isBuiltInTheme,
  makeThemeDefinition,
  THEME_TOKEN_ORDER,
  BUILT_IN_THEME_NAMES,
} from "../../../../src/core/utils/theme-codec.js";

const FULL_TOKEN_MAP = Object.fromEntries(
  THEME_TOKEN_ORDER.map((key, i) => [
    `--ei-${key}`,
    `#${String(i).padStart(2, "0")}ab${String(i).padStart(2, "0")}`,
  ])
);

describe("THEME_TOKEN_ORDER", () => {
  it("contains exactly 37 tokens", () => {
    expect(THEME_TOKEN_ORDER.length).toBe(37);
  });

  it("has no duplicate tokens", () => {
    expect(new Set(THEME_TOKEN_ORDER).size).toBe(THEME_TOKEN_ORDER.length);
  });
});

describe("encodeTheme / decodeTheme roundtrip", () => {
  it("roundtrips a full token map", () => {
    const encoded = encodeTheme(FULL_TOKEN_MAP);
    const decoded = decodeTheme(encoded);
    expect(decoded).not.toBeNull();
    for (const key of THEME_TOKEN_ORDER) {
      expect(decoded![`--ei-${key}`]).toBeDefined();
    }
  });

  it("produces a string with the ei-theme:v1: prefix", () => {
    const encoded = encodeTheme(FULL_TOKEN_MAP);
    expect(encoded).toMatch(/^ei-theme:v1:/);
  });

  it("decoded values match originals (case-insensitive)", () => {
    const tokens = { "--ei-bg-primary": "#AABBCC" };
    const encoded = encodeTheme(tokens);
    const decoded = decodeTheme(encoded);
    expect(decoded!["--ei-bg-primary"]).toBe("#aabbcc");
  });

  it("accepts tokens without -- prefix", () => {
    const tokens = { "bg-primary": "#112233" };
    const encoded = encodeTheme(tokens);
    const decoded = decodeTheme(encoded);
    expect(decoded!["--ei-bg-primary"]).toBe("#112233");
  });

  it("falls back to #000000 for missing tokens", () => {
    const encoded = encodeTheme({});
    const decoded = decodeTheme(encoded);
    expect(decoded!["--ei-bg-primary"]).toBe("#000000");
  });
});

describe("decodeTheme — invalid input", () => {
  it("returns null for wrong prefix", () => {
    expect(decodeTheme("not-a-theme-string")).toBeNull();
  });

  it("returns null for wrong-length payload", () => {
    expect(decodeTheme("ei-theme:v1:" + btoa("tooshort"))).toBeNull();
  });

  it("returns null for garbage base64", () => {
    expect(decodeTheme("ei-theme:v1:!!!invalid!!!")).toBeNull();
  });
});

describe("themeToStyleString", () => {
  it("produces CSS variable declarations", () => {
    const css = themeToStyleString({ "--ei-bg-primary": "#ffffff" });
    expect(css).toContain("--ei-bg-primary: #ffffff");
  });
});

describe("isBuiltInTheme", () => {
  it("returns true for built-in names", () => {
    for (const name of BUILT_IN_THEME_NAMES) {
      expect(isBuiltInTheme(name)).toBe(true);
    }
  });

  it("returns false for unknown names", () => {
    expect(isBuiltInTheme("my-custom-theme")).toBe(false);
  });

  it("returns false for UUIDs", () => {
    expect(isBuiltInTheme("550e8400-e29b-41d4-a716-446655440000")).toBe(false);
  });
});

describe("makeThemeDefinition", () => {
  it("produces a ThemeDefinition with UUID id", () => {
    const def = makeThemeDefinition("My Theme", FULL_TOKEN_MAP);
    expect(def.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(def.name).toBe("My Theme");
    expect(def.encoded).toMatch(/^ei-theme:v1:/);
    expect(def.base).toBeUndefined();
  });

  it("stores the base when provided", () => {
    const def = makeThemeDefinition("My Spoopy", FULL_TOKEN_MAP, "spoopy");
    expect(def.base).toBe("spoopy");
  });

  it("stores a valid ISO timestamp", () => {
    const def = makeThemeDefinition("T", FULL_TOKEN_MAP);
    expect(() => new Date(def.created_at)).not.toThrow();
  });
});

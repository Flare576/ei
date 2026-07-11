import { test, expect, describe } from "bun:test";
import { shouldShowUpgradePrompt } from "../../../src/util/upgrade-prompt";

describe("shouldShowUpgradePrompt", () => {
  test("returns true when installedVersion is present and differs from currentVersion", () => {
    expect(shouldShowUpgradePrompt("1.0.0", "1.1.0")).toBe(true);
  });

  test("returns false when installedVersion is absent (undefined) — first-boot semantics", () => {
    expect(shouldShowUpgradePrompt(undefined, "1.1.0")).toBe(false);
  });

  test("returns false when installedVersion equals currentVersion — already up to date", () => {
    expect(shouldShowUpgradePrompt("1.1.0", "1.1.0")).toBe(false);
  });

  test("returns false when installedVersion is an empty string — treated as absent, not a differing version", () => {
    expect(shouldShowUpgradePrompt("", "1.1.0")).toBe(false);
  });
});

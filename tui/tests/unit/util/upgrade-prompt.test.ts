import { test, expect, describe } from "bun:test";
import { shouldShowUpgradePrompt } from "../../../src/util/upgrade-prompt";

describe("shouldShowUpgradePrompt", () => {
  test("returns true when installedVersion is present and differs from currentVersion", () => {
    expect(shouldShowUpgradePrompt("1.0.0", "1.1.0")).toBe(true);
  });

  test("returns true when installedVersion is absent (undefined) — an existing install with no record is stale", () => {
    expect(shouldShowUpgradePrompt(undefined, "1.1.0")).toBe(true);
  });

  test("returns false when installedVersion equals currentVersion — already up to date", () => {
    expect(shouldShowUpgradePrompt("1.1.0", "1.1.0")).toBe(false);
  });

  test("returns true when installedVersion is an empty string — treated as absent (stale)", () => {
    expect(shouldShowUpgradePrompt("", "1.1.0")).toBe(true);
  });
});

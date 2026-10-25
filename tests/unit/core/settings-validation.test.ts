import { describe, it, expect } from "vitest";
import { assertPositiveSetting, positiveSettingError } from "../../../src/core/settings-validation.js";

describe("settings-validation", () => {
  it("accepts undefined (use default) and positive finite numbers", () => {
    expect(positiveSettingError("f", undefined)).toBeUndefined();
    expect(positiveSettingError("f", 1)).toBeUndefined();
    expect(positiveSettingError("f", 0.5)).toBeUndefined();
  });

  it.each([0, -1, NaN, Infinity, -Infinity, "5", null])("rejects %s with a message naming the field", (v) => {
    expect(() => assertPositiveSetting("backup.max_backups", v)).toThrow(/backup\.max_backups/);
  });
});

import { heartbeatSettingError, MIN_HEARTBEAT_MS } from "../../../src/core/settings-validation.js";
describe("heartbeat minimum", () => {
  it("is 5 minutes; rejects below it, accepts exactly it and undefined", () => {
    expect(MIN_HEARTBEAT_MS).toBe(300000);
    expect(heartbeatSettingError("h", undefined)).toBeUndefined();
    expect(heartbeatSettingError("h", 300000)).toBeUndefined();
    expect(heartbeatSettingError("h", 299999)).toMatch(/h must be at least 5 minutes/);
    expect(heartbeatSettingError("h", 0)).toBeDefined();
    expect(heartbeatSettingError("h", NaN)).toBeDefined();
  });
});

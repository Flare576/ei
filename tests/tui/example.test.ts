import { describe, it, expect } from "vitest";

describe("OpenTUI environment", () => {
  it("should have solid-js available", async () => {
    const module = await import("solid-js");
    expect(module).toBeDefined();
  });

  it("should do basic math", () => {
    expect(1 + 1).toBe(2);
  });
});

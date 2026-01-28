import { describe, it, expect } from "vitest";

describe("Vitest Setup", () => {
  it("should run tests", () => {
    expect(1 + 1).toBe(2);
  });

  it("should import from src", async () => {
    const { ContextStatus } = await import("../../src/core/types.js");
    expect(ContextStatus.Default).toBe("default");
    expect(ContextStatus.Always).toBe("always");
    expect(ContextStatus.Never).toBe("never");
  });

  it("should import enums", async () => {
    const { LLMRequestType, LLMPriority, LLMNextStep } = await import(
      "../../src/core/types.js"
    );
    expect(LLMRequestType.Response).toBe("response");
    expect(LLMRequestType.JSON).toBe("json");
    expect(LLMRequestType.Raw).toBe("raw");
    expect(LLMPriority.High).toBe("high");
    expect(LLMPriority.Normal).toBe("normal");
    expect(LLMPriority.Low).toBe("low");
    expect(LLMNextStep.HandlePersonaResponse).toBe("handlePersonaResponse");
  });
});

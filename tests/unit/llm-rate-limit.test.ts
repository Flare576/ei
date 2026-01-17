import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

class MockOpenAI {
  chat = { completions: { create: mockCreate } };
}

vi.mock("openai", () => ({
  default: MockOpenAI,
}));

describe("rate limit retry behavior", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    vi.useFakeTimers();
    mockCreate.mockReset();
    process.env.EI_OPENAI_API_KEY = "test-key";
    process.env.EI_ANTHROPIC_API_KEY = "test-key";
    
    const { clearClientCache } = await import("../../src/llm.js");
    clearClientCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
  });

  it("retries on 429 with exponential backoff", async () => {
    mockCreate
      .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error("Rate limited"), { status: 429 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Success" }, finish_reason: "stop" }],
      });

    const { callLLM, clearClientCache } = await import("../../src/llm.js");
    clearClientCache();

    const promise = callLLM("system", "user", { model: "openai:gpt-4o" });
    
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    
    const result = await promise;
    
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result).toBe("Success");
  });

  it("retries on 529 (Anthropic overload)", async () => {
    mockCreate
      .mockRejectedValueOnce(Object.assign(new Error("Overloaded"), { status: 529 }))
      .mockResolvedValueOnce({
        choices: [{ message: { content: "Success" }, finish_reason: "stop" }],
      });

    const { callLLM, clearClientCache } = await import("../../src/llm.js");
    clearClientCache();

    const promise = callLLM("system", "user", { model: "anthropic:claude-3" });
    
    await vi.advanceTimersByTimeAsync(1000);
    
    const result = await promise;
    
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toBe("Success");
  });

  it("throws after max retries exhausted", async () => {
    const rateLimitError = Object.assign(new Error("Rate limited"), { status: 429 });
    mockCreate.mockRejectedValue(rateLimitError);

    const { callLLM, clearClientCache, MAX_RETRIES } = await import("../../src/llm.js");
    clearClientCache();

    let thrownError: unknown = null;
    const promise = callLLM("system", "user", { model: "openai:gpt-4o" }).catch((err: unknown) => {
      thrownError = err;
    });
    
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(2000);
    await vi.advanceTimersByTimeAsync(4000);
    
    await promise;
    
    expect(thrownError).not.toBeNull();
    expect(thrownError).toBeInstanceOf(Error);
    expect((thrownError as Error).message).toContain("Rate limited");
    expect(mockCreate).toHaveBeenCalledTimes(MAX_RETRIES + 1);
  });

  it("does not retry non-rate-limit errors", async () => {
    const serverError = Object.assign(new Error("Internal error"), { status: 500 });
    mockCreate.mockRejectedValue(serverError);

    const { callLLM, clearClientCache } = await import("../../src/llm.js");
    clearClientCache();

    await expect(callLLM("system", "user", { model: "openai:gpt-4o" })).rejects.toThrow("Internal error");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("uses correct backoff timing", async () => {
    const { INITIAL_BACKOFF_MS } = await import("../../src/llm.js");
    
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 0)).toBe(1000);
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 1)).toBe(2000);
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 2)).toBe(4000);
  });
});

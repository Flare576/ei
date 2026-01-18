import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockCreate = vi.fn();

class MockOpenAI {
  chat = { completions: { create: mockCreate } };
}

vi.mock("openai", () => ({
  default: MockOpenAI,
}));

describe("callLLMForJSON retry behavior", () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    mockCreate.mockReset();
    process.env.EI_LLM_MODEL = "local:test-model";
    
    const { clearClientCache } = await import("../../src/llm.js");
    clearClientCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns parsed JSON on first attempt success", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ 
        message: { content: '{"key": "value"}' }, 
        finish_reason: "stop" 
      }],
    });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ key: string }>("system", "user");

    expect(result).toEqual({ key: "value" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("handles JSON wrapped in markdown code fences", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ 
        message: { content: '```json\n{"key": "value"}\n```' }, 
        finish_reason: "stop" 
      }],
    });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ key: string }>("system", "user");

    expect(result).toEqual({ key: "value" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries with enhanced prompt when first parse fails", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: "Here's the result: INVALID JSON" }, 
          finish_reason: "stop" 
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: '{"key": "value"}' }, 
          finish_reason: "stop" 
        }],
      });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ key: string }>("system", "user");

    expect(result).toEqual({ key: "value" });
    expect(mockCreate).toHaveBeenCalledTimes(2);
    
    const secondCallArgs = mockCreate.mock.calls[1][0];
    expect(secondCallArgs.messages[0].content).toContain("CRITICAL: Your response MUST be valid JSON");
  });

  it("throws error when both attempts fail to parse", async () => {
    mockCreate
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: "INVALID JSON" }, 
          finish_reason: "stop" 
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: "STILL INVALID JSON" }, 
          finish_reason: "stop" 
        }],
      });

    const { callLLMForJSON } = await import("../../src/llm.js");
    
    await expect(
      callLLMForJSON<{ key: string }>("system", "user")
    ).rejects.toThrow("Invalid JSON from LLM even after retry with enhanced guidance");
    
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("applies JSON repairs before retrying", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ 
        message: { content: '{"key": "value",}' },
        finish_reason: "stop" 
      }],
    });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ key: string }>("system", "user");

    expect(result).toEqual({ key: "value" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("returns null when LLM returns no content on first call", async () => {
    mockCreate.mockResolvedValue({
      choices: [{ 
        message: { content: "" }, 
        finish_reason: "stop" 
      }],
    });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ key: string }>("system", "user");

    expect(result).toBeNull();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("throws LLMTruncatedError when response is truncated", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ 
        message: { content: '{"key": "val' }, 
        finish_reason: "length" 
      }],
    });

    const { callLLMForJSON, LLMTruncatedError } = await import("../../src/llm.js");
    
    await expect(
      callLLMForJSON<{ key: string }>("system", "user")
    ).rejects.toThrow(LLMTruncatedError);
    
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("does not retry when truncation error occurs", async () => {
    mockCreate.mockResolvedValueOnce({
      choices: [{ 
        message: { content: '{"key": "val' }, 
        finish_reason: "length" 
      }],
    });

    const { callLLMForJSON, LLMTruncatedError } = await import("../../src/llm.js");
    
    await expect(
      callLLMForJSON<{ key: string }>("system", "user")
    ).rejects.toThrow(LLMTruncatedError);
    
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries with realistic malformed JSON (explanation + JSON)", async () => {
    const malformedResponse = `Sure! Here are the concepts:
{
  "name": "programming",
  "level": 0.8
}
Let me know if you need anything else!`;

    mockCreate
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: malformedResponse }, 
          finish_reason: "stop" 
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: '{"name": "programming", "level": 0.8}' }, 
          finish_reason: "stop" 
        }],
      });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ name: string; level: number }>("system", "user");

    expect(result).toEqual({ name: "programming", level: 0.8 });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("retries with realistic malformed JSON (trailing comma)", async () => {
    const malformedResponse = `[
  {"name": "test", "value": 0.5},
  {"name": "another", "value": 0.7},
]`;

    mockCreate
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: malformedResponse }, 
          finish_reason: "stop" 
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: '[{"name": "test", "value": 0.5}, {"name": "another", "value": 0.7}]' }, 
          finish_reason: "stop" 
        }],
      });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<Array<{ name: string; value: number }>>("system", "user");

    expect(result).toEqual([
      { name: "test", value: 0.5 },
      { name: "another", value: 0.7 }
    ]);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries with realistic malformed JSON (incomplete response)", async () => {
    const malformedResponse = 'Here is the JSON data: {"name": "incomplete"';

    mockCreate
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: malformedResponse }, 
          finish_reason: "stop" 
        }],
      })
      .mockResolvedValueOnce({
        choices: [{ 
          message: { content: '{"name": "complete", "status": "ok"}' }, 
          finish_reason: "stop" 
        }],
      });

    const { callLLMForJSON } = await import("../../src/llm.js");
    const result = await callLLMForJSON<{ name: string; status: string }>("system", "user");

    expect(result).toEqual({ name: "complete", status: "ok" });
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });
});

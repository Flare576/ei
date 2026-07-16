import { afterEach, describe, expect, it, vi } from "vitest";
import { callLLMRaw } from "../../../src/core/llm-client.js";
import { ProviderType } from "../../../src/core/types.js";
import type { ModelConfig, ProviderAccount } from "../../../src/core/types.js";

const originalFetch = globalThis.fetch;

function makeResponse() {
  return {
    choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
  };
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("callLLMRaw — known defaults for provider default models", () => {
  it("applies known model defaults when a bare provider spec resolves its default model", async () => {
    const model: ModelConfig = {
      id: crypto.randomUUID(),
      name: "claude-opus-4-8",
    };
    const account: ProviderAccount = {
      id: crypto.randomUUID(),
      name: "Anthropic",
      type: ProviderType.LLM,
      url: "https://api.anthropic.com/v1",
      enabled: true,
      created_at: new Date().toISOString(),
      default_model: model.id,
      models: [model],
    };
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(makeResponse()),
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    await callLLMRaw("sys", "user", [], "Anthropic", {}, [account]);

    const [, request] = mockFetch.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(request.body as string) as Record<string, unknown>;
    expect(body.model).toBe("claude-opus-4-8");
    expect("temperature" in body).toBe(false);
    expect(body.max_tokens).toBe(128000);
  });
});

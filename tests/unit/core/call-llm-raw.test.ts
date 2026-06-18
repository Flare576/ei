import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const originalFetch = globalThis.fetch;
const originalVerbose = process.env.EI_DEBUG_NETWORK_VERBOSE;
import { callLLMRaw } from "../../../src/core/llm-client.js";
import { ProviderType } from "../../../src/core/types.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types.js";

function makeModel(name: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
  return { id: crypto.randomUUID(), name, ...overrides };
}

function makeAccount(
  name: string,
  models: ModelConfig[],
  overrides: Partial<ProviderAccount> = {}
): ProviderAccount {
  return {
    id: crypto.randomUUID(),
    name,
    type: ProviderType.LLM,
    url: "http://localhost:1234/v1",
    enabled: true,
    created_at: new Date().toISOString(),
    models,
    ...overrides,
  };
}

function stubFetch(responseBody: unknown) {
  const mockFetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve(responseBody),
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  return mockFetch;
}

function getCapturedBody(mockFetch: ReturnType<typeof vi.fn>): Record<string, unknown> {
  const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

function makeLLMResponse(usage?: { prompt_tokens?: number; completion_tokens?: number; input_tokens?: number; output_tokens?: number }) {
  return {
    choices: [{ message: { role: "assistant", content: "Hello!" }, finish_reason: "stop" }],
    ...(usage ? { usage } : {}),
  };
}

beforeEach(() => {
  delete process.env.EI_DEBUG_NETWORK_VERBOSE;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalVerbose === undefined) delete process.env.EI_DEBUG_NETWORK_VERBOSE;
  else process.env.EI_DEBUG_NETWORK_VERBOSE = originalVerbose;
});

describe("callLLMRaw — max_tokens resolution", () => {
  it("uses ModelConfig.max_output_tokens when set", async () => {
    const model = makeModel("llama-3-8b", { max_output_tokens: 32768 });
    const account = makeAccount("Local LLM", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], `Local LLM:llama-3-8b`, {}, [account]);

    expect(getCapturedBody(mockFetch).max_tokens).toBe(32768);
  });

  it("falls back to 8000 when ModelConfig has no max_output_tokens", async () => {
    const model = makeModel("llama-3-8b");
    const account = makeAccount("Local LLM", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], `Local LLM:llama-3-8b`, {}, [account]);

    expect(getCapturedBody(mockFetch).max_tokens).toBe(8000);
  });
});

describe("callLLMRaw — model field in request body", () => {
  it("includes model field for named models", async () => {
    const model = makeModel("claude-opus-4");
    const account = makeAccount("Anthropic", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], `Anthropic:claude-opus-4`, {}, [account]);

    expect(getCapturedBody(mockFetch).model).toBe("claude-opus-4");
  });

  it("omits model field for 'default' sentinel models", async () => {
    const model = makeModel("default");
    const account = makeAccount("LMStudio", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], `LMStudio:default`, {}, [account]);

    expect("model" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("omits model field when resolved via GUID for a 'default' sentinel model", async () => {
    const model = makeModel("default");
    const account = makeAccount("LMStudio", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], model.id, {}, [account]);

    expect("model" in getCapturedBody(mockFetch)).toBe(false);
  });
});

describe("callLLMRaw — usage counter callback", () => {
  it("calls onUsageUpdate with modelId and token counts (OpenAI format)", async () => {
    const model = makeModel("claude-haiku-4-5", { max_output_tokens: 8192 });
    const account = makeAccount("Anthropic", [model]);
    stubFetch(makeLLMResponse({ prompt_tokens: 500, completion_tokens: 150 }));

    const onUsageUpdate = vi.fn();

    await callLLMRaw("sys", "user", [], `Anthropic:claude-haiku-4-5`, { onUsageUpdate }, [account]);

    expect(onUsageUpdate).toHaveBeenCalledOnce();
    const [calledModelId, usage] = onUsageUpdate.mock.calls[0];
    expect(calledModelId).toBe(model.id);
    expect(usage.calls).toBe(1);
    expect(usage.tokens_in).toBe(500);
    expect(usage.tokens_out).toBe(150);
  });

  it("calls onUsageUpdate with token counts using Anthropic-style field names", async () => {
    const model = makeModel("claude-opus-4");
    const account = makeAccount("Anthropic", [model]);
    stubFetch({
      choices: [{ message: { role: "assistant", content: "Hi" }, finish_reason: "stop" }],
      usage: { input_tokens: 300, output_tokens: 100 },
    });

    const onUsageUpdate = vi.fn();

    await callLLMRaw("sys", "user", [], `Anthropic:claude-opus-4`, { onUsageUpdate }, [account]);

    expect(onUsageUpdate).toHaveBeenCalledOnce();
    const [, usage] = onUsageUpdate.mock.calls[0];
    expect(usage.tokens_in).toBe(300);
    expect(usage.tokens_out).toBe(100);
  });

  it("does not call onUsageUpdate when modelConfig not found (unknown GUID fallback)", async () => {
    const defaultModel = makeModel("default");
    const account = makeAccount("Fallback", [makeModel("gpt-4o"), defaultModel], {
      default_model: defaultModel.id,
    });
    stubFetch(makeLLMResponse());

    const onUsageUpdate = vi.fn();

    await callLLMRaw("sys", "user", [], crypto.randomUUID(), { onUsageUpdate }, [account]);

    expect(onUsageUpdate).not.toHaveBeenCalled();
  });

  it("does not throw when onUsageUpdate is not provided", async () => {
    const model = makeModel("gpt-4o");
    const account = makeAccount("OpenAI", [model]);
    stubFetch(makeLLMResponse({ prompt_tokens: 100, completion_tokens: 50 }));

    await expect(
      callLLMRaw("sys", "user", [], `OpenAI:gpt-4o`, {}, [account])
    ).resolves.toBeDefined();
  });
});

describe("callLLMRaw — temperature handling", () => {
  it("sends temperature by default (no ModelConfig flags set)", async () => {
    const model = makeModel("gpt-4o");
    const account = makeAccount("OpenAI", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "OpenAI:gpt-4o", {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect("temperature" in body).toBe(true);
    expect(body.temperature).toBe(0.7);
  });

  it("omits temperature when ModelConfig has temperature_disabled: true", async () => {
    // Oracle: Anthropic's claude-opus-4-8 rejects temperature entirely.
    // temperature_disabled on the ModelConfig signals this to the client.
    const model = makeModel("claude-opus-4-8", { temperature_disabled: true });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-opus-4-8", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("sends temperature when temperature_disabled is explicitly false", async () => {
    const model = makeModel("claude-sonnet-4-6", { temperature_disabled: false });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-sonnet-4-6", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(true);
  });

  it("omits temperature when thinking_budget > 0 (Anthropic extended thinking rejects it)", async () => {
    // Oracle: Anthropic's /chat/completions endpoint returns 400 if both temperature
    // and extended thinking parameters are present in the same request.
    const model = makeModel("claude-sonnet-4-6", { thinking_budget: 8000 });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-sonnet-4-6", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("sends temperature when thinking_budget is 0 (thinking disabled, temperature allowed)", async () => {
    // Oracle: thinking_budget=0 is the kill switch that disables thinking entirely.
    // With thinking off, temperature is a valid parameter and should be forwarded.
    const model = makeModel("claude-sonnet-4-6", { thinking_budget: 0 });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-sonnet-4-6", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(true);
  });

  it("omits temperature when both temperature_disabled and thinking_budget=0 set (flag wins)", async () => {
    // temperature_disabled is an unconditional model-level contract; thinking_budget is orthogonal.
    const model = makeModel("claude-opus-4-8", { temperature_disabled: true, thinking_budget: 0 });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-opus-4-8", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("respects a custom temperature value from options when temperature is not disabled", async () => {
    const model = makeModel("gpt-4o");
    const account = makeAccount("OpenAI", [model]);
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "OpenAI:gpt-4o", { temperature: 0.3 }, [account]);

    expect(getCapturedBody(mockFetch).temperature).toBe(0.3);
  });

  it("omits temperature even when a custom temperature is provided via options but model disables it", async () => {
    // The model-level contract overrides the caller's requested temperature.
    const model = makeModel("claude-opus-4-8", { temperature_disabled: true });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-opus-4-8", { temperature: 0.3 }, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("sends temperature when no ModelConfig is found (unknown model spec falls through to default)", async () => {
    // No ModelConfig means no flags — safe default is to include temperature.
    const model = makeModel("claude-haiku-4-5");
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-haiku-4-5", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(true);
  });
});

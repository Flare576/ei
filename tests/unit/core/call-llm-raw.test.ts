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

  it("uses KNOWN_MODEL_LIMITS max_output_tokens fallback when ModelConfig has no explicit value", async () => {
    const model = makeModel("opus", { model_id: "claude-opus-4-8" });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:opus", {}, [account]);

    expect(getCapturedBody(mockFetch).max_tokens).toBe(128000);
  });

  it("explicit max_output_tokens overrides the KNOWN_MODEL_LIMITS fallback", async () => {
    const model = makeModel("opus", { model_id: "claude-opus-4-8", max_output_tokens: 50000 });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:opus", {}, [account]);

    expect(getCapturedBody(mockFetch).max_tokens).toBe(50000);
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

  it("rejects an unknown GUID before provider dispatch even when an account default_model exists", async () => {
    const defaultModel = makeModel("default");
    const account = makeAccount("Fallback", [makeModel("gpt-4o"), defaultModel], {
      default_model: defaultModel.id,
    });
    const mockFetch = stubFetch(makeLLMResponse());
    const onUsageUpdate = vi.fn();
    const unknownGuid = crypto.randomUUID();

    await expect(
      callLLMRaw("sys", "user", [], unknownGuid, { onUsageUpdate }, [account])
    ).rejects.toThrow(`Model "${unknownGuid}" not found`);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(onUsageUpdate).not.toHaveBeenCalled();
  });

  it("rejects an unknown GUID before provider dispatch when account configuration is absent", async () => {
    const mockFetch = stubFetch(makeLLMResponse());
    const onUsageUpdate = vi.fn();
    const unknownGuid = crypto.randomUUID();

    await expect(
      callLLMRaw("sys", "user", [], unknownGuid, { onUsageUpdate }, undefined)
    ).rejects.toThrow(`Model "${unknownGuid}" not found`);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(onUsageUpdate).not.toHaveBeenCalled();
  });

  it("rejects an ambiguously owned GUID before provider dispatch", async () => {
    const duplicateId = crypto.randomUUID();
    const firstAccount = makeAccount("First", [makeModel("first-model", { id: duplicateId })]);
    const secondAccount = makeAccount("Second", [makeModel("second-model", { id: duplicateId })]);
    const mockFetch = stubFetch(makeLLMResponse());

    await expect(
      callLLMRaw("sys", "user", [], duplicateId, {}, [firstAccount, secondAccount])
    ).rejects.toThrow(`Model "${duplicateId}" is ambiguous`);

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("rejects a GUID owned only by a disabled account before provider dispatch", async () => {
    const disabledModel = makeModel("disabled-model");
    const disabledAccount = makeAccount("Disabled", [disabledModel], { enabled: false });
    const fallbackModel = makeModel("default");
    const fallbackAccount = makeAccount("Fallback", [fallbackModel], {
      default_model: fallbackModel.id,
    });
    const mockFetch = stubFetch(makeLLMResponse());

    await expect(
      callLLMRaw("sys", "user", [], disabledModel.id, {}, [disabledAccount, fallbackAccount])
    ).rejects.toThrow(`Model "${disabledModel.id}" not found`);

    expect(mockFetch).not.toHaveBeenCalled();
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

  it("omits temperature via KNOWN_MODEL_LIMITS fallback when ModelConfig has no explicit temperature_disabled but model_id matches a known model", async () => {
    // Production bug scenario: a user hand-edited a model entry, and temperature_disabled got dropped.
    // The fallback to KNOWN_MODEL_LIMITS should rescue it.
    const model = makeModel("opus", { model_id: "claude-opus-4-8" });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:opus", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });

  it("sends temperature when explicit temperature_disabled: false overrides a KNOWN_MODEL_LIMITS true entry", async () => {
    // Override scenario: a model whose id matches a known 'always disabled' entry, but the user
    // has explicitly set it to false for a different backend (e.g., Bedrock vs Anthropic API).
    const model = makeModel("opus", { model_id: "claude-opus-4-8", temperature_disabled: false });
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:opus", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(true);
  });

  it("omits temperature via KNOWN_MODEL_LIMITS fallback when matched by name (no model_id set)", async () => {
    // Name-based fallback: the model name itself matches a KNOWN_MODEL_LIMITS entry that disables temperature.
    const model = makeModel("claude-sonnet-5");
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-sonnet-5", {}, [account]);

    expect("temperature" in getCapturedBody(mockFetch)).toBe(false);
  });
});

describe("callLLMRaw — resolved-model/known-limits unification (Beta review I1)", () => {
  it("T1 (P0): bare account-name spec with a default_model resolves the SAME ModelConfig used for known-limits fallback", async () => {
    // Beta's repro: resolveModel() picks the account's default_model for the outbound `model`
    // field, but the separate modelConfig lookup used to miss it entirely for bare specs,
    // so a known temperature-rejecting model still got sent `temperature`.
    const model = makeModel("claude-opus-4-8");
    const account = makeAccount("Anthropic", [model], {
      url: "https://api.anthropic.com/v1",
      default_model: model.id,
    });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic", {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect(body.model).toBe("claude-opus-4-8");
    expect("temperature" in body).toBe(false);
    expect(body.max_tokens).toBe(128000);
  });

  it("T1-R (P0): auto-detected name-valued default_model resolves known limits", async () => {
    const model = makeModel("claude-opus-4-8");
    const account = makeAccount("Anthropic", [model], {
      url: "https://api.anthropic.com/v1",
      default_model: model.name,
    });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic", {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect(body.model).toBe("claude-opus-4-8");
    expect("temperature" in body).toBe(false);
    expect(body.max_tokens).toBe(128000);
  });

  it("T1-M (P1): model_id-valued default_model resolves known limits", async () => {
    const model = makeModel("opus", { model_id: "claude-opus-4-8" });
    const account = makeAccount("Anthropic", [model], {
      url: "https://api.anthropic.com/v1",
      default_model: model.model_id,
    });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic", {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect(body.model).toBe("claude-opus-4-8");
    expect("temperature" in body).toBe(false);
    expect(body.max_tokens).toBe(128000);
  });

  it("T2 (P1): model GUID spec for a known model resolves known-limits fallback", async () => {
    const model = makeModel("claude-opus-4-8");
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], model.id, {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect("temperature" in body).toBe(false);
    expect(body.max_tokens).toBe(128000);
  });

  it("T3 (P1): a known model record without temperature_disabled must not imply temperature is disabled", async () => {
    // Table membership alone (claude-opus-4-7 has max_output_tokens but no temperature_disabled)
    // must not leak into the temperature decision for that entry.
    const model = makeModel("claude-opus-4-7");
    const account = makeAccount("Anthropic", [model], { url: "https://api.anthropic.com/v1" });
    const mockFetch = stubFetch(makeLLMResponse());

    await callLLMRaw("sys", "user", [], "Anthropic:claude-opus-4-7", {}, [account]);

    const body = getCapturedBody(mockFetch);
    expect("temperature" in body).toBe(true);
    expect(body.max_tokens).toBe(128000);
  });
});

import { describe, it, expect } from "vitest";
import { resolveTokenLimit } from "../../../src/core/llm-client.js";
import { ProviderType, type ProviderAccount, type ModelConfig } from "../../../src/core/types.js";

const DEFAULT_CONTEXT_WINDOW = 8192;

function createAccount(overrides: Partial<ProviderAccount> = {}): ProviderAccount {
  return {
    id: crypto.randomUUID(),
    name: "TestProvider",
    type: ProviderType.LLM,
    url: "http://localhost:1234/v1",
    enabled: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function createModel(overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: crypto.randomUUID(),
    name: "test-model",
    ...overrides,
  };
}

describe("resolveTokenLimit", () => {
  it("returns user override when account has token_limit set", () => {
    const accounts = [createAccount({ token_limit: 50_000 })];
    expect(resolveTokenLimit("TestProvider:some-model", accounts)).toBe(50_000);
  });

  it("falls back to default when no user override", () => {
    const accounts = [createAccount()];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("returns default for unknown model with no override", () => {
    const accounts = [createAccount()];
    expect(resolveTokenLimit("TestProvider:unknown-model", accounts)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("returns default when no modelSpec and no accounts", () => {
    expect(resolveTokenLimit()).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveTokenLimit("")).toBe(DEFAULT_CONTEXT_WINDOW);
    expect(resolveTokenLimit(undefined, [])).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("user override takes priority over default", () => {
    const accounts = [createAccount({ token_limit: 42_000, default_model: "gpt-4o" })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(42_000);
  });

  it("resolves model from account default_model when bare provider name used", () => {
    const accounts = [createAccount({ default_model: "claude-3.5-sonnet" })];
    expect(resolveTokenLimit("TestProvider", accounts)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("matches provider name case-insensitively", () => {
    const accounts = [createAccount({ name: "MyProvider", token_limit: 60_000 })];
    expect(resolveTokenLimit("myprovider:model", accounts)).toBe(60_000);
  });

  it("skips disabled accounts", () => {
    const accounts = [createAccount({ token_limit: 99_999, enabled: false })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(DEFAULT_CONTEXT_WINDOW);
  });

  it("legacy 'Provider:model' returns ModelConfig.context_window when set", () => {
    const model = createModel({ name: "gpt-4o", context_window: 128_000 });
    const accounts = [createAccount({ models: [model] })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(128_000);
  });

  it("ModelConfig.context_window takes priority over account.token_limit", () => {
    const model = createModel({ name: "gpt-4o", context_window: 128_000 });
    const accounts = [createAccount({ models: [model], token_limit: 50_000 })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(128_000);
  });

  it("GUID input: returns ModelConfig.context_window when set", () => {
    const modelId = crypto.randomUUID();
    const model = createModel({ id: modelId, context_window: 100_000 });
    const accounts = [createAccount({ models: [model] })];
    expect(resolveTokenLimit(modelId, accounts)).toBe(100_000);
  });

  it("GUID input: falls back to account token_limit when ModelConfig has no context_window", () => {
    const modelId = crypto.randomUUID();
    const model = createModel({ id: modelId });
    const accounts = [createAccount({ models: [model], token_limit: 50_000 })];
    expect(resolveTokenLimit(modelId, accounts)).toBe(50_000);
  });

  it("GUID input: falls back to DEFAULT_CONTEXT_WINDOW when no context_window or token_limit", () => {
    const modelId = crypto.randomUUID();
    const model = createModel({ id: modelId });
    const accounts = [createAccount({ models: [model] })];
    expect(resolveTokenLimit(modelId, accounts)).toBe(DEFAULT_CONTEXT_WINDOW);
  });
});

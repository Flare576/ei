import { describe, it, expect } from "vitest";
import { resolveTokenLimit } from "../../../src/core/llm-client.js";
import { DEFAULT_TOKEN_LIMIT } from "../../../src/core/model-context-windows.js";
import { ProviderType, type ProviderAccount } from "../../../src/core/types.js";

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

describe("resolveTokenLimit", () => {
  it("returns user override when account has token_limit set", () => {
    const accounts = [createAccount({ token_limit: 50_000 })];
    expect(resolveTokenLimit("TestProvider:some-model", accounts)).toBe(50_000);
  });

  it("uses lookup table when no user override", () => {
    const accounts = [createAccount()];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(128_000);
  });

  it("returns default for unknown model with no override", () => {
    const accounts = [createAccount()];
    expect(resolveTokenLimit("TestProvider:unknown-model", accounts)).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it("returns default when no modelSpec and no accounts", () => {
    expect(resolveTokenLimit()).toBe(DEFAULT_TOKEN_LIMIT);
    expect(resolveTokenLimit("")).toBe(DEFAULT_TOKEN_LIMIT);
    expect(resolveTokenLimit(undefined, [])).toBe(DEFAULT_TOKEN_LIMIT);
  });

  it("user override takes priority over lookup table", () => {
    const accounts = [createAccount({ token_limit: 42_000, default_model: "gpt-4o" })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(42_000);
  });

  it("resolves model from account default_model when bare provider name used", () => {
    const accounts = [createAccount({ default_model: "claude-3.5-sonnet" })];
    expect(resolveTokenLimit("TestProvider", accounts)).toBe(200_000);
  });

  it("matches provider name case-insensitively", () => {
    const accounts = [createAccount({ name: "MyProvider", token_limit: 60_000 })];
    expect(resolveTokenLimit("myprovider:model", accounts)).toBe(60_000);
  });

  it("skips disabled accounts", () => {
    const accounts = [createAccount({ token_limit: 99_999, enabled: false })];
    expect(resolveTokenLimit("TestProvider:gpt-4o", accounts)).toBe(128_000);
  });
});

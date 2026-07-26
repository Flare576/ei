import { describe, it, expect } from "vitest";
import { resolveModel, resolveModelById, getDisplayName } from "../../../src/core/llm-client.js";
import { ProviderType } from "../../../src/core/types.js";
import type { ProviderAccount, ModelConfig } from "../../../src/core/types.js";

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────

function createModel(name: string, overrides: Partial<ModelConfig> = {}): ModelConfig {
  return {
    id: crypto.randomUUID(),
    name,
    ...overrides,
  };
}

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

// ──────────────────────────────────────────────
// resolveModelById
// ──────────────────────────────────────────────

describe("resolveModelById", () => {
  it("finds a model by GUID in a single account", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ models: [model] });
    const result = resolveModelById(model.id, [account]);
    expect(result).toBeDefined();
    expect(result!.model.id).toBe(model.id);
    expect(result!.account.name).toBe("TestProvider");
  });

  it("returns undefined when GUID not found in any account", () => {
    const account = createAccount({ models: [createModel("gpt-4o")] });
    expect(resolveModelById(crypto.randomUUID(), [account])).toBeUndefined();
  });

  it("skips disabled accounts", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ models: [model], enabled: false });
    expect(resolveModelById(model.id, [account])).toBeUndefined();
  });

  it("skips non-llm accounts", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ models: [model], type: ProviderType.Storage });
    expect(resolveModelById(model.id, [account])).toBeUndefined();
  });

  it("searches across multiple accounts and returns the matching one", () => {
    const model1 = createModel("gpt-4o");
    const model2 = createModel("claude-opus-4");
    const account1 = createAccount({ name: "OpenAI", models: [model1] });
    const account2 = createAccount({ name: "Anthropic", models: [model2] });
    const result = resolveModelById(model2.id, [account1, account2]);
    expect(result!.account.name).toBe("Anthropic");
    expect(result!.model.name).toBe("claude-opus-4");
  });
});

// ──────────────────────────────────────────────
// getDisplayName
// ──────────────────────────────────────────────

describe("getDisplayName", () => {
  it("returns 'Provider:model' format", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "OpenAI" });
    expect(getDisplayName(account, model)).toBe("OpenAI:gpt-4o");
  });

  it("returns just 'Provider' (no colon) for a default sentinel model", () => {
    const model = createModel("default");
    const account = createAccount({ name: "LocalLLM" });
    expect(getDisplayName(account, model)).toBe("LocalLLM");
  });

  it("handles colons in model names (e.g. org/model:variant)", () => {
    const model = createModel("org/model:variant");
    const account = createAccount({ name: "OpenRouter" });
    expect(getDisplayName(account, model)).toBe("OpenRouter:org/model:variant");
  });
});

// ──────────────────────────────────────────────
// resolveModel — core test suite (10 required + extras)
// ──────────────────────────────────────────────

describe("resolveModel", () => {
  it("throws when modelSpec is undefined", () => {
    expect(() => resolveModel(undefined, [])).toThrow("No model specified");
  });

  it("throws when modelSpec is empty string", () => {
    expect(() => resolveModel("", [])).toThrow("No model specified");
  });

  // ── Test 1: GUID resolves to correct provider + model ──────────────────────
  it("test 1: GUID input resolves to correct provider + model", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "OpenAI", models: [model] });
    const result = resolveModel(model.id, [account]);
    expect(result.provider).toBe("OpenAI");
    expect(result.model).toBe("gpt-4o");
    expect(result.config.baseURL).toBe("http://localhost:1234/v1");
  });

  // ── Test 2: GUID for "default" sentinel returns model: undefined ──────────────────
  it("test 2: GUID for 'default' sentinel model returns undefined model name", () => {
    const model = createModel("default");
    const account = createAccount({ name: "LocalLLM", models: [model] });
    const result = resolveModel(model.id, [account]);
    expect(result.provider).toBe("LocalLLM");
    expect(result.model).toBeUndefined();
  });

  // ── Test 3: Legacy "Provider:model" still works ─────────────────────────────
  it("test 3: legacy 'Provider:model' input still resolves correctly", () => {
    const model = createModel("claude-opus-4");
    const account = createAccount({ name: "Anthropic", models: [model] });
    const result = resolveModel("Anthropic:claude-opus-4", [account]);
    expect(result.provider).toBe("Anthropic");
    expect(result.model).toBe("claude-opus-4");
  });

  // ── Test 4: Legacy "Provider:org/model:variant" colons in model name ────────
  it("test 4: legacy input with colons in model name still resolves correctly", () => {
    const model = createModel("org/model:variant");
    const account = createAccount({ name: "OpenRouter", models: [model] });
    const result = resolveModel("OpenRouter:org/model:variant", [account]);
    expect(result.provider).toBe("OpenRouter");
    expect(result.model).toBe("org/model:variant");
  });

  // ── Test 5: Nonexistent GUID is invalid configuration, even with a default model ──
  it("test 5: nonexistent GUID throws even when an account default_model exists", () => {
    const defaultModel = createModel("gpt-4o");
    const account = createAccount({
      name: "OpenAI",
      models: [defaultModel],
      default_model: defaultModel.id,
    });
    const nonexistentGuid = crypto.randomUUID();

    expect(() => resolveModel(nonexistentGuid, [account]))
      .toThrow(`Model "${nonexistentGuid}" not found`);
  });

  // ── Test 6: Nonexistent GUID with no default_model throws ───────────────────
  it("test 6: nonexistent GUID with no default_model throws", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "OpenAI", models: [model] });
    // account has no default_model
    const nonexistentGuid = crypto.randomUUID();
    expect(() => resolveModel(nonexistentGuid, [account])).toThrow();
  });

  // ── Test 7: Disabled provider's models are skipped ──────────────────────────
  it("test 7: disabled provider's models are skipped for GUID lookup", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "OpenAI", models: [model], enabled: false });
    expect(() => resolveModel(model.id, [account])).toThrow();
  });

  // ── Test 8: Multiple providers, GUID uniquely identifies correct one ─────────
  it("test 8: multiple providers — GUID uniquely identifies the correct one", () => {
    const model1 = createModel("gpt-4o");
    const model2 = createModel("claude-opus-4");
    const account1 = createAccount({ name: "OpenAI", models: [model1] });
    const account2 = createAccount({ name: "Anthropic", models: [model2] });
    const result = resolveModel(model2.id, [account1, account2]);
    expect(result.provider).toBe("Anthropic");
    expect(result.model).toBe("claude-opus-4");
  });

  // ── Test 9: getDisplayName "Provider:model" ─────────────────────────────────
  // (tested above in getDisplayName suite — verified here via round-trip)
  it("test 9: resolveModel + getDisplayName round-trips correctly", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "OpenAI", models: [model] });
    const resolved = resolveModel(model.id, [account]);
    // Reconstruct display name from resolved provider + model
    expect(`${resolved.provider}:${resolved.model}`).toBe("OpenAI:gpt-4o");
  });

  // ── Test 10: "default" sentinel via Provider:model returns undefined ───
  it("test 10: 'Provider:default' resolves to model: undefined", () => {
    const model = createModel("default");
    const account = createAccount({ name: "LocalLLM", models: [model] });
    const result = resolveModel("LocalLLM:default", [account]);
    expect(result.provider).toBe("LocalLLM");
    expect(result.model).toBeUndefined();
  });

  // ── Extra: extra_headers propagated ─────────────────────────────────────────
  it("extra_headers are propagated from the matching account", () => {
    const model = createModel("gemma-3");
    const account = createAccount({
      name: "OpenRouter",
      models: [model],
      extra_headers: { "HTTP-Referer": "https://ei.flare576.com" },
    });
    const result = resolveModel(model.id, [account]);
    expect(result.extraHeaders).toEqual({ "HTTP-Referer": "https://ei.flare576.com" });
  });

  // ── Extra: legacy path without models[] (pre-migration compat) ──────────────
  it("legacy path works even when account has no models[] yet", () => {
    // No models[] - pure legacy
    const account = createAccount({ name: "OldProvider" });
    // Should not throw — falls back to legacy model-name pass-through
    const result = resolveModel("OldProvider:some-model", [account]);
    expect(result.provider).toBe("OldProvider");
    expect(result.model).toBe("some-model");
  });

  // ── Extra: case-insensitive provider name matching in legacy path ────────────
  it("legacy path matches provider name case-insensitively", () => {
    const model = createModel("gpt-4o");
    const account = createAccount({ name: "MyOpenAI", models: [model] });
    const result = resolveModel("myopenai:gpt-4o", [account]);
    expect(result.provider).toBe("MyOpenAI");
    expect(result.model).toBe("gpt-4o");
  });

  // ── Extra: throws when legacy provider not found ─────────────────────────────
  it("throws when legacy 'Provider:model' provider does not exist", () => {
    const account = createAccount({ name: "OpenAI" });
    expect(() => resolveModel("NonExistent:gpt-4o", [account])).toThrow("No provider");
  });
});

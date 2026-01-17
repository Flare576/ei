import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { 
  resolveModel, 
  getProviderStatuses, 
  clearClientCache,
  isRateLimitError,
  RATE_LIMIT_CODES,
  MAX_RETRIES,
  INITIAL_BACKOFF_MS,
  callLLM,
} from "../../src/llm.js";
import type { ResolvedModel, ProviderStatus, LLMOperation } from "../../src/llm.js";

describe("resolveModel", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearClientCache();
    process.env.EI_OPENAI_API_KEY = "test-openai-key";
    process.env.EI_GOOGLE_API_KEY = "test-google-key";
    process.env.EI_ANTHROPIC_API_KEY = "test-anthropic-key";
    process.env.EI_XAI_API_KEY = "test-xai-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearClientCache();
  });

  it("parses provider:model format", () => {
    const result = resolveModel("openai:gpt-4o");

    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
    expect(result.client).toBeDefined();
  });

  it("assumes local for bare model name", () => {
    const result = resolveModel("google/gemma-3-12b");

    expect(result.provider).toBe("local");
    expect(result.model).toBe("google/gemma-3-12b");
  });

  it("handles google provider with colons in model name", () => {
    const result = resolveModel("google:gemini-1.5-pro");

    expect(result.provider).toBe("google");
    expect(result.model).toBe("gemini-1.5-pro");
  });

  it("handles anthropic provider", () => {
    const result = resolveModel("anthropic:claude-3-sonnet");

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-3-sonnet");
  });

  it("handles x provider (xAI/Grok)", () => {
    const result = resolveModel("x:grok-2");

    expect(result.provider).toBe("x");
    expect(result.model).toBe("grok-2");
  });

  it("uses EI_LLM_MODEL when no spec provided", () => {
    process.env.EI_LLM_MODEL = "anthropic:claude-3-sonnet";

    const result = resolveModel();

    expect(result.provider).toBe("anthropic");
    expect(result.model).toBe("claude-3-sonnet");
  });

  it("uses default local model when no spec and no env var", () => {
    delete process.env.EI_LLM_MODEL;

    const result = resolveModel();

    expect(result.provider).toBe("local");
    expect(result.model).toBe("ministral-3-3b-reasoning-2512");
  });

  it("throws for unknown provider", () => {
    expect(() => resolveModel("fake:model")).toThrow("Unknown provider: fake");
    expect(() => resolveModel("fake:model")).toThrow("Valid providers:");
  });

  it("throws for missing API key on non-local provider", () => {
    delete process.env.EI_OPENAI_API_KEY;

    expect(() => resolveModel("openai:gpt-4o")).toThrow("No API key configured for provider: openai");
    expect(() => resolveModel("openai:gpt-4o")).toThrow("Set EI_OPENAI_API_KEY");
  });

  it("throws with correct env var name for x provider", () => {
    delete process.env.EI_XAI_API_KEY;

    expect(() => resolveModel("x:grok-2")).toThrow("Set EI_XAI_API_KEY");
  });

  it("does not throw for local provider without API key", () => {
    delete process.env.EI_LLM_API_KEY;

    const result = resolveModel("local:some-model");

    expect(result.provider).toBe("local");
    expect(result.model).toBe("some-model");
  });

  it("caches clients per provider", () => {
    const result1 = resolveModel("openai:gpt-4o");
    const result2 = resolveModel("openai:gpt-4-turbo");

    expect(result1.client).toBe(result2.client);
  });

  it("creates separate clients for different providers", () => {
    const openaiResult = resolveModel("openai:gpt-4o");
    const googleResult = resolveModel("google:gemini-pro");

    expect(openaiResult.client).not.toBe(googleResult.client);
  });
});

describe("getProviderStatuses", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearClientCache();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns status for all providers", () => {
    const statuses = getProviderStatuses();

    expect(statuses).toHaveLength(5);
    expect(statuses.map(s => s.provider).sort()).toEqual(["anthropic", "google", "local", "openai", "x"]);
  });

  it("marks local as always configured", () => {
    delete process.env.EI_LLM_API_KEY;

    const statuses = getProviderStatuses();
    const local = statuses.find(s => s.provider === "local");

    expect(local?.configured).toBe(true);
  });

  it("marks provider as configured when API key is set", () => {
    process.env.EI_OPENAI_API_KEY = "test-key";

    const statuses = getProviderStatuses();
    const openai = statuses.find(s => s.provider === "openai");

    expect(openai?.configured).toBe(true);
  });

  it("marks provider as not configured when API key is missing", () => {
    delete process.env.EI_OPENAI_API_KEY;

    const statuses = getProviderStatuses();
    const openai = statuses.find(s => s.provider === "openai");

    expect(openai?.configured).toBe(false);
  });

  it("includes display name for each provider", () => {
    const statuses = getProviderStatuses();

    expect(statuses.find(s => s.provider === "local")?.name).toBe("Local (LM Studio/Ollama)");
    expect(statuses.find(s => s.provider === "openai")?.name).toBe("OpenAI");
    expect(statuses.find(s => s.provider === "google")?.name).toBe("Google AI Studio");
    expect(statuses.find(s => s.provider === "anthropic")?.name).toBe("Anthropic");
    expect(statuses.find(s => s.provider === "x")?.name).toBe("xAI (Grok)");
  });

  it("includes baseURL for each provider", () => {
    const statuses = getProviderStatuses();

    const openai = statuses.find(s => s.provider === "openai");
    expect(openai?.baseURL).toBe("https://api.openai.com/v1");

    const google = statuses.find(s => s.provider === "google");
    expect(google?.baseURL).toBe("https://generativelanguage.googleapis.com/v1beta/openai");
  });

  it("uses custom baseURL for local provider from env", () => {
    process.env.EI_LLM_BASE_URL = "http://custom:8080/v1";

    const statuses = getProviderStatuses();
    const local = statuses.find(s => s.provider === "local");

    expect(local?.baseURL).toBe("http://custom:8080/v1");
  });
});

describe("clearClientCache", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.EI_OPENAI_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearClientCache();
  });

  it("clears cached clients so new ones are created", () => {
    const result1 = resolveModel("openai:gpt-4o");
    clearClientCache();
    const result2 = resolveModel("openai:gpt-4o");

    expect(result1.client).not.toBe(result2.client);
  });
});

describe("resolveModel with operation", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    clearClientCache();
    delete process.env.EI_LLM_MODEL;
    delete process.env.EI_MODEL_RESPONSE;
    delete process.env.EI_MODEL_CONCEPT;
    delete process.env.EI_MODEL_GENERATION;
    process.env.EI_OPENAI_API_KEY = "test-openai-key";
    process.env.EI_GOOGLE_API_KEY = "test-google-key";
    process.env.EI_ANTHROPIC_API_KEY = "test-anthropic-key";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    clearClientCache();
  });

  it("uses explicit model over operation default", () => {
    process.env.EI_MODEL_RESPONSE = "openai:gpt-4o";
    const result = resolveModel("local:gemma", "response");
    expect(result.model).toBe("gemma");
    expect(result.provider).toBe("local");
  });

  it("uses operation env var when no explicit model", () => {
    process.env.EI_MODEL_RESPONSE = "openai:gpt-4o";
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("gpt-4o");
    expect(result.provider).toBe("openai");
  });

  it("uses EI_MODEL_CONCEPT env var for concept operation", () => {
    process.env.EI_MODEL_CONCEPT = "google:gemini-pro";
    const result = resolveModel(undefined, "concept");
    expect(result.model).toBe("gemini-pro");
    expect(result.provider).toBe("google");
  });

  it("uses EI_MODEL_GENERATION env var for generation operation", () => {
    process.env.EI_MODEL_GENERATION = "anthropic:claude-3-sonnet";
    const result = resolveModel(undefined, "generation");
    expect(result.model).toBe("claude-3-sonnet");
    expect(result.provider).toBe("anthropic");
  });

  it("falls back to global when no operation env var", () => {
    process.env.EI_LLM_MODEL = "anthropic:claude-3-sonnet";
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("claude-3-sonnet");
    expect(result.provider).toBe("anthropic");
  });

  it("uses hardcoded default when nothing configured", () => {
    const result = resolveModel(undefined, "response");
    expect(result.model).toBe("ministral-3-3b-reasoning-2512");
    expect(result.provider).toBe("local");
  });

  it("backward compatible: no operation uses global env var", () => {
    process.env.EI_LLM_MODEL = "openai:gpt-4-turbo";
    const result = resolveModel();
    expect(result.model).toBe("gpt-4-turbo");
    expect(result.provider).toBe("openai");
  });

  it("backward compatible: no operation and no global uses hardcoded default", () => {
    const result = resolveModel();
    expect(result.model).toBe("ministral-3-3b-reasoning-2512");
    expect(result.provider).toBe("local");
  });

  it("explicit model takes priority over both operation and global env vars", () => {
    process.env.EI_MODEL_RESPONSE = "openai:gpt-4o";
    process.env.EI_LLM_MODEL = "anthropic:claude-3-sonnet";
    const result = resolveModel("google:gemini-pro", "response");
    expect(result.model).toBe("gemini-pro");
    expect(result.provider).toBe("google");
  });
});

describe("isRateLimitError", () => {
  it("returns true for 429 status", () => {
    const error = Object.assign(new Error("Rate limited"), { status: 429 });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns true for 529 status (Anthropic overload)", () => {
    const error = Object.assign(new Error("Overloaded"), { status: 529 });
    expect(isRateLimitError(error)).toBe(true);
  });

  it("returns false for other status codes", () => {
    const error = Object.assign(new Error("Internal error"), { status: 500 });
    expect(isRateLimitError(error)).toBe(false);
  });

  it("returns false for errors without status", () => {
    const error = new Error("Generic error");
    expect(isRateLimitError(error)).toBe(false);
  });

  it("returns false for non-Error objects", () => {
    expect(isRateLimitError("string error")).toBe(false);
    expect(isRateLimitError(null)).toBe(false);
    expect(isRateLimitError(undefined)).toBe(false);
  });
});

describe("rate limit constants", () => {
  it("has expected rate limit codes", () => {
    expect(RATE_LIMIT_CODES).toContain(429);
    expect(RATE_LIMIT_CODES).toContain(529);
  });

  it("has expected retry configuration", () => {
    expect(MAX_RETRIES).toBe(3);
    expect(INITIAL_BACKOFF_MS).toBe(1000);
  });
});

describe("rate limit handling integration", () => {
  it("exponential backoff timing is correct", () => {
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 0)).toBe(1000);
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 1)).toBe(2000);
    expect(INITIAL_BACKOFF_MS * Math.pow(2, 2)).toBe(4000);
  });

  it("isRateLimitError correctly identifies retryable errors", () => {
    const err429 = Object.assign(new Error("Rate limited"), { status: 429 });
    const err529 = Object.assign(new Error("Overloaded"), { status: 529 });
    const err500 = Object.assign(new Error("Server error"), { status: 500 });
    const err401 = Object.assign(new Error("Unauthorized"), { status: 401 });
    
    expect(isRateLimitError(err429)).toBe(true);
    expect(isRateLimitError(err529)).toBe(true);
    expect(isRateLimitError(err500)).toBe(false);
    expect(isRateLimitError(err401)).toBe(false);
  });
});

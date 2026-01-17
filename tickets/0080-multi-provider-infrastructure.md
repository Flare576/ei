# 0080: Core Multi-Provider Infrastructure

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Add provider management and client pooling to `llm.ts`, enabling support for multiple LLM providers (local, OpenAI, Google, Anthropic, X.AI) with proper configuration and caching.

## Problem

Current `llm.ts` has:
- Single global OpenAI client (lines 3-6)
- Single global MODEL constant (lines 8-9)
- No way to switch providers or models dynamically
- Would create new client instances for every call if we naively add model support

## Proposed Solution

### Provider Registry

```typescript
interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;  // Display name for /model --list
}

const PROVIDERS: Record<string, () => ProviderConfig> = {
  local: () => ({
    name: "Local (LM Studio/Ollama)",
    baseURL: process.env.EI_LLM_BASE_URL || "http://127.0.0.1:1234/v1",
    apiKey: process.env.EI_LLM_API_KEY || "not-needed",
  }),
  openai: () => ({
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.EI_OPENAI_API_KEY || "",
  }),
  google: () => ({
    name: "Google AI Studio",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKey: process.env.EI_GOOGLE_API_KEY || "",
  }),
  anthropic: () => ({
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: process.env.EI_ANTHROPIC_API_KEY || "",
  }),
  x: () => ({
    name: "xAI (Grok)",
    baseURL: "https://api.x.ai/v1",
    apiKey: process.env.EI_XAI_API_KEY || "",
  }),
};
```

### Client Caching

```typescript
const clientCache = new Map<string, OpenAI>();

function getOrCreateClient(provider: string): OpenAI {
  if (clientCache.has(provider)) {
    return clientCache.get(provider)!;
  }
  
  const configFn = PROVIDERS[provider];
  if (!configFn) {
    throw new Error(`Unknown provider: ${provider}. Valid: ${Object.keys(PROVIDERS).join(", ")}`);
  }
  
  const config = configFn();
  if (!config.apiKey && provider !== "local") {
    throw new Error(`No API key configured for provider: ${provider}. Set EI_${provider.toUpperCase()}_API_KEY`);
  }
  
  const client = new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey });
  clientCache.set(provider, client);
  return client;
}
```

### Model Spec Parsing

```typescript
export interface ResolvedModel {
  client: OpenAI;
  model: string;
  provider: string;
}

export function resolveModel(modelSpec?: string): ResolvedModel {
  const spec = modelSpec || process.env.EI_LLM_MODEL || "local:google/gemma-3-12b";
  
  let provider: string;
  let model: string;
  
  if (spec.includes(":")) {
    [provider, model] = spec.split(":", 2);
  } else {
    // Bare model name assumes local provider
    provider = "local";
    model = spec;
  }
  
  return {
    client: getOrCreateClient(provider),
    model,
    provider,
  };
}
```

### Provider Status Utility

```typescript
export interface ProviderStatus {
  name: string;
  provider: string;
  configured: boolean;
  baseURL: string;
}

export function getProviderStatuses(): ProviderStatus[] {
  return Object.entries(PROVIDERS).map(([key, configFn]) => {
    const config = configFn();
    return {
      provider: key,
      name: config.name,
      configured: key === "local" || !!config.apiKey,
      baseURL: config.baseURL,
    };
  });
}
```

## Files Modified

- `src/llm.ts` - Add provider registry, client cache, resolution functions

## Acceptance Criteria

- [ ] `ProviderConfig` interface defined
- [ ] Provider registry with 5 providers (local, openai, google, anthropic, x)
- [ ] `resolveModel()` parses `provider:model` format correctly
- [ ] `resolveModel()` handles bare model names (assumes local)
- [ ] Client caching prevents redundant OpenAI instances
- [ ] Graceful error for unknown provider
- [ ] Graceful error for missing API key (non-local providers)
- [ ] `getProviderStatuses()` returns status of all providers
- [ ] Backward compatible: existing `EI_LLM_*` vars still work
- [ ] Unit tests for `resolveModel()` with various inputs
- [ ] Unit tests for provider status utility

## Testing Strategy

```typescript
describe("resolveModel", () => {
  it("parses provider:model format", () => {
    const result = resolveModel("openai:gpt-4o");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o");
  });
  
  it("assumes local for bare model name", () => {
    const result = resolveModel("google/gemma-3-12b");
    expect(result.provider).toBe("local");
    expect(result.model).toBe("google/gemma-3-12b");
  });
  
  it("uses EI_LLM_MODEL when no spec provided", () => {
    process.env.EI_LLM_MODEL = "anthropic:claude-3-sonnet";
    const result = resolveModel();
    expect(result.provider).toBe("anthropic");
  });
  
  it("throws for unknown provider", () => {
    expect(() => resolveModel("fake:model")).toThrow("Unknown provider");
  });
  
  it("throws for missing API key", () => {
    delete process.env.EI_OPENAI_API_KEY;
    expect(() => resolveModel("openai:gpt-4o")).toThrow("No API key");
  });
});
```

## Dependencies

- None (foundation ticket)

## Effort Estimate

Medium: 3-4 hours

## Notes

- Uses lazy evaluation for provider configs (functions, not objects) so env vars are read at resolution time
- Client caching is keyed by provider, not by full model spec (one client per provider)
- Error messages guide user to correct env var name

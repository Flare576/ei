# 0085: Provider-Specific Optimizations

**Status**: DONE (partial - rate limits + provider headers only)

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Handle provider-specific quirks: usage logging for cost awareness, rate limit handling, and JSON parsing resilience for models that struggle with structured output.

## Problem

Different LLM providers have different behaviors:
- **Cost**: OpenAI/Anthropic charge per token; users want visibility into usage
- **Rate limits**: Providers have different limits and error formats
- **JSON reliability**: Some models (especially smaller local ones) produce invalid JSON more often

After the core multi-model work (0080-0084), these are polish items to improve reliability and user experience.

## Proposed Solution

### 1. Usage Logging

Add optional logging of provider/model usage per call:

```typescript
// In callLLMRaw, after successful response
if (process.env.EI_LOG_MODEL_USAGE === "true") {
  const usage = response.usage;
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    provider,
    model,
    prompt_tokens: usage?.prompt_tokens,
    completion_tokens: usage?.completion_tokens,
    total_tokens: usage?.total_tokens,
  }));
}
```

Environment variable: `EI_LOG_MODEL_USAGE=true`

Output can be piped to a file for later analysis:
```bash
EI_LOG_MODEL_USAGE=true npm start 2>&1 | tee usage.log
```

### 2. Rate Limit Handling

Detect rate limit errors and implement exponential backoff:

```typescript
const RATE_LIMIT_CODES = [429, 529];  // 529 is Anthropic overload
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 1000;

async function callLLMRawWithRetry(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<LLMRawResponse> {
  let lastError: Error | null = null;
  
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await callLLMRaw(systemPrompt, userPrompt, options);
    } catch (err) {
      if (isRateLimitError(err)) {
        lastError = err as Error;
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[LLM] Rate limited, waiting ${backoff}ms before retry...`);
        await sleep(backoff);
        continue;
      }
      throw err;  // Not a rate limit error, don't retry
    }
  }
  
  throw lastError;
}

function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    return RATE_LIMIT_CODES.includes((err as any).status);
  }
  return false;
}
```

### 3. JSON Parsing Resilience

For `callLLMForJSON`, add a retry with stronger guidance if JSON parsing fails:

```typescript
export async function callLLMForJSON<T>(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<T | null> {
  // First attempt
  const result = await attemptJSONParse<T>(systemPrompt, userPrompt, options);
  if (result !== null) return result;
  
  // Retry with additional JSON guidance
  const enhancedSystemPrompt = systemPrompt + `

CRITICAL: Your response MUST be valid JSON. No markdown code fences, no explanations, just the JSON object/array.`;
  
  console.warn("[LLM] JSON parse failed, retrying with enhanced guidance...");
  return attemptJSONParse<T>(enhancedSystemPrompt, userPrompt, options);
}

async function attemptJSONParse<T>(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions
): Promise<T | null> {
  const { content, finishReason } = await callLLMRaw(systemPrompt, userPrompt, options);
  
  if (finishReason === "length") {
    throw new LLMTruncatedError(...);
  }
  
  if (!content) return null;
  
  // Existing JSON extraction and repair logic...
  try {
    return extractAndParseJSON<T>(content);
  } catch {
    return null;  // Signal retry needed
  }
}
```

### 4. API Key Validation on First Use

Validate API keys actually work before trusting them. Cache validation results per session:

```typescript
const validatedProviders = new Set<string>();

async function validateProvider(provider: string, client: OpenAI, model: string): Promise<void> {
  if (validatedProviders.has(provider)) return;
  if (provider === "local") {
    validatedProviders.add(provider);
    return;  // Local doesn't need key validation
  }
  
  try {
    // Minimal request to verify credentials
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    validatedProviders.add(provider);
    console.log(`[LLM] Provider '${provider}' validated successfully`);
  } catch (err) {
    if (isAuthError(err)) {
      throw new Error(
        `Invalid API key for provider '${provider}'. ` +
        `Check your ${getEnvVarName(provider)} environment variable.`
      );
    }
    // Other errors (network, etc.) - don't cache, let it fail on actual use
    throw err;
  }
}

function isAuthError(err: unknown): boolean {
  if (err instanceof Error && 'status' in err) {
    return [401, 403].includes((err as any).status);
  }
  return false;
}

function getEnvVarName(provider: string): string {
  const names: Record<string, string> = {
    openai: "EI_OPENAI_API_KEY",
    google: "EI_GOOGLE_API_KEY",
    anthropic: "EI_ANTHROPIC_API_KEY",
    x: "EI_XAI_API_KEY",
  };
  return names[provider] || `EI_${provider.toUpperCase()}_API_KEY`;
}
```

Call `validateProvider()` from `resolveModel()` on first use of each provider. The validation is:
- **Lazy**: Only validates when you actually try to use a provider
- **Cached**: Once validated, doesn't re-check within the session
- **Informative**: Clear error message pointing to the right env var

### 5. Provider-Specific Headers (Future)

Some providers need specific headers. Prepare the infrastructure:

```typescript
interface ProviderConfig {
  baseURL: string;
  apiKey: string;
  name: string;
  defaultHeaders?: Record<string, string>;  // NEW
}

const PROVIDERS: Record<string, () => ProviderConfig> = {
  anthropic: () => ({
    name: "Anthropic",
    baseURL: "https://api.anthropic.com/v1",
    apiKey: process.env.EI_ANTHROPIC_API_KEY || "",
    defaultHeaders: {
      "anthropic-version": "2023-06-01",
    },
  }),
  // ...
};
```

## Files Modified

- `src/llm.ts` - Add usage logging, rate limit handling, JSON retry logic
- `AGENTS.md` - Document `EI_LOG_MODEL_USAGE` env var

## Acceptance Criteria

- [ ] `EI_LOG_MODEL_USAGE=true` logs provider/model/tokens per call
- [ ] Rate limit errors (429, 529) trigger exponential backoff retry
- [ ] Maximum 3 retries for rate limits, then throw
- [ ] JSON parse failures trigger one retry with enhanced guidance
- [ ] Retry warnings logged to help users understand what's happening
- [ ] API keys validated on first use of each provider
- [ ] Invalid API keys produce clear error with env var name
- [ ] Validation cached per session (don't re-validate on every call)
- [ ] Tests verify rate limit retry behavior (with mocked responses)
- [ ] Tests verify JSON retry behavior
- [ ] Tests verify API key validation behavior
- [ ] AGENTS.md documents usage logging

## Testing Strategy

```typescript
describe("rate limit handling", () => {
  it("retries on 429 with exponential backoff", async () => {
    const mockCreate = jest.fn()
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ status: 429 })
      .mockResolvedValueOnce({ choices: [{ message: { content: "ok" } }] });
    
    const result = await callLLM("sys", "user");
    
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(result).toBe("ok");
  });
  
  it("throws after max retries", async () => {
    const mockCreate = jest.fn().mockRejectedValue({ status: 429 });
    
    await expect(callLLM("sys", "user")).rejects.toThrow();
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});

describe("JSON parsing resilience", () => {
  it("retries with enhanced prompt on parse failure", async () => {
    const mockCreate = jest.fn()
      .mockResolvedValueOnce({ choices: [{ message: { content: "not json" } }] })
      .mockResolvedValueOnce({ choices: [{ message: { content: '{"valid": true}' } }] });
    
    const result = await callLLMForJSON<{ valid: boolean }>("sys", "user");
    
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ valid: true });
  });
});

describe("API key validation", () => {
  it("validates on first use, caches result", async () => {
    const mockCreate = jest.fn().mockResolvedValue({ 
      choices: [{ message: { content: "ok" } }] 
    });
    
    // First call validates
    await callLLM("sys", "user", { model: "openai:gpt-4o" });
    // Second call uses cache
    await callLLM("sys", "user", { model: "openai:gpt-4o" });
    
    // Validation call + 2 actual calls = could be 3, but validation is cached
    // so only 1 validation + 2 actual = 3 total, or if validation piggybacked, 2
  });
  
  it("throws clear error for invalid API key", async () => {
    const mockCreate = jest.fn().mockRejectedValue({ status: 401 });
    
    await expect(callLLM("sys", "user", { model: "openai:gpt-4o" }))
      .rejects.toThrow(/Invalid API key.*EI_OPENAI_API_KEY/);
  });
  
  it("skips validation for local provider", async () => {
    // Local provider should not trigger validation request
  });
});
```

## Dependencies

- **0082**: Needs refactored LLM infrastructure

## Effort Estimate

Medium: 3-4 hours

## Open Questions

- Should we track cumulative token counts per session for cost estimation?
- Should rate limit handling be configurable (max retries, backoff multiplier)?
- Should we support provider-specific response formats (Anthropic's differs from OpenAI)?

## Notes

- This is a polish/nice-to-have ticket - core functionality works without it
- Usage logging outputs JSON for easy parsing/analysis
- Rate limit handling is defensive - users may not hit limits with normal usage
- JSON retry is particularly useful for smaller local models

# 0089: Proactive API Key Validation

**Status**: PENDING

## Summary

Validate API keys work on first use of each provider, cache results, and provide clear error messages.

## Problem

Currently, invalid API keys only fail when an actual conversation request is made. Users might configure a key, think it's working, then hit an error mid-conversation.

## Proposed Solution

On first use of each non-local provider:
1. Make a minimal API call (1 token max) to verify credentials
2. Cache successful validation for the session
3. On auth failure (401/403), throw clear error with env var name

```typescript
const validatedProviders = new Set<string>();

async function validateProvider(provider: string, client: OpenAI, model: string): Promise<void> {
  if (validatedProviders.has(provider) || provider === "local") return;
  
  try {
    await client.chat.completions.create({
      model,
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1,
    });
    validatedProviders.add(provider);
  } catch (err) {
    if (isAuthError(err)) {
      throw new Error(`Invalid API key for '${provider}'. Check ${getEnvVarName(provider)}`);
    }
    throw err;
  }
}
```

## Acceptance Criteria

- [ ] API keys validated on first use of each provider
- [ ] Invalid keys produce clear error with env var name
- [ ] Validation cached per session
- [ ] Local provider skips validation
- [ ] Tests verify validation behavior

## Dependencies

- None (standalone enhancement)

## Effort Estimate

Small: 1-2 hours

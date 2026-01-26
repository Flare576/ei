# 0092: LLM Validation and Error Handling

**Status**: PENDING

## Summary

Improve validation and error handling for LLM calls and model configuration.

## Problem

Current issues discovered during testing:
1. Invalid model names (e.g., `google:gemini/gemini-2.5-flash` instead of `google:gemini-2.5-flash`) result in cryptic `404 status code (no body)` errors
2. No validation that model names are reasonable before saving to persona config
3. LLM errors don't surface enough detail to debug issues
4. No guidance when model names look malformed

## Proposed Solution

### 1. Model Name Validation

Add basic sanity checks when setting model via `/model`:

```typescript
function validateModelName(model: string): string | null {
  // Check for obvious issues
  if (model.includes('//')) {
    return "Model name contains '//'. Did you mean a single '/'?";
  }
  
  // Check for duplicate provider in model name
  // e.g., "google:gemini/gemini-2.5-flash" - "gemini" appears twice
  const [provider, modelName] = model.split(':', 2);
  if (modelName && modelName.toLowerCase().startsWith(provider.toLowerCase())) {
    return `Model name "${modelName}" starts with provider name. Try just "${modelName.split('/').pop()}"?`;
  }
  
  return null; // Valid
}
```

### 2. Better Error Messages

Wrap LLM calls to provide more context on failure:

```typescript
try {
  response = await client.chat.completions.create(...);
} catch (err) {
  if (err.status === 404) {
    throw new Error(
      `Model "${model}" not found on ${provider}. ` +
      `Check the model name is correct for this provider.`
    );
  }
  // ... other status codes
}
```

### 3. Debug Logging

When DEBUG mode is on, log more details about failed requests:
- Full model spec used
- Provider endpoint
- HTTP status code
- Response body (if any)

## Acceptance Criteria

- [ ] `/model` warns about suspicious model name patterns
- [ ] 404 errors include "model not found" guidance
- [ ] 401/403 errors include "check API key" guidance
- [ ] Debug mode logs full request/response details on failure
- [ ] Tests for validation logic

## Dependencies

- None

## Effort Estimate

Small-Medium: 2-3 hours

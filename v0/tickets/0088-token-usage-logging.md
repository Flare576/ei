# 0088: Token Usage Logging

**Status**: PENDING

## Summary

Add optional logging of token usage per LLM call for cost monitoring.

## Problem

Users on paid providers (OpenAI, Anthropic, etc.) may want visibility into token usage for cost awareness.

## Proposed Solution

Environment variable `EI_LOG_MODEL_USAGE=true` enables JSON logging of each call:

```typescript
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

Output can be piped to a file:
```bash
EI_LOG_MODEL_USAGE=true npm start 2>&1 | tee usage.log
```

## Acceptance Criteria

- [ ] `EI_LOG_MODEL_USAGE=true` logs provider/model/tokens per call
- [ ] Output is valid JSON for easy parsing
- [ ] Logs to stderr to not interfere with UI
- [ ] Documentation in AGENTS.md

## Dependencies

- None (standalone feature)

## Effort Estimate

Small: 1 hour

# 0006: Detect and Handle LLM Response Truncation

**Status**: VALIDATED

## Summary

Detect when LLM responses are truncated due to token limits (`finish_reason: "length"`) and handle gracefully instead of failing with confusing JSON parse errors.

## Problem

When LLM responses hit `max_tokens`, the response is cut off mid-content. For JSON responses, this results in invalid JSON and a cryptic parse error. The user sees:

```
[LLM] Failed to parse JSON even after repair:
[LLM] Original: ```json
[
  {
    "name": "human_developer",
    "description": "The human who designed and maintains the application. Shows curiosity about AI history, appreciates collaborative creation, and has a strong background in game development, web back‑end engineering, and recent experience as an LLM sani
```

This doesn't communicate the actual problem: the response was truncated.

## Proposed Solution

Expose `finish_reason` from the OpenAI API response and check it before attempting JSON parse.

### Implementation

```typescript
interface LLMResponse {
  content: string | null;
  finishReason: string | null;
}

export async function callLLMRaw(
  systemPrompt: string,
  userPrompt: string,
  options: LLMOptions = {}
): Promise<LLMResponse> {
  // ... existing call logic ...
  
  return {
    content: response.choices[0]?.message?.content?.trim() ?? null,
    finishReason: response.choices[0]?.finish_reason ?? null,
  };
}

export async function callLLMForJSON<T>(...): Promise<T | null> {
  const { content, finishReason } = await callLLMRaw(...);
  
  if (finishReason === "length") {
    throw new LLMTruncatedError(
      `Response truncated at ${MAX_TOKENS} tokens. Consider increasing MAX_TOKENS or simplifying the request.`
    );
  }
  
  // ... existing JSON parse logic ...
}
```

### Error Handling Options

When truncation is detected:

1. **Surface clear error** - Tell user exactly what happened: "Response truncated - concept map may be too large for current token limit"
2. **Retry with higher limit** - Automatically bump `max_tokens` and retry once (with ceiling to prevent runaway costs)

### Open Questions

- Should `MAX_TOKENS` be configurable via environment variable?
- What's a reasonable ceiling for automatic retry? (e.g., 8000 tokens)
- Should we track truncation frequency to detect models that consistently need more tokens?

## Acceptance Criteria

- [x] `finish_reason` is captured from LLM API response
- [x] `finish_reason: "length"` triggers specific `LLMTruncatedError`
- [x] Error message clearly states truncation occurred and suggests remediation
- [ ] Optional: Automatic retry with increased token limit

## Value Statement

Users get actionable error messages instead of cryptic JSON parse failures. System can potentially self-heal by retrying with higher limits.

## Dependencies

None - internal refactor of LLM module.

## Effort Estimate

Small-Medium: ~2-3 hours

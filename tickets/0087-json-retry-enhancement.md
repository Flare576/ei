# 0087: JSON Parse Retry with Enhanced Prompt

**Status**: DONE

## Summary

When `callLLMForJSON` fails to parse JSON from an LLM response, retry once with an enhanced system prompt that emphasizes valid JSON output.

## Problem

Some models (especially smaller local ones) sometimes return malformed JSON or include markdown fences/explanations when asked for JSON. The existing JSON repair logic handles some cases, but a retry with stronger guidance could recover more failures.

## Proposed Solution

```typescript
export async function callLLMForJSON<T>(...): Promise<T | null> {
  // First attempt
  const result = await attemptJSONParse<T>(systemPrompt, userPrompt, options);
  if (result !== null) return result;
  
  // Retry with enhanced guidance
  const enhancedSystemPrompt = systemPrompt + `

CRITICAL: Your response MUST be valid JSON. No markdown code fences, no explanations, just the JSON object/array.`;
  
  console.warn("[LLM] JSON parse failed, retrying with enhanced guidance...");
  return attemptJSONParse<T>(enhancedSystemPrompt, userPrompt, options);
}
```

## Acceptance Criteria

- [x] JSON parse failure triggers one retry with enhanced prompt
- [x] Retry logs a warning so users know what's happening
- [x] If retry also fails, throw the parse error as before
- [x] Tests verify retry behavior

## Dependencies

- None (standalone enhancement)

## Effort Estimate

Small: 1-2 hours

## Implementation Notes

**Testing Strategy**: Unit tests at the `callLLMForJSON` level are the correct abstraction for this feature. E2E tests were considered but rejected because:
- Concept updates happen asynchronously in background queue (unpredictable timing)
- Can't reliably force synchronous processing without changing production code
- Unit tests mock at the right level and test exact retry behavior deterministically

**Test Coverage**: 11 unit tests including realistic malformed JSON patterns that actual LLMs produce:
- Explanatory text + JSON
- Trailing commas (handled by repair, no retry needed)
- Incomplete responses
- Both retry attempts failing

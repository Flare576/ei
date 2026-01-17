# 0087: JSON Parse Retry with Enhanced Prompt

**Status**: PENDING

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

- [ ] JSON parse failure triggers one retry with enhanced prompt
- [ ] Retry logs a warning so users know what's happening
- [ ] If retry also fails, throw the parse error as before
- [ ] Tests verify retry behavior

## Dependencies

- None (standalone enhancement)

## Effort Estimate

Small: 1-2 hours

# 0090: Parse Qwen-style Response Markup

**Status**: DONE

## Summary

Research and handle Qwen-based model response formats that include thinking/response tags.

## Problem

Qwen-based models (and possibly others) return responses with markup like:

```
After carefully considering...</thinking><RESPONSE>the actual content</RESPONSE>
```

Notes:
- No opening `<thinking>` tag (just closing)
- Response wrapped in `<RESPONSE>` tags
- The "thinking" content leaks into the response
- Qwen3 does have open/close <think> tags

This markup ends up in chat output instead of being stripped.

## Research Needed

1. What markup patterns do Qwen models use?
2. Are there other common patterns (DeepSeek, etc.)?
3. Is this configurable via system prompt, or do we need to parse it out?

## Proposed Solution

Add response post-processing in `callLLM` or `callLLMRaw` to strip common thinking/response tags:

```typescript
function cleanModelResponse(content: string): string {
  // Strip incomplete thinking tags
  content = content.replace(/^.*<\/thinking>/s, '');
  
  // Extract from <RESPONSE> tags if present
  const responseMatch = content.match(/<RESPONSE>([\s\S]*)<\/RESPONSE>/i);
  if (responseMatch) {
    return responseMatch[1].trim();
  }
  
  // Strip other common wrappers
  // ... research needed
  
  return content.trim();
}
```

## Acceptance Criteria

- [x] Research common thinking/response tag patterns
- [x] Implement parsing to extract actual response content
- [x] Handle malformed tags gracefully (missing open/close)
- [x] Tests for various tag formats
- [x] Works with local Qwen models

## Implementation Notes

Fixed in two parts:

1. **JSON Responses** (`attemptJSONParse` in `src/llm.ts`):
   - Added extraction logic for `
...
` wrapped JSON
   - Priority: code fences → thinking tags → raw content
   - Fixes persona creation failures with Qwen models

2. **Text Responses** (`cleanModelResponse` in `src/llm.ts`):
   - Strips `
...
` and `<thinking>...</thinking>` tags
   - Extracts content from `<RESPONSE>...</RESPONSE>` wrappers
   - Handles incomplete tags (missing opening tag)
   - Fixes chat responses leaking thinking content

Tests added: 5 new test cases covering all tag patterns

## Dependencies

- None

## Effort Estimate

Medium: 2-3 hours (including research)

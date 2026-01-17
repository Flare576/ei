# 0090: Parse Qwen-style Response Markup

**Status**: PENDING

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

- [ ] Research common thinking/response tag patterns
- [ ] Implement parsing to extract actual response content
- [ ] Handle malformed tags gracefully (missing open/close)
- [ ] Tests for various tag formats
- [ ] Works with local Qwen models

## Dependencies

- None

## Effort Estimate

Medium: 2-3 hours (including research)

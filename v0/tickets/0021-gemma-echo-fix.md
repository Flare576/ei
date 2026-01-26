# 0021: Fix Gemma Message Echo Bug

**Status**: DONE

## Summary

Gemma model echoes the user's message before responding. Adjust prompts or post-process responses to eliminate this.

## Problem

When using Google's Gemma model, responses often start with an exact copy of the user's message:

```
[7:08 PM] You: Could you try using **bold**?
[7:08 PM] Ei: Could you try using **bold**?

It's interesting you switched models! **I do notice a difference**...
```

This is confusing and wastes screen space.

## Proposed Solution

### Option A: Prompt Engineering

Add explicit instruction to the system prompt:
```
IMPORTANT: Never repeat or echo the user's message in your response. 
Start directly with your own words.
```

### Option B: Post-Processing

Detect and strip echoed content from responses:
```typescript
function stripEcho(userMessage: string, response: string): string {
  // If response starts with userMessage (or close match), remove it
  if (response.startsWith(userMessage)) {
    return response.slice(userMessage.length).trimStart();
  }
  // Handle partial matches, newline variations, etc.
  return response;
}
```

### Option C: Both

Belt and suspenders - prompt to prevent, post-process to catch.

### Considerations

- Different models may have different echo behaviors
- Post-processing needs to avoid false positives (legitimate quotes)
- Should preserve intentional quoting: `You said "X" and I think...`

## Acceptance Criteria

- [x] Gemma responses don't echo user messages
- [x] Intentional quotes are preserved
- [x] Works with other models without breaking them
- [x] No false positives (stripping legitimate content)

## Value Statement

Clean conversation flow. No confusion about who said what.

## Dependencies

- None (can be done independently)

## Effort Estimate

Small: ~1-2 hours

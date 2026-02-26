# 0130: No Response Explanation UI

**Status**: DONE
**Depends on**: 0044

## Summary

When a persona chooses not to respond, show the reason inline in chat so the user understands what happened.

## Context

User's daughter didn't realize "No Response" was a valid persona choice and thought the system was broken when it happened. Original approach was a one-time explanation on first occurrence.

## Superseded By

The one-time explanation approach was superseded by a richer structured response schema. The response prompt now asks personas to return JSON:

```json
{
  "should_respond": boolean,
  "verbal_response": string,   // optional
  "action_response": string,   // optional, rendered as _italics_
  "reason": string             // optional, shown when should_respond=false
}
```

When `should_respond` is false and `reason` is provided, `handlePersonaResponse` appends a `ContextStatus.Never` message to the chat:

```
[PersonaName chose not to respond because: {reason}]
```

This appears every time (not just the first), gives the actual reason rather than a generic explanation, and is excluded from the LLM context window via `ContextStatus.Never`.

## Acceptance Criteria

- [x] Silent responses show reason inline in chat
- [x] Message is visually distinct (ContextStatus.Never excludes it from context)
- [x] Reason is logged to console for debugging
- [x] Fallback: if no reason given, silently drops (no message shown)

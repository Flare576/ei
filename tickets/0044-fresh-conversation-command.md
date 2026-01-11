# 0044: Fresh Conversation Command

**Status**: PENDING

## Summary
Implement `/fresh` command to start a new conversation context while preserving concept map, preventing previous messages from influencing current discussion.

## Problem
Long conversations can become unwieldy and previous context may inappropriately influence new topics. Users need a way to start fresh while maintaining the persona's learned concepts and personality.

## Proposed Solution
Implement `/fresh` (or `/clear`) command that:

```typescript
// Clear conversation context but preserve concepts
/fresh    // Clears active persona's conversation context
/clear    // Alternative command name
```

**Key behaviors:**
- Clears conversation history from LLM context (not from storage)
- Preserves persona's concept map and core personality
- Next message starts with fresh context window
- History file retains all messages for user reference
- Concept map continues to evolve from new conversation

**Design decision needed:** Should this be `/fresh`, `/clear`, `/new`, or `/convo`?

## Acceptance Criteria
- [ ] `/fresh` command clears conversation context for active persona
- [ ] Previous messages no longer influence LLM responses
- [ ] Persona concept map and personality remain intact
- [ ] Chat history remains visible in UI and stored in files
- [ ] Next message after `/fresh` starts with clean context window
- [ ] Command works with multi-persona conversations
- [ ] `/help` command documents fresh conversation syntax
- [ ] Visual indicator shows when conversation context was cleared
- [ ] Concept map continues to update from post-fresh messages

## Value Statement
Enables users to start new topics without baggage from previous conversations while maintaining persona continuity through concept maps.

## Dependencies
- None (uses existing conversation and concept management)

## Effort Estimate
Small (~1-2 hours)
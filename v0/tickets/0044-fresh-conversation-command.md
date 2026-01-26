# 0044: New Conversation Command

**Status**: DONE

## Summary
Implement `/new` command to start a new conversation context while preserving concept map, preventing previous messages from influencing current discussion.

## Problem
Long conversations can become unwieldy and previous context may inappropriately influence new topics. Users need a way to start fresh while maintaining the persona's learned concepts and personality.

## Implementation Approach: Option C - Context Marker Message

After analysis, we chose to implement a **context boundary marker** approach:

### How It Works
1. `/new` inserts a special marker message into the conversation history:
   ```typescript
   {
     role: "system",
     content: "[CONTEXT_CLEARED]",
     timestamp: new Date().toISOString(),
     read: true,
     concept_processed: true
   }
   ```

2. Modify `getRecentMessages()` in `storage.ts` to stop at the most recent marker
3. Display visual divider in chat: `--- New Conversation ---`
4. History file retains all messages (including marker) for audit trail

### Why This Approach?
- **Pros**: 
  - History file shows exactly when context was cleared (audit trail)
  - Simple to implement, no schema changes needed
  - Works across app restarts
  - Reversible via `/undo`
  - Marker visible in JSONC files for debugging
- **Cons**: None significant (marker in history is actually beneficial)

### Alternative Approaches Considered
- **Option A** (timestamp field): Would work but harder to visualize in chat/files
- **Option B** (in-memory only): Doesn't persist across restarts

## Command Syntax
```bash
/new    # Clears active persona's conversation context
```

Command name rationale: `/new` fits with CLI-based LLM tools. `/clear` might imply wiping the chat UI (not the intent), `/fresh` is unnecessarily vague.

## Acceptance Criteria
- [x] `/new` command inserts context marker message
- [x] `getRecentMessages()` stops at most recent marker
- [x] Visual divider `--- New Conversation ---` displays in chat
- [x] Previous messages no longer influence LLM responses
- [x] Persona concept map and personality remain intact
- [x] Chat history remains visible in UI and stored in files
- [x] Next message after `/new` starts with clean context window
- [x] `/help` command documents `/new` syntax
- [x] Concept map continues to update from post-marker messages

## Implementation Summary

Successfully implemented `/new` command using Option C (context marker approach):

**Files Modified:**
- `src/blessed/app.ts`: Added `/new` command handler, updated help text
- `src/storage.ts`: Modified `getRecentMessages()` to filter at marker boundaries
- `src/blessed/chat-renderer.ts`: Added visual divider rendering for marker messages
- `tests/unit/storage.test.ts`: Added 4 test cases for marker filtering logic
- `tests/integration/command-flow.test.ts`: Added integration test for `/new` command

**How It Works:**
1. User executes `/new` command
2. System inserts marker message: `{ role: "system", content: "[CONTEXT_CLEARED]", ... }`
3. `getRecentMessages()` finds most recent marker and returns only messages after it
4. Chat renderer displays `--- New Conversation ---` divider
5. LLM sees only post-marker messages in context
6. Full history (including marker) preserved in history.jsonc

**Test Coverage:**
- Unit tests: Context marker filtering (single marker, multiple markers, no marker, empty)
- Integration test: Command execution and status verification
- All 529 tests passing

## Value Statement
Enables users to start new topics without baggage from previous conversations while maintaining persona continuity through concept maps.

## Dependencies
- None (uses existing conversation and concept management)

## Effort Estimate
Small (~1-2 hours)
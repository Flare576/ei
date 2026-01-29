# 0051: Context Boundary ("New" Command)

**Status**: PENDING
**Depends on**: 0043 (Chat Panel)

## Summary

Add a "New" button to create a context boundary - a fresh conversational slate that excludes prior messages from LLM context while preserving history.

## Acceptance Criteria

- [ ] Add `context_boundary?: string` field to PersonaEntity (ISO timestamp)
- [ ] Response prompt builder respects boundary:
  - `context_status: "always"` → INCLUDE (overrides boundary)
  - `context_status: "never"` → EXCLUDE
  - `context_status: "default"` + before boundary → EXCLUDE
  - `context_status: "default"` + after boundary → apply normal window logic
- [ ] "New" / "Resume" button in ChatPanel:
  - Position: Bottom-right corner of messages area (above input, in chat history zone)
  - Small, unobtrusive
- [ ] Button behavior:
  - If `context_boundary > last_message.timestamp` → show "Resume", click clears boundary
  - Otherwise → show "New", click sets boundary to now
- [ ] Visual divider rendered in chat history when boundary exists and is within visible range
- [ ] Processor method: `setContextBoundary(personaName: string, timestamp: string | null)`

## Technical Notes

**Priority hierarchy** (explicit user intent beats automatic filtering):
```
1. context_status: "always" → INCLUDE
2. context_status: "never"  → EXCLUDE  
3. context_status: "default" → check boundary, then window
```

**Button state logic**:
```typescript
const lastMessage = messages[messages.length - 1];
const boundaryIsActive = context_boundary && 
  (!lastMessage || context_boundary > lastMessage.timestamp);
// Show "Resume" if active, "New" otherwise
```

**Divider rendering**: When iterating messages, if a message's timestamp is the first one >= `context_boundary`, render a divider element before it.

## V0 Reference

This replaces V0's `/new` slash command which inserted a marker message. The new approach is cleaner - a timestamp on the entity rather than a special message type.

## Files to Modify

- `src/core/types.ts` - Add `context_boundary` to PersonaEntity
- `src/prompts/response/index.ts` - Add boundary check to message filtering
- `src/core/processor.ts` - Add `setContextBoundary()` method
- `src/core/state/personas.ts` - Add boundary getter/setter
- `web/src/components/Layout/ChatPanel.tsx` - Add button + divider rendering
- `web/src/styles/layout.css` - Divider + button styles

# 0155: Web Persona Editor — Delete Message Button

**Status**: DONE
**Depends on**: 0154 (adds `Processor.deleteMessages` hard-delete)
**Blocked by**: None (0154 is DONE)

## Summary

Add a trash can (🗑) delete button to each message row in the web persona editor's Context Window tab. Clicking it prompts a confirmation dialog and, on confirm, calls `Processor.deleteMessages()` introduced in 0154. Messages are hard-deleted (removed from state entirely).

## Design

### Trash Can Button

Add a delete column to the existing `ContextWindowTab` message table:

```
| Who | When | What         | Status  | 🗑 |
|-----|------|--------------|---------|-----|
| 👤  | 10:30| Hi there...  | Default |  🗑 |
| 🤖  | 10:31| Hello!       | Always  |  🗑 |
```

### Confirmation Dialog

Standard browser `confirm()` is acceptable for MVP. Content:

> Delete this message from [Persona Name]'s history?
>
> Note: Any Quotes, Topics, Facts, or People extracted from this message will not be reverted.

Two actions: **Delete** (destructive) and **Cancel**.

### Post-Delete Behavior

- On confirm: calls `processor.deleteMessages(personaId, [messageId])`
- Parent component refreshes message list from Processor state
- Row disappears on next render (no optimistic UI needed — refresh is fast)

## Acceptance Criteria

 [x] Trash can button (🗑) rendered in each message row of `ContextWindowTab`
 [x] Clicking opens confirmation dialog with persona name and data-retention warning
 [x] On confirm: calls `processor.deleteMessages(personaId, [messageId])`
 [x] Deleted message row disappears from the table after refresh
 [x] Button is keyboard accessible (focusable, Enter/Space triggers)

## Notes

- Depends on 0154 for `Processor.deleteMessages(personaId, messageIds: string[]): Promise<Message[]>`
- `ContextWindowTab` lives in `web/src/components/EntityEditor/tabs/ContextWindowTab.tsx`
- Parent chain: `App.tsx` → `PersonaEditor` → `ContextWindowTab` (same pattern as `onContextStatusChange`)
- The warning text is intentional — extracted data is a side effect of conversation, not owned by the message

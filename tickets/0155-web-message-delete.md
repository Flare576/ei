# 0155: Web Persona Editor — Delete Message Button

**Status**: PENDING
**Depends on**: 0154 (adds `is_deleted` to Message type and Processor.deleteMessage)
**Blocked by**: 0154

## Summary

Add a trash can (🗑) delete button to each message row in the web persona editor's Context Window tab. Clicking it prompts a confirmation dialog and, on confirm, calls the new `deleteMessage` Processor endpoint introduced in 0154.

## Design

### Trash Can Button

Add a delete column to the existing `ContextWindowTab` message table:

```
| Who | When | What         | Status  | 🗑 |
|-----|------|--------------|---------|-----|
| 👤  | 10:30| Hi there...  | Default |  🗑 |
| 🤖  | 10:31| Hello!       | Always  |  🗑 |
```

The 🗑 button is shown on every non-deleted message row. Already-deleted messages show a muted "deleted" badge instead and a restore option (stretch goal).

### Confirmation Dialog

Standard browser `confirm()` is acceptable for MVP. Content:

> Delete this message from [Persona Name]'s history?
>
> Note: Any Quotes, Topics, Facts, or People extracted from this message will not be reverted.

Two actions: **Delete** (destructive) and **Cancel**.

### Post-Delete Behavior

- Row is immediately hidden from the table (optimistic UI)
- Parent component refreshes message list from Processor state

## Acceptance Criteria

- [ ] Trash can button (🗑) rendered in each message row of `ContextWindowTab`
- [ ] Clicking opens confirmation dialog with persona name and data-retention warning
- [ ] On confirm: calls `processor.deleteMessage(personaId, messageId)`
- [ ] Deleted message row disappears from the table immediately
- [ ] No button shown on already-deleted messages (or stretch: show restore)
- [ ] Button is keyboard accessible (focusable, Enter/Space triggers)

## Notes

- Depends on 0154 for `Processor.deleteMessage()` and `Message.is_deleted`
- `ContextWindowTab` lives in `web/src/components/EntityEditor/tabs/ContextWindowTab.tsx`
- Parent (`PersonaEditor` or `HumanEditor`) passes `onDeleteMessage` callback down
- The warning text is intentional — extracted data is a side effect of conversation, not owned by the message

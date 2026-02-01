# 0120: Quote Management UI

**Status**: PENDING
**Epic**: E011 (Quote Preservation System)
**Depends on**: 0118, 0119

## Summary

Users can edit or delete captured quotes. Also adds a Quotes tab to the Human Editor for browsing all quotes.

## Acceptance Criteria

### Oopsie Modal (Click existing quote)
- [ ] Clicking a highlighted quote opens the management modal
- [ ] Modal shows same UI as capture modal, pre-populated with quote data
- [ ] User can adjust selection range
- [ ] User can edit quote text
- [ ] User can change linked data items
- [ ] Delete button removes the quote entirely
- [ ] Confirmation before delete: "Our bad - should we forget about this?"
- [ ] "Don't ask again" checkbox for future deletes

### Human Editor - Quotes Tab
- [ ] Add "Quotes" tab to Human Editor modal
- [ ] List all quotes, grouped by linked data item (or "Unlinked")
- [ ] Each quote card shows:
  - Quote text (truncated if long)
  - Speaker and timestamp
  - Linked topics/facts
  - Edit and Delete buttons
- [ ] Click quote to open management modal
- [ ] Search/filter quotes

## Oopsie Modal Design

Same as Capture Modal (0119), but with:

```
┌─────────────────────────────────────────────────────────┐
│  📎 Edit Quote                                      [X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  [Same content as capture modal, pre-populated]         │
│                                                         │
│           [🗑️ Delete]  [Cancel]  [💾 Save Changes]      │
└─────────────────────────────────────────────────────────┘
```

## Delete Confirmation

First time:
```
┌─────────────────────────────────────────────────┐
│  Remove Quote?                                  │
├─────────────────────────────────────────────────┤
│                                                 │
│  "I felt that in my tokens."                    │
│                                                 │
│  Our bad - should we forget about this?         │
│                                                 │
│  [ ] Don't ask me again                         │
│                                                 │
│            [Keep It]  [🗑️ Remove]               │
└─────────────────────────────────────────────────┘
```

After "Don't ask again": Delete immediately on click.

Store preference in `HumanSettings.skip_quote_delete_confirm?: boolean`.

## Human Editor - Quotes Tab

```
┌─────────────────────────────────────────────────────────┐
│  [Settings] [Facts] [Traits] [People] [Topics] [Quotes] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  🔍 [Search quotes...]                                  │
│                                                         │
│  ── Ei Development (Topic) ──────────────────────────   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ "I felt that in my tokens."                     │    │
│  │ Sisyphus • 2026-01-30 07:42         [✏️] [🗑️]  │    │
│  └─────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────┐    │
│  │ "The validation layer is chef's kiss."          │    │
│  │ Sisyphus • 2026-01-30 07:42         [✏️] [🗑️]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ── Unlinked ────────────────────────────────────────   │
│  ┌─────────────────────────────────────────────────┐    │
│  │ "WHO THE HELL KEEPS GIVING THIS GUY ACCESS..."  │    │
│  │ Flare • 2026-02-01 08:15            [✏️] [🗑️]  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│                              [+ Add Quote Manually]     │
└─────────────────────────────────────────────────────────┘
```

## Notes

**Why a separate tab?**: As chat history rolls off (future feature), quotes survive because they're on HumanEntity. Users need a place to browse/manage all quotes, not just those visible in current chat.

**"Add Quote Manually"**: Opens capture modal without a source message. User types the quote directly. Stored with `message_id: null`, `start: null`, `end: null`. Can't highlight, but preserved for posterity.

**Quote card actions**:
- Click card → Open management modal
- Edit button → Open management modal
- Delete button → Delete confirmation (or immediate if skipped)

## Testing

- [ ] E2E: Click highlight opens management modal
- [ ] E2E: Edit quote updates storage
- [ ] E2E: Delete removes quote, updates chat display
- [ ] E2E: "Don't ask again" persists preference
- [ ] E2E: Quotes tab shows all quotes
- [ ] E2E: Search filters quotes
- [ ] E2E: Manual quote creation (no source message)

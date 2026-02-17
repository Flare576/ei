# 0150: TUI /quotes Command

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton), 0116 (Quote Data Type & Storage)
**Priority**: Low (Post-V1 Polish)

## Summary

Create a `/quotes` command for TUI that provides quote management functionality equivalent to (or better than) the web interface's Quote Management UI.

## Background

The web interface has a full Quote Management UI (ticket 0120) with:
- List of all quotes with source message preview
- Visibility toggles (General/Persona-specific)
- Importance sliders
- Delete functionality
- Click-to-navigate to source message

TUI currently has no way to view or manage quotes. The `/me` command doesn't include quotes, and inline quote highlighting was explored but deemed impractical (ANSI codes get escaped by marked.js, overlapping quotes complicate inline rendering).

### Experiments Tried

1. **ANSI escape codes in markdown** - Failed. marked.js escapes them, showing literal `[4mtext[24m`.
2. **Inline highlighting** - Deferred. Overlapping quotes and markdown parsing boundaries make this fragile.

## Acceptance Criteria

### Core Functionality

- [ ] `/quotes` command displays all quotes for current persona
- [ ] Each quote shows: text snippet, source message timestamp, visibility, importance
- [ ] Can toggle quote visibility (General ↔ Persona-specific)
- [ ] Can adjust quote importance
- [ ] Can delete quotes
- [ ] Can navigate to source message (scroll chat to that message)

### UX Considerations

- [ ] Keyboard-driven interface (vim-style navigation)
- [ ] Clear visual hierarchy for quote list
- [ ] Confirmation before delete
- [ ] Graceful handling of quotes whose source message was deleted

### Stretch Goals

- [ ] `/quotes search <term>` - filter quotes by content
- [ ] `/quotes add` - manual quote capture (select text range somehow?)
- [ ] Show quote count in status bar or persona list
- [ ] Visual indicator in chat for messages containing quotes (small glyph at quote end positions)

## Technical Design

### Command Registration

```typescript
// tui/src/commands/quotes.ts
export const quotesCommand: SlashCommand = {
  name: "quotes",
  description: "Manage quotes for current persona",
  execute: async (args, context) => {
    // Open quotes panel/modal
  }
}
```

### UI Options to Explore

1. **Modal overlay** - Like web's Quote Management modal
2. **Split pane** - Temporarily replace chat with quote list
3. **Inline expansion** - Show quotes below current message area
4. **Dedicated route** - Full-screen quote manager (like OpenCode's session list)

### Data Access

Quotes are stored per-persona. Need to:
1. Get current persona from context
2. Fetch `Human.Quotes` filtered by persona visibility
3. Support CRUD operations through Processor

## Notes

- Quote highlighting in chat is a separate concern - could be a follow-up ticket
- Web uses character offsets (`start`/`end`) for highlighting - TUI might need different approach
- Consider whether `/quotes` should show ALL quotes or just current-persona-visible ones

## References

- Web Quote Management: `web/src/components/Entity/QuotesTab.tsx`
- Quote types: `src/core/types.ts` (Quote interface)
- Web rendering: `web/src/components/Chat/MarkdownContent.tsx`

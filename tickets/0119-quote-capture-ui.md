# 0119: Quote Capture UI (Scissors Modal)

**Status**: DONE
**Epic**: E011 (Quote Preservation System)
**Depends on**: 0116, 0118

## Summary

The scissors icon lets users manually capture quotes the extraction missed.

## Acceptance Criteria

- [ ] Scissors icon appears on message hover
- [ ] Clicking scissors opens the Quote Capture modal
- [ ] Modal displays the full message content
- [ ] Dual-slider selects highlight range (start/end positions)
- [ ] Preview shows selected text with highlight styling
- [ ] Text field allows appending/editing (for multi-message quotes, punchlines)
- [ ] "Link to" dropdown associates quote with data items
- [ ] Save validates and stores the quote
- [ ] Warning if custom text doesn't match message (can't highlight, but still saves)

## Modal Design

```
┌─────────────────────────────────────────────────────────┐
│  ✂️ Capture Quote                                   [X] │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Message from Sisyphus (2026-01-30 07:42):              │
│  ┌─────────────────────────────────────────────────┐    │
│  │ I'm dying at this dialogue. Also: I felt that   │    │
│  │ in my tokens. The validation layer is chef's    │    │
│  │ kiss.                                           │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Select the part to highlight:                          │
│  ○─────────────[======]─────────────○                   │
│            start ↑    ↑ end                             │
│                                                         │
│  Preview:                                               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ [highlighted] I felt that in my tokens.         │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  Add your own text (punchlines, context):               │
│  ┌─────────────────────────────────────────────────┐    │
│  │ I felt that in my tokens.                       │    │
│  │ _                                               │    │
│  └─────────────────────────────────────────────────┘    │
│  💡 The highlight stays where you set it above.         │
│     Add extra text here - we'll save it but only       │
│     highlight the original selection.                   │
│                                                         │
│  Link to:                                               │
│  [v] Ei Development (Topic)                             │
│  [ ] Quote System (Topic)                               │
│  [+ Search/Add...]                                      │
│                                                         │
│                      [Cancel]  [💾 Save Quote]          │
└─────────────────────────────────────────────────────────┘
```

## Dual-Slider Component

```tsx
interface RangeSelectorProps {
  text: string;
  start: number;
  end: number;
  onChange: (start: number, end: number) => void;
}

function RangeSelector({ text, start, end, onChange }: RangeSelectorProps) {
  // Two thumbs on a single track
  // Left thumb: start position
  // Right thumb: end position
  // Constrained: start < end, both within [0, text.length]
  
  return (
    <div className="range-selector">
      <input
        type="range"
        min={0}
        max={text.length}
        value={start}
        onChange={(e) => onChange(Math.min(Number(e.target.value), end - 1), end)}
      />
      <input
        type="range"
        min={0}
        max={text.length}
        value={end}
        onChange={(e) => onChange(start, Math.max(Number(e.target.value), start + 1))}
      />
    </div>
  );
}
```

**Better approach**: Use a proper dual-thumb slider library (e.g., `rc-slider` Range component) for better UX.

## Behavior Rules

1. **Initial state**: Slider selects entire message, text field shows full content
2. **User adjusts slider**: Preview updates, text field updates to match selection
3. **User edits text field**: Text can be longer than selection (append punchlines)
4. **User adjusts slider AFTER editing text**: Text field resets to new selection (warn first?)
5. **Save**: Store with slider positions as start/end, text field content as quote.text

## Validation on Save

```typescript
function saveQuote(message: Message, start: number, end: number, text: string) {
  const selectedText = message.content.slice(start, end);
  
  if (!text.startsWith(selectedText)) {
    // User edited the beginning - can't reliably highlight
    // Warn but allow save
    showWarning("Your text doesn't match the selection. We'll save it, but can't highlight it in chat.");
    return saveWithoutPositions(message, text);
  }
  
  // Text matches selection (possibly with additions)
  return saveWithPositions(message, start, end, text);
}
```

## Notes

**The punchline feature**: User selects "I felt that in my tokens" but the full joke includes a response in the next message. They can type/paste the punchline into the text field. The highlight only covers the selected part, but the full quote is preserved.

**"It can be our secret"**: The footer text should be friendly and explain this isn't a bug - it's intentional flexibility.

## Testing

- [ ] E2E: Open modal from scissors icon
- [ ] E2E: Slider adjusts selection
- [ ] E2E: Preview updates with selection
- [ ] E2E: Text field allows editing
- [ ] E2E: Save creates quote with correct positions
- [ ] E2E: Warning shown when text doesn't match

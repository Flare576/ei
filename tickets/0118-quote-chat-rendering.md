# 0118: Quote Chat Rendering

**Status**: PENDING
**Epic**: E011 (Quote Preservation System)
**Depends on**: 0116

## Summary

Render captured quotes as highlights within chat messages.

## Acceptance Criteria

- [ ] Messages with quotes show highlighted text spans
- [ ] Highlighted spans are visually distinct (background color, border, etc.)
- [ ] Clicking a highlighted span opens the Quote Management modal (0120)
- [ ] Messages with quotes that lack start/end positions show a badge instead
- [ ] Scissors icon appears on hover for manual quote capture

## Implementation

### Message Rendering

```tsx
function renderMessageContent(
  message: Message,
  quotes: Quote[],
  onQuoteClick: (quote: Quote) => void,
  onScissorsClick: (message: Message) => void
): React.ReactNode {
  const messageQuotes = quotes
    .filter(q => q.message_id === message.id && q.start !== null && q.end !== null)
    .sort((a, b) => a.start! - b.start!);
  
  if (messageQuotes.length === 0) {
    return <span>{message.content}</span>;
  }
  
  // Build segments: [normal, highlight, normal, highlight, ...]
  const segments: Array<{ text: string; quote?: Quote }> = [];
  let cursor = 0;
  
  for (const quote of messageQuotes) {
    // Text before this quote
    if (quote.start! > cursor) {
      segments.push({ text: message.content.slice(cursor, quote.start!) });
    }
    // The quoted text
    segments.push({ 
      text: message.content.slice(quote.start!, quote.end!),
      quote 
    });
    cursor = quote.end!;
  }
  // Remaining text after last quote
  if (cursor < message.content.length) {
    segments.push({ text: message.content.slice(cursor) });
  }
  
  return (
    <>
      {segments.map((seg, i) => 
        seg.quote ? (
          <span 
            key={i}
            className="quote-highlight"
            onClick={() => onQuoteClick(seg.quote!)}
            title="Click to edit or remove"
          >
            {seg.text}
          </span>
        ) : (
          <span key={i}>{seg.text}</span>
        )
      )}
    </>
  );
}
```

### CSS

```css
.quote-highlight {
  background-color: rgba(255, 200, 100, 0.3);
  border-bottom: 2px solid var(--ei-accent);
  cursor: pointer;
  transition: background-color var(--ei-transition-fast);
}

.quote-highlight:hover {
  background-color: rgba(255, 200, 100, 0.5);
}

/* Badge for quotes without positions */
.quote-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 0.75em;
  color: var(--ei-text-secondary);
  margin-left: 8px;
}

/* Scissors icon on hover */
.message-scissors {
  opacity: 0;
  transition: opacity var(--ei-transition-fast);
  cursor: pointer;
}

.message:hover .message-scissors {
  opacity: 0.6;
}

.message-scissors:hover {
  opacity: 1;
}
```

### Quote Badge (for non-positioned quotes)

When a quote has `start: null` / `end: null`, we can't highlight inline. Show a badge instead:

```tsx
const nonPositionedQuotes = quotes.filter(
  q => q.message_id === message.id && (q.start === null || q.end === null)
);

{nonPositionedQuotes.length > 0 && (
  <span className="quote-badge">
    📎 {nonPositionedQuotes.length} saved
  </span>
)}
```

## Notes

**Overlapping quotes**: If two quotes overlap (rare), the segment builder needs to handle it. For MVP, later quote wins. Future enhancement could merge or nest highlights.

**Performance**: Building segments is O(q) where q = quotes per message. Typically 0-3, so trivial.

## Testing

- [ ] E2E: Message with quote shows highlight
- [ ] E2E: Click highlight opens modal
- [ ] E2E: Scissors icon visible on hover
- [ ] E2E: Badge shown for non-positioned quotes

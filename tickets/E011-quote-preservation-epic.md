# E011: Quote Preservation System (Epic)

**Status**: PENDING

## The Problem

Conversations accumulate. Context balloons. Eventually, we need compaction.

But compaction loses the *good stuff* - the memorable lines, the callbacks, the "remember when you said X?" moments. An LLM summarizing a Topic description will compress away the exact phrasing that made something funny or meaningful.

## The Solution

**Quotes** - a new data type that preserves exact text from messages, linked to data items (Topics, Facts, etc.) but stored separately so compaction can't touch them.

### Key Insight: Deterministic Validation

LLMs hallucinate quotes. "The user said they love cats" when they actually said "I tolerate cats."

**We don't trust the LLM to attribute quotes.** We:
1. Ask the LLM: "What quotes are worth preserving?"
2. Search the actual message for that exact string
3. If found → store with character positions (start/end)
4. If not found → discard (or let user manually capture)

### Human in the Loop

The user sees highlighted quotes in chat. They can:
- **Scissors icon**: Manually capture quotes the LLM missed
- **Click highlight**: Edit or delete captured quotes

The system captures what it can. The human corrects what it misses. Over time, the important stuff accumulates.

## The Quote Entity

```typescript
interface Quote {
  id: string;                    // UUID
  message_id: string;            // FK to Message
  data_item_ids: string[];       // FK[] to DataItemBase (Facts, Topics, etc.)
  persona_groups: string[];      // Visibility groups
  
  text: string;                  // The quote content (may include user additions)
  speaker: "human" | string;     // Who said it (persona name)
  timestamp: string;             // When (from message)
  
  start: number | null;          // Character offset for highlight (null = non-verbatim)
  end: number | null;            // Character offset for highlight (null = non-verbatim)
  
  created_at: string;            // When we captured it
  created_by: "extraction" | "human";  // How we got it
}
```

**Lives on**: `HumanEntity.quotes: Quote[]`

**First referential constraint in EI**: `data_item_ids` points to IDs across facts/traits/topics/people.

## UI Flow

### Automatic Capture (Extraction)
1. Step 3 prompt asks for notable quotes
2. LLM returns candidates
3. We search message for exact match
4. If found: Store with start/end positions
5. Chat renders with highlights

### Manual Capture (Scissors)
1. User clicks scissors icon on a message
2. Modal shows:
   - The message content
   - Dual-slider to select highlight range
   - Preview of selection
   - Text field to append/edit (for multi-message jokes, punchlines)
3. Save stores the quote

### Quote Management (Oopsie)
1. User clicks a highlighted quote
2. Same modal, but with existing data
3. Can edit range, text, or delete entirely

## Tickets

| Ticket | Title | Summary |
|--------|-------|---------|
| 0116 | Quote Data Type & Storage | Types, HumanEntity.quotes, StateManager methods |
| 0117 | Quote Extraction | Step 3 prompt changes, validation logic |
| 0118 | Quote Chat Rendering | Highlight quotes in message display |
| 0119 | Quote Capture UI | Scissors icon, modal with dual-slider |
| 0120 | Quote Management UI | Edit/delete modal, Human Editor tab |

## Future Considerations

- **Chat history rolloff**: When messages age out, quotes remain (they're on HumanEntity, not Message)
- **Topic compaction**: Quotes survive because they're separate from Topic.description
- **Human Editor**: May need a "Quotes" tab to browse/manage all quotes (0120 scope)

## The Philosophy

> "It's all about the lulz, Sisyphus."

The system remembers what matters. The human decides what matters. Together, we preserve the moments worth keeping.

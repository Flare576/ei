# 0150: TUI /quotes Command

**Status**: PENDING
**Depends on**: 0100 (TUI Frontend Skeleton), 0116 (Quote Data Type & Storage)
**Priority**: Low (Post-V1 Polish)

## Summary

Create a `/quotes` command for TUI that provides quote management functionality equivalent to (or better than) the web interface's Quote Management UI. Includes visual indicators in chat showing where quotes exist.

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

## Design

### Visual Indicators in Chat

Messages containing quotes show two indicators:

1. **Message index** `[N]` in the header for `/quotes N` targeting
2. **Superscript marker** `⁺` at each quote's end position within the text

```
Ei (04:33) [1]: Hi there!⁺
Human (04:34) [2]: Sup Ei⁺ How's it going?
Ei (04:35): Good!
```

**Index behavior**:
- Computed at render time (not persisted)
- First message in array = `[1]`, second = `[2]`, etc.
- Only messages with quotes get an index
- Indices are stable during a session but roll off as old messages leave the array

**Superscript insertion**:
- Insert `⁺` at each quote's `end` position
- Process right-to-left to preserve character offsets
- Insert before passing content to `<markdown>` component

### Command Signature

```
/quotes              # All quotes → $EDITOR (YAML format)
/quotes search "X"   # Quotes containing X → $EDITOR
/quotes N            # Quotes from message [N] → Overlay modal
/quotes Bob          # Bob's quotes → $EDITOR
/quotes me           # Human's quotes → $EDITOR
```

### Overlay Modal (for `/quotes N`)

Shows quotes from a specific message with keyboard navigation:

- `j/k` - Navigate quote list
- `Enter` - Select quote (show full details?)
- `e` - Open this message's quotes in $EDITOR
- `d` - Delete selected quote (with confirmation)
- `Escape` - Close overlay

### $EDITOR Format (YAML)

Follow `/me` command pattern. YAML structure per quote:

```yaml
quotes:
  - id: "uuid-here"  # Read-only, used for updates
    text: "The actual quote text"
    speaker: "human"  # or persona name
    timestamp: "2024-01-15T10:30:00Z"  # Read-only
    message_id: "msg-uuid"  # Read-only, nullable
    data_item_ids:
      - "fact-uuid-1"
      - "topic-uuid-2"
    persona_groups:
      - "General"
      - "Ei"
    # To delete: remove the entire quote block
```

## Acceptance Criteria

### Core Functionality

- [ ] Visual indicators in MessageList
  - [ ] `[N]` index on messages with quotes
  - [ ] `⁺` superscript at quote end positions
- [ ] `/quotes` opens all quotes in $EDITOR
- [ ] `/quotes N` opens overlay for message N's quotes
- [ ] `/quotes me` opens human quotes in $EDITOR
- [ ] `/quotes <persona>` opens that speaker's quotes in $EDITOR
- [ ] Quote CRUD via YAML editing (add/update/delete)
- [ ] Overlay allows delete with confirmation

### UX Considerations

- [ ] Keyboard-driven interface (vim-style navigation in overlay)
- [ ] Clear visual hierarchy for quote list
- [ ] Confirmation before delete
- [ ] Graceful handling of quotes whose source message was deleted
- [ ] `e` in overlay drops into $EDITOR for that message's quotes

### Stretch Goals

- [ ] `/quotes add` - manual quote capture (select text range somehow?)
- [ ] Show quote count in status bar or persona list

### Semantic Search Enhancement

- [ ] `/quotes search <term>` uses embedding similarity instead of substring match
- [ ] Response prompt context selection uses embeddings to pick relevant quotes/topics/people

## Technical Design

### EiContext Additions

Add to `tui/src/context/ei.tsx`:

```typescript
// In EiContextValue interface:
getQuotes: (filter?: { message_id?: string; speaker?: string }) => Promise<Quote[]>;
getQuotesForMessage: (messageId: string) => Promise<Quote[]>;
updateQuote: (id: string, updates: Partial<Quote>) => Promise<void>;
removeQuote: (id: string) => Promise<void>;
```

### MessageList Changes

```typescript
// Helper to insert superscript markers
function insertQuoteMarkers(content: string, quotes: Quote[]): string {
  const validQuotes = quotes
    .filter(q => q.end !== null)
    .sort((a, b) => b.end! - a.end!);  // Right-to-left
  
  let result = content;
  for (const quote of validQuotes) {
    result = result.slice(0, quote.end!) + '⁺' + result.slice(quote.end!);
  }
  return result;
}

// Build message-to-index map (only messages with quotes)
function buildQuoteIndexMap(messages: Message[], quotesMap: Map<string, Quote[]>): Map<string, number> {
  const indexMap = new Map<string, number>();
  let index = 1;
  for (const msg of messages) {
    if (quotesMap.has(msg.id) && quotesMap.get(msg.id)!.length > 0) {
      indexMap.set(msg.id, index++);
    }
  }
  return indexMap;
}
```

### Command Registration

```typescript
// tui/src/commands/quotes.tsx
export const quotesCommand: Command = {
  name: "quotes",
  aliases: ["q"],
  description: "Manage quotes",
  usage: "/quotes [N | search \"term\" | me | <persona>]",
  
  async execute(args, ctx) {
    if (args.length === 0) {
      // All quotes → $EDITOR
      await openQuotesInEditor(ctx, await ctx.ei.getQuotes());
    } else if (args[0] === "search" && args[1]) {
      // Search → $EDITOR with filtered quotes
      const term = args.slice(1).join(" ").replace(/^"|"$/g, "");
      const all = await ctx.ei.getQuotes();
      const filtered = all.filter(q => q.text.toLowerCase().includes(term.toLowerCase()));
      await openQuotesInEditor(ctx, filtered);
    } else if (args[0] === "me") {
      // Human quotes → $EDITOR
      const all = await ctx.ei.getQuotes();
      const humanQuotes = all.filter(q => q.speaker === "human");
      await openQuotesInEditor(ctx, humanQuotes);
    } else if (/^\d+$/.test(args[0])) {
      // Message index → Overlay
      const index = parseInt(args[0], 10);
      ctx.showOverlay((hide) => <QuotesOverlay messageIndex={index} onClose={hide} />);
    } else {
      // Persona name → $EDITOR
      const speaker = args.join(" ");
      const all = await ctx.ei.getQuotes();
      const filtered = all.filter(q => q.speaker.toLowerCase() === speaker.toLowerCase());
      await openQuotesInEditor(ctx, filtered);
    }
  }
};
```

### New Files

- `tui/src/commands/quotes.tsx` - Command implementation
- `tui/src/components/QuotesOverlay.tsx` - Overlay for `/quotes N`
- `tui/src/util/yaml-serializers.ts` - Add `quotesToYAML` / `quotesFromYAML`

## Notes

- Quotes are stored in `HumanEntity.quotes[]` (not per-persona)
- Processor API: `getQuotes()`, `getQuotesForMessage()`, `updateQuote()`, `removeQuote()`
- Web reference: `web/src/components/EntityEditor/tabs/HumanQuotesTab.tsx`

## Semantic Search & Context Selection

### Quote Search with Embeddings

The `/quotes search` command should use semantic similarity instead of substring matching:

```typescript
// In quotes.tsx execute() for search branch:
import { getEmbeddingService, findTopK } from "../../../src/core/embedding-service";

const embeddingService = getEmbeddingService();
const queryVector = await embeddingService.embed(term);
const results = findTopK(queryVector, allQuotes, 20);  // Top 20 matches
const filtered = results
  .filter(({ similarity }) => similarity >= 0.3)  // Min threshold
  .map(({ item }) => item);
await openQuotesInEditor(ctx, filtered);
```

### Response Prompt Context Selection (Bonus Enhancement)

Currently `buildResponsePromptData()` in `processor.ts` selects context by:
- **Topics**: Filter to `exposure_current > 0.3`, take top 10 by exposure
- **People**: Take top 10 by exposure_current  
- **Quotes**: Take 10 most recent by timestamp

**Problem**: This misses semantically relevant context that hasn't been discussed recently.

**Solution**: Use the current message + recent conversation to embed a query, then select top-K most relevant items across all categories:

```typescript
// In processor.ts buildResponsePromptData() or a new helper:

private async selectRelevantContext(
  messages: Message[],
  human: HumanEntity,
  visibleGroups: Set<string>,
  limits: { topics: number; people: number; quotes: number }
): Promise<ResponsePromptData["human"]> {
  // Build query from recent conversation
  const recentMessages = messages.slice(-5);
  const queryText = recentMessages.map(m => m.content).join(" ");
  
  const embeddingService = getEmbeddingService();
  const queryVector = await embeddingService.embed(queryText);
  
  // Filter by visibility first, then rank by similarity
  const visibleTopics = filterByGroup(human.topics, visibleGroups);
  const visiblePeople = filterByGroup(human.people, visibleGroups);
  const visibleQuotes = filterQuotesByGroup(human.quotes, visibleGroups);
  
  const topTopics = findTopK(queryVector, visibleTopics, limits.topics).map(r => r.item);
  const topPeople = findTopK(queryVector, visiblePeople, limits.people).map(r => r.item);
  const topQuotes = findTopK(queryVector, visibleQuotes, limits.quotes).map(r => r.item);
  
  return {
    facts: filterByGroup(human.facts, visibleGroups),  // Keep all facts (usually small set)
    traits: filterByGroup(human.traits, visibleGroups), // Keep all traits
    topics: topTopics,
    people: topPeople,
    quotes: topQuotes,
  };
}
```

This makes the persona aware of contextually relevant information even if it hasn't been discussed recently.

## References

- Web Quote Management: `web/src/components/Quote/QuoteManagementModal.tsx`
- Quote types: `src/core/types.ts` (Quote interface)
- Web highlighting: `web/src/components/Layout/ChatPanel.tsx` (renderMessageContent)
- TUI command pattern: `tui/src/commands/me.tsx`

# 0117: Quote Extraction (Step 3)

**Status**: DONE
**Epic**: E011 (Quote Preservation System)
**Depends on**: 0116

## Summary

Modify the Step 3 extraction prompt to identify notable quotes, then validate and store them.

## Acceptance Criteria

- [ ] Update `buildHumanItemUpdatePrompt` to request quotes in response
- [ ] Add `quotes` field to expected JSON response
- [ ] Handler validates each quote candidate against the actual message
- [ ] Validated quotes are stored via `StateManager.addQuote()`
- [ ] Non-matching quotes are discarded (logged for debugging)

## Prompt Changes

Add to the Step 3 prompt (item-update.ts):

```
## Quotes

In addition to updating the ${typeLabel}, identify any **memorable, funny, important, or stand-out phrases** from the Most Recent Messages that relate to this ${typeLabel}.

Return them in the \`quotes\` array:

\`\`\`json
{
  "name": "...",
  "description": "...",
  "sentiment": 0.5,
  "quotes": [
    {
      "text": "exact phrase from the message",
      "reason": "why this is worth preserving"
    }
  ]
}
\`\`\`

**CRITICAL**: Return the EXACT text as it appears in the message. We will verify it.
```

## Validation Logic

```typescript
function validateAndStoreQuotes(
  candidates: Array<{ text: string; reason: string }>,
  messages: Message[],
  dataItemId: string,
  personaName: string,
  state: StateManager
): void {
  for (const candidate of candidates) {
    // Search all messages for exact match
    for (const message of messages) {
      const start = message.content.indexOf(candidate.text);
      if (start !== -1) {
        const quote: Quote = {
          id: crypto.randomUUID(),
          message_id: message.id,
          data_item_ids: [dataItemId],
          persona_groups: ["General"], // Or inherit from data item
          text: candidate.text,
          speaker: message.role === "human" ? "human" : personaName,
          timestamp: message.timestamp,
          start: start,
          end: start + candidate.text.length,
          created_at: new Date().toISOString(),
          created_by: "extraction",
        };
        state.addQuote(quote);
        console.log(`[extraction] Captured quote: "${candidate.text.slice(0, 50)}..."`);
        break; // Found it, move to next candidate
      }
    }
    // If we get here without finding it, log and skip
    console.log(`[extraction] Quote not found in messages, skipping: "${candidate.text.slice(0, 50)}..."`);
  }
}
```

## Notes

**Why exact match?**: LLMs paraphrase. "User said they love cats" might come back when the message says "I tolerate cats." By requiring exact match, we ensure the quote is real.

**Duplicate prevention**: Before storing, check if a quote with the same `message_id` + `start` + `end` already exists. Skip if so.

**Performance**: This runs during Step 3, which already analyzes messages. The string search is O(n*m) where n = messages, m = candidates. Should be fine for typical conversation lengths.

## Testing

- [ ] Unit test: Quote found in message → stored with correct positions
- [ ] Unit test: Quote not found → not stored, logged
- [ ] Unit test: Duplicate quote → not stored twice
- [ ] Integration test: Full extraction flow captures quotes

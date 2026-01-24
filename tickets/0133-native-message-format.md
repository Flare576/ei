# 0133: Native Message Format for Responses

**Status**: PENDING

## Problem

Currently, we pass conversation history as a text blob embedded in the user prompt:

```typescript
// Current approach (src/llm.ts lines 335-341)
messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: userPromptWithHistoryBlob },
]
```

The user prompt contains formatted history like:
```
### RECENT CONVERSATION ###
Human: Hi Ei
Ei: Hello, Flare!
Human: How are you?
### END CONVERSATION ###
```

This is suboptimal because:
1. The model must re-parse conversation structure every time
2. No benefit from API-level conversation caching
3. Model trained on native message format, not our custom markers
4. Less clear separation of "who said what"

## Solution

Switch response generation to use native OpenAI message format:

```typescript
// New approach
messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: "Hi Ei" },
  { role: "assistant", content: "Hello, Flare!" },
  { role: "user", content: "How are you?" },
]
```

**Important**: Only apply to **response generation**. Extraction prompts remain text-blob based because they're analytical tasks where the model examines a transcript, not continues a conversation.

## Implementation

### 1. New LLM Function

Create `callLLMWithHistory()` in `src/llm.ts`:

```typescript
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export async function callLLMWithHistory(
  systemPrompt: string,
  history: ChatMessage[],
  options: LLMOptions = {}
): Promise<string | null> {
  const { signal, temperature = 0.7, model: modelSpec, operation } = options;
  
  if (signal?.aborted) {
    throw new LLMAbortedError();
  }

  const { client, model, provider } = resolveModel(modelSpec, operation);

  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    ...history,
  ];

  // ... rate limit retry logic (same as callLLMRaw)
  
  const response = await client.chat.completions.create(
    { model, messages, temperature },
    { signal }
  );

  // ... clean response (same as callLLM)
}
```

### 2. Convert History Format

Create helper in `src/prompts.ts`:

```typescript
import { Message } from "./types.js";
import { ChatMessage } from "./llm.js";

/**
 * Convert internal Message format to OpenAI ChatMessage format.
 * Maps "human" → "user" and "system" → "assistant".
 */
export function toNativeMessages(
  history: Message[],
  currentMessage?: string
): ChatMessage[] {
  const messages: ChatMessage[] = history.map(m => ({
    role: m.role === "human" ? "user" : "assistant",
    content: m.content,
  }));
  
  if (currentMessage) {
    messages.push({ role: "user", content: currentMessage });
  }
  
  return messages;
}
```

### 3. Update Response Generation

In `src/processor.ts`, update `processEvent()` to use new format:

```typescript
// Before
const response = await callLLM(systemPrompt, userPrompt, { signal, ... });

// After
const nativeHistory = toNativeMessages(recentHistory, humanMessage);
const response = await callLLMWithHistory(systemPrompt, nativeHistory, { signal, ... });
```

### 4. Simplify Response User Prompt

The current `buildResponseUserPrompt()` in `src/prompts.ts` constructs elaborate prompts with:
- Conversation state context
- History blob
- Repetition warnings

With native messages, simplify to:
- System prompt contains all persona context (already does)
- History is passed natively (no formatting needed)
- Current message is just the last user message

**Keep**: Conversation state hints can go in system prompt
**Remove**: History blob construction, `### CONVERSATION ###` markers

### 5. Handle Edge Cases

**No-message heartbeats**: When `humanMessage` is null (proactive reach-out):
- Pass history ending with last assistant message
- Add system-level instruction in system prompt about whether to reach out

**Continuation detection**: Current logic detects consecutive system messages:
```typescript
const consecutiveSystemMessages = countTrailingSystemMessages(recentHistory);
```
This logic moves to system prompt context, not user prompt.

## Files Changed

| File | Changes |
|------|---------|
| `src/llm.ts` | Add `callLLMWithHistory()`, export `ChatMessage` type |
| `src/prompts.ts` | Add `toNativeMessages()`, simplify `buildResponseUserPrompt()` |
| `src/processor.ts` | Update `processEvent()` to use new functions |

## Acceptance Criteria

- [ ] Create `callLLMWithHistory()` function
- [ ] Create `toNativeMessages()` helper
- [ ] Update response generation to use native format
- [ ] Simplify `buildResponseUserPrompt()` (remove history blob)
- [ ] Move conversation state context to system prompt
- [ ] Handle no-message heartbeat case
- [ ] Extraction prompts unchanged (still use text blobs)
- [ ] Manual test: conversation quality should improve or stay same
- [ ] Manual test: proactive reach-out (heartbeat) still works

## Testing

1. **Basic conversation**: Multi-turn chat should feel natural
2. **Persona switching**: Different personas maintain their voice
3. **Heartbeat**: Unprompted messages still work correctly
4. **Long history**: Ensure token limits are respected

## Dependencies

None - can be implemented independently.

## Notes

- This only affects response generation, not extraction
- Extraction is an analytical task (examining a transcript), so text blobs are appropriate
- Native format enables future optimizations (caching, streaming, etc.)
- Consider adding conversation length limits (token counting) in future ticket

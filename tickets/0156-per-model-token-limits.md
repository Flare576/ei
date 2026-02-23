# 0156: Per-Model Token Limits

**Status**: DONE
**Depends on**: 0096 (Provider Accounts & Settings Sync)
**Blocked by**: None

---

## Summary

The extraction chunker uses a single hard-coded `DEFAULT_MAX_TOKENS = 10000` for all models. This wastes capacity on large-context models (128K+ tokens) and risks overflow on small local models (2K-8K default context). The chunker already accepts a `maxTokens` parameter — the work is getting the right value to it per-model.

### Research Findings: API Auto-Detection

| Provider | Auto-Detect? | Method | Field |
|----------|:---:|---------|-------|
| **Google Gemini** | YES | `models.get()` / `models.list()` | `inputTokenLimit` |
| **Ollama** | YES | `POST /api/show` | `model_info.{family}.context_length` |
| **OpenAI** | NO | `/v1/models` returns no context info | — |
| **Anthropic** | NO | `/v1/models` returns `id`, `display_name`, `type` only | — |
| **LM Studio** | NO | OpenAI-compatible, same limitation | — |
| **xAI (Grok)** | NO | OpenAI-compatible, same limitation | — |

**Conclusion**: Only 2 of 6 providers expose context windows via API. A lookup table with optional auto-detection and user override is the right approach.

## Architecture

### Resolution Order (highest precedence first)

1. **User override** — `context_window` field on `ProviderAccount` (for custom/fine-tuned models)
2. **API auto-detection** — Google Gemini and Ollama only (async, cached)
3. **Lookup table** — built-in map of known model → context window size
4. **Conservative default** — 8192 tokens (safe for any model)

### Key Design Decision: Extraction Budget vs Context Window

The `context_window` is the model's total capacity. The extraction chunker should NOT use the full window — it needs room for the system prompt and response. The existing ratios (`CONTEXT_RATIO = 0.15`, `ANALYZE_RATIO = 0.85`, `SYSTEM_PROMPT_BUFFER = 1000`) handle this correctly once given the right `maxTokens`.

The `maxTokens` passed to `chunkExtractionContext()` should be a **fraction of the context window** — not the whole thing. Proposed: `Math.floor(contextWindow * 0.75)` to leave room for system prompt + response.

## Acceptance Criteria

### Data Model

- [ ] Add optional `context_window?: number` to `ProviderAccount` interface
  - User-specified override for the model's context window
  - When set, takes absolute precedence over auto-detection and lookup

### Lookup Table

- [ ] Create `src/core/model-context-windows.ts` with:
  - `KNOWN_CONTEXT_WINDOWS: Record<string, number>` — model name patterns → token count
  - `getKnownContextWindow(modelName: string): number | undefined` — fuzzy match function
  - Pattern matching: `"gpt-4o"` matches `"gpt-4o"`, `"gpt-4o-2024-08-06"`, etc.

Known sizes to include:

| Model | Context Window |
|-------|------:|
| gpt-4o | 128,000 |
| gpt-4o-mini | 128,000 |
| gpt-4.1 | 1,048,576 |
| gpt-4.1-mini | 1,048,576 |
| gpt-4.1-nano | 1,048,576 |
| gpt-3.5-turbo | 16,384 |
| claude-3-opus | 200,000 |
| claude-3-sonnet | 200,000 |
| claude-3-haiku | 200,000 |
| claude-3.5-sonnet | 200,000 |
| claude-3.5-haiku | 200,000 |
| claude-opus-4 | 200,000 |
| claude-sonnet-4 | 200,000 |
| gemini-2.0-flash | 1,000,000 |
| gemini-2.5-flash | 1,000,000 |
| gemini-2.5-pro | 1,000,000 |
| gemini-1.5-pro | 1,000,000 |
| gemini-1.5-flash | 1,000,000 |
| llama-3.1-* | 131,072 |
| llama-3.2-* | 131,072 |
| llama-3.3-* | 131,072 |
| mistral-7b | 32,768 |
| mixtral-8x7b | 32,768 |
| deepseek-coder-v2 | 163,840 |
| deepseek-v3 | 131,072 |
| qwen-2.5-* | 131,072 |

### Auto-Detection (Optional, Phase 2)

- [ ] `fetchContextWindow(provider, model, config): Promise<number | undefined>`
  - **Google**: `GET {baseURL}/models/{model}` → `inputTokenLimit`
  - **Ollama**: `POST {baseURL}/../api/show` → `model_info.{family}.context_length`
  - Cache results in memory for session lifetime (no re-fetching)
  - Timeout: 3 seconds — fall through to lookup on failure
  - Never block startup — fire-and-forget with callback

### Resolution Function

- [ ] Add `resolveContextWindow()` to `llm-client.ts` (or new file):

```typescript
function resolveContextWindow(
  modelSpec: string,
  accounts?: ProviderAccount[],
  cachedDetection?: Map<string, number>
): number {
  const resolved = resolveModel(modelSpec, accounts);

  // 1. User override on account
  if (accounts) {
    const account = accounts.find(a => a.name.toLowerCase() === resolved.provider.toLowerCase());
    if (account?.context_window) return account.context_window;
  }

  // 2. Cached auto-detection result
  const cacheKey = `${resolved.provider}:${resolved.model}`;
  if (cachedDetection?.has(cacheKey)) return cachedDetection.get(cacheKey)!;

  // 3. Lookup table
  const known = getKnownContextWindow(resolved.model);
  if (known) return known;

  // 4. Conservative default
  return 8192;
}
```

### Wire Into Extraction

- [ ] Update all 6 `chunkExtractionContext(context)` call sites in `human-extraction.ts` to pass `maxTokens`:
  - Resolve model spec from `HumanSettings` (e.g., `EI_MODEL_CONCEPT`)
  - Call `resolveContextWindow()` to get the context window
  - Pass `Math.floor(contextWindow * 0.75)` as `maxTokens`
- [ ] The existing `DEFAULT_MAX_TOKENS = 10000` remains as an absolute floor — never chunk smaller than this

### Logging

- [ ] Log on first use per model: `[TokenLimit] {model}: {source} → {contextWindow} tokens (extraction budget: {maxTokens})`
  - Source: "user-override" | "auto-detected" | "lookup-table" | "default"
- [ ] Warn when falling back to default: `[TokenLimit] Unknown model "{model}" — using conservative default (8192)`

## Non-Goals

- **Token counting accuracy** — The existing `CHARS_PER_TOKEN = 4` heuristic is fine. Per-model tokenizers are overkill for chunking.
- **Response prompt token limits** — This ticket only covers extraction chunking. Response prompts use message history windowing which is a separate concern.
- **UI for context window** — The existing Settings UI for provider accounts just needs an optional number field. No dedicated UI work.

## Files to Modify

| File | Change |
|------|--------|
| `src/core/types.ts` | Add `context_window?: number` to `ProviderAccount` |
| `src/core/model-context-windows.ts` | **NEW** — lookup table + `getKnownContextWindow()` |
| `src/core/llm-client.ts` | Add `resolveContextWindow()` export |
| `src/core/orchestrators/human-extraction.ts` | Pass resolved `maxTokens` to all 6 `chunkExtractionContext()` calls |
| `src/core/orchestrators/extraction-chunker.ts` | No changes needed (already parameterized) |

## Notes

- `chunkExtractionContext()` already accepts `maxTokens` parameter — it's just never passed anything. The chunker itself needs zero changes.
- The lookup table will need periodic updates as new models release. Consider a comment with "last updated" date.
- Ollama's default context is 8192 tokens regardless of model capability — users must explicitly set `num_ctx` higher. This means Ollama auto-detection returns the *configured* context, not the model maximum, which is actually what we want (it reflects real available capacity).
- Google Gemini auto-detection is the most reliable — clean field, always present, always accurate.

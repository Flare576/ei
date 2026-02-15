# 0143: Model Compatibility Guidance

**Status**: PENDING
**Depends on**: 0096 (Settings Sync - for web UI warnings)
**Blocked by**: None

## Summary

Provide users guidance on which local LLM models work well (and which don't) with Ei's message structure. Some models have strict Jinja template requirements (e.g., Gemma requires alternating user/assistant messages) that conflict with Ei's conversation architecture.

## Background

Ei's conversation structure:
- Messages don't always alternate user/assistant
- System instructions often appear in final user block
- Multiple consecutive user messages are common (human sends, persona doesn't respond)

Models like Gemma 2 enforce strict alternation in their Jinja templates:
```
"Conversation roles must alternate user/assistant/user/assistant/..."
```

This causes 400 errors that are confusing to debug.

## Acceptance Criteria

### Documentation (README.md)
- [ ] Add "Model Compatibility" section to README
- [ ] Document known incompatible models (Gemma family)
- [ ] Document recommended models (Mistral Nemo, Llama 3, Phi-3, etc.)
- [ ] Explain WHY some models fail (Jinja template alternation requirements)
- [ ] Note LM Studio workaround (My Models > Prompt Template > Manual)

### Web UI Warning (Settings)
- [ ] Add model compatibility check in LLM settings
- [ ] When user configures a known-problematic model, show warning banner
- [ ] Warning should explain the issue and suggest alternatives
- [ ] Warning should NOT block usage (user may have custom template)
- [ ] Store known-incompatible model patterns in a config (easy to update)

### Implementation Details

**Incompatible model patterns** (initial list):
- `gemma` (all variants)
- `gemma2`
- `google/gemma*`

**Recommended models** (for extraction/conversation):
- `mistral-nemo` - Clinical output, good JSON, no alternation requirement
- `llama3` / `llama3.2` - Flexible, well-tested
- `phi3` / `phi3.5` - Good instruction following
- `qwen2.5` - Generally compatible (avoid for extraction quality, not compatibility)

**Warning component location**: `web/src/components/Settings/LLMSettings.tsx` (or wherever model config lives)

## Notes

- This came from debugging Gemma 2 12B failing on quote extraction
- The Jinja template can be overridden in LM Studio, but that's fragile
- Better to guide users to compatible models upfront
- Consider: Could we detect this error pattern and show a helpful message?

## Future Considerations

- Auto-detect model compatibility by sending a test prompt with consecutive user messages
- Community-maintained compatibility database
- Model-specific prompt template adapters (transform our messages to fit model requirements)

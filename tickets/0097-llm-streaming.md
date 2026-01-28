# 0097: LLM Streaming Support

**Status**: PENDING
**Depends on**: 0011

## Summary

Stream LLM responses for real-time display instead of waiting for complete response.

## Acceptance Criteria

- [ ] QueueProcessor supports streaming mode
- [ ] LLM client handles SSE/streaming responses
- [ ] Chat UI displays tokens as they arrive
- [ ] Typing indicator during stream
- [ ] Graceful degradation if streaming not supported
- [ ] Abort works mid-stream
- [ ] Final message assembled from stream chunks

## Notes

This significantly improves perceived responsiveness for long responses. Requires:
1. LLM client streaming support (most providers support this)
2. New event: `onMessageStreaming(personaName, partialContent)`
3. UI state for "streaming in progress"

Lower priority - complete responses work fine, just feel slower.

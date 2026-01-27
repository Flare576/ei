# 0009: Ollama & Other Local LLM CORS Investigation

**Status**: PENDING
**Depends on**: 0001
**Priority**: Low

## Summary

Investigate CORS requirements for local LLM providers other than LM Studio. Document setup steps for each supported provider.

## Providers to Investigate

- [ ] Ollama - Does it support CORS? What config is needed?
- [ ] llama.cpp server - CORS headers?
- [ ] Text Generation WebUI - API compatibility?
- [ ] LocalAI - OpenAI-compatible API?

## Acceptance Criteria

- [ ] Document CORS setup for Ollama
- [ ] Document CORS setup for at least one other provider
- [ ] Update README.md with provider-specific instructions
- [ ] Test EI connectivity with each documented provider

## Notes

This is a documentation/compatibility ticket, not a code change. The goal is to ensure EI works with the most popular local LLM options.

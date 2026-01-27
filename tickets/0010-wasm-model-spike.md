# 0010: WebAssembly In-Browser Model Spike

**Status**: PENDING
**Depends on**: None
**Priority**: Low (Future exploration)

## Summary

Investigate whether small language models can be loaded directly into the browser via WebAssembly, eliminating the need for a local LLM server entirely.

## Research Questions

- [ ] What WASM-compatible model runtimes exist? (llama.cpp WASM, transformers.js, etc.)
- [ ] What model sizes are practical for browser loading? (RAM constraints)
- [ ] What's the performance like compared to native execution?
- [ ] Can we use WebGPU for acceleration?
- [ ] What's the initial load time / model download size tradeoff?

## Potential Benefits

- Zero setup for users (no LM Studio, no Ollama)
- Fully offline capable
- No CORS concerns
- Portable (works anywhere a browser works)

## Potential Drawbacks

- Limited model size (probably <7B parameters)
- Slower inference than native
- Large initial download
- Memory pressure on low-RAM devices

## Acceptance Criteria

- [ ] Identify 2-3 viable WASM model runtime options
- [ ] Create proof-of-concept loading a small model (~1-3B) in browser
- [ ] Benchmark inference speed vs LM Studio
- [ ] Document findings and recommendation

## Resources to Explore

- [llama.cpp WASM](https://github.com/nicehorse06/llama.cpp-wasm)
- [Transformers.js](https://huggingface.co/docs/transformers.js)
- [WebLLM](https://webllm.mlc.ai/)
- [MLC LLM](https://mlc.ai/mlc-llm/)

## Notes

This is a future exploration spike. Not blocking V1 launch - EI will work fine with LM Studio. This is about reducing friction for new users who don't want to install additional software.

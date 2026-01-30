# 0111: Persona Tool Use (Web Search, Verification)

**Status**: PENDING  
**Depends on**: 0011 (Response Prompt), probably needs new Epic
**Difficulty**: 🌶️🌶️🌶️🌶️🌶️ (Here be dragons)

## Summary

Enable personas to use external tools (web search, API calls) to verify facts and provide accurate information instead of hallucinating.

## Problem Statement

DJ (music persona) confidently recommends "Song X by Artist Y" - great recommendations individually, but often the song isn't actually by that artist. The LLM is pattern-matching vibes, not verifying facts.

This is a fundamental LLM limitation: they generate plausible-sounding information, not verified information. The only fix is tool use - letting the model query external sources before responding.

## The Can of Worms

Tool use in LLMs is... non-trivial:

1. **Model Support**: Not all models support function calling. Local models via LM Studio vary wildly in capability.

2. **Architecture**: Current flow is `prompt → LLM → response`. Tool use requires `prompt → LLM → tool call → tool result → LLM → response` (or multiple rounds).

3. **Tool Definition**: Need a schema for available tools, how to invoke them, parsing the model's "I want to call X" output.

4. **Security**: Web search is one thing. What if someone configures a "run shell command" tool? Sandbox concerns.

5. **Cost/Latency**: Each tool call adds latency. Web searches are slow. Do we show "thinking..." states?

6. **Provider Variance**: OpenAI has structured function calling. Local models might emit `<tool>search("query")</tool>` or just hallucinate tool calls.

## Potential Approaches

### A. Naive Web Search Injection
Before sending to LLM, detect queries that might need verification ("what songs did X release?"), do a search, inject results into context.
- Pro: Works with any model
- Con: Requires heuristics to detect when to search, adds latency to every message

### B. Model-Driven Tool Calling
Let model request tools explicitly via function calling or structured output.
- Pro: Model decides when tools are needed
- Con: Requires model support, complex parsing

### C. Retrieval-Augmented Generation (RAG)
Build a local knowledge base of verified facts (e.g., MusicBrainz dump), query it before responding.
- Pro: Fast, no external calls
- Con: Limited to what's in the database, needs maintenance

### D. Hybrid
Combination of above - RAG for common queries, web search fallback, model can request either.

## Research Needed

- [ ] Survey which local models support function calling (Mistral? Llama 3?)
- [ ] Evaluate web search APIs (SerpAPI, Tavily, Brave Search API)
- [ ] Prototype tool calling loop with a capable model
- [ ] Investigate MCP (Model Context Protocol) as a standard for tool interfaces

## Acceptance Criteria

TBD - this ticket is "Future Flare's problem" until research phase completes.

## Notes

From the original conversation:
> "I have no forking idea how to ACTUALLY wire up tool use, if it's easy, or if I'm essentially saying 'hey, can we add the hardest thing in LLM/AI to my little pet project about chatting with witty computers?'"

This is a valid concern. Tool use is genuinely one of the more complex LLM patterns. But it's also the difference between "fun chat toy" and "actually useful assistant."

Parking this for now. Future Flare: good luck, you'll need it. 🫡

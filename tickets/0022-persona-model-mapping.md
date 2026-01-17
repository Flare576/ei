# 0022: Multi-Model LLM Architecture (Epic)

**Status**: DONE

## Summary

Allow each persona to use a different LLM model/provider, enable operation-specific model configuration, and support multiple LLM providers (OpenAI, Anthropic, Google, X.AI, local).

## Problem

Currently all personas share a single global model (`EI_LLM_MODEL`). Different personas might benefit from different models:
- **ei**: Could use a flagship model (Gemini Pro, GPT-4) for nuanced emotional intelligence
- **mike**: Might work great with a local model for quick, practical responses
- **lena**: Could leverage a creative-focused model
- **beta**: Testing ground for experimental models

Additionally, different *operations* might benefit from different models:
- **Responses**: Needs creativity and personality - flagship model
- **Concept updates**: Needs reliable JSON output - structured model
- **Persona generation**: Needs creativity but also structure - mid-tier model

No way to configure any of this today.

## Proposed Solution

### Provider/Model String Format

Use a `provider:model` format to specify both where and what:

```
local:google/gemma-3-12b      # Local LM Studio / Ollama
openai:gpt-4o                 # OpenAI API
google:gemini-1.5-pro         # Google AI Studio
anthropic:claude-3-sonnet     # Anthropic API
x:grok-2                      # xAI API
```

### Schema Addition

Add optional `model` field to persona's `system.jsonc`:

```jsonc
{
  "entity": "system",
  "aliases": ["ei", "friend"],
  "model": "google:gemini-1.5-pro",  // NEW - optional, falls back to global
  "last_updated": "...",
  "concepts": [...]
}
```

### Provider Configuration

Environment variables for provider endpoints/keys:

```bash
# Existing (becomes "local" provider)
EI_LLM_BASE_URL=http://127.0.0.1:1234/v1
EI_LLM_API_KEY=not-needed-for-local
EI_LLM_MODEL=google/gemma-3-12b  # Default when no persona model set

# New provider configs
EI_OPENAI_API_KEY=sk-...
EI_GOOGLE_API_KEY=...
EI_ANTHROPIC_API_KEY=...
EI_XAI_API_KEY=...

# Operation-specific defaults (optional)
EI_MODEL_RESPONSE=openai:gpt-4o          # For conversational responses
EI_MODEL_CONCEPT=local:google/gemma-3-12b # For concept map updates
EI_MODEL_GENERATION=openai:gpt-4o-mini    # For persona creation
```

### Fallback Chain

1. Persona's `model` field (if set)
2. Operation-specific env var (e.g., `EI_MODEL_RESPONSE`)
3. Global `EI_LLM_MODEL` env var
4. Default: `local:google/gemma-3-12b`

### Commands

```
/model                    # Show current persona's model (and fallback info)
/model <provider:model>   # Set model for current persona
/model --clear            # Remove persona-specific model (use global default)
/model --list             # List available/configured providers
```

## Sub-Tickets

| Ticket | Title | Priority | Dependencies |
|--------|-------|----------|--------------|
| 0080 | Core Multi-Provider Infrastructure | High | None |
| 0081 | Schema - Add Model Field to ConceptMap | High | None |
| 0082 | Refactor LLM Calls - Accept Model Parameter | High | 0080 |
| 0083 | Operation-Specific Model Configuration | Medium | 0082 |
| 0084 | /model Command - View and Set Persona Models | Medium | 0081, 0082 |
| 0085 | Provider-Specific Optimizations | Low | 0082 |
| 0086 | Documentation - Multi-Model Setup Guide | Low | All |

### Implementation Phases

**Phase 1 - Foundation (Parallel)**
- 0080: Multi-provider infrastructure (llm.ts refactor)
- 0081: Add `model` field to schema

**Phase 2 - Integration (Sequential)**
- 0082: Refactor all LLM calls to use model parameter
- 0083: Operation-specific model config

**Phase 3 - User-Facing**
- 0084: `/model` command

**Phase 4 - Polish (Optional)**
- 0085: Provider-specific optimizations
- 0086: Complete documentation

## Acceptance Criteria

- [x] Sub-ticket 0080 complete: Multi-provider infrastructure
- [x] Sub-ticket 0081 complete: Schema updated
- [x] Sub-ticket 0082 complete: LLM calls refactored
- [x] Sub-ticket 0083 complete: Operation-specific models
- [x] Sub-ticket 0084 complete: /model command
- [x] Sub-ticket 0085 complete: Provider optimizations (partial - rate limits + headers)
- [x] Sub-ticket 0086 complete: Documentation

## Value Statement

Mix and match models based on persona personality and use case. Run cheap local models for background tasks, bring in the big guns for complex conversations. Experiment with new models without affecting all personas.

## Dependencies

- None (extends existing LLM infrastructure)

## Effort Estimate

Large: ~12-16 hours total across all sub-tickets

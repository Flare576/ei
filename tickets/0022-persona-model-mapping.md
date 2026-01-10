# 0022: Per-Persona Model Configuration

**Status**: PENDING

## Summary

Allow each persona to use a different LLM model/provider, enabling mixed-model conversations where each persona has distinct "brains."

## Problem

Currently all personas share a single global model (`EI_LLM_MODEL`). Different personas might benefit from different models:
- **ei**: Could use a flagship model (Gemini Pro, GPT-4) for nuanced emotional intelligence
- **mike**: Might work great with a local model for quick, practical responses
- **lena**: Could leverage a creative-focused model
- **beta**: Testing ground for experimental models

No way to configure this per-persona today.

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
```

### Implementation

```typescript
// llm.ts additions
interface ProviderConfig {
  baseURL: string;
  apiKey: string;
}

const PROVIDERS: Record<string, ProviderConfig> = {
  local: {
    baseURL: process.env.EI_LLM_BASE_URL || "http://127.0.0.1:1234/v1",
    apiKey: process.env.EI_LLM_API_KEY || "not-needed",
  },
  openai: {
    baseURL: "https://api.openai.com/v1",
    apiKey: process.env.EI_OPENAI_API_KEY || "",
  },
  // ... etc
};

function getClientForModel(modelSpec: string): { client: OpenAI; model: string } {
  const [provider, model] = modelSpec.includes(":") 
    ? modelSpec.split(":", 2) 
    : ["local", modelSpec];
  
  const config = PROVIDERS[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);
  
  return {
    client: new OpenAI({ baseURL: config.baseURL, apiKey: config.apiKey }),
    model,
  };
}
```

### Fallback Chain

1. Persona's `model` field (if set)
2. Global `EI_LLM_MODEL` env var
3. Default: `local:google/gemma-3-12b`

### Commands

```
/model                    # Show current persona's model (and fallback info)
/model <provider:model>   # Set model for current persona
/model --clear            # Remove persona-specific model (use global default)
/model --list             # List available/configured providers
```

Example output:

```
> /model
Current model for ei: google:gemini-1.5-pro

> /model local:google/gemma-3-12b
Model for ei set to: local:google/gemma-3-12b

> /model --clear
Model for ei cleared. Using global default: local:google/gemma-3-12b

> /model --list
Configured providers:
  local     ✓ http://127.0.0.1:1234/v1
  openai    ✓ (API key set)
  google    ✗ (no API key)
  anthropic ✗ (no API key)
```

### Open Questions

- **Cost tracking**: Should we log which provider/model was used per message for cost awareness?
- **Rate limiting**: Different providers have different limits - handle gracefully?
- **Capability mismatch**: Some models may not handle JSON output well - per-model tweaks?

## Acceptance Criteria

- [ ] Persona `system.jsonc` supports optional `model` field
- [ ] `provider:model` format parsed correctly
- [ ] Multiple provider configs via env vars
- [ ] Fallback to global model when persona model not set
- [ ] Different personas can use different models in same session
- [ ] Error handling for misconfigured/unavailable providers
- [ ] `/model` shows current persona's model config
- [ ] `/model <provider:model>` sets model for current persona
- [ ] `/model --clear` removes persona-specific override
- [ ] `/model --list` shows configured providers
- [ ] `/help` updated with model commands

## Value Statement

Mix and match models based on persona personality and use case. Run cheap local models for casual chat, bring in the big guns for complex discussions. Experiment with new models without affecting all personas.

## Dependencies

- None (extends existing LLM infrastructure)

## Effort Estimate

Medium: ~3-4 hours

# 0086: Documentation - Multi-Model Setup Guide

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Create comprehensive documentation for the multi-model LLM system, including environment variable reference, provider setup guides, and example configurations.

## Problem

After implementing 0080-0085, users need documentation to:
- Understand available configuration options
- Set up API keys for different providers
- Choose appropriate models for their use cases
- Troubleshoot common issues

## Proposed Solution

### Update AGENTS.md

Add new section "## LLM Configuration" with subsections:

#### Environment Variables Reference

```markdown
## LLM Configuration

### Environment Variables

| Variable | Purpose | Default |
|----------|---------|---------|
| `EI_LLM_BASE_URL` | Local provider endpoint | `http://127.0.0.1:1234/v1` |
| `EI_LLM_API_KEY` | Local provider API key | `not-needed-for-local` |
| `EI_LLM_MODEL` | Global default model | `local:google/gemma-3-12b` |
| `EI_OPENAI_API_KEY` | OpenAI API key | (none) |
| `EI_GOOGLE_API_KEY` | Google AI Studio API key | (none) |
| `EI_ANTHROPIC_API_KEY` | Anthropic API key | (none) |
| `EI_XAI_API_KEY` | xAI (Grok) API key | (none) |
| `EI_MODEL_RESPONSE` | Model for conversational responses | (uses `EI_LLM_MODEL`) |
| `EI_MODEL_CONCEPT` | Model for concept map updates | (uses `EI_LLM_MODEL`) |
| `EI_MODEL_GENERATION` | Model for persona generation | (uses `EI_LLM_MODEL`) |
| `EI_LOG_MODEL_USAGE` | Log token usage per call | `false` |
```

#### Provider Setup

```markdown
### Provider Setup

#### Local (LM Studio / Ollama)

No API key needed. Ensure your local server is running:

```bash
# LM Studio: Start server on default port
# Ollama: ollama serve

export EI_LLM_BASE_URL=http://127.0.0.1:1234/v1
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### OpenAI

1. Get API key from https://platform.openai.com/api-keys
2. Set environment variable:

```bash
export EI_OPENAI_API_KEY=sk-...
```

#### Google AI Studio

1. Get API key from https://aistudio.google.com/apikey
2. Set environment variable:

```bash
export EI_GOOGLE_API_KEY=...
```

#### Anthropic

1. Get API key from https://console.anthropic.com/
2. Set environment variable:

```bash
export EI_ANTHROPIC_API_KEY=sk-ant-...
```

#### xAI (Grok)

1. Get API key from https://console.x.ai/
2. Set environment variable:

```bash
export EI_XAI_API_KEY=...
```
```

#### Model Spec Format

```markdown
### Model Specification Format

Models are specified as `provider:model`:

```
local:google/gemma-3-12b      # Local LM Studio / Ollama
openai:gpt-4o                 # OpenAI GPT-4o
openai:gpt-4o-mini            # OpenAI GPT-4o Mini (cheaper)
google:gemini-1.5-pro         # Google Gemini 1.5 Pro
google:gemini-1.5-flash       # Google Gemini 1.5 Flash (faster)
anthropic:claude-3-5-sonnet   # Anthropic Claude 3.5 Sonnet
anthropic:claude-3-haiku      # Anthropic Claude 3 Haiku (faster)
x:grok-2                      # xAI Grok 2
```

Bare model names (without `provider:`) assume the `local` provider:

```bash
export EI_LLM_MODEL=google/gemma-3-12b  # Same as local:google/gemma-3-12b
```
```

#### Example Configurations

```markdown
### Example Configurations

#### Development (Local Only)

```bash
# Use local LM Studio for everything
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### Production (Mixed Models)

```bash
# Flagship model for conversations
export EI_MODEL_RESPONSE=openai:gpt-4o

# Cheap/fast model for background work
export EI_MODEL_CONCEPT=local:google/gemma-3-12b
export EI_MODEL_GENERATION=openai:gpt-4o-mini

# Fallback if nothing else specified
export EI_LLM_MODEL=local:google/gemma-3-12b
```

#### Per-Persona Customization

```bash
# Set global defaults
export EI_LLM_MODEL=local:google/gemma-3-12b

# Then customize specific personas via /model command:
/model openai:gpt-4o          # Premium model for 'ei'
# Switch to another persona...
/model anthropic:claude-3-haiku  # Fast model for 'helper'
```

#### Cost-Conscious Setup

```bash
# Use local models for everything except critical conversations
export EI_LLM_MODEL=local:google/gemma-3-12b
export EI_MODEL_RESPONSE=openai:gpt-4o-mini  # Only pay for responses
```
```

#### Troubleshooting

```markdown
### Troubleshooting

#### "Unknown provider: X"

Valid providers: `local`, `openai`, `google`, `anthropic`, `x`

Check spelling in your model spec.

#### "No API key configured for provider: X"

Set the appropriate environment variable:
- OpenAI: `EI_OPENAI_API_KEY`
- Google: `EI_GOOGLE_API_KEY`
- Anthropic: `EI_ANTHROPIC_API_KEY`
- xAI: `EI_XAI_API_KEY`

#### "Connection refused" (local provider)

Ensure your local LLM server is running:
- LM Studio: Start the server from the app
- Ollama: Run `ollama serve`

Check `EI_LLM_BASE_URL` matches your server's address.

#### JSON parsing errors with local models

Some smaller models struggle with JSON output. Options:
1. Use a larger/smarter model for concept updates: `export EI_MODEL_CONCEPT=openai:gpt-4o-mini`
2. The system will automatically retry with enhanced guidance

#### Rate limiting

The system automatically retries rate-limited requests with exponential backoff. If you see repeated rate limit warnings:
1. Reduce request frequency
2. Upgrade your API tier
3. Use local models for background operations
```

## Files Modified

- `AGENTS.md` - Add "LLM Configuration" section with all subsections above

## Acceptance Criteria

- [ ] Environment variable reference table is complete and accurate
- [ ] Provider setup instructions cover all 5 providers
- [ ] Model spec format is clearly explained with examples
- [ ] Example configurations cover common use cases
- [ ] Troubleshooting section addresses likely issues
- [ ] All env var names match actual implementation
- [ ] All provider URLs/endpoints are correct

## Dependencies

- All other epic tickets (0080-0085) - document final implementation

## Effort Estimate

Small: 1 hour

## Notes

- This should be written/finalized AFTER implementation is complete
- Keep examples practical and copy-pasteable
- Focus on "how to get started" rather than exhaustive reference

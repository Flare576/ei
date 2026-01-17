# 0084: /model Command - View and Set Persona Models

**Status**: PENDING

**Parent Epic**: 0022 - Multi-Model LLM Architecture

## Summary

Add `/model` command to the blessed UI for viewing and managing per-persona model configuration.

## Problem

After 0080-0083, the infrastructure supports per-persona models, but users have no way to:
- See what model the current persona is using
- Change a persona's model
- See which providers are configured

## Proposed Solution

### Command Syntax

```
/model                    # Show current persona's model configuration
/model <provider:model>   # Set model for current persona
/model --clear            # Remove persona-specific model (use defaults)
/model --list             # List all providers and their status
```

### Command: `/model` (no args)

Show current persona's model with full fallback chain:

```
Model configuration for 'ei':

  Persona model:     openai:gpt-4o
  Operation models:  (using persona model)
  Global default:    local:google/gemma-3-12b

Currently using: openai:gpt-4o
```

Or when no persona model is set:

```
Model configuration for 'mike':

  Persona model:     (not set)
  Response model:    EI_MODEL_RESPONSE = openai:gpt-4o
  Concept model:     EI_MODEL_CONCEPT = (not set)
  Global default:    EI_LLM_MODEL = local:google/gemma-3-12b

Currently using for responses: openai:gpt-4o
Currently using for concepts: local:google/gemma-3-12b
```

### Command: `/model <spec>`

Set the persona's model:

```
> /model google:gemini-1.5-pro
Model for 'ei' set to: google:gemini-1.5-pro
```

With validation:

```
> /model fake:model
Error: Unknown provider 'fake'. Valid providers: local, openai, google, anthropic, x

> /model openai:gpt-4o
Error: No API key configured for 'openai'. Set EI_OPENAI_API_KEY environment variable.
```

### Command: `/model --clear`

Remove persona-specific model:

```
> /model --clear
Model override cleared for 'ei'. Now using default: local:google/gemma-3-12b
```

### Command: `/model --list`

Show all providers and their configuration status:

```
Available Providers:

  local      ✓ Configured (http://127.0.0.1:1234/v1)
  openai     ✓ Configured (API key set)
  google     ✗ Not configured (set EI_GOOGLE_API_KEY)
  anthropic  ✗ Not configured (set EI_ANTHROPIC_API_KEY)
  x          ✗ Not configured (set EI_XAI_API_KEY)

Current defaults:
  EI_LLM_MODEL        = local:google/gemma-3-12b
  EI_MODEL_RESPONSE   = (not set)
  EI_MODEL_CONCEPT    = (not set)
  EI_MODEL_GENERATION = (not set)
```

### Implementation

#### Command Handler (app.ts)

```typescript
private async handleModelCommand(args: string[]): Promise<void> {
  const arg = args[0];
  
  if (!arg) {
    // Show current config
    await this.showModelConfig();
    return;
  }
  
  if (arg === "--clear") {
    await this.clearPersonaModel();
    return;
  }
  
  if (arg === "--list") {
    await this.listProviders();
    return;
  }
  
  // Set model
  await this.setPersonaModel(arg);
}

private async setPersonaModel(modelSpec: string): Promise<void> {
  // Validate the model spec can be resolved
  try {
    resolveModel(modelSpec);  // Will throw if invalid
  } catch (err) {
    this.showSystemMessage(`Error: ${err.message}`);
    return;
  }
  
  // Update persona's concept map
  const concepts = await loadConceptMap("system", this.currentPersona);
  concepts.model = modelSpec;
  await saveConceptMap(concepts, this.currentPersona);
  
  // Update in-memory state if needed
  this.showSystemMessage(`Model for '${this.currentPersona}' set to: ${modelSpec}`);
}
```

#### Storage Changes

The `saveConceptMap` function already handles arbitrary fields on ConceptMap, so no changes needed there. The model field will be persisted when the concept map is saved.

### Help Text Update

Add to `/help` output:

```
Model Commands:
  /model                    Show current model configuration
  /model <provider:model>   Set model for current persona
  /model --clear            Remove persona model (use default)
  /model --list             List available providers

Examples:
  /model openai:gpt-4o      Use OpenAI GPT-4o for current persona
  /model local:gemma-3      Use local Gemma model
  /model --clear            Revert to default model
```

## Files Modified

- `src/blessed/app.ts` - Add command handler and helper methods
- `src/llm.ts` - Export `getProviderStatuses()` for `/model --list`
- Help text (wherever `/help` content is defined)

## Acceptance Criteria

- [ ] `/model` shows current persona's model with fallback explanation
- [ ] `/model <provider:model>` validates and sets persona model
- [ ] `/model <spec>` shows helpful error for unknown provider
- [ ] `/model <spec>` shows helpful error for missing API key
- [ ] `/model --clear` removes persona model override
- [ ] `/model --list` shows all providers with status
- [ ] Model changes persist to persona's `system.jsonc` file
- [ ] `/help` updated with model commands
- [ ] Integration tests verify command behavior

## Testing Strategy

### Unit Tests

```typescript
describe("/model command", () => {
  it("shows current model config", async () => {
    // Set up persona with model
    // Execute /model
    // Verify output shows persona model, fallbacks
  });
  
  it("sets persona model", async () => {
    // Execute /model openai:gpt-4o
    // Verify persona file updated
    // Verify success message shown
  });
  
  it("validates model spec", async () => {
    // Execute /model fake:model
    // Verify error message shown
    // Verify persona file NOT changed
  });
  
  it("clears persona model", async () => {
    // Set up persona with model
    // Execute /model --clear
    // Verify persona file updated (model removed)
  });
});
```

## Dependencies

- **0081**: Schema must have `model` field
- **0082**: Need `resolveModel()` for validation

## Effort Estimate

Medium: 2-3 hours

## Notes

- The command output is intentionally verbose to help users understand the fallback chain
- Error messages include actionable guidance (which env var to set)
- Model validation happens at set time, not use time, to fail fast

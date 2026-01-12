# 0057: Persona Creation via /persona Command

**Status**: PENDING

## Summary
Re-implement `/persona <name>` command to create new personas when the specified persona doesn't exist, with interactive persona generation flow.

## Problem
Currently, `/persona <name>` only switches to existing personas. When a persona doesn't exist, it shows "Persona 'name' not found" instead of offering to create it. This forces users to use external tools or manual file creation to add new personas, breaking the conversational workflow.

## Proposed Solution

### Enhanced Persona Command Flow
1. **Existing behavior**: `/persona <name>` switches to existing persona
2. **New behavior**: When persona not found, prompt user: "Persona 'name' not found. Create it? (y/n)"
3. **Creation flow**: If yes, launch interactive persona generator
4. **Auto-switch**: After creation, automatically switch to the new persona

### Interactive Creation Process
```
> /persona assistant
Persona 'assistant' not found. Create it? (y/n): y

Creating new persona 'assistant'...
What should this persona be like? (describe their role, personality, expertise): 
> A helpful coding assistant that specializes in TypeScript and testing

Generating persona... ✓
Persona 'assistant' created and activated!
```

### Implementation Details
- Integrate with existing persona generator system
- Use blessed modal interface for creation prompts (depends on 0038)
- Validate persona names (no spaces, special chars, etc.)
- Handle creation failures gracefully
- Support cancellation at any step

## Acceptance Criteria
- [ ] `/persona <existing_name>` continues to work (switch behavior)
- [ ] `/persona <new_name>` prompts for creation when persona not found
- [ ] Creation prompt accepts y/n input with clear messaging
- [ ] Interactive persona generation flow launches on confirmation
- [ ] New persona files are created in correct directory structure
- [ ] Application automatically switches to newly created persona
- [ ] Creation process can be cancelled without side effects
- [ ] Invalid persona names are rejected with helpful error messages
- [ ] Creation failures show clear error messages and don't leave partial files

## Testing Requirements

✅ **E2E TESTING FRAMEWORK READY**: The E2E testing framework from ticket 0056 is complete and fully supports interactive input testing for blessed applications.

**Available Testing Capabilities**:
- **Input simulation**: `sendInput()` and `sendCommand()` work reliably with blessed
- **Interactive flows**: Can handle multi-step user interactions (y/n prompts, text input)
- **State verification**: Can verify persona creation, file system changes, and application state
- **Mock LLM integration**: Supports persona generation with configurable responses

**Test Coverage Strategy**:
1. **E2E tests**: Full persona creation flow using existing framework patterns
2. **Unit tests**: Direct testing of `handlePersonaCommand()` logic
3. **Integration tests**: File system operations and persona switching
4. **Error handling tests**: Invalid names, creation failures, cancellation

**Existing Test Patterns**: Multiple E2E tests already expect `/persona create <name>` syntax, indicating this feature was anticipated in the framework design.

## Value Statement
Streamlines persona creation workflow by eliminating the need to exit the application or use external tools. Enables rapid persona experimentation and reduces friction in multi-persona conversations.

## Dependencies
- **Hard dependency**: 0058 (Blessed App.ts Refactoring) - must be completed first for clean implementation
- **Soft dependency**: 0038 (Multi-line Modal Interface) - would improve UX but not required
- **✅ Resolved**: E2E testing framework from 0056 is complete and ready

## Effort Estimate
Small-Medium (~2-3 hours) - leverages existing persona creation system and proven E2E testing patterns
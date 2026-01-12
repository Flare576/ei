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

⚠️ **CRITICAL TESTING CHALLENGE**: This will be the **first ticket that requires solving the blessed application input testing problem** discovered during E2E testing POC (ticket 0056).

**Current Issue**: Our E2E test framework cannot send input to blessed applications because blessed uses its own input event system, not standard `process.stdin`. The signal-based testing approach works for quit commands but won't work for interactive flows like persona creation.

**Testing Approaches Needed**:
1. **Direct method testing**: Test `handlePersonaCommand()` logic directly
2. **File system verification**: Confirm persona files are created correctly  
3. **State verification**: Ensure application switches to new persona
4. **Future**: Solve blessed input simulation for full E2E testing

**Test Coverage Required**:
- Unit tests for persona creation logic
- Integration tests for file system operations
- State verification tests for persona switching
- Error handling tests for invalid names and creation failures

## Value Statement
Streamlines persona creation workflow by eliminating the need to exit the application or use external tools. Enables rapid persona experimentation and reduces friction in multi-persona conversations.

## Dependencies
- **Soft dependency**: 0038 (Multi-line Modal Interface) - would improve UX but not required
- **Testing dependency**: Blessed input simulation solution from 0056 E2E testing POC

## Effort Estimate
Medium (~3-4 hours) - includes persona creation logic, UI integration, and comprehensive testing strategy
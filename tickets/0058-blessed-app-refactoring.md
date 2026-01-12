# 0058: Blessed App.ts Refactoring

**Status**: PENDING

## Summary
Refactor the monolithic `src/blessed/app.ts` file (1059 lines) into focused, maintainable modules with clear separation of concerns.

## Problem
The `src/blessed/app.ts` file has grown to 1059 lines with ~30+ methods, making it difficult to:
- Navigate and understand the codebase
- Write focused unit tests
- Maintain and debug individual features
- Work on multiple features in parallel without conflicts
- Add new functionality without increasing complexity

The file currently handles multiple distinct responsibilities:
- Application lifecycle and initialization
- Command parsing and handling
- Persona management and switching
- Message processing and queuing
- UI event handling and rendering
- Test input injection
- Exit/cleanup logic

## Proposed Solution

### Refactoring Strategy
Split `app.ts` into focused modules while maintaining the existing public API and functionality:

```
src/blessed/
├── app.ts (main orchestration, ~300 lines)
├── command-handler.ts (all /command logic, ~200 lines)  
├── persona-manager.ts (persona switching, state management, ~250 lines)
├── message-processor.ts (message queuing, processing, ~200 lines)
└── test-support.ts (test input injection, ~100 lines)
```

### Module Responsibilities

**app.ts** (Main Orchestrator):
- Application initialization and lifecycle
- UI setup (screen, layout, focus managers)
- Event handler coordination
- Rendering coordination
- Exit/cleanup logic

**command-handler.ts**:
- Command parsing (`/persona`, `/quit`, `/refresh`, `/help`)
- Command validation and argument processing
- Command execution coordination
- Help text management

**persona-manager.ts**:
- Persona switching logic
- Persona state management (PersonaState map)
- Unread count tracking
- Persona list rendering coordination
- Integration with storage layer

**message-processor.ts**:
- Message queuing and processing
- LLM request orchestration
- Heartbeat system management
- Debounce logic
- AbortController management

**test-support.ts**:
- Test input injection system
- Test mode detection and setup
- Debug logging for test scenarios

### Migration Approach
1. **Extract interfaces first**: Define clear interfaces between modules
2. **Move methods incrementally**: Start with least coupled methods
3. **Maintain existing tests**: Ensure all existing tests continue to pass
4. **Preserve public API**: No changes to external interfaces
5. **Update imports**: Ensure all dependencies are properly imported

## Acceptance Criteria
- [ ] `app.ts` is reduced to ~300 lines focused on orchestration
- [ ] `command-handler.ts` contains all command parsing and execution logic
- [ ] `persona-manager.ts` handles all persona-related state and operations
- [ ] `message-processor.ts` manages message queuing and LLM interactions
- [ ] `test-support.ts` isolates all test-specific functionality
- [ ] All existing unit tests continue to pass without modification
- [ ] All existing E2E tests continue to pass without modification
- [ ] Application functionality remains identical to users
- [ ] No performance regression in application startup or operation
- [ ] Clear interfaces defined between modules
- [ ] Proper TypeScript imports and exports
- [ ] Debug logging continues to work as expected
- [ ] Test input injection system remains functional

## Testing Requirements
- **Regression Testing**: All existing tests must pass
- **Integration Testing**: Verify module interactions work correctly
- **Unit Testing**: Each new module should be unit testable in isolation
- **E2E Validation**: Complete application flow testing
- **Performance Testing**: Ensure no startup or runtime performance impact

## Value Statement
Enables faster development of new features (like persona creation) by providing:
- Clear separation of concerns for easier reasoning
- Focused modules that are easier to test and debug
- Reduced merge conflicts when multiple features are developed
- Better code organization for long-term maintainability
- Foundation for future architectural improvements

## Dependencies
- **Blocks**: 0057 (Persona Creation Command) - should be done before persona creation work
- **Enables**: All future blessed UI features will benefit from cleaner architecture

## Effort Estimate
Medium (~3-4 hours) - careful extraction with comprehensive testing to ensure no regressions

## Implementation Notes
- Use TypeScript interfaces to define clear contracts between modules
- Maintain existing debug logging patterns
- Preserve all existing error handling behavior
- Keep the same blessed UI patterns and event handling
- Ensure test input injection continues to work for E2E testing
- Document the new module structure in code comments
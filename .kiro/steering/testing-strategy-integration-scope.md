# Integration Test Scope and Strategy

## Project Context
- EI is on its **third UI library** (readline → Ink → Blessed)
- UI grew organically through migrations
- E2E tests are **brand new** capability
- About to modularize UI architecture
- Integration tests currently mock Blessed extensively

## Integration Test Philosophy

### What Integration Tests SHOULD Test
**Business logic coordination between components** - things unit tests can't see and E2E tests can't access:

- **Message processing workflows** - How user input flows through command parsing, validation, processor calls, and state updates
- **Persona state management** - How persona switching coordinates between storage loading, state updates, and memory management  
- **Queue and processing coordination** - How message queues, processing states, and heartbeat timers interact
- **Storage coordination** - How multiple components coordinate file I/O operations
- **Error handling flows** - How errors propagate between components and affect system state

### What Integration Tests SHOULD NOT Test
**UI framework behavior** - delegate to E2E tests:

- Blessed widget interactions (screen.alloc, box.setContent, etc.)
- Terminal rendering and layout
- Keyboard input handling
- Screen updates and redraws
- Widget focus management

### Mock Strategy
- **Mock external dependencies**: Storage, LLM calls, network requests
- **Mock system interfaces**: File system, process signals, timers
- **DO NOT mock UI frameworks**: Let E2E tests handle blessed behavior
- **Use real business logic**: Test actual component coordination

## Current Problem
Integration tests extensively mock Blessed interfaces, creating:
- **Maintenance burden**: Keeping mocks in sync with 10+ year old library
- **False failures**: Mock drift from real API
- **Wrong abstraction**: Testing mock behavior instead of business logic
- **Duplicate coverage**: E2E tests already validate UI behavior

## Migration Strategy
1. **Identify blessed-mocking integration tests** - catalog what's mocking UI
2. **Evaluate business logic value** - what coordination is actually being tested?
3. **Move UI-focused tests to E2E** - tests that primarily validate blessed behavior
4. **Refactor coordination tests** - remove blessed mocks, focus on business logic
5. **Eliminate redundant tests** - remove tests that duplicate unit or E2E coverage

## Success Criteria
- Integration tests run without blessed mocks
- Integration tests focus on component coordination only
- Clear separation: Unit (isolation) → Integration (coordination) → E2E (full system)
- Reduced maintenance burden for test infrastructure
- Faster, more reliable integration test suite
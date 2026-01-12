# Implementation Plan: App Modularization

## Overview

This implementation plan converts the monolithic `src/blessed/app.ts` file into focused, maintainable modules while preserving all existing functionality and test compatibility. The approach follows incremental extraction with continuous validation to ensure no regressions.

## Tasks

- [ ] 1. Establish baseline and create module interfaces
  - Create TypeScript interfaces for all new modules
  - Capture baseline performance metrics for comparison
  - _Requirements: 4.1, 8.1, 8.5_

- [ ] 2. Extract Command Handler module
  - [ ] 2.1 Create command-handler.ts with ICommandHandler interface
    - Extract command parsing logic from app.ts
    - Implement parseCommand() and executeCommand() methods
    - Move help text management to command handler
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ] 2.3 Update app.ts to use CommandHandler
    - Replace inline command handling with CommandHandler calls
    - Maintain existing event handler patterns
    - _Requirements: 2.1, 2.3_

- [ ] 3. Extract Persona Manager module
  - [ ] 3.1 Create persona-manager.ts with IPersonaManager interface
    - Extract persona switching logic from app.ts
    - Move PersonaState map management to persona manager
    - Integrate with existing persona-renderer.ts
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 10.4_

  - [ ] 3.3 Update app.ts and CommandHandler to use PersonaManager
    - Replace inline persona management with PersonaManager calls
    - Update command handler to use persona manager for /persona commands
    - _Requirements: 2.1, 2.4_

- [ ] 4. Extract Message Processor module
  - [ ] 4.1 Create message-processor.ts with IMessageProcessor interface
    - Extract message queuing and processing logic from app.ts
    - Move heartbeat system management to message processor
    - Integrate with existing chat-renderer.ts
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 10.1_

  - [ ] 4.3 Update app.ts to use MessageProcessor
    - Replace inline message processing with MessageProcessor calls
    - Maintain existing debounce and abort controller patterns
    - _Requirements: 2.1, 2.5_

- [ ] 5. Extract Test Support module
  - [ ] 5.1 Create test-support.ts with ITestSupport interface
    - Extract E2E test input injection system from app.ts
    - Maintain stdin-based input handling for E2E tests
    - Preserve test mode detection and debug logging
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 5.3 Update app.ts to use TestSupport
    - Replace inline test support with TestSupport calls
    - Maintain public injectTestInput() method for E2E tests
    - _Requirements: 2.1, 3.6_

- [ ] 6. Checkpoint - Verify all modules extracted
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Finalize app.ts orchestration
  - [ ] 7.1 Reduce app.ts to orchestration-only (~300 lines)
    - Remove all extracted functionality from app.ts
    - Keep only initialization, UI setup, and coordination logic
    - Maintain integration with existing modules (layout-manager, focus-manager)
    - _Requirements: 1.1, 10.2, 10.3_

  - [ ] 7.2 Implement proper dependency injection
    - Pass module instances through constructors
    - Ensure clean interfaces between all modules
    - _Requirements: 4.2, 4.5_

- [ ] 8. Performance and compatibility validation
  - [ ] 8.1 Run all existing test suites
    - Verify unit tests pass without modification
    - Verify integration tests pass without modification
    - Verify E2E tests pass without modification
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 9.5, 9.6_

  - [ ] 8.2 Validate performance metrics
    - Compare startup time against baseline (≤10% increase)
    - Compare memory usage against baseline (≤10% increase)
    - Compare response times against baseline (≤5% increase)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 9. Final integration and cleanup
  - [ ] 9.1 Update imports and exports across all modules
    - Ensure proper TypeScript imports for all dependencies
    - Export interfaces and implementations correctly
    - _Requirements: 4.1, 4.4_

  - [ ] 9.2 Verify existing module integration
    - Confirm chat-renderer.ts integration works correctly
    - Confirm focus-manager.ts integration works correctly
    - Confirm layout-manager.ts integration works correctly
    - Confirm persona-renderer.ts integration works correctly
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [ ] 9.3 Final validation checkpoint
    - Run complete test suite one final time
    - Verify debug logging works across all modules
    - Confirm application behavior is identical to baseline
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [ ] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation throughout the refactoring process
- The existing comprehensive test suite (60 unit tests + integration tests + E2E tests) validates refactoring success
- The refactoring maintains backward compatibility while improving code organization
- No additional property-based tests needed - existing tests provide sufficient coverage
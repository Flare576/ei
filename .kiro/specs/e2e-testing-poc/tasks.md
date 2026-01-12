# Implementation Plan: E2E Testing POC

## Overview

This implementation plan creates a comprehensive end-to-end testing framework for the EI application. The approach focuses on building reusable testing infrastructure that can validate real application behavior through controlled environments, mock LLM interactions, and automated test scenarios.

## Tasks

- [x] 1. Set up E2E testing infrastructure and core interfaces
  - Create directory structure for e2e tests
  - Define TypeScript interfaces for all major components
  - Set up Vitest configuration for e2e tests with longer timeouts
  - Install and configure required dependencies (mock server, file watching)
  - _Requirements: 7.1, 7.4_

- [x] 2. Implement Environment Manager
  - [x] 2.1 Create EnvironmentManager class with temp directory management
    - Implement createTempDir() with unique directory generation
    - Implement cleanupTempDir() with recursive removal
    - Add environment variable management (set/restore)
    - _Requirements: 1.1, 1.3_

  - [x] 2.2 Add file system monitoring capabilities
    - Implement file watcher using fs.watch or chokidar
    - Add methods to watch specific files and directories
    - Handle file change events and notifications
    - _Requirements: 3.2_

- [x] 3. Implement Mock LLM Server
  - [x] 3.1 Create MockLLMServer class with HTTP server
    - Set up Express.js server with OpenAI-compatible endpoints
    - Implement /v1/chat/completions endpoint with configurable responses
    - Add request logging and history tracking
    - Support both single and streaming responses
    - _Requirements: 4.1, 4.2, 4.5_

  - [x] 3.2 Add response configuration and timing control
    - Implement setResponse() and setDelay() methods
    - Add streaming response support with configurable chunks
    - Implement response delay simulation
    - Add error response simulation capabilities
    - _Requirements: 4.2, 4.3_

  - [x] 3.3 Add streaming interruption support
    - Implement mid-stream interruption for streaming responses
    - Handle client disconnection during streaming
    - Test interruption scenarios with abort signals
    - _Requirements: 4.4_

- [x] 4. Implement Application Process Manager
  - [x] 4.1 Create AppProcessManager class
    - Implement process spawning with child_process.spawn
    - Add stdin/stdout/stderr handling
    - Implement process monitoring and health checks
    - Add graceful and forced termination methods
    - Add PTY support for better blessed application compatibility
    - _Requirements: 2.1, 2.3, 2.4_

  - [x] 4.2 Add timeout and termination handling
    - Implement configurable timeouts for different operations
    - Add automatic process termination for hanging processes
    - Handle process exit codes and final state capture
    - _Requirements: 2.2, 2.5_

- [x] 5. Checkpoint - Core components functional
  - Ensure all core components (Environment, Mock Server, Process Manager) work independently
  - Verify basic functionality with simple test scenarios
  - Ask the user if questions arise about component integration

- [x] 6. Implement E2E Test Harness
  - [x] 6.1 Create E2ETestHarness orchestration class
    - Integrate Environment Manager, Mock Server, and Process Manager
    - Implement setup() and cleanup() lifecycle methods
    - Add application control methods (start/stop/input)
    - Create configuration management system
    - _Requirements: 1.1, 1.3, 2.1_

  - [x] 6.2 Add state observation and monitoring
    - Implement UI output monitoring with pattern matching
    - Add file change detection and waiting methods
    - Create process state monitoring capabilities
    - Implement waitFor methods with configurable timeouts
    - Add advanced wait conditions (UI text, patterns, file content)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 6.3 Add assertion and verification methods
    - Implement UI content assertions
    - Add file existence and content verification
    - Create persona state assertion methods
    - Add application state verification utilities
    - Add mock server request verification
    - _Requirements: 3.4, 6.3_

- [x] 7. Implement test scenario framework
  - [x] 7.1 Create TestScenario configuration system
    - Define test scenario data structures
    - Implement scenario loading from configuration files
    - Add test step execution engine
    - Create assertion evaluation system
    - _Requirements: 6.1, 6.2_

  - [x] 7.2 Add error handling and recovery mechanisms
    - Implement graceful error handling for test failures
    - Add automatic retry logic with exponential backoff
    - Create emergency cleanup procedures
    - Add detailed error reporting and diagnostics
    - _Requirements: 6.4, 7.2_

- [x] 8. Create quit command validation tests
  - [x] 8.1 Implement quit command test scenarios
    - Create test for quit in idle state (exit code 0)
    - Create test for quit during active LLM processing (interruption)
    - Create test for quit with background processing (warnings)
    - Create test for force quit bypassing all checks
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [x] 8.2 Add comprehensive quit command integration tests
    - Test quit command through actual application process
    - Verify state persistence before termination
    - Test all quit command variations and edge cases
    - Validate integration with existing Ctrl+C logic
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 9. Implement configuration and extensibility
  - [x] 9.1 Create configuration management system
    - Implement file-based configuration loading
    - Add programmatic configuration API
    - Support environment-specific overrides
    - Add configuration validation and defaults
    - _Requirements: 8.1, 8.2, 8.3, 8.5_

  - [x] 9.2 Add extensibility hooks system
    - Implement hook registration and execution
    - Add pre/post test hooks
    - Create custom scenario extension points
    - Add plugin-style extensibility for advanced use cases
    - _Requirements: 8.4_

- [x] 10. Create comprehensive test scenarios
  - [x] 10.1 Implement basic application flow test
    - Test: start app → send message → receive response → quit
    - Verify complete end-to-end functionality
    - Test with mock LLM responses and real UI interaction
    - Add streaming response tests
    - Add multiple message exchange tests
    - Add error handling tests
    - _Requirements: 6.1_

  - [x] 10.2 Implement interruption and timing tests
    - Test quit during active LLM processing
    - Test application responsiveness during background processing
    - Test timeout handling and recovery scenarios
    - Test streaming interruption scenarios
    - _Requirements: 6.2_

  - [x] 10.3 Create multi-persona scenario tests
    - Test independent persona state management
    - Test concurrent persona processing
    - Test persona switching and unread count management
    - Test persona isolation and data integrity
    - Test persona heartbeat and background processing
    - Test persona error handling and recovery
    - _Requirements: 6.3_

- [x] 11. Integration with existing test suite
  - [x] 11.1 Update Vitest configuration for e2e tests
    - Add e2e test patterns to include configuration
    - Set appropriate timeouts for e2e test execution
    - Configure test environment variables
    - Add e2e test scripts to package.json
    - Configure sequential test execution to avoid resource conflicts
    - _Requirements: 7.1, 7.4_

  - [x] 11.2 Add test execution metrics and reporting
    - Implement execution time tracking
    - Add resource usage monitoring
    - Create detailed test reports with diagnostics
    - Add metrics collection for application performance
    - Add mock server metrics tracking
    - Integrate with existing coverage reporting where applicable
    - _Requirements: 7.3, 7.5_

- [x] 12. Documentation and examples
  - [x] 12.1 Create comprehensive documentation
    - Write API documentation for all public interfaces
    - Create usage examples for common test scenarios
    - Document configuration options and extensibility
    - Add troubleshooting guide for common issues
    - Document framework architecture and component interactions
    - _Requirements: 8.4_

  - [x] 12.2 Create example test scenarios
    - Provide working examples for each major test type
    - Create templates for new test scenarios
    - Document best practices and patterns
    - Add integration examples with existing test suite
    - Create JSON configuration examples for scenario-driven testing
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 13. Clean up experimental and debug files
  - [x] 13.1 Remove experimental test files and debug scenarios
    - Remove debug-input-simple.e2e.test.ts and other debug test files
    - Remove experimental scenario JSON files that aren't being used
    - Clean up EXAMPLES.md and other documentation experiments
    - Remove unused framework components and test utilities
    - _Requirements: 7.4 - Clean test infrastructure_

  - [x] 13.2 Clean up unused dependencies and packages
    - Review package.json for unused dependencies from experiments
    - Remove any experimental packages that aren't needed
    - Clean up import statements and unused code
    - _Requirements: 7.4 - Maintain clean codebase_

- [x] 14. Update tests to use new input system
  - [x] 14.1 Update quit command tests to use proper input system
    - Modify quit-command.e2e.test.ts to use sendCommand('/quit') instead of SIGTERM shortcuts
    - Keep SIGTERM tests for Ctrl+C behavior validation
    - Update quit-command-integration.e2e.test.ts to use new input patterns
    - Test both /quit command and Ctrl+C signal handling
    - _Requirements: 5.1, 5.2, 5.3, 5.4 - Proper quit command testing_

  - [x] 14.2 Update basic flow tests to use reliable input system
    - Update basic-flow.e2e.test.ts to use the working input system
    - Ensure message sending works consistently
    - Update multi-persona tests to use proper input handling
    - Test persona switching commands work with new input system
    - _Requirements: 6.1, 6.3 - Reliable test execution_

  - [x] 14.3 Update input testing scenarios
    - Refine input-testing.e2e.test.ts to focus on working input patterns
    - Remove experimental input methods that don't work
    - Document the working input approach for future tests
    - _Requirements: 2.3 - Reliable input delivery_

- [x] 15. Polish and stabilize remaining test issues
  - [x] 15.1 Fix any remaining test reliability issues
    - Identify and fix flaky tests that don't consistently pass
    - Improve timeout handling for blessed application startup
    - Ensure proper cleanup between test runs
    - _Requirements: 7.1, 7.4 - Reliable test execution_

  - [x] 15.2 Validate framework with real application scenarios
    - Test framework with actual EI application behavior
    - Verify quit command scenarios work end-to-end
    - Ensure multi-persona functionality is properly tested
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.3 - Complete validation_

- [ ] 16. Final cleanup and documentation
  - [ ] 16.1 Update documentation to reflect working patterns
    - Update README.md with current working test patterns
    - Document the input system approach that works
    - Remove references to experimental approaches
    - _Requirements: 8.4 - Accurate documentation_

  - [ ] 16.2 Final validation and framework completion
    - Run full test suite to ensure everything works
    - Verify all core scenarios pass consistently
    - Confirm framework is ready for production use
    - _Requirements: 7.1, 7.4 - Complete and reliable framework_

## Notes

- **Framework Status**: CORE COMPLETE - Major components implemented, cleanup and polish needed
- Recent breakthrough with input system requires updating existing tests
- Many experimental files from development process need cleanup
- Focus on making existing tests reliable and removing unused code
- Framework provides solid foundation, needs final polish for production readiness
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation and integration
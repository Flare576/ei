# 0056: End-to-End Testing POC with Controlled Environment

**Status**: VALIDATED

## Summary
Proof of concept for true end-to-end testing using temporary data directories and controlled LLM responses to enable comprehensive integration testing of the EI application.

## Problem
Current testing is limited to unit tests and mocked integration tests. We need a way to test the actual application flow including:
- Real UI interactions through blessed terminal interface
- Actual LLM processing and response handling
- Complete command processing pipeline
- Real persona state management and data persistence
- Timing-sensitive operations like quit-during-processing

The quit command implementation revealed the need for testing real application states that are difficult to mock accurately.

## Proposed Solution

### Phase 1: Controlled Data Environment
- Use `EI_DATA_PATH` environment variable to point to temporary test directories
- Create test harness that sets up isolated data environment for each test
- Verify we can start the app, send messages, and observe state changes through data files

### Phase 2: Application Control and Observation
- Develop methods to:
  - Start the application as a background process
  - Send input to the application (messages, commands)
  - Observe application state through:
    - UI output (blessed terminal rendering)
    - Data file changes (personas, history, concepts)
    - Process status and exit codes
- Test basic flow: start app → send "hello" → detect LLM response → send `/quit`

### Phase 3: Controlled LLM Responses
- Set up mock LLM server that returns predictable responses
- Configure test personas to use the mock server via `EI_LLM_BASE_URL`
- Enable testing of:
  - Processing interruption with `/quit` mid-response
  - Background processing scenarios
  - Error handling and recovery
  - Timing-sensitive operations

### Phase 4: Comprehensive Test Scenarios
- Test quit command in all real application states:
  - Active processing (can interrupt mid-LLM-call)
  - Background processing (multiple personas)
  - Input text present
  - Various combinations of blocking conditions
- Test complex workflows that span multiple interactions
- Validate data persistence and state recovery

## Acceptance Criteria

### Phase 1: Environment Control
- [ ] Can start EI app with `EI_DATA_PATH` pointing to temp directory
- [ ] App creates and uses isolated data files in temp location
- [ ] Can observe persona files, history files, and concept maps in temp directory
- [ ] Temp directory cleanup works properly after tests

### Phase 2: Application Interaction
- [ ] Can start EI app as background process using `controlBashProcess`
- [ ] Can send input to the app and observe UI output changes
- [ ] Can detect when LLM processing starts and completes
- [ ] Can send `/quit` command and verify clean exit
- [ ] Can observe data file changes during application lifecycle

### Phase 3: Mock LLM Integration
- [ ] Can start simple HTTP mock server that mimics OpenAI API
- [ ] Can configure EI app to use mock server via `EI_LLM_BASE_URL`
- [ ] Mock server can return controlled responses with configurable delays
- [ ] Can test interrupting LLM calls mid-processing with `/quit`

### Phase 4: Real-World Test Scenarios
- [ ] Test `/quit` during active LLM processing (should abort cleanly)
- [ ] Test `/quit` with background processing (should show warning)
- [ ] Test `/quit --force` bypassing all safety checks
- [ ] Test complex multi-persona scenarios with real state management
- [ ] Validate that all quit command requirements work in real application

## Value Statement
This POC would enable:
- **True integration testing** - Test real application behavior, not mocked approximations
- **Automated testing of complex scenarios** - Test timing-sensitive operations and multi-step workflows
- **Regression prevention** - Catch issues that only appear in real application usage
- **Confidence in releases** - Verify that features work end-to-end before deployment
- **Foundation for future testing** - Establish patterns for testing other complex features

## Dependencies
- Requires completion of 0029 (Quit Command) to have something concrete to test
- No other hard dependencies, but benefits from:
  - 0022 (Per-Persona Model Configuration) for easier mock server assignment
  - 0055 (Logging System Improvements) for better test observability

## Effort Estimate
Medium (~3-4 hours)
- Phase 1: 1 hour (environment setup and basic app control)
- Phase 2: 1 hour (input/output handling and state observation)
- Phase 3: 1 hour (mock server setup and LLM integration)
- Phase 4: 1 hour (comprehensive test scenarios and validation)

## Technical Notes

### Environment Variables for Testing
```bash
EI_DATA_PATH=/tmp/ei-test-12345
EI_LLM_BASE_URL=http://localhost:3001/v1
EI_LLM_API_KEY=test-key
EI_LLM_MODEL=mock-model
```

### Mock Server Requirements
- Simple HTTP server that implements minimal OpenAI-compatible API
- Configurable response delays to test timing scenarios
- Ability to return specific responses for testing different scenarios
- Support for streaming responses to test interruption

### Test Harness Architecture
```typescript
class E2ETestHarness {
  private tempDir: string;
  private mockServer: MockLLMServer;
  private appProcess: BackgroundProcess;
  
  async setup(): Promise<void> { /* create temp dir, start mock server */ }
  async startApp(): Promise<void> { /* start EI app with test env vars */ }
  async sendInput(text: string): Promise<void> { /* send to app stdin */ }
  async waitForResponse(): Promise<string> { /* observe UI or data files */ }
  async cleanup(): Promise<void> { /* cleanup temp dir and processes */ }
}
```

This POC would establish the foundation for comprehensive end-to-end testing that could be applied to many other features beyond just the quit command.
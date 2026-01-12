# E2E Test Scenarios

This directory contains comprehensive end-to-end test scenarios for the EI application. The scenarios are organized into different categories to test various aspects of the application's functionality.

## Test Categories

### 1. Basic Flow Tests (`basic-flow.e2e.test.ts`)
Tests the fundamental application workflow: start → send message → receive response → quit

**Test Cases:**
- Basic application flow with mock LLM responses
- Scenario configuration file execution
- Streaming response handling
- Multiple message exchanges
- Error handling and recovery

**Requirements Validated:** 6.1 - Complete end-to-end functionality

### 2. Interruption and Timing Tests (`interruption-timing.e2e.test.ts`)
Tests application behavior during interruptions, timeouts, and background processing

**Test Cases:**
- Quit during active LLM processing
- Quit with background processing warnings
- Application responsiveness during background processing
- Timeout handling and recovery scenarios
- Force quit bypassing all checks
- Interrupt streaming response mid-stream
- Timeout with multiple concurrent operations

**Requirements Validated:** 6.2 - Interruption and timing behavior

### 3. Multi-Persona Tests (`multi-persona.e2e.test.ts`)
Tests multi-persona functionality including state management, switching, and concurrent processing

**Test Cases:**
- Independent persona state management
- Concurrent persona processing
- Persona switching and unread count management
- Multi-persona scenario with configuration file
- Persona isolation and data integrity
- Persona heartbeat and background processing
- Persona error handling and recovery

**Requirements Validated:** 6.3 - Multi-persona state management

## Configuration Files

### Scenario Configuration Files
- `example-basic-flow.json` - Basic application flow scenario
- `interruption-scenarios.json` - Collection of interruption test scenarios
- `multi-persona-scenarios.json` - Collection of multi-persona test scenarios

These JSON files define test scenarios that can be executed by the `TestScenarioRunner` for consistent, repeatable testing.

## Test Framework Integration

All tests use the E2E Test Harness framework components:
- `E2ETestHarnessImpl` - Main orchestration class
- `TestScenarioRunner` - Scenario execution engine
- Mock LLM Server - Controlled LLM response simulation
- Environment Manager - Isolated test environments
- Application Process Manager - Controlled application lifecycle

## Running the Tests

```bash
# Run all e2e tests
npm test -- tests/e2e/scenarios/

# Run specific test category
npm test -- tests/e2e/scenarios/basic-flow.e2e.test.ts
npm test -- tests/e2e/scenarios/interruption-timing.e2e.test.ts
npm test -- tests/e2e/scenarios/multi-persona.e2e.test.ts

# Run with debug output
npm test -- tests/e2e/scenarios/ --reporter=verbose
```

## Test Characteristics

### Timeouts
- Basic flow tests: 30-45 seconds
- Interruption tests: 30-60 seconds
- Multi-persona tests: 45-60 seconds

### Mock Server Configuration
- Configurable response delays
- Streaming response support
- Error response simulation
- Request history tracking

### Environment Isolation
- Each test gets a unique temporary data directory
- Environment variables are set per test
- Complete cleanup after each test
- No test interference

## Expected Behavior

### Application Startup
The tests expect the EI application to:
1. Start successfully with provided environment variables
2. Initialize within the configured timeout (5-15 seconds)
3. Respond to input and commands
4. Handle LLM requests through the mock server
5. Exit cleanly with appropriate exit codes

### Mock LLM Integration
The mock server provides:
- OpenAI-compatible API endpoints
- Configurable response content and timing
- Streaming response simulation
- Request logging and verification

### Error Handling
Tests include scenarios for:
- Network timeouts
- LLM server errors
- Application crashes
- Graceful degradation
- Recovery mechanisms

## Troubleshooting

### Common Issues
1. **Application startup timeout** - Increase `appTimeout` in test configuration
2. **LLM request timeout** - Check mock server configuration and delays
3. **Process cleanup issues** - Verify graceful shutdown handling
4. **File system permissions** - Ensure temp directory access

### Debug Mode
Enable debug mode in tests for verbose output:
```typescript
await harness.startApp({ debugMode: true });
```

### Test Isolation
If tests interfere with each other:
1. Check temp directory cleanup
2. Verify environment variable restoration
3. Ensure process termination
4. Review resource cleanup in error scenarios
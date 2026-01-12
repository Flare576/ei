# Test Scenario Framework

The Test Scenario Framework provides a comprehensive system for creating, loading, and executing end-to-end test scenarios with built-in error handling and recovery mechanisms.

> **📖 Related Documentation**: 
> - For main framework overview and usage guide, see [`../README.md`](../README.md)
> - For configuration management and extensibility features, see [`README.md`](README.md)
> - This document focuses on the test scenario execution system

## Overview

The framework consists of two main components:

1. **TestScenarioRunner** - Loads and executes test scenarios from configuration files or objects
2. **ErrorRecoveryImpl** - Provides retry logic, error handling, and emergency cleanup capabilities

## Features

### Test Scenario Configuration
- Load scenarios from JSON files or JavaScript objects
- Comprehensive validation of scenario structure
- Support for complex setup, execution, and cleanup phases
- Flexible step and assertion definitions

### Error Handling and Recovery
- Automatic retry with exponential backoff
- Graceful degradation for non-critical failures
- Emergency cleanup procedures
- Detailed error reporting and diagnostics
- Resource management and tracking

### Step Types
- **input** - Send text input to the application
- **command** - Send commands (automatically prefixed with `/`)
- **wait** - Wait for specific conditions (UI changes, file changes, processing completion)
- **assert** - Perform inline assertions during execution

### Assertion Types
- **ui** - Assert UI output contains/matches specific text or patterns
- **file** - Assert file existence, content, or properties
- **state** - Assert application or persona state
- **process** - Assert process state, exit codes, or mock server interactions

## Usage

### Basic Usage

```typescript
import { E2ETestHarnessImpl, TestScenarioRunner } from './framework/index.js';

// Create harness and scenario runner
const harness = new E2ETestHarnessImpl();
const scenarioRunner = new TestScenarioRunner(harness);

// Set up the test environment
await harness.setup({
  tempDirPrefix: 'my-test',
  mockServerPort: 3001
});

// Load and execute a scenario
const scenario = await scenarioRunner.loadScenarioFromFile('./scenarios/basic-flow.json');
const result = await scenarioRunner.executeScenario(scenario);

// Check results
if (result.success) {
  console.log('Test scenario passed!');
} else {
  console.error('Test scenario failed:', result.error);
}

// Clean up
await harness.cleanup();
```

### Scenario Configuration Format

```json
{
  "name": "Test Scenario Name",
  "description": "Description of what this scenario tests",
  "setup": {
    "personas": [
      {
        "name": "test-persona",
        "systemPrompt": "You are a test assistant",
        "initialMessages": ["Hello", "How can I help?"]
      }
    ],
    "mockResponses": [
      {
        "endpoint": "/v1/chat/completions",
        "response": {
          "type": "fixed",
          "content": "Mock response",
          "delayMs": 100
        }
      }
    ],
    "initialData": {
      "concepts": { "test-concept": "test-value" },
      "history": { "persona-name": [{"role": "user", "content": "Test"}] }
    }
  },
  "steps": [
    {
      "type": "input",
      "action": "Hello world",
      "timeout": 5000
    },
    {
      "type": "wait",
      "action": "ui:Welcome",
      "timeout": 3000
    },
    {
      "type": "assert",
      "action": "ui_contains:Welcome"
    }
  ],
  "assertions": [
    {
      "type": "ui",
      "target": "output",
      "condition": "contains",
      "expected": "Welcome"
    },
    {
      "type": "file",
      "target": "personas/test-persona/system.jsonc",
      "condition": "exists",
      "expected": true
    }
  ],
  "cleanup": {
    "removeFiles": ["temp-file.txt"],
    "killProcesses": true,
    "restoreEnvironment": true
  }
}
```

### Error Recovery Options

```typescript
const recoveryOptions = {
  attemptRecovery: true,      // Enable recovery mechanisms
  retryOperation: true,       // Retry failed operations
  maxRetries: 3,             // Maximum retry attempts
  performCleanup: true,      // Perform cleanup after failures
  fallbackAction: () => {    // Fallback action for graceful degradation
    console.log('Using fallback behavior');
  }
};

const result = await scenarioRunner.executeScenario(scenario, recoveryOptions);
```

## Step Reference

### Input Steps
Send text input to the application:
```json
{
  "type": "input",
  "action": "Hello, how are you?",
  "timeout": 5000
}
```

### Command Steps
Send commands (automatically prefixed with `/`):
```json
{
  "type": "command",
  "action": "help",
  "timeout": 3000
}
```

### Wait Steps
Wait for specific conditions:
```json
{
  "type": "wait",
  "action": "ui:Expected text",
  "timeout": 5000
}
```

Wait actions:
- `ui:text` - Wait for text to appear in UI output
- `file:path` - Wait for file to change
- `processing` - Wait for processing to complete
- `idle` - Wait for application to reach idle state
- `llm_request` - Wait for LLM request to be made

### Assert Steps
Perform inline assertions:
```json
{
  "type": "assert",
  "action": "ui_contains:Expected text"
}
```

Assert actions:
- `ui_contains:text` - Assert UI contains text
- `ui_not_contains:text` - Assert UI does not contain text
- `file_exists:path` - Assert file exists
- `file_not_exists:path` - Assert file does not exist
- `process_running` - Assert process is running
- `process_stopped` - Assert process is stopped

## Assertion Reference

### UI Assertions
```json
{
  "type": "ui",
  "target": "output",
  "condition": "contains|not_contains|matches",
  "expected": "text or regex pattern"
}
```

### File Assertions
```json
{
  "type": "file",
  "target": "path/to/file",
  "condition": "exists|not_exists|content_contains|content_matches",
  "expected": "expected value"
}
```

### State Assertions
```json
{
  "type": "state",
  "target": "persona-name",
  "condition": "persona_exists|persona_state",
  "expected": "expected state"
}
```

### Process Assertions
```json
{
  "type": "process",
  "target": "application",
  "condition": "running|exit_code|mock_requests",
  "expected": "expected value"
}
```

## Error Handling

The framework provides comprehensive error handling:

### Automatic Retry
Operations are automatically retried with exponential backoff:
- Base delay: 1000ms
- Maximum delay: 30000ms
- Jitter: Up to 10% of delay time
- Configurable maximum retry attempts

### Error Recovery
- **Graceful degradation** - Fallback actions for non-critical failures
- **Emergency cleanup** - Automatic resource cleanup on failures
- **Detailed reporting** - Comprehensive error reports with suggestions

### Resource Management
Resources are automatically tracked and cleaned up:
- Process cleanup (application termination)
- File cleanup (temporary file removal)
- Directory cleanup (temporary directory removal)
- Server cleanup (mock server shutdown)

## Best Practices

### Scenario Design
1. **Keep scenarios focused** - Test one main flow per scenario
2. **Use descriptive names** - Make scenario purpose clear
3. **Include proper cleanup** - Always specify cleanup actions
4. **Set appropriate timeouts** - Account for application startup time

### Error Handling
1. **Enable recovery** - Use recovery options for robust testing
2. **Provide fallbacks** - Include fallback actions for critical steps
3. **Monitor resources** - Track resources that need cleanup
4. **Review error reports** - Use detailed error reports for debugging

### Performance
1. **Minimize setup time** - Reuse test environments when possible
2. **Parallel cleanup** - Resources are cleaned up in parallel
3. **Efficient waiting** - Use specific wait conditions instead of fixed delays
4. **Resource limits** - Clean up resources promptly to avoid limits

## Examples

See the `tests/e2e/scenarios/` directory for example scenario configurations:
- `example-basic-flow.json` - Basic application interaction
- Additional examples for specific test patterns

## Integration

The Test Scenario Framework integrates with:
- **E2E Test Harness** - For application control and monitoring
- **Mock LLM Server** - For controlled LLM responses
- **Environment Manager** - For isolated test environments
- **Vitest** - For test execution and reporting

## Requirements Validation

This framework validates the following requirements:
- **6.1** - Comprehensive test scenarios with configuration loading
- **6.2** - Test step execution engine and assertion evaluation
- **6.4** - Graceful error handling and recovery mechanisms
- **7.2** - Detailed error reporting and diagnostics
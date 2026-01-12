# E2E Testing Framework for EI Application

This comprehensive end-to-end testing framework enables automated testing of the EI (Emotional Intelligence) application through controlled environments, mock LLM interactions, and real application behavior validation.

**Framework Status**: ✅ **VALIDATED** - Core functionality tested and working with real EI application scenarios.

> **📖 Additional Documentation**: 
> - For detailed framework architecture and component documentation, see this main README
> - For configuration management and extensibility features, see [`framework/README.md`](framework/README.md)
> - For test scenario framework details, see [`framework/test-scenario-README.md`](framework/test-scenario-README.md)

## Overview

The E2E testing framework provides **validated, working patterns** for:

- **✅ Isolated Test Environments**: Each test runs in a temporary directory with its own data
- **✅ Mock LLM Server**: Configurable mock server that simulates LLM responses with sequential response queues
- **✅ Application Process Management**: Reliable spawning and management of the EI application using regular spawn (not PTY)
- **✅ Test Input Injection**: Proven input delivery system that works with blessed-based terminal applications
- **✅ Quit Command Validation**: Complete validation of quit command behavior in all application states
- **✅ Multi-Persona Testing**: Basic multi-persona functionality validation with independent state management
- **✅ Comprehensive Metrics**: Detailed execution time tracking and resource usage monitoring
- **✅ Flexible Test Scenarios**: JSON-configurable test scenarios with step-by-step execution
- **✅ Extensible Hooks System**: Pre/post test hooks for custom setup and teardown

**Recent Validation**: Framework has been extensively tested with real EI application scenarios and provides reliable testing capabilities for core functionality.

## Architecture

```
tests/e2e/
├── framework/           # Core framework components
│   ├── harness.ts      # Main orchestration class
│   ├── environment.ts  # Environment and temp directory management
│   ├── mock-server.ts  # Mock LLM server implementation
│   ├── app-process-manager.ts  # Application process control
│   ├── test-scenario.ts        # Scenario execution engine
│   ├── test-metrics.ts         # Metrics collection and reporting
│   ├── hooks-manager.ts        # Extensibility hooks system
│   ├── config-manager.ts       # Configuration management
│   └── vitest-reporter.ts      # Custom Vitest reporter
├── scenarios/          # Test scenario implementations
│   ├── basic-flow.e2e.test.ts     # Basic application flow tests
│   ├── interruption-timing.e2e.test.ts  # Interruption and timing tests
│   ├── multi-persona.e2e.test.ts         # Multi-persona scenario tests
│   ├── working-input-test.e2e.test.ts    # Input injection verification
│   └── metrics-test.e2e.test.ts          # Metrics system verification
└── types.ts           # TypeScript type definitions
```

## Quick Start

### Prerequisites

1. Build the EI application:
   ```bash
   npm run build
   ```

2. Ensure all dependencies are installed:
   ```bash
   npm install
   ```

### Running Tests

```bash
# Run all E2E tests
npm run test:e2e

# Run specific test file
npx vitest run tests/e2e/scenarios/working-input-test.e2e.test.ts

# Run with debug output (only when troubleshooting)
npm run test:e2e:debug

# Run framework validation tests
npx vitest run tests/e2e/scenarios/framework-validation.e2e.test.ts
```

### Basic Test Example (Working Pattern)

```typescript
import { E2ETestHarnessImpl } from '../framework/harness.js';

test('basic message flow', async () => {
  const harness = new E2ETestHarnessImpl();
  
  // Setup test environment
  await harness.setup({
    tempDirPrefix: 'my-test',
    appTimeout: 10000,
    cleanupTimeout: 5000
  });

  // Configure mock responses (3+ responses per message)
  harness.setMockResponseQueue([
    'Hello from mock server!',     // Main response
    JSON.stringify([]),            // System concepts
    JSON.stringify([])             // Human concepts
  ]);

  // Start application (use regular spawn, not PTY)
  await harness.startApp({ debugMode: false, usePty: false });

  // Wait for initialization (always do this)
  await harness.waitForIdleState(5000);

  // Send input (include \n for line termination)
  await harness.sendInput('Hello, test message\n');

  // Wait for processing
  await harness.waitForLLMRequest(3000);
  await harness.waitForUIText('Hello from mock', 8000);

  // Verify response (use partial text matching)
  await harness.assertUIContains('Hello from mock');

  // Clean exit
  await harness.sendCommand('/quit');
  await harness.assertExitCode(0, 5000);

  // Cleanup
  await harness.cleanup();
}, 30000);
```

## Core Components

### E2ETestHarness

The main orchestration class that integrates all framework components.

```typescript
import { E2ETestHarnessImpl } from '../framework/harness.js';

const harness = new E2ETestHarnessImpl();

// Setup test environment
await harness.setup({
  tempDirPrefix: 'my-test',
  appTimeout: 10000,
  cleanupTimeout: 5000
});

// Configure mock LLM response
harness.setMockResponse('/v1/chat/completions', 
  'Hello from mock server!', 
  200 // 200ms delay
);

// Start the application
await harness.startApp({ debugMode: false });

// Send input to the application
await harness.sendInput('Hello, test message\n');

// Wait for LLM request
await harness.waitForLLMRequest(3000);

// Wait for response in UI
await harness.waitForUIText('Hello from mock server', 5000);

// Verify response
await harness.assertUIContains('Hello from mock server');

// Clean shutdown
await harness.sendCommand('/quit');
await harness.assertExitCode(0, 5000);

// Cleanup
await harness.cleanup();
```

### Environment Manager

Manages temporary directories and environment variables for isolated testing.

```typescript
import { EnvironmentManagerImpl } from '../framework/environment.js';

const envManager = new EnvironmentManagerImpl();

// Create temporary directory
const tempDir = await envManager.createTempDir('test-prefix');

// Set test environment variables
envManager.setTestEnvironment({
  EI_DATA_PATH: tempDir,
  EI_LLM_BASE_URL: 'http://localhost:3001/v1',
  EI_LLM_API_KEY: 'test-key'
});

// Cleanup when done
await envManager.cleanup();
```

### Mock LLM Server

Provides configurable mock responses for LLM interactions.

```typescript
import { MockLLMServerImpl } from '../framework/mock-server.js';

const mockServer = new MockLLMServerImpl();

// Start server
await mockServer.start(3001, {
  responses: new Map([
    ['/v1/chat/completions', {
      type: 'fixed',
      content: 'Mock response',
      delayMs: 100
    }]
  ])
});

// Configure streaming response
mockServer.enableStreaming('/v1/chat/completions', [
  'Chunk 1 ',
  'Chunk 2 ',
  'Chunk 3'
]);

// Get request history
const history = mockServer.getRequestHistory();

// Stop server
await mockServer.stop();
```

### Application Process Manager

Controls the EI application as a subprocess with input/output handling.

```typescript
import { AppProcessManagerImpl } from '../framework/app-process-manager.js';

const processManager = new AppProcessManagerImpl();

// Start application
const process = await processManager.start({
  dataPath: '/tmp/test-data',
  llmBaseUrl: 'http://localhost:3001/v1',
  debugMode: true
});

// Send input
await processManager.sendInput(process, 'Hello\n');

// Get output
const output = await processManager.getOutput(process);

// Check if running
const isRunning = processManager.isRunning(process);

// Stop application
await processManager.stop(process);
```

## Test Input System - Working Patterns

The framework uses a proven input injection system that reliably sends input to the blessed-based EI application. Based on extensive testing and validation, the following patterns work consistently:

### Working Configuration

**Application Startup (RECOMMENDED)**:
```typescript
// Use regular spawn (not PTY) for reliable input injection
await harness.startApp({ 
  debugMode: false,  // Enable only for troubleshooting
  usePty: false      // PTY causes input reliability issues
});
```

**Input Delivery**:
```typescript
// Send regular messages (include \n for line termination)
await harness.sendInput('Hello, test message\n');

// Send commands (framework adds / prefix and \n suffix automatically)
await harness.sendCommand('/quit');
await harness.sendCommand('/persona create TestPersona');
```

**Mock Response Configuration**:
```typescript
// Configure sequential responses for complete message flow
// Each message requires 3+ responses: main response + system concepts + human concepts
harness.setMockResponseQueue([
  'Hello! I received your message.',  // Main LLM response
  JSON.stringify([{                   // System concepts update
    name: "Test Concept",
    description: "A test concept",
    level_current: 0.5,
    level_ideal: 0.8,
    level_elasticity: 0.3,
    type: "static"
  }]),
  JSON.stringify([])                  // Human concepts (usually empty)
]);
```

### Key Features

- **Reliable Input Delivery**: Regular spawn process provides consistent input handling
- **Command Support**: Framework handles both messages and commands with proper formatting
- **Clean Exit**: `/quit` command ensures proper application termination
- **Mock Integration**: Sequential response queue handles complete message processing flow
- **Debug Support**: Enable debug mode only when troubleshooting specific issues

## Metrics and Reporting

The framework includes comprehensive metrics collection and reporting:

### Metrics Collected

- **Execution Time**: Test duration, startup time, shutdown time
- **Resource Usage**: Memory usage, CPU usage, process counts
- **Application Metrics**: LLM request count, input count, output size
- **Mock Server Metrics**: Request count, response times, error rates
- **Step Metrics**: Individual test step timing and success rates

### Generating Reports

```typescript
// Start metrics collection
harness.startTestMetrics('My Test');

// Record test steps
harness.recordTestStep('Setup', 'setup', 1000, true);
harness.recordTestStep('Execution', 'test', 5000, true);

// Finish metrics collection
harness.finishTestMetrics(true);

// Generate reports
const report = harness.generateTestReport();
await harness.exportMetricsToJson('test-results/metrics.json');
await harness.exportMetricsToHtml('test-results/metrics.html');
```

### HTML Report Features

- **Summary Dashboard**: Success rate, total tests, duration
- **Detailed Test Results**: Expandable test details with step breakdown
- **Diagnostics**: Error messages, warnings, and info logs
- **Resource Usage**: Memory and CPU usage tracking
- **Interactive UI**: Click to expand test details

## Configuration

### Test Configuration

```typescript
interface TestConfig {
  tempDirPrefix?: string;        // Prefix for temporary directories
  appTimeout?: number;           // Application startup timeout (ms)
  cleanupTimeout?: number;       // Cleanup timeout (ms)
  mockServerPort?: number;       // Mock server port (auto-assigned if not specified)
  retryAttempts?: number;        // Number of retry attempts for failed operations
  debugMode?: boolean;           // Enable debug logging
}
```

### Application Configuration

```typescript
interface AppConfig {
  dataPath: string;              // Path to application data directory
  llmBaseUrl: string;           // LLM API base URL
  llmApiKey: string;            // LLM API key
  llmModel: string;             // LLM model identifier
  debugMode?: boolean;          // Enable application debug mode
  usePty?: boolean;             // Use PTY for better terminal compatibility
}
```

### Mock Server Configuration

```typescript
interface MockServerConfig {
  responses: Map<string, MockResponse>;  // Endpoint response mappings
  defaultDelay: number;                  // Default response delay (ms)
  enableLogging: boolean;                // Enable request logging
}

interface MockResponse {
  type: 'fixed' | 'streaming';
  content: string | string[];
  delayMs: number;
  statusCode?: number;
}
```

## Test Scenarios

The framework includes a comprehensive test scenario system for creating reusable, configurable tests. For detailed information about the test scenario framework, see [`framework/test-scenario-README.md`](framework/test-scenario-README.md).

### JSON Configuration Format

Test scenarios can be defined in JSON files for reusable, configurable tests:

```json
{
  "name": "Basic Flow Test",
  "description": "Tests basic application functionality",
  "setup": {
    "mockResponses": [
      {
        "endpoint": "/v1/chat/completions",
        "response": {
          "type": "fixed",
          "content": "Hello from test!",
          "delayMs": 200
        }
      }
    ]
  },
  "steps": [
    {
      "type": "input",
      "action": "Hello, world!",
      "timeout": 5000
    },
    {
      "type": "wait",
      "action": "llm_request",
      "timeout": 3000
    },
    {
      "type": "wait",
      "action": "ui:Hello from test",
      "timeout": 8000
    },
    {
      "type": "command",
      "action": "/quit",
      "timeout": 3000
    }
  ],
  "assertions": [
    {
      "type": "ui",
      "target": "output",
      "condition": "contains",
      "expected": "Hello from test"
    },
    {
      "type": "process",
      "target": "exit_code",
      "condition": "equals",
      "expected": 0
    }
  ]
}
```

### Scenario Execution

```typescript
import { TestScenarioRunner } from '../framework/test-scenario.js';

const scenarioRunner = new TestScenarioRunner(harness);

// Load scenario from file
const scenario = await scenarioRunner.loadScenarioFromFile('path/to/scenario.json');

// Execute scenario
const result = await scenarioRunner.executeScenario(scenario, {
  maxRetries: 2,
  attemptRecovery: true,
  performCleanup: true
});

// Check results
expect(result.success).toBe(true);
expect(result.stepResults.every(step => step.success)).toBe(true);
```

## Extensibility

### Hooks System

The framework provides hooks for custom setup and teardown:

```typescript
import { createHooksManager } from '../framework/hooks-manager.js';

const hooksManager = createHooksManager();

// Register hooks
hooksManager.registerHook('beforeTest', async (context) => {
  console.log(`Starting test: ${context.testName}`);
  // Custom setup logic
});

hooksManager.registerHook('afterTest', async (context) => {
  console.log(`Finished test: ${context.testName}`);
  // Custom cleanup logic
});

// Execute hooks
await hooksManager.executeHooks('beforeTest', { testName: 'My Test' });
```

### Custom Assertions

Add custom assertion methods by extending the harness:

```typescript
class CustomTestHarness extends E2ETestHarnessImpl {
  async assertPersonaExists(personaName: string): Promise<void> {
    const tempDataPath = this.getTempDataPath();
    const personaPath = path.join(tempDataPath, 'personas', personaName);
    
    try {
      await fs.access(personaPath);
    } catch (error) {
      throw new Error(`Persona ${personaName} does not exist`);
    }
  }
}
```

## Troubleshooting

### Working Patterns (VALIDATED)

The following patterns have been validated and work reliably:

#### ✅ Application Startup
```typescript
// WORKING: Use regular spawn, not PTY
await harness.startApp({ debugMode: false, usePty: false });
await harness.waitForIdleState(5000);
```

#### ✅ Input Delivery  
```typescript
// WORKING: Include \n for messages, use sendCommand for commands
await harness.sendInput('Hello, test message\n');
await harness.sendCommand('/quit');  // Framework adds / and \n automatically
```

#### ✅ Mock Response Configuration
```typescript
// WORKING: Sequential queue handles complete message flow
harness.setMockResponseQueue([
  'Main response',           // LLM response
  JSON.stringify([]),        // System concepts
  JSON.stringify([])         // Human concepts  
]);
```

#### ✅ UI Text Validation
```typescript
// WORKING: Use partial text matching, not exact matches
await harness.waitForUIText('Hello! I received', 8000);
await harness.assertUIContains('Hello! I received');
```

### Common Issues and Solutions

#### 1. Test Timeouts

**Problem**: Tests timeout waiting for responses or UI text.

**Solutions**:
- Use recommended timeouts: startup (10s), LLM request (3s), UI text (8s)
- Always wait for idle state after startup: `await harness.waitForIdleState(5000)`
- Use partial text matching instead of exact text matches
- Check mock response queue has enough responses (3+ per message)

#### 2. Input Not Working

**Problem**: Application doesn't respond to test input.

**Solutions**:
- Use `usePty: false` in startApp options (PTY causes issues)
- Include `\n` at end of input messages: `sendInput('message\n')`
- Use `sendCommand('/quit')` for commands (framework handles formatting)
- Wait for idle state before sending input

#### 3. Mock Server Issues

**Problem**: LLM requests not reaching mock server.

**Solutions**:
- Configure response queue before starting app
- Use `waitForLLMRequest(3000)` to verify requests are made
- Check request history: `harness.getMockRequestHistory().length`
- Ensure mock server starts before application

#### 4. UI Text Not Found

**Problem**: Expected text doesn't appear in UI output.

**Solutions**:
- Use partial text matching: `waitForUIText('partial text', 8000)`
- Remember blessed output contains escape sequences (this is normal)
- Use `getCurrentOutput()` for debugging what text is actually present
- Focus on content fragments, not formatted UI elements

#### 5. Application Won't Exit

**Problem**: Application hangs during shutdown.

**Solutions**:
- Use `sendCommand('/quit')` instead of process termination
- Wait for exit code: `await harness.assertExitCode(0, 5000)`
- Cleanup handles forced termination if needed
- Check that all async operations complete before quit

### ❌ Patterns to Avoid (Experimental/Deprecated)

The following patterns were tried during development but are not reliable:

#### ❌ PTY Process Spawning
```typescript
// DON'T USE: PTY causes input reliability issues
await harness.startApp({ usePty: true });  // Unreliable
```

#### ❌ Complex Text Matching
```typescript
// DON'T USE: Exact text matching fails with blessed escape sequences
await harness.waitForUIText('exact formatted text with colors');  // Fails
```

#### ❌ Manual Process Termination
```typescript
// DON'T USE: SIGTERM/SIGKILL instead of proper quit command
process.kill(pid, 'SIGTERM');  // Unreliable cleanup
```

#### ❌ Single Mock Response
```typescript
// DON'T USE: Single response doesn't handle concept updates
harness.setMockResponse('/v1/chat/completions', 'response');  // Incomplete
```

#### ❌ Fixed Delays Instead of Waiting
```typescript
// DON'T USE: Fixed delays are unreliable
await new Promise(resolve => setTimeout(resolve, 5000));  // Flaky
// USE: Proper wait conditions
await harness.waitForLLMRequest(3000);  // Reliable
```

### Debug Mode

Enable debug mode for detailed logging:

```typescript
// In test configuration
await harness.setup({
  debugMode: true,
  // ... other config
});

// In application startup
await harness.startApp({ 
  debugMode: true 
});
```

Debug mode provides:
- Detailed process startup/shutdown logs
- Input injection tracking
- Mock server request/response logs
- Application output analysis
- Timing information for all operations

### Log Files

The framework generates several log files for troubleshooting:

- **Application Debug Log**: `logs/debug.log` (when debug mode enabled)
- **Test Metrics**: `test-results/e2e/e2e-metrics.json`
- **HTML Report**: `test-results/e2e/e2e-metrics.html`

## Best Practices

### Test Organization

1. **Use descriptive test names** that explain what is being tested
2. **Group related tests** in describe blocks
3. **Keep tests focused** - one test should verify one specific behavior
4. **Use setup/teardown** properly to ensure clean test environments

### Mock Configuration

1. **Configure realistic delays** to simulate real LLM response times
2. **Use streaming responses** for tests that need to verify streaming behavior
3. **Test error conditions** by configuring mock server errors
4. **Verify request history** to ensure the right number of requests were made

### Assertions

1. **Use specific assertions** rather than generic ones
2. **Wait for conditions** rather than using fixed delays
3. **Verify both positive and negative cases**
4. **Check application state** after operations complete

### Performance

1. **Run E2E tests sequentially** to avoid resource conflicts
2. **Use appropriate timeouts** - not too short, not too long
3. **Clean up resources** properly to prevent memory leaks
4. **Monitor test execution time** and optimize slow tests

## API Reference

### E2ETestHarness Methods

#### Setup and Lifecycle
- `setup(config: TestConfig): Promise<void>` - Initialize test environment
- `cleanup(): Promise<void>` - Clean up all resources
- `startApp(options?: AppStartOptions): Promise<void>` - Start EI application
- `stopApp(): Promise<void>` - Stop EI application

#### Application Control
- `sendInput(text: string): Promise<void>` - Send input to application
- `sendCommand(command: string): Promise<void>` - Send command (adds `/` prefix and `\n` suffix)
- `isAppRunning(): boolean` - Check if application is running
- `getCurrentOutput(): Promise<string>` - Get current application output

#### Mock Server Control
- `setMockResponse(endpoint: string, content: string, delay?: number): void` - Configure fixed response
- `enableMockStreaming(endpoint: string, chunks: string[]): void` - Configure streaming response
- `getMockRequestHistory(): MockRequest[]` - Get request history
- `assertMockRequestCount(expected: number): void` - Assert number of requests made

#### Waiting and Assertions
- `waitForIdleState(timeout: number): Promise<void>` - Wait for application to be idle
- `waitForLLMRequest(timeout: number): Promise<void>` - Wait for LLM request to be made
- `waitForUIText(text: string, timeout: number): Promise<void>` - Wait for text in UI
- `waitForCondition(condition: () => boolean | Promise<boolean>, description: string, timeout: number): Promise<void>` - Wait for custom condition
- `assertUIContains(text: string): Promise<void>` - Assert UI contains text
- `assertExitCode(expected: number, timeout: number): Promise<void>` - Assert application exit code
- `assertFileExists(relativePath: string): void` - Assert file exists in temp directory
- `assertDirectoryExists(relativePath: string): void` - Assert directory exists

#### Metrics and Reporting
- `startTestMetrics(testName: string): void` - Start metrics collection
- `recordTestStep(stepName: string, stepType: string, duration: number, success: boolean, error?: string): void` - Record test step
- `finishTestMetrics(success: boolean, error?: string): void` - Finish metrics collection
- `generateTestReport(): TestReport` - Generate comprehensive report
- `exportMetricsToJson(filePath: string): Promise<void>` - Export metrics to JSON
- `exportMetricsToHtml(filePath: string): Promise<void>` - Export metrics to HTML

### Configuration Types

See the TypeScript definitions in `tests/e2e/types.ts` for complete type information.

## Contributing

When adding new features to the E2E testing framework:

1. **Follow the existing patterns** for consistency
2. **Add comprehensive tests** for new functionality
3. **Update documentation** to reflect changes
4. **Consider backward compatibility** when making changes
5. **Add metrics collection** for new operations where appropriate

## License

This E2E testing framework is part of the EI project and follows the same license terms.
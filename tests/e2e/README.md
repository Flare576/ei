# E2E Testing Framework for EI Application

This comprehensive end-to-end testing framework enables automated testing of the EI (Emotional Intelligence) application through controlled environments, mock LLM interactions, and real application behavior validation.

## Overview

The E2E testing framework provides:

- **Isolated Test Environments**: Each test runs in a temporary directory with its own data
- **Mock LLM Server**: Configurable mock server that simulates LLM responses
- **Application Process Management**: Controlled spawning and management of the EI application
- **Test Input Injection**: Direct input injection into the blessed-based terminal application
- **Comprehensive Metrics**: Detailed execution time tracking and resource usage monitoring
- **Flexible Test Scenarios**: JSON-configurable test scenarios with step-by-step execution
- **Extensible Hooks System**: Pre/post test hooks for custom setup and teardown

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

# Run with debug output
npm run test:e2e:debug

# Run metrics verification test
npm run test:e2e:metrics
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

## Test Input Injection System

The framework uses a special test input injection system that allows sending input directly to the blessed-based EI application. This works by:

1. Setting the `EI_TEST_INPUT=true` environment variable
2. The EI application detects this and sets up a secondary input listener on stdin
3. Tests can send input via the process manager, which gets processed as if typed by a user

### Key Features

- **Command Support**: Handles both regular messages and commands (e.g., `/quit`, `/persona`)
- **Clean Exit**: Special handling for quit commands to ensure clean test exits
- **Debug Logging**: Comprehensive logging for troubleshooting input issues
- **Compatibility**: Works with both regular spawn and PTY processes

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

### Common Issues

#### 1. Application Startup Timeout

**Problem**: Application fails to start within the timeout period.

**Solutions**:
- Increase `appTimeout` in test configuration
- Check that the application builds successfully (`npm run build`)
- Verify environment variables are set correctly
- Enable debug mode to see detailed startup logs

#### 2. Input Not Reaching Application

**Problem**: Test input doesn't seem to reach the application.

**Solutions**:
- Verify `EI_TEST_INPUT=true` environment variable is set
- Check that the application process is running (`harness.isAppRunning()`)
- Use `usePty: false` in app start options (regular spawn works better for input injection)
- Add delays between input and verification steps

#### 3. Mock Server Connection Issues

**Problem**: Application can't connect to mock LLM server.

**Solutions**:
- Verify mock server is started before application
- Check that `EI_LLM_BASE_URL` points to the correct mock server port
- Ensure no firewall or port conflicts
- Use `harness.waitForLLMRequest()` to verify requests are being made

#### 4. Test Cleanup Errors

**Problem**: Tests fail during cleanup with process management errors.

**Solutions**:
- These are usually non-critical - the test functionality worked
- Ensure proper test lifecycle: setup → test → cleanup
- Use try/catch blocks around cleanup operations
- Check for resource leaks (unclosed processes, temp directories)

#### 5. Blessed Application Output Issues

**Problem**: Can't find expected text in application output.

**Solutions**:
- Remember that blessed output contains escape sequences and box-drawing characters
- Use partial text matching instead of exact matches
- Check output with `harness.getCurrentOutput()` for debugging
- Look for content fragments rather than formatted UI elements

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
# E2E Test Harness

The E2E Test Harness is a comprehensive testing framework for the EI application that enables true integration testing by controlling the application environment, managing LLM interactions, and validating real application behavior through automated test scenarios.

## Overview

The E2E Test Harness orchestrates three core components:

1. **Environment Manager** - Creates isolated test environments with temporary directories
2. **Mock LLM Server** - Provides OpenAI-compatible API endpoints for controlled testing
3. **Application Process Manager** - Manages the EI application as a controlled subprocess

## Quick Start

```typescript
import { E2ETestHarnessImpl } from './framework/harness.js';

const harness = new E2ETestHarnessImpl();

// Setup test environment
await harness.setup({
  tempDirPrefix: 'my-test',
  mockServerPort: 3001,
  appTimeout: 5000
});

// Start the application
await harness.startApp({ debugMode: true });

// Send input and wait for response
await harness.sendInput('Hello, world!\n');
await harness.waitForUIChange(5000);

// Make assertions
await harness.assertUIContains('Hello');
harness.assertFileExists('personas/ei/system.jsonc');

// Cleanup
await harness.stopApp();
await harness.cleanup();
```

## Core Features

### Lifecycle Management

- **setup(config)** - Initializes test environment with isolated directories and mock server
- **cleanup()** - Cleans up all test resources and restores environment
- **startApp(options)** - Launches EI application as controlled subprocess
- **stopApp()** - Gracefully stops the application

### Application Control

- **sendInput(text)** - Sends text input to application stdin
- **sendCommand(command)** - Sends formatted commands (automatically adds `/` prefix)
- **getCurrentOutput(lines?)** - Gets current application output
- **isAppRunning()** - Checks if application process is running

### State Observation

#### UI Monitoring
- **waitForUIChange(timeout?)** - Waits for UI output to change
- **waitForUIText(text, timeout?)** - Waits for specific text to appear
- **waitForUIPattern(pattern, timeout?)** - Waits for regex pattern match

#### File System Monitoring
- **waitForFileChange(path, timeout?)** - Waits for file modification
- **waitForFileCreation(path, timeout?)** - Waits for file to be created
- **waitForFileContent(path, content, timeout?)** - Waits for specific file content

#### Process State Monitoring
- **waitForProcessingComplete(timeout?)** - Waits for application to finish processing
- **waitForLLMRequest(timeout?)** - Waits for LLM request to mock server
- **waitForIdleState(timeout?)** - Waits for application to reach idle state
- **waitForCondition(checker, description, timeout?, interval?)** - Custom condition waiting

### Assertions

#### UI Assertions
- **assertUIContains(text)** - Assert UI output contains text
- **assertUIDoesNotContain(text)** - Assert UI output does not contain text
- **assertUIMatches(pattern)** - Assert UI output matches regex pattern

#### File System Assertions
- **assertFileExists(path)** - Assert file exists
- **assertFileDoesNotExist(path)** - Assert file does not exist
- **assertFileContent(path, content)** - Assert file content matches
- **assertDirectoryExists(path, files?)** - Assert directory exists with optional file list

#### Application State Assertions
- **assertProcessState(running)** - Assert application running state
- **assertExitCode(code, timeout?)** - Assert application exit code
- **assertPersonaState(persona, state)** - Assert persona state (basic implementation)

#### Mock Server Assertions
- **assertMockRequestCount(count)** - Assert number of requests received
- **assertMockRequestReceived(endpoint, method?)** - Assert specific request was made

#### Environment Assertions
- **assertCleanEnvironment(allowedFiles?)** - Assert test environment is clean

### Mock Server Control

- **setMockResponse(endpoint, content, delay?)** - Configure mock response
- **enableMockStreaming(endpoint, chunks)** - Enable streaming responses
- **getMockRequestHistory()** - Get all requests made to mock server

## Configuration

### TestConfig Options

```typescript
interface TestConfig {
  tempDirPrefix?: string;        // Prefix for temp directory names
  mockServerPort?: number;       // Port for mock LLM server
  appTimeout?: number;           // Application startup timeout
  cleanupTimeout?: number;       // Cleanup operation timeout
  mockResponses?: MockResponseConfig[];  // Pre-configured mock responses
}
```

### AppStartOptions

```typescript
interface AppStartOptions {
  dataPath?: string;      // Override data directory path
  llmBaseUrl?: string;    // Override LLM API URL
  llmApiKey?: string;     // Override LLM API key
  llmModel?: string;      // Override LLM model
  debugMode?: boolean;    // Enable debug output
}
```

## Usage Patterns

### Basic Test Structure

```typescript
describe('My E2E Test', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    await harness.setup({ tempDirPrefix: 'my-test' });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('should handle basic interaction', async () => {
    await harness.startApp();
    
    await harness.sendInput('Hello\n');
    await harness.waitForUIChange();
    
    await harness.assertUIContains('Hello');
    
    await harness.stopApp();
  });
});
```

### Testing Quit Command

```typescript
test('should quit gracefully when idle', async () => {
  await harness.startApp();
  
  // Wait for application to be ready
  await harness.waitForIdleState();
  
  // Send quit command
  await harness.sendCommand('quit');
  
  // Assert clean exit
  await harness.assertExitCode(0);
});
```

### Testing LLM Interactions

```typescript
test('should handle LLM conversation', async () => {
  // Configure mock response
  harness.setMockResponse('/v1/chat/completions', 'Mock AI response', 100);
  
  await harness.startApp();
  
  // Send message that triggers LLM
  await harness.sendInput('Tell me a joke\n');
  
  // Wait for LLM request
  await harness.waitForLLMRequest();
  
  // Wait for response to appear
  await harness.waitForUIText('Mock AI response');
  
  // Verify request was made
  harness.assertMockRequestReceived('/v1/chat/completions');
  
  await harness.stopApp();
});
```

### Testing File Operations

```typescript
test('should persist conversation data', async () => {
  await harness.startApp();
  
  // Send a message
  await harness.sendInput('Save this message\n');
  
  // Wait for data to be written
  await harness.waitForFileChange('personas/ei/history.jsonc');
  
  // Verify file content
  await harness.assertFileContent('personas/ei/history.jsonc', 'Save this message');
  
  await harness.stopApp();
});
```

### Testing Error Conditions

```typescript
test('should handle invalid commands gracefully', async () => {
  await harness.startApp();
  
  // Send invalid command
  await harness.sendCommand('invalid-command');
  
  // Should show error message
  await harness.waitForUIText('Unknown command');
  
  // Application should still be running
  harness.assertProcessState(true);
  
  await harness.stopApp();
});
```

### Testing Streaming Responses

```typescript
test('should handle streaming LLM responses', async () => {
  // Configure streaming response
  harness.enableMockStreaming('/v1/chat/completions', [
    'This ', 'is ', 'a ', 'streaming ', 'response'
  ]);
  
  await harness.startApp();
  
  await harness.sendInput('Stream me a response\n');
  
  // Wait for streaming to complete
  await harness.waitForUIText('streaming response');
  
  await harness.stopApp();
});
```

## Advanced Features

### Custom Wait Conditions

```typescript
// Wait for complex application state
await harness.waitForCondition(
  async () => {
    const output = await harness.getCurrentOutput();
    return output.includes('Ready') && !output.includes('Processing');
  },
  'application ready and not processing',
  10000,
  200
);
```

### Environment Verification

```typescript
// Verify clean test environment
harness.assertCleanEnvironment(['personas/ei/system.jsonc']);

// Verify directory structure
harness.assertDirectoryExists('personas', ['ei']);
harness.assertDirectoryExists('history');
harness.assertDirectoryExists('concepts');
```

### Mock Server Inspection

```typescript
// Get detailed request history
const requests = harness.getMockRequestHistory();
expect(requests).toHaveLength(2);
expect(requests[0].endpoint).toBe('/v1/chat/completions');
expect(requests[0].body.messages).toBeDefined();
```

## Error Handling

The harness provides comprehensive error handling:

- **Setup failures** - Automatic cleanup of partial setup
- **Application crashes** - Graceful handling and state capture
- **Timeout conditions** - Clear error messages with context
- **Assertion failures** - Detailed information about expected vs actual values
- **Cleanup errors** - Best-effort cleanup with warnings

## Testing the Framework

The framework itself is thoroughly tested with 62+ test cases covering:

- Lifecycle management
- Configuration handling
- Mock server integration
- File system operations
- Assertion methods
- Wait conditions
- Error scenarios
- State management

Run framework tests with:
```bash
npm test -- tests/e2e/framework/ --run
```

## Integration with Existing Tests

The E2E Test Harness integrates seamlessly with the existing Vitest test infrastructure:

```typescript
// vitest.config.ts
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/e2e/**/*.e2e.test.ts"],
    testTimeout: 30000, // Longer timeout for e2e tests
  },
});
```

## Best Practices

1. **Always use beforeEach/afterEach** for setup and cleanup
2. **Use specific timeouts** based on expected operation duration
3. **Test both success and failure scenarios**
4. **Verify mock server interactions** when testing LLM features
5. **Use descriptive test names** that explain the scenario
6. **Group related assertions** to minimize test execution time
7. **Clean up resources** even when tests fail
8. **Use appropriate wait methods** for different types of state changes

## Troubleshooting

### Common Issues

1. **Port conflicts** - Use different ports for concurrent tests
2. **Timeout errors** - Increase timeouts for slow operations
3. **File permission errors** - Ensure temp directories are writable
4. **Process hanging** - Check for proper cleanup in afterEach
5. **Mock server not responding** - Verify port configuration

### Debug Mode

Enable debug mode for detailed logging:

```typescript
await harness.startApp({ debugMode: true });
```

### Output Inspection

Get current application output for debugging:

```typescript
const output = await harness.getCurrentOutput(50); // Last 50 lines
console.log('Current output:', output);
```

## Future Enhancements

Potential improvements for the framework:

1. **TUI Test Integration** - Enhanced terminal interaction testing
2. **Performance Monitoring** - Resource usage tracking
3. **Parallel Test Execution** - Better isolation for concurrent tests
4. **Visual Regression Testing** - Terminal screenshot comparison
5. **Test Recording/Playback** - Capture and replay test scenarios
6. **Advanced Mocking** - More sophisticated LLM response patterns
7. **Real-time Monitoring** - Live test execution dashboards
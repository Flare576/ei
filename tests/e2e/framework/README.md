# E2E Testing Framework - Configuration and Extensibility

This document describes the configuration management and extensibility features of the E2E testing framework.

> **📖 Related Documentation**: 
> - For main framework overview and usage guide, see [`../README.md`](../README.md)
> - For test scenario framework details, see [`test-scenario-README.md`](test-scenario-README.md)
> - This document focuses on configuration management and extensibility features

## Configuration Management

The configuration system provides file-based configuration loading, programmatic API, environment overrides, and validation.

### Basic Usage

```typescript
import { createConfigManager, createDefaultConfig } from './config-manager.js';

// Create a configuration manager
const configManager = createConfigManager();

// Create default configuration
const config = createDefaultConfig({
  tempDirPrefix: 'my-test',
  appTimeout: 15000
});

// Validate configuration
const validation = configManager.validateConfig(config);
if (!validation.isValid) {
  console.error('Invalid configuration:', validation.errors);
}
```

### File-based Configuration

Create a configuration file (supports JSON and JSONC):

```json
{
  // E2E Test Configuration
  "tempDirPrefix": "my-e2e-tests",
  "mockServerPort": 3001,
  "appTimeout": 12000,
  "cleanupTimeout": 6000,
  "mockResponses": [
    {
      "endpoint": "/v1/chat/completions",
      "response": {
        "type": "fixed",
        "content": "Test response",
        "delayMs": 100
      }
    }
  ]
}
```

Load and save configuration:

```typescript
// Load from file
const config = await configManager.loadFromFile('./test-config.json');

// Save to file
await configManager.saveToFile(config, './test-config.json');
```

### Environment Variable Overrides

Set environment variables to override configuration:

```bash
export E2E_TEST_TEMP_DIR_PREFIX=env-test
export E2E_TEST_MOCK_SERVER_PORT=3002
export E2E_TEST_APP_TIMEOUT=20000
export E2E_TEST_CLEANUP_TIMEOUT=8000
```

Apply environment overrides:

```typescript
const configWithEnv = configManager.applyEnvironmentOverrides(baseConfig);
```

### Configuration Validation

The system validates configuration and provides helpful error messages:

```typescript
const validation = configManager.validateConfig(config);

console.log('Valid:', validation.isValid);
console.log('Errors:', validation.errors);
console.log('Warnings:', validation.warnings);
```

## Extensibility System

The hooks system provides extensible test execution with pre/post hooks, custom scenarios, and plugin support.

### Basic Hook Usage

```typescript
import { createHooksManager } from './hooks-manager.js';

const hooksManager = createHooksManager();

// Register a simple hook
hooksManager.registerHook('my-hook', async (context) => {
  console.log('Hook executed:', context.hookName);
});

// Execute the hook
await hooksManager.executeHook('my-hook', {
  hookName: 'my-hook',
  timestamp: Date.now(),
  data: { custom: 'data' }
});
```

### Pre/Post Test Hooks

```typescript
// Before each test
hooksManager.registerBeforeTest(async (context) => {
  console.log(`Starting test: ${context.testName}`);
  // Setup test-specific resources
});

// After each test
hooksManager.registerAfterTest(async (context) => {
  console.log(`Completed test: ${context.testName}`);
  // Cleanup test-specific resources
});

// Before each scenario
hooksManager.registerBeforeScenario(async (context) => {
  console.log(`Starting scenario: ${context.scenario.name}`);
});

// After each scenario
hooksManager.registerAfterScenario(async (context) => {
  console.log(`Completed scenario: ${context.scenario.name}`);
});
```

### Scenario Extensions

Create custom scenario extensions:

```typescript
import { ScenarioExtension } from './hooks-manager.js';

const myExtension: ScenarioExtension = {
  name: 'my-extension',
  description: 'Custom scenario extension',
  version: '1.0.0',
  
  beforeScenario: async (context) => {
    // Setup before scenario
  },
  
  afterScenario: async (context) => {
    // Cleanup after scenario
  },
  
  customStepTypes: {
    'custom-action': async (action, context) => {
      // Handle custom step type
      console.log(`Executing custom action: ${action}`);
      return { result: 'success' };
    }
  },
  
  customAssertionTypes: {
    'custom-assert': async (target, condition, expected, context) => {
      // Handle custom assertion type
      if (target !== expected) {
        throw new Error(`Custom assertion failed: ${target} !== ${expected}`);
      }
    }
  }
};

// Register the extension
hooksManager.registerScenarioExtension('my-extension', myExtension);
```

### Plugin System

Create and register plugins:

```typescript
import { E2EPlugin } from './hooks-manager.js';

const myPlugin: E2EPlugin = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Custom E2E testing plugin',
  
  initialize: async (hooksManager, config) => {
    console.log('Plugin initialized');
    // Setup plugin resources
  },
  
  cleanup: async () => {
    console.log('Plugin cleaned up');
    // Cleanup plugin resources
  },
  
  hooks: {
    'plugin-hook': async (context) => {
      console.log('Plugin hook executed');
    }
  },
  
  scenarioExtensions: [myExtension],
  
  dependencies: ['other-plugin'] // Optional dependencies
};

// Register the plugin
await hooksManager.registerPlugin(myPlugin);
```

### Built-in Extensions

The framework provides built-in extensions:

```typescript
import { LoggingExtension, TimingExtension } from './hooks-manager.js';

// Register logging extension for detailed execution logs
hooksManager.registerScenarioExtension('logging', LoggingExtension);

// Register timing extension for performance monitoring
hooksManager.registerScenarioExtension('timing', TimingExtension);
```

### Integration with Test Harness

Use configuration and hooks with the test harness:

```typescript
import { E2ETestHarnessImpl } from './harness.js';
import { createDefaultConfig } from './config-manager.js';
import { LoggingExtension } from './hooks-manager.js';

const harness = new E2ETestHarnessImpl();

// Setup with configuration
const config = createDefaultConfig({
  tempDirPrefix: 'integration-test',
  appTimeout: 15000
});

await harness.setup(config);

// Get hooks manager and register extensions
const hooksManager = harness.getHooksManager();
hooksManager.registerScenarioExtension('logging', LoggingExtension);

// Execute test scenario with hooks
const scenario = {
  name: 'my-scenario',
  description: 'Test scenario with hooks',
  setup: {},
  steps: [
    { type: 'custom-action', action: 'my custom step' }
  ],
  assertions: [
    { type: 'custom-assert', target: 'value', condition: 'equals', expected: 'value' }
  ]
};

await harness.executeTestScenario(scenario);

// Cleanup
await harness.cleanup();
```

## Advanced Features

### Hook Execution Monitoring

```typescript
// Get execution statistics
const stats = hooksManager.getStatistics();
console.log('Total hooks:', stats.totalHooks);
console.log('Total handlers:', stats.totalHandlers);
console.log('Plugins:', stats.plugins);

// Get execution history
const history = hooksManager.getExecutionHistory();
for (const result of history) {
  console.log(`Hook ${result.hookName}: ${result.executionTime}ms, ${result.handlersExecuted} handlers`);
  if (result.errors.length > 0) {
    console.error('Errors:', result.errors);
  }
}
```

### Configuration Schema Validation

The system validates configuration against a built-in schema:

- `tempDirPrefix`: String, alphanumeric with underscores and hyphens
- `mockServerPort`: Number, 1024-65535
- `appTimeout`: Number, minimum 100ms (warns if < 1000ms)
- `cleanupTimeout`: Number, minimum 100ms (warns if < 1000ms)
- `mockResponses`: Array of mock response configurations

### Error Handling

Both systems handle errors gracefully:

- Configuration validation provides detailed error messages
- Hook execution continues even if individual handlers fail
- Plugin initialization failures prevent registration
- Cleanup operations attempt to clean up all resources even if some fail

This extensible architecture allows for comprehensive testing scenarios while maintaining clean separation of concerns and easy customization for specific testing needs.
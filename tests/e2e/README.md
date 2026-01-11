# E2E Testing Framework

This directory contains the End-to-End testing framework for the EI application.

## Directory Structure

```
tests/e2e/
├── framework/           # Tests for the e2e framework itself
│   ├── harness.test.ts     # E2E Test Harness unit tests
│   ├── mock-server.test.ts # Mock LLM Server unit tests
│   └── environment.test.ts # Environment Manager unit tests
├── scenarios/           # Actual e2e test scenarios
│   ├── quit-command.e2e.test.ts    # Quit command behavior tests
│   ├── multi-persona.e2e.test.ts   # Multi-persona functionality tests
│   └── basic-flow.e2e.test.ts      # Basic application flow tests
├── types.ts            # TypeScript interfaces for all components
├── config.ts           # Default configuration values
├── utils.ts            # Common utility functions
└── README.md           # This file
```

## Framework Components

### E2E Test Harness
The central orchestration component that manages test lifecycle and provides the primary API for test scenarios.

### Mock LLM Server
A lightweight HTTP server that implements OpenAI-compatible endpoints for controlled testing.

### Application Process Manager
Manages the EI application as a controlled subprocess with input/output handling.

### Environment Manager
Handles temporary directory creation, cleanup, and environment variable management.

## Running E2E Tests

```bash
# Run all e2e tests
npm run test:e2e

# Run e2e tests in watch mode
npm run test:e2e:watch

# Run specific e2e test file
npx vitest tests/e2e/scenarios/quit-command.e2e.test.ts
```

## Configuration

Default configuration values are defined in `config.ts`. Tests can override these values as needed.

Key configuration options:
- `tempDirPrefix`: Prefix for temporary test directories
- `mockServerPort`: Port for the mock LLM server
- `appTimeout`: Timeout for application startup
- `cleanupTimeout`: Timeout for cleanup operations

## Test Development

When creating new e2e tests:

1. Use the interfaces defined in `types.ts`
2. Follow the patterns established in existing scenario tests
3. Use utility functions from `utils.ts` for common operations
4. Ensure proper cleanup in test teardown
5. Use descriptive test names that explain the scenario being tested

## Dependencies

The e2e testing framework uses:
- `express`: For the mock LLM server
- `chokidar`: For file system monitoring
- `vitest`: As the test runner (with extended timeout for e2e tests)

## Implementation Status

This framework is currently in development. The infrastructure and interfaces are set up, but the actual implementation of the framework components will be done in subsequent tasks according to the implementation plan.
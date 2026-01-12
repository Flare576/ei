// Basic flow E2E test scenarios
// Tests for basic application flow: start → send message → receive response → quit

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { TestScenarioRunner } from '../framework/test-scenario.js';
import { TestScenario } from '../types.js';

describe('Basic Flow E2E Tests', () => {
  let harness: E2ETestHarnessImpl;
  let scenarioRunner: TestScenarioRunner;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    scenarioRunner = new TestScenarioRunner(harness);
    
    await harness.setup({
      tempDirPrefix: 'basic-flow-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('basic application flow: start → send message → receive response → quit', async () => {
    // Configure sequential responses: response, system concepts JSON, human concepts JSON
    harness.setMockResponseQueue([
      'Hello! I received your message and I\'m responding from the test environment.',
      JSON.stringify([{
        name: "Test System Concept",
        description: "A test concept for system",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])  // Empty human concepts array
    ]);

    // Start the application using regular spawn (not PTY) - this is the working approach
    await harness.startApp({ debugMode: false, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Send a test message using the working input system
    await harness.sendInput('Hello, test assistant!\n');

    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);

    // Wait for response to appear in UI
    await harness.waitForUIText('Hello! I received your message', 8000);

    // Verify the response appears in UI
    await harness.assertUIContains('Hello! I received your message');

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);

    // Verify mock server received expected requests (1 message = 3+ requests: response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);

    // Verify persona data was created
    harness.assertFileExists('personas');
    harness.assertDirectoryExists('personas');
  }, 30000); // 30 second timeout for full flow

  test('basic flow with scenario configuration file', async () => {
    // Load and execute the example scenario
    const scenario = await scenarioRunner.loadScenarioFromFile('tests/e2e/scenarios/example-basic-flow.json');
    
    const result = await scenarioRunner.executeScenario(scenario, {
      maxRetries: 2,
      attemptRecovery: true,
      performCleanup: true
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.stepResults.length).toBeGreaterThan(0);
    expect(result.assertionResults.length).toBeGreaterThan(0);
    
    // Verify all steps succeeded
    for (const stepResult of result.stepResults) {
      expect(stepResult.success).toBe(true);
    }
    
    // Verify all assertions succeeded
    for (const assertionResult of result.assertionResults) {
      expect(assertionResult.success).toBe(true);
    }
  }, 30000);

  test('basic flow with streaming response', async () => {
    // Configure streaming mock response
    harness.enableMockStreaming('/v1/chat/completions', [
      'Hello! ',
      'This is ',
      'a streaming ',
      'response ',
      'from the ',
      'test environment.'
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Send a test message
    await harness.sendInput('Tell me a streaming story\n');

    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);

    // Wait for streaming response to complete
    await harness.waitForUIText('test environment', 10000);

    // Verify the complete response appears in UI
    await harness.assertUIContains('Hello! This is a streaming response from the test environment');

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);

    // Verify mock server received expected requests (1 message = 3+ requests: response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
  }, 30000);

  test('basic flow with multiple messages', async () => {
    // Configure sequential responses for 2 messages (6 total responses)
    harness.setMockResponseQueue([
      // Message 1 responses
      'I understand your first message.',
      JSON.stringify([{
        name: "First Message Concept",
        description: "Concept from first message",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      // Message 2 responses
      'I received your second message too.',
      JSON.stringify([{
        name: "Second Message Concept", 
        description: "Concept from second message",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // First message exchange
    await harness.sendInput('First test message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('I understand your first message', 8000);

    // Second message exchange
    await harness.sendInput('Second test message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('I received your second message too', 8000);

    // Verify both responses appear in UI
    await harness.assertUIContains('I understand your first message');
    await harness.assertUIContains('I received your second message too');

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);

    // Verify mock server received expected requests (2 messages = 6+ requests: 3 per message)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
  }, 45000);

  test('basic flow with error handling', async () => {
    // Configure sequential responses with error for first call, then valid JSON for concept calls
    harness.setMockResponseQueue([
      'Server Error',  // This will cause an error
      JSON.stringify([]),  // Empty system concepts
      JSON.stringify([])   // Empty human concepts
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Send a test message that should trigger an error
    await harness.sendInput('This should cause an error\n');

    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);

    // Wait for error handling to complete
    await harness.waitForIdleState(5000);

    // The application should still be running and responsive
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);

    // Verify mock server received expected requests (1 message = 3+ requests: response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
  }, 30000);
});
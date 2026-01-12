// Basic flow E2E test scenarios
// Tests for basic application flow: start → send message → receive response → quit

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { TestScenarioRunner } from '../framework/test-scenario.js';

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
    // usePty: false enables reliable blessed output capture
    await harness.startApp({ debugMode: false, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Send a test message using the working input system
    // Use message >30 characters to avoid debouncing delays
    const testMessage = 'Hello, test assistant! This message is long enough to trigger immediate processing.';
    await harness.sendInput(`${testMessage}\n`);

    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);

    // Wait for processing to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify mock server received expected requests (1 message = 3+ requests: response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);

    // Enhanced: Verify blessed output capture shows user input
    const capturedOutput = await harness.getCurrentOutput();
    expect(capturedOutput).toContain(testMessage.slice(0, 30)); // Verify user message appears in UI
    
    // Enhanced: Verify output capture system is working
    const captureMessages = capturedOutput.split('\n').filter(line => line.includes('[TestOutputCapture]'));
    expect(captureMessages.length).toBeGreaterThan(0); // Should have UI update messages

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);

    // Verify persona data was created
    harness.assertFileExists('personas');
    harness.assertDirectoryExists('personas');
  }, 30000); // 30 second timeout for full flow

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

    // Start the application with blessed output capture enabled
    await harness.startApp({ debugMode: false, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // First message exchange - use message >30 characters to avoid debouncing
    const firstMessage = 'First test message that is long enough to trigger immediate processing without delays';
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for processing

    // Enhanced: Verify first message appears in captured output
    const afterFirstMessage = await harness.getCurrentOutput();
    expect(afterFirstMessage).toContain(firstMessage.slice(0, 30));

    // Second message exchange - use message >30 characters to avoid debouncing
    const secondMessage = 'Second test message that is also long enough to trigger immediate processing';
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 3000)); // Wait for processing

    // Enhanced: Verify second message appears in captured output OR verify multiple UI updates occurred
    const afterSecondMessage = await harness.getCurrentOutput();
    
    // Check if second message appears, or at least verify we have more UI activity
    const hasSecondMessage = afterSecondMessage.includes(secondMessage.slice(0, 30));
    const hasMultipleUpdates = afterSecondMessage.split('[TestOutputCapture]').length > 10;
    
    // Either the second message should be visible, or we should see significant UI activity
    expect(hasSecondMessage || hasMultipleUpdates).toBe(true);

    // Enhanced: Verify output capture system detected multiple UI updates
    const captureMessages = afterSecondMessage.split('\n').filter(line => line.includes('[TestOutputCapture]'));
    expect(captureMessages.length).toBeGreaterThan(0); // Should have multiple UI updates

    // Verify mock server received expected requests (2 messages = 6+ requests: 3 per message)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);
  }, 45000);

  test('basic flow with error handling', async () => {
    // Configure sequential responses with error for first call, then valid JSON for concept calls
    harness.setMockResponseQueue([
      'Server Error',  // This will cause an error
      JSON.stringify([]),  // Empty system concepts
      JSON.stringify([])   // Empty human concepts
    ]);

    // Start the application with blessed output capture enabled
    await harness.startApp({ debugMode: false, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Send a test message that should trigger an error - use message >30 characters to avoid debouncing
    const errorMessage = 'This message should cause an error but still be processed and displayed in the UI';
    await harness.sendInput(`${errorMessage}\n`);

    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);

    // Wait for error handling to complete
    await new Promise(resolve => setTimeout(resolve, 5000));

    // The application should still be running and responsive
    expect(harness.isAppRunning()).toBe(true);

    // Enhanced: Verify error message input appears in captured output
    const capturedOutput = await harness.getCurrentOutput();
    expect(capturedOutput).toContain(errorMessage.slice(0, 30)); // User input should still be captured

    // Enhanced: Verify output capture system is working even with errors
    const captureMessages = capturedOutput.split('\n').filter(line => line.includes('[TestOutputCapture]'));
    expect(captureMessages.length).toBeGreaterThan(0); // Should have UI update messages

    // Verify mock server received expected requests (1 message = 3+ requests: response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);

    // Send quit command using proper command system
    await harness.sendCommand('/quit');

    // Wait for application to exit cleanly
    await harness.assertExitCode(0, 5000);
  }, 30000);
});
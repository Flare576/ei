// Simple E2E Test Example
// Demonstrates the most basic E2E test structure

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Simple E2E Test Examples', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'simple-example',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('minimal working example', async () => {
    // This is the absolute minimum E2E test
    
    // 1. Configure sequential responses: response, system concepts JSON, human concepts JSON
    harness.setMockResponseQueue([
      'Hello! This is a simple test response.',
      JSON.stringify([{
        name: "Simple Test Concept",
        description: "A simple concept for testing",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // 2. Start the EI application
    await harness.startApp({ debugMode: false });

    // 3. Wait for it to be ready
    await harness.waitForIdleState(3000);

    // 4. Send a message
    await harness.sendInput('Hello, simple test!\n');

    // 5. Wait for the app to make an LLM request
    await harness.waitForLLMRequest(3000);

    // 6. Wait for the response to appear in the UI
    await harness.waitForUIText('simple test response', 5000);

    // 7. Verify the response is there
    await harness.assertUIContains('simple test response');

    // 8. Quit the application
    await harness.sendCommand('/quit');

    // 9. Make sure it exited cleanly
    await harness.assertExitCode(0, 5000);

    // 10. Verify we made at least 3 LLM requests (response + system concepts + human concepts)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
  }, 30000);

  test('example with error handling', async () => {
    // This example shows how to test error conditions
    
    // Configure sequential responses with error for first call
    harness.setMockResponseQueue([
      'Server Error',  // This will cause an error
      JSON.stringify([]),  // Empty system concepts
      JSON.stringify([])   // Empty human concepts
    ]);

    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);

    // Send a message that will trigger an error
    await harness.sendInput('This will cause an error\n');
    await harness.waitForLLMRequest(3000);

    // Wait for error handling to complete
    await harness.waitForIdleState(3000);

    // The application should still be running (resilient to errors)
    expect(harness.isAppRunning()).toBe(true);

    // Clean exit
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify the error request was made (at least 3 requests expected)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
  }, 30000);

  test('example with streaming response', async () => {
    // This example shows how to test streaming responses
    
    // Configure streaming response
    harness.enableMockStreaming('/v1/chat/completions', [
      'This is ',
      'a streaming ',
      'response ',
      'example.'
    ]);

    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);

    await harness.sendInput('Give me a streaming response\n');
    await harness.waitForLLMRequest(3000);

    // Wait for streaming to begin
    await harness.waitForUIText('This is a streaming', 5000);

    // Wait for streaming to complete
    await harness.waitForUIText('response example', 8000);

    // Verify complete response
    await harness.assertUIContains('This is a streaming response example');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
    harness.assertMockRequestCount(1);
  }, 30000);

  test('example with multiple messages', async () => {
    // This example shows a conversation with multiple exchanges
    
    // Configure sequential responses for 2 messages (6 total responses)
    harness.setMockResponseQueue([
      // First message responses
      'First response from the assistant.',
      JSON.stringify([{
        name: "First Message Concept",
        description: "Concept from first message",
        level_current: 0.4,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second message responses
      'Second response from the assistant.',
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

    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);

    // First exchange
    await harness.sendInput('First message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('First response', 5000);

    // Second exchange
    await harness.sendInput('Second message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Second response', 5000);

    // Verify both responses are in the UI
    await harness.assertUIContains('First response');
    await harness.assertUIContains('Second response');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify we made 6+ LLM requests (2 messages = 6+ requests: 3+ per message)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
  }, 45000);

  test('example with custom wait conditions', async () => {
    // This example shows how to wait for custom conditions
    
    // Configure sequential responses for custom conditions test
    harness.setMockResponseQueue([
      'Custom condition test response.',
      JSON.stringify([{
        name: "Custom Condition Concept",
        description: "Concept for custom condition testing",
        level_current: 0.7,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);

    await harness.sendInput('Test custom conditions\n');

    // Wait for a custom condition (application is processing)
    await harness.waitForCondition(
      async () => {
        const output = await harness.getCurrentOutput();
        return output.includes('thinking') || output.includes('processing');
      },
      'Application should show processing indicator',
      5000
    );

    // Wait for processing to complete
    await harness.waitForCondition(
      async () => {
        const output = await harness.getCurrentOutput();
        return output.includes('Custom condition test response');
      },
      'Response should appear in output',
      8000
    );

    await harness.assertUIContains('Custom condition test response');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
  }, 30000);
});
// Interruption and timing E2E test scenarios
// Tests for quit during active LLM processing, background processing, and timeout handling

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { TestScenarioRunner } from '../framework/test-scenario.js';

describe('Interruption and Timing E2E Tests', () => {
  let harness: E2ETestHarnessImpl;
  let scenarioRunner: TestScenarioRunner;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    scenarioRunner = new TestScenarioRunner(harness);
    
    await harness.setup({
      tempDirPrefix: 'interruption-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('quit during active LLM processing', async () => {
    // Configure sequential responses with long delay to simulate slow LLM response
    harness.setMockResponseQueue([
      'This response took a long time to generate.',
      JSON.stringify([{
        name: "Long Processing Concept",
        description: "Concept from long processing operation",
        level_current: 0.3,
        level_ideal: 0.9,
        level_elasticity: 0.5,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger LLM processing
    await harness.sendInput('Generate a long response\n');

    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);

    // Immediately send quit command while processing is active
    await harness.sendCommand('/quit');

    // The application should handle the interruption gracefully
    // It might exit immediately or wait for processing to complete
    await harness.waitForCondition(
      () => !harness.isAppRunning(),
      'Application should exit after quit during processing',
      10000
    );

    // Verify the application exited (exit code may vary depending on interruption handling)
    expect(harness.isAppRunning()).toBe(false);

    // Verify mock server received the request
    harness.assertMockRequestCount(1);
  }, 30000);

  test('quit with background processing warnings', async () => {
    // Configure mock server with streaming response to simulate background processing
    harness.enableMockStreaming('/v1/chat/completions', [
      'Processing ',
      'your request ',
      'in the background. ',
      'This will take ',
      'some time to complete.'
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger background processing
    await harness.sendInput('Start background processing\n');

    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);

    // Send quit command while background processing is active
    await harness.sendCommand('/quit');

    // The application should display warnings about background processing
    // and may ask for confirmation or wait for completion
    await harness.waitForCondition(
      () => !harness.isAppRunning(),
      'Application should handle background processing quit',
      15000
    );

    // Verify the application handled the quit appropriately
    expect(harness.isAppRunning()).toBe(false);

    // Verify mock server received the request
    harness.assertMockRequestCount(1);
  }, 30000);

  test('application responsiveness during background processing', async () => {
    // Configure sequential responses for background processing test
    harness.setMockResponseQueue([
      // First message (slow background operation)
      'Starting very slow background processing operation.',
      JSON.stringify([{
        name: "Background Processing Concept",
        description: "Concept from background processing",
        level_current: 0.2,
        level_ideal: 0.8,
        level_elasticity: 0.6,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second message (additional input while processing)
      'Additional input processed while background operation running.',
      JSON.stringify([{
        name: "Additional Input Concept",
        description: "Concept from additional input during processing",
        level_current: 0.4,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger slow background processing
    await harness.sendInput('Start slow background operation\n');

    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);

    // While processing is happening, test that the application remains responsive
    // by sending additional input
    await harness.sendInput('Additional input while processing\n');

    // The application should remain responsive and handle the additional input
    // even while background processing is occurring
    
    // Wait for the background processing to complete
    await harness.waitForUIText('background processing operation', 15000);

    // Verify the application is still responsive
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command
    await harness.sendCommand('/quit');

    // Wait for clean exit
    await harness.assertExitCode(0, 5000);

    // Verify mock server received the requests
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(1);
  }, 45000);

  test('timeout handling and recovery scenarios', async () => {
    // Configure sequential responses for timeout test
    harness.setMockResponseQueue([
      // First message (will timeout)
      'This response will timeout.',
      JSON.stringify([{
        name: "Timeout Test Concept",
        description: "Concept from timeout test",
        level_current: 0.1,
        level_ideal: 0.9,
        level_elasticity: 0.8,
        type: "static"
      }]),
      JSON.stringify([]),
      // Recovery message
      'Recovery successful.',
      JSON.stringify([{
        name: "Recovery Concept",
        description: "Concept from recovery after timeout",
        level_current: 0.8,
        level_ideal: 0.9,
        level_elasticity: 0.1,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger a timeout
    await harness.sendInput('This will timeout\n');

    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);

    // Wait for timeout handling to occur
    // The application should handle the timeout gracefully
    await harness.waitForCondition(
      async () => {
        const output = await harness.getCurrentOutput();
        // Look for timeout indicators or return to idle state
        return output.includes('timeout') || 
               output.includes('error') || 
               !harness.isAppRunning();
      },
      'Application should handle timeout',
      20000
    );

    // The application should either show an error message or recover gracefully
    if (harness.isAppRunning()) {
      // If still running, it should be responsive
      await harness.sendInput('Recovery test\n');
      
      // Test that the application can recover and process new requests
      await harness.waitForLLMRequest(3000);
      await harness.waitForUIText('Recovery successful', 8000);
      
      // Send quit command
      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    } else {
      // If the application exited due to timeout, that's also acceptable behavior
      expect(harness.isAppRunning()).toBe(false);
    }

    // Verify mock server received at least the initial request
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(1);
  }, 60000);

  test('force quit bypassing all checks', async () => {
    // Configure sequential responses for force quit test
    harness.setMockResponseQueue([
      'Long running operation in progress.',
      JSON.stringify([{
        name: "Force Quit Test Concept",
        description: "Concept from force quit test",
        level_current: 0.2,
        level_ideal: 0.8,
        level_elasticity: 0.6,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger long processing
    await harness.sendInput('Start long operation\n');

    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);

    // Send force quit command (this might be Ctrl+C or a specific force quit command)
    // For now, we'll simulate this by sending multiple quit commands rapidly
    await harness.sendCommand('/quit');
    await harness.sendCommand('/quit');
    await harness.sendCommand('/quit');

    // Force quit should bypass all safety checks and exit immediately
    await harness.waitForCondition(
      () => !harness.isAppRunning(),
      'Application should force quit immediately',
      8000
    );

    // Verify the application exited quickly
    expect(harness.isAppRunning()).toBe(false);

    // Verify mock server received the initial request
    harness.assertMockRequestCount(1);
  }, 30000);

  test('interrupt streaming response mid-stream', async () => {
    // Configure mock server with streaming response that can be interrupted
    harness.enableMockStreaming('/v1/chat/completions', [
      'This is ',
      'a very long ',
      'streaming response ',
      'that should be ',
      'interrupted before ',
      'it completes ',
      'successfully.'
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send a message that will trigger streaming
    await harness.sendInput('Start streaming response\n');

    // Wait for streaming to begin
    await harness.waitForLLMRequest(2000);
    await harness.waitForUIText('This is a very long', 5000);

    // Interrupt the streaming response with quit command
    await harness.sendCommand('/quit');

    // The application should handle the interruption gracefully
    await harness.waitForCondition(
      () => !harness.isAppRunning(),
      'Application should handle streaming interruption',
      10000
    );

    // Verify the application exited
    expect(harness.isAppRunning()).toBe(false);

    // Verify mock server received the request
    harness.assertMockRequestCount(1);
  }, 30000);

  test('timeout with multiple concurrent operations', async () => {
    // Configure sequential responses for multiple concurrent operations
    harness.setMockResponseQueue([
      // First concurrent message
      'Concurrent operation response.',
      JSON.stringify([{
        name: "Concurrent Op 1 Concept",
        description: "First concurrent operation concept",
        level_current: 0.4,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second concurrent message
      'Concurrent operation response.',
      JSON.stringify([{
        name: "Concurrent Op 2 Concept",
        description: "Second concurrent operation concept",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      // Third concurrent message
      'Concurrent operation response.',
      JSON.stringify([{
        name: "Concurrent Op 3 Concept",
        description: "Third concurrent operation concept",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Send multiple messages in quick succession to simulate concurrent operations
    await harness.sendInput('First concurrent message\n');
    await harness.sendInput('Second concurrent message\n');
    await harness.sendInput('Third concurrent message\n');

    // Wait for at least one LLM request to be initiated
    await harness.waitForLLMRequest(3000);

    // The application should handle multiple concurrent operations gracefully
    // Wait for processing to complete or timeout
    await harness.waitForCondition(
      async () => {
        const output = await harness.getCurrentOutput();
        return output.includes('Concurrent operation response') ||
               output.includes('timeout') ||
               output.includes('error');
      },
      'Application should handle concurrent operations',
      15000
    );

    // Verify the application is still responsive
    if (harness.isAppRunning()) {
      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }

    // Verify mock server received requests
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(1);
  }, 45000);
});
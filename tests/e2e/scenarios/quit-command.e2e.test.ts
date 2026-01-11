// Quit command E2E test scenarios
// Tests for quit command behavior in real application scenarios

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { TestScenarioRunner } from '../framework/test-scenario.js';
import { E2ETestHarness, TestScenario } from '../types.js';

describe('Quit Command E2E Tests', () => {
  let harness: E2ETestHarness;
  let scenarioRunner: TestScenarioRunner;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    scenarioRunner = new TestScenarioRunner(harness);
    
    await harness.setup({
      tempDirPrefix: 'quit-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  /**
   * Test quit command in idle state (exit code 0)
   * Requirements: 5.1 - WHEN the application is idle, THE quit command SHALL exit cleanly with code 0
   */
  test('quit command in idle state exits with code 0', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for application to reach idle state
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Assert application exits with code 0
    await harness.assertExitCode(0, 5000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
  }, 15000);

  /**
   * Test quit command during active LLM processing (interruption)
   * Requirements: 5.2 - WHEN LLM processing is active, THE quit command SHALL interrupt processing and exit cleanly
   */
  test('quit command during LLM processing interrupts and exits cleanly', async () => {
    // Configure mock server with delayed response to simulate processing
    harness.setMockResponse('/v1/chat/completions', 'This is a delayed response.', 3000);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state first
    await harness.waitForIdleState(3000);
    
    // Send a message to trigger LLM processing
    await harness.sendInput('Tell me a story\n');
    
    // Wait for LLM request to be initiated
    await harness.waitForLLMRequest(2000);
    
    // Send quit command while processing is active
    await harness.sendCommand('quit');
    
    // Assert application exits cleanly (should interrupt processing)
    await harness.assertExitCode(0, 5000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
    
    // Verify that LLM request was made (processing was started)
    harness.assertMockRequestCount(1);
  }, 20000);

  /**
   * Test quit command with background processing (warnings)
   * Requirements: 5.3 - WHEN background processing occurs, THE quit command SHALL display warnings and wait for confirmation
   */
  test('quit command with background processing shows warnings', async () => {
    // Configure mock server with streaming response to simulate background processing
    harness.enableMockStreaming('/v1/chat/completions', [
      'This is chunk 1',
      'This is chunk 2', 
      'This is chunk 3'
    ]);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(3000);
    
    // Send a message to trigger background processing
    await harness.sendInput('Generate a long response\n');
    
    // Wait for processing to begin
    await harness.waitForLLMRequest(2000);
    
    // Send quit command during background processing
    await harness.sendCommand('quit');
    
    // Wait for UI to show warning about background processing
    await harness.waitForUIText('background processing', 3000);
    
    // Send confirmation to proceed with quit
    await harness.sendInput('y\n');
    
    // Assert application exits cleanly after confirmation
    await harness.assertExitCode(0, 8000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
  }, 25000);

  /**
   * Test force quit bypassing all checks
   * Requirements: 5.4 - WHEN using force quit, THE quit command SHALL bypass all safety checks and exit immediately
   */
  test('force quit bypasses all safety checks', async () => {
    // Configure mock server with long delay to simulate ongoing processing
    harness.setMockResponse('/v1/chat/completions', 'Long processing response', 5000);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(3000);
    
    // Send a message to trigger processing
    await harness.sendInput('Start processing\n');
    
    // Wait for processing to begin
    await harness.waitForLLMRequest(2000);
    
    // Send force quit command (assuming --force or similar flag)
    await harness.sendCommand('quit --force');
    
    // Assert application exits immediately without waiting for processing
    await harness.assertExitCode(0, 3000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
    
    // Verify that processing was interrupted (request was made but not completed)
    harness.assertMockRequestCount(1);
  }, 20000);

  /**
   * Test quit command using scenario configuration files
   * Requirements: 5.1, 5.2, 5.3, 5.4 - Test all quit scenarios using configuration-driven approach
   */
  test('quit in idle state using scenario configuration', async () => {
    const scenario = await scenarioRunner.loadScenarioFromFile('./tests/e2e/scenarios/quit-idle-state.json');
    const result = await scenarioRunner.executeScenario(scenario);
    
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.stepResults.every(step => step.success)).toBe(true);
    expect(result.assertionResults.every(assertion => assertion.success)).toBe(true);
  }, 15000);

  /**
   * Test quit during processing using scenario configuration
   * Requirements: 5.2 - Test quit during LLM processing using configuration-driven approach
   */
  test('quit during processing using scenario configuration', async () => {
    const scenario = await scenarioRunner.loadScenarioFromFile('./tests/e2e/scenarios/quit-during-processing.json');
    const result = await scenarioRunner.executeScenario(scenario);
    
    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.stepResults.every(step => step.success)).toBe(true);
    expect(result.assertionResults.every(assertion => assertion.success)).toBe(true);
  }, 20000);

  /**
   * Test edge case: multiple quit commands
   * Requirements: 5.1 - Ensure quit command is idempotent and handles multiple calls gracefully
   */
  test('multiple quit commands are handled gracefully', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(3000);
    
    // Send first quit command
    await harness.sendCommand('quit');
    
    // Try to send second quit command quickly (should be ignored or handled gracefully)
    try {
      await harness.sendCommand('quit');
    } catch (error) {
      // Expected - application may have already exited
    }
    
    // Assert application exits cleanly
    await harness.assertExitCode(0, 5000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
  }, 15000);

  /**
   * Test quit command with invalid arguments
   * Requirements: 5.4 - Test quit command argument validation
   */
  test('quit command with invalid arguments shows help', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(3000);
    
    // Send quit command with invalid argument
    await harness.sendCommand('quit --invalid-flag');
    
    // Wait for help text or error message
    await harness.waitForUIText('usage', 2000);
    
    // Application should still be running after invalid command
    harness.assertProcessState(true);
    
    // Send proper quit command
    await harness.sendCommand('quit');
    
    // Assert application exits cleanly
    await harness.assertExitCode(0, 5000);
  }, 15000);
});
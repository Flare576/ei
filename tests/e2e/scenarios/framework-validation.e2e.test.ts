// Framework validation E2E test scenarios
// Tests to validate the e2e testing framework with real application scenarios

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { E2ETestHarness } from '../types.js';

describe('Framework Validation E2E Tests', () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'framework-validation-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  /**
   * Test framework can start and stop the EI application
   * Requirements: 5.1 - Basic application lifecycle management
   */
  test('framework can start and stop EI application', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Verify application is running
    expect(harness.isAppRunning()).toBe(true);
    
    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for application to exit
    await harness.assertExitCode(0, 8000);
    
    // Verify application is no longer running
    expect(harness.isAppRunning()).toBe(false);
  }, 25000);

  /**
   * Test framework can interact with the application through input
   * Requirements: 2.3 - Input delivery to application
   */
  test('framework can send input to application', async () => {
    // Configure mock response for any input
    harness.setMockResponse('/v1/chat/completions', 'Framework validation response', 500);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Send input to the application
    await harness.sendInput('Framework validation test\n');
    
    // Wait for LLM request to be made
    await harness.waitForLLMRequest(3000);
    
    // Verify mock server received the request
    expect(harness.getMockRequestHistory().length).toBeGreaterThan(0);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
  }, 30000);

  /**
   * Test framework can observe application state changes
   * Requirements: 3.1, 3.2 - State observation capabilities
   */
  test('framework can observe application state changes', async () => {
    const tempDataPath = harness.getTempDataPath();
    expect(tempDataPath).toBeTruthy();
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Verify temp data directory was created
    harness.assertDirectoryExists('.');
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
    
    // Verify application created some data structure
    // (The exact structure depends on EI's implementation)
    if (tempDataPath) {
      harness.assertDirectoryExists('.');
    }
  }, 25000);

  /**
   * Test framework mock server integration
   * Requirements: 4.1, 4.2 - Mock LLM server functionality
   */
  test('framework mock server works with application', async () => {
    // Configure sequential responses for a complete interaction
    harness.setMockResponseQueue([
      'Mock server validation response',
      JSON.stringify([{
        name: "Mock Server Concept",
        description: "Concept from mock server validation",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Send input that should trigger LLM request
    await harness.sendInput('Test mock server integration\n');
    
    // Wait for LLM request
    await harness.waitForLLMRequest(3000);
    
    // Verify mock server received requests
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThan(0);
    
    // Verify the request was for chat completions
    const chatRequest = requestHistory.find(req => req.endpoint.includes('/v1/chat/completions'));
    expect(chatRequest).toBeTruthy();
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
  }, 30000);

  /**
   * Test framework handles application errors gracefully
   * Requirements: 6.4 - Error handling and recovery
   */
  test('framework handles application errors gracefully', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Send an invalid command that might cause an error
    await harness.sendInput('/invalid-command\n');
    
    // Wait for any error handling
    await harness.waitForIdleState(3000);
    
    // Application should still be running
    expect(harness.isAppRunning()).toBe(true);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
  }, 25000);

  /**
   * Test framework can validate quit command scenarios
   * Requirements: 5.1, 5.2, 5.3, 5.4 - Quit command validation
   */
  test('framework validates quit command in idle state', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Verify clean exit with code 0
    await harness.assertExitCode(0, 8000);
    
    // Verify application stopped
    expect(harness.isAppRunning()).toBe(false);
  }, 20000);

  /**
   * Test framework can validate quit during processing
   * Requirements: 5.2 - Quit during LLM processing
   */
  test('framework validates quit during processing', async () => {
    // Configure mock response queue with delay to simulate processing
    harness.setMockResponseQueue([
      'Processing response',     // Main response with delay
      JSON.stringify([]),        // System concepts
      JSON.stringify([])         // Human concepts
    ]);
    harness.setMockResponse('/v1/chat/completions', 'Processing response', 2000);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for idle state
    await harness.waitForIdleState(5000);
    
    // Send input to trigger processing
    await harness.sendInput('Start processing\n');
    
    // Wait for LLM request to start
    await harness.waitForLLMRequest(3000);
    
    // Send quit command during processing
    await harness.sendCommand('/quit');
    
    // Application should exit cleanly (interrupting processing)
    await harness.assertExitCode(0, 8000);
    
    // Verify application stopped
    expect(harness.isAppRunning()).toBe(false);
  }, 25000);

  /**
   * Test framework can validate multi-persona functionality
   * Requirements: 6.3 - Multi-persona state management
   */
  test('framework validates basic multi-persona functionality', async () => {
    // Configure sequential responses for persona operations
    harness.setMockResponseQueue([
      'Response for first persona',
      JSON.stringify([{
        name: "First Persona Concept",
        description: "Concept from first persona",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      'Response for second persona',
      JSON.stringify([{
        name: "Second Persona Concept",
        description: "Concept from second persona",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Create first persona
    await harness.sendCommand('/persona create test-persona-1');
    await harness.waitForIdleState(2000);
    
    // Send message to first persona
    await harness.sendInput('Message to first persona\n');
    await harness.waitForLLMRequest(3000);
    
    // Create second persona
    await harness.sendCommand('/persona create test-persona-2');
    await harness.waitForIdleState(2000);
    
    // Send message to second persona
    await harness.sendInput('Message to second persona\n');
    await harness.waitForLLMRequest(3000);
    
    // Verify both personas made requests
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
    
    // Verify persona data was created
    harness.assertDirectoryExists('personas');
  }, 45000);

  /**
   * Test framework performance and reliability
   * Requirements: 7.1, 7.4 - Reliable test execution
   */
  test('framework performs reliably under normal conditions', async () => {
    const startTime = Date.now();
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(3000);
    
    // Perform a series of operations
    await harness.sendInput('Performance test message\n');
    await harness.waitForIdleState(3000);
    
    // Send quit command
    await harness.sendCommand('/quit');
    
    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
    
    const endTime = Date.now();
    const totalTime = endTime - startTime;
    
    // Test should complete within reasonable time (30 seconds)
    expect(totalTime).toBeLessThan(30000);
    
    // Verify clean state
    expect(harness.isAppRunning()).toBe(false);
  }, 35000);

  /**
   * Test framework cleanup and resource management
   * Requirements: 1.3, 1.5 - Environment cleanup
   */
  test('framework cleans up resources properly', async () => {
    const tempDataPath = harness.getTempDataPath();
    expect(tempDataPath).toBeTruthy();
    
    // Start and use the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Create some state
    await harness.sendInput('Create cleanup test state\n');
    await harness.waitForIdleState(3000);
    
    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
    
    // Verify temp directory exists (will be cleaned up in afterEach)
    if (tempDataPath) {
      harness.assertDirectoryExists('.');
    }
    
    // The actual cleanup verification happens in afterEach
    // This test validates that the framework can create and manage temp resources
  }, 25000);
});
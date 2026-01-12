// Simple Metrics Test - Copy of working test to isolate the issue
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Simple Metrics Test', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'simple-metrics-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('basic metrics functionality test', async () => {
    console.log('=== Testing basic metrics functionality ===');
    
    // Setup mock responses for the 3-4 LLM calls per message
    // Remember: Each message triggers response + system concepts + human concepts (+ optional 4th call)
    harness.setMockResponseQueue([
      'Hello! I received your test message successfully. This response demonstrates the complete E2E testing flow.',
      JSON.stringify([{
        name: "E2E Test System Concept",
        description: "A concept created during E2E testing to verify system concept updates",
        level_current: 0.7,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([{
        name: "E2E Test Human Concept", 
        description: "A concept about the human user during E2E testing",
        level_current: 0.6,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "dynamic"
      }])
    ]);

    console.log('Mock responses configured for 3 LLM calls per message');

    // Start the application with both test input and output systems enabled
    // EI_TEST_INPUT=true enables input injection
    // EI_TEST_OUTPUT=true enables blessed output capture
    await harness.startApp({ 
      debugMode: true, 
      usePty: false  // Use regular spawn for reliable input injection
    });

    console.log('Application started with test input and output systems enabled');

    // Wait for application to initialize completely
    await harness.waitForIdleState(8000);
    console.log('Application initialization complete');

    // Verify application is running
    expect(harness.isAppRunning()).toBe(true);

    // Send a message >30 characters to trigger immediate processing (no debounce delay)
    const testMessage = 'This is a comprehensive test message that exceeds the thirty character threshold for immediate processing';
    console.log(`Sending test message: "${testMessage}"`);
    
    await harness.sendInput(`${testMessage}\n`);

    // Wait for LLM processing to begin
    console.log('Waiting for LLM request...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ LLM request detected - input injection working!');

    // Wait for all LLM calls to complete (response + concept updates)
    console.log('Waiting for all LLM processing to complete...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Verify we got the expected number of LLM requests (3-4 per message)
    const requestHistory = harness.getMockRequestHistory();
    console.log(`Total LLM requests made: ${requestHistory.length}`);
    expect(requestHistory.length).toBeGreaterThanOrEqual(3);
    expect(requestHistory.length).toBeLessThanOrEqual(4);

    // Verify the test output capture system is working
    console.log('Verifying output capture system...');
    const currentOutput = await harness.getCurrentOutput();
    const captureMessages = currentOutput.split('\n').filter(line => line.includes('[TestOutputCapture]'));
    console.log(`Found ${captureMessages.length} output capture messages`);
    expect(captureMessages.length).toBeGreaterThan(0);
    console.log('✓ Output capture system working - capturing UI updates');

    // Verify user input appears in captured output
    const hasUserMessage = currentOutput.includes(testMessage.slice(0, 30)); // Check first part of message
    console.log('User message captured in output:', hasUserMessage);
    expect(hasUserMessage).toBe(true);
    console.log('✓ User input successfully captured in UI output');

    // Test clean shutdown
    console.log('Testing clean shutdown...');
    await harness.sendCommand('/quit');

    // Wait for graceful exit
    await harness.assertExitCode(0, 8000);
    console.log('✓ Application exited cleanly with code 0');

    // Final verification that application stopped
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application fully stopped');

    console.log('=== Simple Metrics Test Complete ===');
    
  }, 60000); // 60 second timeout for complete flow
});
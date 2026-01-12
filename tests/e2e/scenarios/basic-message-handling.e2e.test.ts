// Basic Message Handling E2E Test
// Demonstrates complete E2E testing infrastructure: input injection + output capture + mock LLM
// This test serves as a proof-of-concept that all test systems work together reliably

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Basic Message Handling E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'basic-message-handling-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('application handles message input and output correctly', async () => {
    console.log('=== Testing complete E2E infrastructure ===');
    
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

    // Verify the complete message flow worked
    console.log('Verifying complete message processing flow...');
    
    // Check that persona data was created/updated
    harness.assertDirectoryExists('personas');
    harness.assertDirectoryExists('personas/ei');
    console.log('✓ Persona data directories created');

    // Verify application is still running and responsive
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains running and responsive');

    // Test clean shutdown
    console.log('Testing clean shutdown...');
    await harness.sendCommand('/quit');

    // Wait for graceful exit
    try {
      await harness.assertExitCode(0, 8000);
      console.log('✓ Application exited cleanly with code 0');
    } catch (error) {
      console.log('Exit timeout - application may still be processing');
      
      // Check if still running
      if (harness.isAppRunning()) {
        console.log('Application still running, forcing cleanup...');
      }
      
      throw error;
    }

    // Final verification that application stopped
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application fully stopped');

    console.log('=== E2E Infrastructure Test Complete ===');
    console.log('✓ Input injection system working');
    console.log('✓ Output capture system working'); 
    console.log('✓ Mock LLM system working');
    console.log('✓ Complete message processing flow verified');
    console.log('✓ Clean startup and shutdown verified');
    
  }, 60000); // 60 second timeout for complete flow

  test('output capture system detects multiple UI updates', async () => {
    console.log('=== Testing output capture with multiple UI updates ===');
    
    // Setup responses for multiple messages
    harness.setMockResponseQueue([
      // First message responses
      'First response from the assistant.',
      JSON.stringify([{ name: "First Concept", description: "First test concept", level_current: 0.5, level_ideal: 0.8, level_elasticity: 0.3, type: "static" }]),
      JSON.stringify([]),
      // Second message responses  
      'Second response from the assistant.',
      JSON.stringify([{ name: "Second Concept", description: "Second test concept", level_current: 0.6, level_ideal: 0.9, level_elasticity: 0.2, type: "static" }]),
      JSON.stringify([])
    ]);

    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);

    // Get initial capture count
    const initialOutput = await harness.getCurrentOutput();
    const initialCaptureCount = initialOutput.split('\n').filter(line => line.includes('[TestOutputCapture]')).length;
    console.log('Initial capture messages:', initialCaptureCount);

    // Send first message
    const firstMessage = 'First test message that is long enough to avoid debouncing';
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Check capture count after first message
    const afterFirst = await harness.getCurrentOutput();
    const firstCaptureCount = afterFirst.split('\n').filter(line => line.includes('[TestOutputCapture]')).length;
    console.log('Capture messages after first:', firstCaptureCount);
    expect(firstCaptureCount).toBeGreaterThan(initialCaptureCount);

    // Send second message
    const secondMessage = 'Second test message that is also long enough to avoid debouncing';
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Check capture count after second message
    const afterSecond = await harness.getCurrentOutput();
    const secondCaptureCount = afterSecond.split('\n').filter(line => line.includes('[TestOutputCapture]')).length;
    console.log('Capture messages after second:', secondCaptureCount);
    expect(secondCaptureCount).toBeGreaterThan(firstCaptureCount);

    // Verify we got expected number of requests (6 total: 3 per message)
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(6);
    console.log(`✓ Received ${requestHistory.length} LLM requests as expected`);

    // Verify output capture system detected multiple updates
    console.log(`Found ${secondCaptureCount} total output capture messages`);
    expect(secondCaptureCount).toBeGreaterThan(10); // Should have many UI updates
    console.log('✓ Output capture system detected multiple UI updates');

    // Clean shutdown
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
    
    console.log('✓ Multiple UI updates test complete');
    
  }, 60000);

  test('error handling with output capture', async () => {
    console.log('=== Testing error handling with output capture ===');
    
    // Setup responses that will cause processing errors but valid concept responses
    harness.setMockResponseQueue([
      'Error: This is a simulated error response',  // This should still be displayed
      JSON.stringify([]),  // Empty system concepts
      JSON.stringify([])   // Empty human concepts
    ]);

    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);

    // Send message that will trigger error response
    const errorMessage = 'This message will receive an error response but should still be handled gracefully';
    await harness.sendInput(`${errorMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Verify error message input was captured
    const currentOutput = await harness.getCurrentOutput();
    const hasErrorMessage = currentOutput.includes(errorMessage.slice(0, 30));
    console.log('Error message input captured:', hasErrorMessage);
    expect(hasErrorMessage).toBe(true);
    console.log('✓ Error message input successfully captured');

    // Verify application is still running despite error
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable after error response');

    // Verify we still got the expected LLM requests
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(3);
    console.log(`✓ Received ${requestHistory.length} LLM requests despite error`);

    // Verify output capture system is still working
    const captureMessages = currentOutput.split('\n').filter(line => line.includes('[TestOutputCapture]'));
    console.log(`Found ${captureMessages.length} output capture messages`);
    expect(captureMessages.length).toBeGreaterThan(0);
    console.log('✓ Output capture system continues working after error');

    // Clean shutdown
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
    
    console.log('✓ Error handling test complete');
    
  }, 45000);
});
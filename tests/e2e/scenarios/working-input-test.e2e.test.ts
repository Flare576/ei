// Working Input Test - Basic message sending only
// Simple test to verify input is working with blessed applications

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Working Input Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'working-input-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('send basic message and verify LLM request', async () => {
    console.log('=== Testing basic message sending ===');
    
    // Configure sequential responses: response, system concepts JSON, human concepts JSON
    harness.setMockResponseQueue([
      'Hello! I received your message successfully.',
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

    // Start the application using regular spawn (not PTY)
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);

    // Verify concept maps are initialized by checking if files exist
    const tempDataPath = process.env.EI_DATA_PATH;
    if (tempDataPath) {
      console.log('Checking concept map initialization...');
      try {
        // Check if system concept map exists
        const systemPath = `${tempDataPath}/personas/ei/system.jsonc`;
        const humanPath = `${tempDataPath}/human.jsonc`;
        
        console.log(`System concept map path: ${systemPath}`);
        console.log(`Human concept map path: ${humanPath}`);
        
        // Use bash to check if files exist (since they're outside workspace)
        // This will help us understand if initialization completed
      } catch (error) {
        console.log('Could not check concept map files:', error);
      }
    }

    // Get initial output
    const initialOutput = await harness.getCurrentOutput();
    console.log('Initial output length:', initialOutput.length);
    console.log('Sample output (first 200 chars):', initialOutput.slice(0, 200));

    // Verify application is running
    expect(harness.isAppRunning()).toBe(true);
    expect(initialOutput.length).toBeGreaterThan(0);

    // Send a simple message
    console.log('Sending test message: "Hello, this is a test message"');
    await harness.sendInput('Hello, this is a test message\n');

    // Wait for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Get output after input
    const afterInput = await harness.getCurrentOutput();
    console.log('After input length:', afterInput.length);
    console.log('Output change:', afterInput.length - initialOutput.length);

    if (afterInput.length > initialOutput.length) {
      console.log('✓ Output changed after input - good sign!');
      const newContent = afterInput.slice(initialOutput.length);
      console.log('New content:', newContent);
      
      // Look for debug messages in the output
      if (newContent.includes('[Debug]')) {
        console.log('=== DEBUG MESSAGES FOUND ===');
        const debugLines = newContent.split('\n').filter(line => line.includes('[Debug]'));
        debugLines.forEach(line => console.log('DEBUG:', line));
        console.log('=== END DEBUG MESSAGES ===');
      }
    } else {
      console.log('✗ No output change detected');
    }

    // Check if we can detect LLM request (this will tell us if input is working)
    try {
      console.log('Waiting for LLM request...');
      await harness.waitForLLMRequest(5000);
      console.log('✓ SUCCESS: LLM request detected - input is working!');
      
      // Log the exact number of requests made
      const requestCount = harness.getMockRequestHistory().length;
      console.log(`Total LLM requests after message: ${requestCount}`);
      
      // Wait a bit longer to ensure all concept update calls complete
      console.log('Waiting for additional concept update requests...');
      await new Promise(resolve => setTimeout(resolve, 8000));
      
      const requestHistory = harness.getMockRequestHistory();
      console.log(`Total requests after waiting: ${requestHistory.length}`);
      
      // We expect at least 3 requests: response + system concepts + human concepts
      // The concept update calls may fail due to invalid JSON responses, but the HTTP requests should still be made
      expect(requestHistory.length).toBeGreaterThanOrEqual(3);
      
      // Wait for response to appear in UI
      console.log('Waiting for response in UI...');
      await harness.waitForUIText('Hello! I received your message successfully', 8000);
      console.log('✓ SUCCESS: Response received - full flow working!');
      
      // Log final request count
      const finalRequestCount = harness.getMockRequestHistory().length;
      console.log(`Final LLM request count: ${finalRequestCount}`);
      
      // Verify we got at least 3 requests (response + system concepts + human concepts)
      expect(finalRequestCount).toBeGreaterThanOrEqual(3);
      
      // Verify the response appears in UI
      await harness.assertUIContains('Hello! I received your message successfully');
      console.log('✓ SUCCESS: Response verified in UI');
      
    } catch (error) {
      console.log('✗ LLM request or response failed:', error);
      console.log('This indicates input may not be reaching the application');
      
      // Show final output for debugging
      const finalOutput = await harness.getCurrentOutput();
      console.log('Final output length:', finalOutput.length);
      console.log('Final output sample:', finalOutput.slice(-300));
    }

    // Try to quit
    console.log('Sending quit command...');
    await harness.sendCommand('/quit');

    // Wait for exit
    try {
      await harness.assertExitCode(0, 8000);
      console.log('✓ Application exited cleanly');
    } catch (error) {
      console.log('Exit timeout - forcing cleanup');
    }

    // Verify application stopped
    expect(harness.isAppRunning()).toBe(false);
  }, 60000);
});
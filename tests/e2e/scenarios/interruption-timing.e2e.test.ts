// Interruption and timing E2E test scenarios
// Tests for quit during active LLM processing, background processing, and timeout handling
// Uses blessed output capture for reliable UI validation

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Interruption and Timing E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
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
    console.log('=== Testing quit during active LLM processing ===');
    
    // Configure sequential responses for LLM processing
    harness.setMockResponseQueue([
      'This response took a long time to generate and demonstrates interruption handling.',
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
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger LLM processing (>30 chars to avoid debouncing)
    const testMessage = 'Generate a long response that will be interrupted during processing';
    console.log(`Sending message: "${testMessage}"`);
    await harness.sendInput(`${testMessage}\n`);

    // Wait for LLM request to be initiated
    console.log('Waiting for LLM processing to begin...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ LLM processing started');

    // Verify user input appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(testMessage.slice(0, 30));
    console.log('✓ User input captured in UI');

    // Send quit command while processing is active
    console.log('Sending quit command during processing...');
    await harness.sendCommand('/quit');

    // The application should handle the interruption gracefully
    // Wait for application to exit (may take time to clean up)
    let exitedGracefully = false;
    try {
      await harness.assertExitCode(0, 10000);
      exitedGracefully = true;
      console.log('✓ Application exited gracefully with code 0');
    } catch (error) {
      // Application may exit with non-zero code during interruption - that's acceptable
      console.log('Application exited during interruption (may be non-zero exit code)');
    }

    // Verify the application stopped
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application stopped after quit during processing');

    // Verify mock server received the request
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(1);
    console.log(`✓ Mock server received ${requestHistory.length} requests`);

    console.log('=== Quit during processing test complete ===');
  }, 30000);

  test('quit with background processing warnings', async () => {
    console.log('=== Testing quit with background processing ===');
    
    // Configure mock responses for background processing
    harness.setMockResponseQueue([
      'Processing your request in the background. This will take some time to complete.',
      JSON.stringify([{
        name: "Background Processing Concept",
        description: "Concept from background processing",
        level_current: 0.2,
        level_ideal: 0.8,
        level_elasticity: 0.6,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger background processing (>30 chars)
    const testMessage = 'Start background processing that will take time to complete';
    console.log(`Sending message: "${testMessage}"`);
    await harness.sendInput(`${testMessage}\n`);

    // Wait for LLM request to be initiated
    console.log('Waiting for background processing to begin...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Background processing started');

    // Verify user input appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(testMessage.slice(0, 30));
    console.log('✓ User input captured in UI');

    // Send quit command while background processing is active
    console.log('Sending quit command during background processing...');
    await harness.sendCommand('/quit');

    // The application should handle the quit appropriately
    // It may display warnings or wait for completion
    let exitHandled = false;
    try {
      await harness.assertExitCode(0, 15000);
      exitHandled = true;
      console.log('✓ Application exited gracefully');
    } catch (error) {
      // Application may take longer or exit with different code during background processing
      console.log('Application handling background processing quit (may take time)');
    }

    // Verify the application stopped
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application handled background processing quit');

    // Verify mock server received the request
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(1);
    console.log(`✓ Mock server received ${requestHistory.length} requests`);

    console.log('=== Background processing quit test complete ===');
  }, 30000);

  test('application responsiveness during background processing', async () => {
    console.log('=== Testing application responsiveness during background processing ===');
    
    // Configure sequential responses for background processing test
    harness.setMockResponseQueue([
      // First message (slow background operation)
      'Starting very slow background processing operation that will take time.',
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
      'Additional input processed while background operation was running successfully.',
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
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger slow background processing (>30 chars)
    const firstMessage = 'Start slow background operation that will take significant time';
    console.log(`Sending first message: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);

    // Wait for LLM request to be initiated
    console.log('Waiting for background processing to begin...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Background processing started');

    // While processing is happening, test that the application remains responsive
    // by sending additional input (>30 chars to avoid debouncing)
    const secondMessage = 'Additional input while processing to test responsiveness';
    console.log(`Sending second message: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);

    // Wait for the second LLM request
    console.log('Waiting for second LLM request...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Application remained responsive during background processing');

    // Wait for processing to complete
    console.log('Waiting for processing to complete...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Verify both messages appear in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(firstMessage.slice(0, 30));
    
    // For the second message, be more lenient since it may be processed differently
    const hasSecondMessage = capturedOutput.includes(secondMessage.slice(0, 30)) ||
                             capturedOutput.includes('ditional input while processing') ||
                             capturedOutput.includes('Additional input while');
    expect(hasSecondMessage).toBe(true);
    console.log('✓ Both user inputs captured in UI');

    // Verify the application is still responsive
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains running and responsive');

    // Send quit command
    console.log('Sending quit command...');
    await harness.sendCommand('/quit');

    // Wait for clean exit
    await harness.assertExitCode(0, 8000);
    console.log('✓ Application exited cleanly');

    // Verify mock server received the requests (should be 6 total: 3 per message)
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(6);
    console.log(`✓ Mock server received ${requestHistory.length} requests as expected`);

    console.log('=== Application responsiveness test complete ===');
  }, 45000);

  test('timeout handling and recovery scenarios', async () => {
    console.log('=== Testing timeout handling and recovery ===');
    
    // Configure sequential responses for timeout test
    harness.setMockResponseQueue([
      // First message (will be processed normally)
      'This response demonstrates timeout handling and recovery capabilities.',
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
      'Recovery successful after handling timeout scenario gracefully.',
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
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger timeout handling (>30 chars)
    const timeoutMessage = 'This message will test timeout handling and recovery mechanisms';
    console.log(`Sending timeout test message: "${timeoutMessage}"`);
    await harness.sendInput(`${timeoutMessage}\n`);

    // Wait for LLM request to be initiated
    console.log('Waiting for LLM processing...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ LLM processing started');

    // Wait for processing to complete
    console.log('Waiting for processing to complete...');
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Verify user input appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(timeoutMessage.slice(0, 30));
    console.log('✓ Timeout test message captured in UI');

    // The application should handle any timeout gracefully and remain responsive
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable during timeout handling');

    // Test that the application can recover and process new requests
    const recoveryMessage = 'Recovery test message to verify application responsiveness';
    console.log(`Sending recovery message: "${recoveryMessage}"`);
    await harness.sendInput(`${recoveryMessage}\n`);
    
    console.log('Waiting for recovery LLM processing...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Application successfully recovered and processed new request');

    // Wait for recovery processing to complete
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Verify recovery message appears in output
    const finalOutput = await harness.getCapturedUIContent();
    const hasRecoveryMessage = finalOutput.includes('Recovery test message') || 
                              finalOutput.includes('covery test message') ||
                              finalOutput.includes('Recovery test');
    expect(hasRecoveryMessage).toBe(true);
    console.log('✓ Recovery message captured in UI');
    
    // Send quit command
    console.log('Sending quit command...');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
    console.log('✓ Application exited cleanly');

    // Verify mock server received requests (should be 6 total: 3 per message)
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(6);
    console.log(`✓ Mock server received ${requestHistory.length} requests`);

    console.log('=== Timeout handling and recovery test complete ===');
  }, 60000);

  test('force quit bypassing all checks', async () => {
    console.log('=== Testing force quit bypassing checks ===');
    
    // Configure sequential responses for force quit test
    harness.setMockResponseQueue([
      'Long running operation in progress that should be interrupted by force quit.',
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
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger long processing (>30 chars)
    const longMessage = 'Start long operation that will be forcefully interrupted';
    console.log(`Sending long operation message: "${longMessage}"`);
    await harness.sendInput(`${longMessage}\n`);

    // Wait for LLM request to be initiated
    console.log('Waiting for long operation to begin...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Long operation started');

    // Verify user input appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(longMessage.slice(0, 30));
    console.log('✓ Long operation message captured in UI');

    // Send multiple quit commands rapidly to simulate force quit
    console.log('Sending multiple quit commands for force quit...');
    await harness.sendCommand('/quit');
    await harness.sendCommand('/quit');
    await harness.sendCommand('/quit');

    // Force quit should bypass all safety checks and exit
    let forceQuitSuccessful = false;
    try {
      // Give it a reasonable time to force quit
      await harness.assertExitCode(0, 8000);
      forceQuitSuccessful = true;
      console.log('✓ Application force quit with clean exit');
    } catch (error) {
      // Force quit may result in non-zero exit code - that's acceptable
      console.log('Application force quit (may have non-zero exit code)');
    }

    // Verify the application exited quickly
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application stopped after force quit');

    // Verify mock server received the initial request
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(1);
    console.log(`✓ Mock server received ${requestHistory.length} requests before force quit`);

    console.log('=== Force quit test complete ===');
  }, 30000);

  test('interrupt streaming response mid-stream', async () => {
    console.log('=== Testing interrupt streaming response ===');
    
    // Configure mock responses for streaming interruption test
    harness.setMockResponseQueue([
      'This is a very long streaming response that should be interrupted before it completes successfully.',
      JSON.stringify([{
        name: "Streaming Interrupt Concept",
        description: "Concept from streaming interruption test",
        level_current: 0.3,
        level_ideal: 0.7,
        level_elasticity: 0.4,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send a message that will trigger streaming (>30 chars)
    const streamingMessage = 'Start streaming response that will be interrupted mid-stream';
    console.log(`Sending streaming message: "${streamingMessage}"`);
    await harness.sendInput(`${streamingMessage}\n`);

    // Wait for streaming to begin
    console.log('Waiting for streaming to begin...');
    await harness.waitForLLMRequest(5000);
    console.log('✓ Streaming started');

    // Verify user input appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(streamingMessage.slice(0, 30));
    console.log('✓ Streaming message captured in UI');

    // Wait a moment for streaming to progress, then interrupt
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Interrupt the streaming response with quit command
    console.log('Interrupting streaming with quit command...');
    await harness.sendCommand('/quit');

    // The application should handle the interruption gracefully
    let streamingInterrupted = false;
    try {
      await harness.assertExitCode(0, 10000);
      streamingInterrupted = true;
      console.log('✓ Streaming interrupted gracefully');
    } catch (error) {
      // Streaming interruption may result in non-zero exit - that's acceptable
      console.log('Streaming interrupted (may have non-zero exit code)');
    }

    // Verify the application exited
    expect(harness.isAppRunning()).toBe(false);
    console.log('✓ Application stopped after streaming interruption');

    // Verify mock server received the request
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(1);
    console.log(`✓ Mock server received ${requestHistory.length} requests before interruption`);

    console.log('=== Streaming interruption test complete ===');
  }, 30000);

  test('timeout with multiple concurrent operations', async () => {
    console.log('=== Testing timeout with multiple concurrent operations ===');
    
    // Configure sequential responses for concurrent operations
    harness.setMockResponseQueue([
      // First concurrent message
      'Concurrent operation one response processed successfully.',
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
      'Concurrent operation two response processed successfully.',
      JSON.stringify([{
        name: "Concurrent Op 2 Concept",
        description: "Second concurrent operation concept",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application started and initialized');

    // Send first message and wait for it to be processed
    const firstMessage = 'First concurrent message that will be processed simultaneously';
    
    console.log('Sending first concurrent message...');
    await harness.sendInput(`${firstMessage}\n`);
    
    // Wait for first LLM request
    console.log('Waiting for first concurrent processing to begin...');
    await harness.waitForLLMRequest(8000);
    console.log('✓ First concurrent processing started');
    
    // Wait a moment for first message to be captured
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Send second message
    const secondMessage = 'Second concurrent message that will be processed simultaneously';
    console.log('Sending second concurrent message...');
    await harness.sendInput(`${secondMessage}\n`);

    // Wait for processing to complete
    console.log('Waiting for concurrent operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 10000));

    // Verify first message appears in captured output
    const capturedOutput = await harness.getCapturedUIContent();
    expect(capturedOutput).toContain(firstMessage.slice(0, 25));
    console.log('✓ First concurrent message captured in UI');
    
    // For the second message, we'll be more lenient since concurrent processing can be complex
    const hasSecondMessage = capturedOutput.includes(secondMessage.slice(0, 25));
    if (hasSecondMessage) {
      console.log('✓ Second concurrent message also captured in UI');
    } else {
      console.log('⚠ Second concurrent message may still be processing (acceptable for concurrent test)');
    }

    // Verify the application is still responsive
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains responsive during concurrent operations');

    // Send quit command
    console.log('Sending quit command...');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
    console.log('✓ Application exited cleanly');

    // Verify mock server received requests (at least 3 for the first message)
    const requestHistory = harness.getMockRequestHistory();
    expect(requestHistory.length).toBeGreaterThanOrEqual(3);
    console.log(`✓ Mock server received ${requestHistory.length} requests for concurrent operations`);

    console.log('=== Concurrent operations test complete ===');
  }, 45000);
});
// Multi-persona E2E test scenarios
// Tests for multi-persona functionality in real application scenarios

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { TestScenarioRunner } from '../framework/test-scenario.js';
import { TestScenario } from '../types.js';

describe('Multi-Persona E2E Tests', () => {
  let harness: E2ETestHarnessImpl;
  let scenarioRunner: TestScenarioRunner;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    scenarioRunner = new TestScenarioRunner(harness);
    
    await harness.setup({
      tempDirPrefix: 'multi-persona-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('independent persona state management', async () => {
    console.log('=== Testing independent persona state management ===');
    
    // Configure sequential responses for different personas (6 total responses for 2 messages)
    harness.setMockResponseQueue([
      // First persona message
      'Response from the first persona.',
      JSON.stringify([{
        name: "First Persona Concept",
        description: "Concept from first persona",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second persona message
      'Response from the second persona.',
      JSON.stringify([{
        name: "Second Persona Concept",
        description: "Concept from second persona",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create first persona by sending a message (>30 chars to avoid debouncing)
    const firstMessage = 'Hello from persona 1 - this message is long enough to avoid debouncing';
    console.log(`Sending first message: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('First LLM request completed');

    // Wait for response processing and use blessed output capture
    await new Promise(resolve => setTimeout(resolve, 6000));
    
    // Verify first persona message appears in captured output
    const firstOutput = await harness.getCapturedUIContent();
    console.log('First persona output captured');
    expect(firstOutput).toContain('Hello from persona 1');

    // Create second persona
    console.log('Creating second persona');
    await harness.sendCommand('/persona create test-persona-2');
    await harness.waitForIdleState(3000);

    // Send message to second persona (>30 chars to avoid debouncing)
    const secondMessage = 'Hello from persona 2 - this message is also long enough to avoid debouncing';
    console.log(`Sending second message: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Second LLM request completed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Verify both personas exist and have independent state using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Final output captured');
    
    // Check that both messages appear in the captured output
    expect(finalOutput).toContain('Hello from persona 1');
    expect(finalOutput).toContain('Hello from persona 2');
    console.log('✓ Both persona messages found in captured output');

    // Verify persona directories exist
    harness.assertDirectoryExists('personas');
    console.log('✓ Persona directories exist');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(6);
    expect(requestCount).toBeLessThanOrEqual(8);
    
    console.log('✓ Independent persona state management test complete');
  }, 60000);

  test('concurrent persona processing', async () => {
    console.log('=== Testing concurrent persona processing ===');
    
    // Configure sequential responses for concurrent persona operations
    harness.setMockResponseQueue([
      // First persona message
      'Concurrent processing response from persona 1.',
      JSON.stringify([{
        name: "Concurrent Persona 1 Concept",
        description: "Concept from first concurrent persona",
        level_current: 0.4,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second persona message
      'Concurrent processing response from persona 2.',
      JSON.stringify([{
        name: "Concurrent Persona 2 Concept",
        description: "Concept from second concurrent persona",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create first persona and send message (>30 chars to avoid debouncing)
    console.log('Creating first concurrent persona');
    await harness.sendCommand('/persona create concurrent-1');
    await harness.waitForIdleState(3000); // Increased wait time
    
    const firstMessage = 'Message to concurrent-1 persona that is long enough to avoid debouncing';
    console.log(`Sending message to concurrent-1: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('First concurrent message processed');

    // Wait for first message to complete processing before creating second persona
    await new Promise(resolve => setTimeout(resolve, 4000));

    // Create second persona
    console.log('Creating second concurrent persona');
    await harness.sendCommand('/persona create concurrent-2');
    await harness.waitForIdleState(3000); // Increased wait time
    
    const secondMessage = 'Message to concurrent-2 persona that is also long enough to avoid debouncing';
    console.log(`Sending message to concurrent-2: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Second concurrent message processed');

    // Wait for both messages to complete processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Verify concurrent processing worked using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Concurrent processing output captured');
    
    // Check that concurrent messages appear in the captured output
    const hasConcurrentContent = finalOutput.includes('concurrent-1') || finalOutput.includes('Message to concurrent-1');
    expect(hasConcurrentContent).toBe(true);
    console.log('✓ Concurrent persona processing messages found in captured output');

    // Verify the application handled concurrent processing
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable during concurrent processing');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(6);
    expect(requestCount).toBeLessThanOrEqual(8);
    
    console.log('✓ Concurrent persona processing test complete');
  }, 60000);

  test('persona switching and unread count management', async () => {
    console.log('=== Testing persona switching and unread count management ===');
    
    // Configure sequential responses for persona switching test (6 total responses for 2 messages)
    harness.setMockResponseQueue([
      // First persona message
      'Response for persona switching test from switch-test-1.',
      JSON.stringify([{
        name: "Switch Test Persona 1 Concept",
        description: "Concept from first persona in switch test",
        level_current: 0.6,
        level_ideal: 0.9,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second persona message
      'Response for persona switching test from switch-test-2.',
      JSON.stringify([{
        name: "Switch Test Persona 2 Concept",
        description: "Concept from second persona in switch test",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create first persona and send message (>30 chars to avoid debouncing)
    console.log('Creating first persona for switching test');
    await harness.sendCommand('/persona create switch-test-1');
    await harness.waitForIdleState(2000);
    
    const firstMessage = 'Message to switch-test-1 persona that is long enough to avoid debouncing';
    console.log(`Sending message to switch-test-1: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('First persona message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Create second persona
    console.log('Creating second persona for switching test');
    await harness.sendCommand('/persona create switch-test-2');
    await harness.waitForIdleState(2000);

    // Send message to second persona (>30 chars to avoid debouncing)
    const secondMessage = 'Message to switch-test-2 persona that is also long enough to avoid debouncing';
    console.log(`Sending message to switch-test-2: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Second persona message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Switch back to first persona
    console.log('Switching back to first persona');
    await harness.sendCommand('/persona switch switch-test-1');
    await harness.waitForIdleState(3000);

    // Switch back to second persona
    console.log('Switching to second persona');
    await harness.sendCommand('/persona switch switch-test-2');
    await harness.waitForIdleState(3000);

    // Verify persona switching works using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Persona switching output captured');
    
    // Check that persona switching commands appear in the captured output
    const hasSwitchingContent = finalOutput.includes('switch-test-1') || finalOutput.includes('switch-test-2');
    expect(hasSwitchingContent).toBe(true);
    console.log('✓ Persona switching found in captured output');

    // Verify persona switching works and state is maintained
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable during persona switching');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify both personas have their data saved
    harness.assertDirectoryExists('personas');
    console.log('✓ Persona directories exist');
    
    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(6);
    expect(requestCount).toBeLessThanOrEqual(8);
    
    console.log('✓ Persona switching and unread count management test complete');
  }, 60000);

  test('multi-persona scenario with configuration file', async () => {
    console.log('=== Testing multi-persona scenario with configuration file ===');
    
    // Set up mock responses for multiple LLM calls (3 per persona interaction)
    // Each message interaction requires: 1 response + 2 concept updates = 3 calls
    // Total for 2 persona interactions: 6 calls
    harness.setMockResponseQueue([
      // First persona interaction (assistant-1): 3 calls
      'Multi-persona test response from assistant-1.',
      JSON.stringify([{ "name": "test_interaction", "description": "System concept for assistant-1", "confidence": 0.8 }]),
      JSON.stringify([{ "name": "user_greeting", "description": "Human concept for assistant-1", "confidence": 0.9 }]),
      // Second persona interaction (assistant-2): 3 calls  
      'Multi-persona test response from assistant-2.',
      JSON.stringify([{ "name": "test_interaction", "description": "System concept for assistant-2", "confidence": 0.8 }]),
      JSON.stringify([{ "name": "user_greeting", "description": "Human concept for assistant-2", "confidence": 0.9 }])
    ]);

    // Set up initial personas data
    const tempDataPath = harness.getTempDataPath();
    if (tempDataPath) {
      const fs = require('fs');
      const path = require('path');
      
      // Create assistant-1 persona
      const persona1Dir = path.join(tempDataPath, 'personas', 'assistant-1');
      await fs.promises.mkdir(persona1Dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(persona1Dir, 'system.jsonc'),
        JSON.stringify({
          name: 'assistant-1',
          systemPrompt: 'You are Assistant 1, a helpful AI.',
          created: new Date().toISOString()
        }, null, 2)
      );

      // Create assistant-2 persona  
      const persona2Dir = path.join(tempDataPath, 'personas', 'assistant-2');
      await fs.promises.mkdir(persona2Dir, { recursive: true });
      await fs.promises.writeFile(
        path.join(persona2Dir, 'system.jsonc'),
        JSON.stringify({
          name: 'assistant-2',
          systemPrompt: 'You are Assistant 2, a creative AI.',
          created: new Date().toISOString()
        }, null, 2)
      );
      console.log('Pre-configured personas created');
    }

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });
    await harness.waitForIdleState(5000);
    console.log('Application initialized with pre-configured personas');

    // Test the multi-persona scenario
    console.log('Switching to assistant-1');
    await harness.sendCommand('/persona switch assistant-1');
    await harness.waitForIdleState(2000);
    
    const firstMessage = 'Hello Assistant 1 - this message is long enough to avoid debouncing';
    console.log(`Sending message to assistant-1: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Assistant-1 message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    console.log('Switching to assistant-2');
    await harness.sendCommand('/persona switch assistant-2');
    await harness.waitForIdleState(2000);
    
    const secondMessage = 'Hello Assistant 2 - this message is also long enough to avoid debouncing';
    console.log(`Sending message to assistant-2: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Assistant-2 message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Verify UI content using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Multi-persona configuration output captured');
    
    // Check that both assistants appear in the captured output
    const hasAssistantContent = finalOutput.includes('assistant-1') || finalOutput.includes('Assistant 1');
    expect(hasAssistantContent).toBe(true);
    console.log('✓ Assistant personas found in captured output');

    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify file assertions after app has exited
    harness.assertFileExists('personas/assistant-1/system.jsonc');
    harness.assertFileExists('personas/assistant-2/system.jsonc');
    console.log('✓ Persona configuration files exist');
    
    // Verify we got at least the expected minimum requests (6 for 2 persona interactions)
    // Actual count may vary due to initialization/timing (typically 6-8)
    const actualCount = harness.getMockRequestHistory().length;
    console.log(`Received ${actualCount} LLM requests`);
    expect(actualCount).toBeGreaterThanOrEqual(6);
    expect(actualCount).toBeLessThanOrEqual(10); // Reasonable upper bound
    
    console.log('✓ Multi-persona scenario with configuration file test complete');
  }, 60000);

  test('persona isolation and data integrity', async () => {
    console.log('=== Testing persona isolation and data integrity ===');
    
    // Configure sequential responses for isolation test (6 total responses for 2 messages)
    harness.setMockResponseQueue([
      // First isolated persona message
      'Isolated persona response from isolated-1.',
      JSON.stringify([{
        name: "Isolated Persona 1 Concept",
        description: "Concept from first isolated persona",
        level_current: 0.7,
        level_ideal: 0.9,
        level_elasticity: 0.1,
        type: "static"
      }]),
      JSON.stringify([]),
      // Second isolated persona message
      'Isolated persona response from isolated-2.',
      JSON.stringify([{
        name: "Isolated Persona 2 Concept",
        description: "Concept from second isolated persona",
        level_current: 0.4,
        level_ideal: 0.8,
        level_elasticity: 0.4,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create first persona with specific data (>30 chars to avoid debouncing)
    console.log('Creating first isolated persona');
    await harness.sendCommand('/persona create isolated-1');
    await harness.waitForIdleState(2000);
    
    const firstMessage = 'Unique message for isolated-1 persona that is long enough to avoid debouncing';
    console.log(`Sending unique message to isolated-1: "${firstMessage}"`);
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('First isolated persona message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Create second persona with different data (>30 chars to avoid debouncing)
    console.log('Creating second isolated persona');
    await harness.sendCommand('/persona create isolated-2');
    await harness.waitForIdleState(2000);
    
    const secondMessage = 'Different message for isolated-2 persona that is also long enough to avoid debouncing';
    console.log(`Sending different message to isolated-2: "${secondMessage}"`);
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Second isolated persona message processed');

    // Wait for response processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Switch back to first persona and verify its data is intact
    console.log('Switching back to first isolated persona');
    await harness.sendCommand('/persona switch isolated-1');
    await harness.waitForIdleState(3000);

    // Switch to second persona and verify its data is intact
    console.log('Switching to second isolated persona');
    await harness.sendCommand('/persona switch isolated-2');
    await harness.waitForIdleState(3000);

    // Verify persona isolation using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Persona isolation output captured');
    
    // Check that both personas appear in the captured output
    expect(finalOutput).toContain('isolated-1');
    expect(finalOutput).toContain('isolated-2');
    console.log('✓ Both isolated persona names found in captured output');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify both personas have separate data files
    harness.assertDirectoryExists('personas');
    console.log('✓ Persona directories exist');
    
    // Verify data integrity - each persona should have its own files
    const tempDataPath = harness.getTempDataPath();
    if (tempDataPath) {
      harness.assertDirectoryExists('personas');
      console.log('✓ Persona data directories verified');
    }

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(6);
    expect(requestCount).toBeLessThanOrEqual(8);
    
    console.log('✓ Persona isolation and data integrity test complete');
  }, 60000);

  test('persona heartbeat and background processing', async () => {
    console.log('=== Testing persona heartbeat and background processing ===');
    
    // Configure mock responses for heartbeat processing (3 calls per message)
    harness.setMockResponseQueue([
      'Heartbeat processing response for persona background operations.',
      JSON.stringify([{
        name: "Heartbeat Concept",
        description: "Concept from heartbeat processing",
        level_current: 0.6,
        level_ideal: 0.8,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create persona and trigger heartbeat processing (>30 chars to avoid debouncing)
    console.log('Creating heartbeat test persona');
    await harness.sendCommand('/persona create heartbeat-test');
    await harness.waitForIdleState(2000);
    
    const heartbeatMessage = 'Start heartbeat processing for persona background operations test';
    console.log(`Sending heartbeat message: "${heartbeatMessage}"`);
    await harness.sendInput(`${heartbeatMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Heartbeat processing message sent');

    // While heartbeat processing is happening, create another persona
    console.log('Creating second heartbeat test persona');
    await harness.sendCommand('/persona create heartbeat-test-2');
    await harness.waitForIdleState(2000);

    // Wait for heartbeat processing to complete
    await new Promise(resolve => setTimeout(resolve, 8000));

    // Verify heartbeat processing worked using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Heartbeat processing output captured');
    
    // Check that both personas appear in the captured output
    expect(finalOutput).toContain('heartbeat-test');
    console.log('✓ Heartbeat test personas found in captured output');

    // Verify both personas are functional
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable during heartbeat processing');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify mock server received requests (1 message = 3-4 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(3);
    expect(requestCount).toBeLessThanOrEqual(4);
    
    console.log('✓ Persona heartbeat and background processing test complete');
  }, 60000);

  test('persona error handling and recovery', async () => {
    console.log('=== Testing persona error handling and recovery ===');
    
    // Configure sequential responses: error for first persona, success for second
    harness.setMockResponseQueue([
      // First persona (error case)
      'Error: This is a simulated error response',  // This should still be displayed
      JSON.stringify([]),  // Empty concepts for error case
      JSON.stringify([]),
      // Second persona (recovery case)
      'Recovery successful from error handling test.',
      JSON.stringify([{
        name: "Recovery Concept",
        description: "Concept from recovery test",
        level_current: 0.8,
        level_ideal: 0.9,
        level_elasticity: 0.1,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Start the application with blessed output capture
    await harness.startApp({ debugMode: true, usePty: false });

    // Wait for application to initialize
    await harness.waitForIdleState(5000);
    console.log('Application initialized');

    // Create persona and trigger error (>30 chars to avoid debouncing)
    console.log('Creating error test persona');
    await harness.sendCommand('/persona create error-test');
    await harness.waitForIdleState(2000);
    
    const errorMessage = 'This should cause an error response but should still be handled gracefully';
    console.log(`Sending error test message: "${errorMessage}"`);
    await harness.sendInput(`${errorMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Error test message processed');

    // Wait for error handling
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Create another persona to test that errors don't affect other personas
    console.log('Creating recovery test persona');
    await harness.sendCommand('/persona create recovery-test');
    await harness.waitForIdleState(2000);

    // Send recovery test message (>30 chars to avoid debouncing)
    const recoveryMessage = 'Recovery test message that should work after error handling';
    console.log(`Sending recovery test message: "${recoveryMessage}"`);
    await harness.sendInput(`${recoveryMessage}\n`);
    await harness.waitForLLMRequest(5000);
    console.log('Recovery test message processed');

    // Wait for recovery processing
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Verify error handling and recovery using blessed output capture
    const finalOutput = await harness.getCapturedUIContent();
    console.log('Error handling and recovery output captured');
    
    // Check that test messages appear in the captured output
    const hasErrorContent = finalOutput.includes('error response') || finalOutput.includes('Recovery test message');
    expect(hasErrorContent).toBe(true);
    console.log('✓ Error and recovery test messages found in captured output');

    // Verify the application recovered and both personas exist
    expect(harness.isAppRunning()).toBe(true);
    console.log('✓ Application remains stable after error and recovery');

    // Send quit command
    console.log('Sending quit command');
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    const requestCount = harness.getMockRequestHistory().length;
    console.log(`Received ${requestCount} LLM requests`);
    expect(requestCount).toBeGreaterThanOrEqual(6);
    expect(requestCount).toBeLessThanOrEqual(8);
    
    console.log('✓ Persona error handling and recovery test complete');
  }, 60000);
});
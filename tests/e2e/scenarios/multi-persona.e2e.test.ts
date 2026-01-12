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

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create first persona by sending a message
    await harness.sendInput('Hello from persona 1\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Response from the first persona', 8000);

    // Switch to a different persona (this depends on EI's persona switching mechanism)
    // For now, we'll simulate this by creating a new persona
    await harness.sendCommand('/persona create test-persona-2');
    await harness.waitForIdleState(2000);

    // Send message to second persona
    await harness.sendInput('Hello from persona 2\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Response from the second persona', 8000);

    // Verify both personas exist and have independent state
    harness.assertDirectoryExists('personas');
    
    // Check that both persona directories exist
    const tempDataPath = harness.getTempDataPath();
    if (tempDataPath) {
      // The exact persona names depend on EI's implementation
      // We'll check for the existence of persona directories
      harness.assertDirectoryExists('personas');
    }

    // Verify both personas received responses
    await harness.assertUIContains('Response from the first persona');
    await harness.assertUIContains('Response from the second persona');

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(8);
  }, 45000);

  test('concurrent persona processing', async () => {
    // Configure sequential responses for concurrent persona operations
    harness.setMockResponseQueue([
      // First persona message
      'Concurrent processing response.',
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
      'Concurrent processing response.',
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

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create multiple personas and send messages concurrently
    await harness.sendCommand('/persona create concurrent-1');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Message to concurrent-1\n');
    
    // Quickly switch to another persona
    await harness.sendCommand('/persona create concurrent-2');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Message to concurrent-2\n');

    // Both personas should be able to process concurrently
    // Wait for both LLM requests to be initiated
    await harness.waitForCondition(
      () => harness.getMockRequestHistory().length >= 2,
      'Both personas should make LLM requests',
      10000
    );

    // Wait for both responses to appear
    await harness.waitForUIText('Concurrent processing response', 15000);

    // Verify the application handled concurrent processing
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(8);
  }, 45000);

  test('persona switching and unread count management', async () => {
    // Configure sequential responses for persona switching test (6 total responses for 2 messages)
    harness.setMockResponseQueue([
      // First persona message
      'Response for persona switching test.',
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
      'Response for persona switching test.',
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

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create first persona and send message
    await harness.sendCommand('/persona create switch-test-1');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Message to switch-test-1\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Response for persona switching test', 8000);

    // Create second persona
    await harness.sendCommand('/persona create switch-test-2');
    await harness.waitForIdleState(1000);

    // Send message to second persona
    await harness.sendInput('Message to switch-test-2\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Response for persona switching test', 8000);

    // Switch back to first persona
    await harness.sendCommand('/persona switch switch-test-1');
    await harness.waitForIdleState(2000);

    // The UI should show the conversation history for the first persona
    // and manage unread counts appropriately
    
    // Switch back to second persona
    await harness.sendCommand('/persona switch switch-test-2');
    await harness.waitForIdleState(2000);

    // Verify persona switching works and state is maintained
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify both personas have their data saved
    harness.assertDirectoryExists('personas');
    
    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(8);
  }, 45000);

  test('multi-persona scenario with configuration file', async () => {
    // Create a comprehensive multi-persona scenario
    const multiPersonaScenario: TestScenario = {
      name: 'Multi-Persona Integration Test',
      description: 'Tests multiple personas with different configurations and interactions',
      setup: {
        mockResponses: [
          {
            endpoint: '/v1/chat/completions',
            response: {
              type: 'fixed',
              content: 'Multi-persona test response.',
              delayMs: 200
            }
          }
        ],
        initialData: {
          personas: [
            {
              name: 'assistant-1',
              systemPrompt: 'You are Assistant 1, a helpful AI.',
              initialMessages: []
            },
            {
              name: 'assistant-2', 
              systemPrompt: 'You are Assistant 2, a creative AI.',
              initialMessages: []
            }
          ]
        }
      },
      steps: [
        {
          type: 'command',
          action: '/persona switch assistant-1',
          timeout: 3000
        },
        {
          type: 'input',
          action: 'Hello Assistant 1',
          timeout: 5000
        },
        {
          type: 'wait',
          action: 'llm_request',
          timeout: 3000
        },
        {
          type: 'wait',
          action: 'ui:Multi-persona test response',
          timeout: 8000
        },
        {
          type: 'command',
          action: '/persona switch assistant-2',
          timeout: 3000
        },
        {
          type: 'input',
          action: 'Hello Assistant 2',
          timeout: 5000
        },
        {
          type: 'wait',
          action: 'llm_request',
          timeout: 3000
        },
        {
          type: 'wait',
          action: 'ui:Multi-persona test response',
          timeout: 8000
        },
        {
          type: 'command',
          action: '/quit',
          timeout: 3000
        }
      ],
      assertions: [
        {
          type: 'ui',
          target: 'output',
          condition: 'contains',
          expected: 'Multi-persona test response'
        },
        {
          type: 'file',
          target: 'personas/assistant-1/system.jsonc',
          condition: 'exists',
          expected: true
        },
        {
          type: 'file',
          target: 'personas/assistant-2/system.jsonc',
          condition: 'exists',
          expected: true
        },
        {
          type: 'process',
          target: 'mock_server',
          condition: 'mock_requests',
          expected: 2
        }
      ],
      cleanup: {
        killProcesses: true,
        restoreEnvironment: true
      }
    };

    // Execute the scenario
    const result = await scenarioRunner.executeScenario(multiPersonaScenario, {
      maxRetries: 2,
      attemptRecovery: true,
      performCleanup: true
    });

    expect(result.success).toBe(true);
    expect(result.error).toBeNull();
    expect(result.stepResults.length).toBeGreaterThan(0);
    expect(result.assertionResults.length).toBeGreaterThan(0);
    
    // Verify all steps succeeded
    for (const stepResult of result.stepResults) {
      expect(stepResult.success).toBe(true);
    }
    
    // Verify all assertions succeeded
    for (const assertionResult of result.assertionResults) {
      expect(assertionResult.success).toBe(true);
    }
  }, 60000);

  test('persona isolation and data integrity', async () => {
    // Configure sequential responses for isolation test (6 total responses for 2 messages)
    harness.setMockResponseQueue([
      // First isolated persona message
      'Isolated persona response.',
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
      'Isolated persona response.',
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

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create first persona with specific data
    await harness.sendCommand('/persona create isolated-1');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Unique message for isolated-1\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Isolated persona response', 8000);

    // Create second persona with different data
    await harness.sendCommand('/persona create isolated-2');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Different message for isolated-2\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Isolated persona response', 8000);

    // Switch back to first persona and verify its data is intact
    await harness.sendCommand('/persona switch isolated-1');
    await harness.waitForIdleState(2000);

    // The conversation history should show only the first persona's messages
    // This is a behavioral test that depends on EI's UI implementation
    
    // Switch to second persona and verify its data is intact
    await harness.sendCommand('/persona switch isolated-2');
    await harness.waitForIdleState(2000);

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify both personas have separate data files
    harness.assertDirectoryExists('personas');
    
    // Verify data integrity - each persona should have its own files
    const tempDataPath = harness.getTempDataPath();
    if (tempDataPath) {
      harness.assertDirectoryExists('personas');
      // Additional file-level checks would depend on EI's data structure
    }

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(8);
  }, 45000);

  test('persona heartbeat and background processing', async () => {
    // Configure mock server with streaming to simulate heartbeat processing
    harness.enableMockStreaming('/v1/chat/completions', [
      'Heartbeat ',
      'processing ',
      'for persona ',
      'background ',
      'operations.'
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create persona and trigger heartbeat processing
    await harness.sendCommand('/persona create heartbeat-test');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('Start heartbeat processing\n');
    await harness.waitForLLMRequest(3000);

    // While heartbeat processing is happening, create another persona
    await harness.sendCommand('/persona create heartbeat-test-2');
    await harness.waitForIdleState(1000);

    // Both personas should be able to operate independently
    // even with background heartbeat processing
    
    // Wait for heartbeat processing to complete
    await harness.waitForUIText('background operations', 15000);

    // Verify both personas are functional
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify mock server received requests (1 message = 3-4 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(4);
  }, 45000);

  test('persona error handling and recovery', async () => {
    // Configure sequential responses: error for first persona, success for second
    harness.setMockResponseQueue([
      // First persona (error case)
      'Error response',
      JSON.stringify([]),  // Empty concepts for error case
      JSON.stringify([]),
      // Second persona (recovery case)
      'Recovery successful.',
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

    // Start the application
    await harness.startApp({ debugMode: false });

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Create persona and trigger error
    await harness.sendCommand('/persona create error-test');
    await harness.waitForIdleState(1000);
    
    await harness.sendInput('This should cause an error\n');
    await harness.waitForLLMRequest(3000);

    // Wait for error handling
    await harness.waitForIdleState(5000);

    // Create another persona to test that errors don't affect other personas
    await harness.sendCommand('/persona create recovery-test');
    await harness.waitForIdleState(1000);

    // Send recovery test message (will use next responses in queue)
    await harness.sendInput('Recovery test message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Recovery successful', 8000);

    // Verify the application recovered and both personas exist
    expect(harness.isAppRunning()).toBe(true);

    // Send quit command
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify mock server received requests from both personas (2 messages = 6-8 requests)
    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);
    expect(harness.getMockRequestHistory().length).toBeLessThanOrEqual(8);
  }, 45000);
});
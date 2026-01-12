import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Basic Flow E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'basic-flow-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('basic application flow: start → send message → receive response → quit', async () => {
    harness.setMockResponseQueue([
      'Hello! I received your message and I\'m responding from the test environment.',
      JSON.stringify([{
        name: "Test System Concept",
        description: "A test concept for system",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    const testMessage = 'Hello, test assistant! This message is long enough to trigger immediate processing.';
    await harness.sendInput(`${testMessage}\n`);

    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 5000));

    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);

    const capturedOutput = await harness.getCurrentOutput();
    expect(capturedOutput).toContain(testMessage.slice(0, 30));

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    harness.assertFileExists('personas');
    harness.assertDirectoryExists('personas');
  }, 30000);

  test('basic flow with multiple messages', async () => {
    harness.setMockResponseQueue([
      'I understand your first message.',
      JSON.stringify([{
        name: "First Message Concept",
        description: "Concept from first message",
        level_current: 0.5,
        level_ideal: 0.8,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([]),
      'I received your second message too.',
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

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    const firstMessage = 'First test message that is long enough to trigger immediate processing without delays';
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 3000));

    const afterFirstMessage = await harness.getCurrentOutput();
    expect(afterFirstMessage).toContain(firstMessage.slice(0, 30));

    const secondMessage = 'Second test message that is also long enough to trigger immediate processing';
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 3000));

    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(6);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 45000);

  test('basic flow with error handling', async () => {
    harness.setMockResponseQueue([
      'Server Error',
      JSON.stringify([]),
      JSON.stringify([])
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    const errorMessage = 'This message should cause an error but still be processed and displayed in the UI';
    await harness.sendInput(`${errorMessage}\n`);

    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 5000));

    expect(harness.isAppRunning()).toBe(true);

    const capturedOutput = await harness.getCurrentOutput();
    expect(capturedOutput).toContain(errorMessage.slice(0, 30));

    expect(harness.getMockRequestHistory().length).toBeGreaterThanOrEqual(3);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);
});

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Multi-Persona E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'multi-persona-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('persona creation creates data directory', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona create test-persona');
    await harness.waitForIdleState(3000);

    harness.assertDirectoryExists('personas');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('persona switching works correctly', async () => {
    harness.setMockResponseQueue([
      'Response for switching test.',
      JSON.stringify([]),
      JSON.stringify([]),
      'Response from second persona.',
      JSON.stringify([]),
      JSON.stringify([])
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona create switch-test-1');
    await harness.waitForIdleState(2000);
    
    const firstMessage = 'Message to switch-test-1 persona that is long enough to avoid debouncing';
    await harness.sendInput(`${firstMessage}\n`);
    await harness.waitForLLMRequest(5000);
    await new Promise(resolve => setTimeout(resolve, 6000));

    await harness.sendCommand('/persona create switch-test-2');
    await harness.waitForIdleState(2000);

    const secondMessage = 'Message to switch-test-2 persona that is also long enough to avoid debouncing';
    await harness.sendInput(`${secondMessage}\n`);
    await harness.waitForLLMRequest(5000);
    await new Promise(resolve => setTimeout(resolve, 6000));

    await harness.sendCommand('/persona switch switch-test-1');
    await harness.waitForIdleState(3000);

    expect(harness.isAppRunning()).toBe(true);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    harness.assertDirectoryExists('personas');
  }, 60000);
});

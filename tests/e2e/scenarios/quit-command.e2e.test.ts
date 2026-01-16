import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Quit Command E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'quit-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('quit command in idle state exits with code 0', async () => {
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(5000);
    
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
    
    harness.assertProcessState(false);
  }, 15000);

  test('first quit during LLM processing aborts the request (not exit)', async () => {
    // Set up a slow response so we can interrupt it
    harness.setMockResponse('/v1/chat/completions', 'This would be a slow response.', 5000);
    
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Send a message to start LLM processing
    await harness.sendInput('Tell me a story\n');
    await harness.waitForLLMRequest(3000);
    
    // First /quit should abort the active processing, not exit
    await harness.sendCommand('/quit');
    
    // Wait for the abort to be reflected in status
    await harness.waitForUIText('Aborted', 3000);
    
    // App should still be running (abort happened, not exit)
    expect(harness.isAppRunning()).toBe(true);
    
    // Now use --force to cleanly exit for test cleanup
    await harness.sendCommand('/quit --force');
    await harness.assertExitCode(0, 5000);
    
    harness.assertProcessState(false);
  }, 20000);

  test('quit --force exits immediately even during LLM processing', async () => {
    // Set up a slow response so we can interrupt it
    harness.setMockResponse('/v1/chat/completions', 'This would be a slow response.', 5000);
    
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Send a message to start LLM processing
    await harness.sendInput('Tell me a story\n');
    await harness.waitForLLMRequest(3000);
    
    // /quit --force should exit immediately regardless of processing state
    await harness.sendCommand('/quit --force');
    await harness.assertExitCode(0, 5000);
    
    harness.assertProcessState(false);
  }, 20000);

  test('multiple quit commands are handled gracefully', async () => {
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    await harness.sendCommand('/quit');
    
    setTimeout(async () => {
      if (harness.isAppRunning()) {
        await harness.sendCommand('/quit');
      }
    }, 100);
    
    await harness.assertExitCode(0, 5000);
    harness.assertProcessState(false);
  }, 15000);

  test('Ctrl+C (SIGTERM) behavior works correctly', async () => {
    harness.setMockResponseQueue([
      'Test message response for Ctrl+C integration that is long enough to avoid debouncing',
      JSON.stringify([{
        name: "Ctrl+C Test Concept",
        description: "Concept for Ctrl+C integration test",
        level_current: 0.5,
        level_ideal: 0.8,
        sentiment: 0.0,
        type: "static"
      }]),
      JSON.stringify([])
    ]);
    
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(3000);
    
    const testMessage = 'Test message for Ctrl+C integration that exceeds thirty character threshold';
    await harness.sendInput(`${testMessage}\n`);
    await harness.waitForLLMRequest(3000);
    await new Promise(resolve => setTimeout(resolve, 4000));
    
    const currentProcess = (harness as any).currentProcess;
    if (currentProcess) {
      currentProcess.kill('SIGTERM');
    }
    
    await harness.assertExitCode(0, 8000);
    harness.assertProcessState(false);
  }, 20000);
});

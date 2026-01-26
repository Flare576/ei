import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Pause/Resume Persona E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'pause-resume-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('/pause command pauses active persona indefinitely', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);

    await harness.assertFileContent('personas/ei/system.jsonc', '"isPaused": true');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/pause with duration sets pauseUntil timestamp', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause 30m');
    await harness.waitForUIText('Paused ei for 30m', 5000);

    await harness.assertFileContent('personas/ei/system.jsonc', '"isPaused": true');
    await harness.assertFileContent('personas/ei/system.jsonc', '"pauseUntil"');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/pause with hour duration works', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause 2h');
    await harness.waitForUIText('Paused ei for 2h', 5000);

    await harness.assertFileContent('personas/ei/system.jsonc', '"isPaused": true');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/pause rejects invalid duration format', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause 30x');
    await harness.waitForUIText('Usage:', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/pause on already paused persona shows error', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);
    await harness.waitForIdleState(2000);

    await harness.sendCommand('/pause');
    await harness.waitForIdleState(3000);
    
    await harness.assertFileContent('personas/ei/system.jsonc', '"isPaused": true');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/resume unpauses persona', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);

    await harness.sendCommand('/resume');
    await harness.waitForUIText('Resumed ei', 5000);

    await harness.assertFileContent('personas/ei/system.jsonc', '"isPaused": false');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/resume on non-paused persona shows error', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/resume');
    await harness.waitForUIText('not paused', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('messages sent to paused persona are queued', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);
    await harness.waitForIdleState(2000);

    const testMessage = 'This is a test message sent while paused that should be queued';
    await harness.sendInput(`${testMessage}\n`);
    
    await harness.waitForFileContent('personas/ei/history.jsonc', testMessage, 10000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 45000);

  test('pause state persists across app restart', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('already paused', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 45000);

  test('/help includes pause/resume documentation', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/help');
    await harness.waitForUIText('pause', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('resume processes queued messages', async () => {
    harness.setMockResponseQueue([
      'Hello! I received your queued message.'
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/pause');
    await harness.waitForUIText('Paused ei indefinitely', 5000);
    await harness.waitForIdleState(2000);

    const testMessage = 'This message is long enough to be processed immediately after resume happens';
    await harness.sendInput(`${testMessage}\n`);
    
    await harness.waitForFileContent('personas/ei/history.jsonc', testMessage, 10000);
    await harness.waitForIdleState(2000);
    
    const requestCountBeforeResume = harness.getMockRequestHistory().length;

    await harness.sendCommand('/resume');
    await harness.waitForUIText('Resumed ei', 5000);

    await harness.waitForLLMRequestCount(requestCountBeforeResume + 1, 15000);
    
    await harness.waitForUIText('queued message', 10000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);
});

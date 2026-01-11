// Simple PTY test to verify node-pty integration
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { E2ETestHarness } from '../types.js';

describe('Simple PTY Test', () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'simple-pty-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('can start app with PTY', async () => {
    console.log('=== Starting application with PTY ===');
    await harness.startApp({ debugMode: true, usePty: true });
    
    console.log('=== Application started successfully ===');
    
    // Just verify the app started
    const isRunning = harness.isAppRunning();
    expect(isRunning).toBe(true);
    
    console.log('=== Stopping application ===');
    await harness.stopApp();
  }, 15000);
});
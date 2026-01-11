// Debug test to understand quit command behavior
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { E2ETestHarness } from '../types.js';

describe('Debug Quit Command', () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'debug-quit-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('debug quit command step by step', async () => {
    console.log('=== Starting application ===');
    await harness.startApp({ debugMode: true });
    
    console.log('=== Waiting for idle state ===');
    await harness.waitForIdleState(8000);
    
    console.log('=== Getting initial output ===');
    const initialOutput = await harness.getCurrentOutput(20);
    console.log('Initial output (last 20 lines):', initialOutput.split('\n').slice(-20).join('\n'));
    
    console.log('=== Sending quit command ===');
    await harness.sendCommand('quit');
    
    console.log('=== Waiting for output change ===');
    try {
      const changedOutput = await harness.waitForUIChange(3000);
      console.log('Output after quit command (last 20 lines):', changedOutput.split('\n').slice(-20).join('\n'));
    } catch (error) {
      console.log('No UI change detected after quit command:', error);
    }
    
    console.log('=== Checking if process is still running ===');
    const isRunning = harness.isAppRunning();
    console.log('Process still running:', isRunning);
    
    if (isRunning) {
      console.log('=== Getting current output to see if quit was processed ===');
      const currentOutput = await harness.getCurrentOutput(30);
      console.log('Current output (last 30 lines):', currentOutput.split('\n').slice(-30).join('\n'));
      
      // Try sending Ctrl+C as a fallback
      console.log('=== Trying Ctrl+C as fallback ===');
      await harness.sendInput('\x03'); // Ctrl+C
      
      try {
        await harness.assertExitCode(0, 3000);
        console.log('Process exited with Ctrl+C');
      } catch (error) {
        console.log('Process did not exit with Ctrl+C either:', error);
      }
    } else {
      console.log('=== Process exited, checking exit code ===');
      await harness.assertExitCode(0, 1000);
    }
  }, 30000);
});
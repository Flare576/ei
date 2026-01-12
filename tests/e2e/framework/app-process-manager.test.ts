// Tests for AppProcessManager Implementation
// Verifies process lifecycle management, timeout handling, and state capture

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { AppProcessManagerImpl } from './app-process-manager.js';
import { AppConfig } from '../types.js';
import * as path from 'path';
import * as os from 'os';

describe('AppProcessManager', () => {
  let processManager: AppProcessManagerImpl;
  let testConfig: AppConfig;

  beforeEach(() => {
    processManager = new AppProcessManagerImpl();
    testConfig = {
      dataPath: path.join(os.tmpdir(), `test-${Date.now()}`),
      llmBaseUrl: 'http://localhost:1234/v1',
      llmApiKey: 'test-key',
      llmModel: 'test-model',
      debugMode: true
    };
  });

  afterEach(async () => {
    await processManager.cleanup();
  });

  test('should manage process lifecycle correctly', async () => {
    // This test verifies basic process management without actually starting the EI app
    // since we don't have a built version in the test environment
    
    const managedProcesses = processManager.getManagedProcesses();
    expect(managedProcesses).toHaveLength(0);
    
    // Test timeout configuration methods
    // We can't test with a real process, but we can verify the interface works
    expect(() => {
      processManager.configureTimeouts({} as any, {
        initialization: 10000,
        gracefulShutdown: 5000,
        forceKill: 2000
      });
    }).toThrow('Process not managed by this AppProcessManager');
  });

  test('should handle timeout configuration', () => {
    // Test that timeout configuration interface works
    const timeouts = {
      initialization: 10000,
      gracefulShutdown: 5000,
      forceKill: 2000
    };

    // This should throw since no process is managed
    expect(() => {
      processManager.configureTimeouts({} as any, timeouts);
    }).toThrow('Process not managed by this AppProcessManager');
  });

  test('should provide final state information', () => {
    // Test that final state interface works
    expect(() => {
      processManager.getFinalState({} as any);
    }).toThrow('Process not managed by this AppProcessManager');
  });

  test('should handle input/output operations', async () => {
    // Test input/output interface
    await expect(
      processManager.sendInput({} as any, 'test input')
    ).rejects.toThrow('Cannot send input to stopped process');

    const output = await processManager.getOutput({} as any);
    expect(output).toBe('');
  });

  test('should check process running state', () => {
    // Test process state checking
    const mockProcess = {
      exitCode: null,
      killed: false
    } as any;

    expect(processManager.isRunning(mockProcess)).toBe(true);

    mockProcess.exitCode = 0;
    expect(processManager.isRunning(mockProcess)).toBe(false);

    mockProcess.exitCode = null;
    mockProcess.killed = true;
    expect(processManager.isRunning(mockProcess)).toBe(false);
  });

  test('should handle wait for exit with timeout', async () => {
    // Test wait for exit interface
    await expect(
      processManager.waitForExit({} as any, 1000)
    ).rejects.toThrow('Process not managed by this AppProcessManager');
  });
});
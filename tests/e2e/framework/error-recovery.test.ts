// Error Recovery System Tests
// Validates retry logic, error handling, and emergency cleanup

import { describe, test, expect, beforeEach, vi } from 'vitest';
import { ErrorRecoveryImpl, RetryExhaustedError, EmergencyCleanupError } from './error-recovery.js';
import { TestResource } from '../types.js';

describe('ErrorRecoveryImpl', () => {
  let errorRecovery: ErrorRecoveryImpl;

  beforeEach(() => {
    errorRecovery = new ErrorRecoveryImpl();
    vi.clearAllMocks();
  });

  describe('Retry with Backoff', () => {
    test('succeeds on first attempt', async () => {
      const operation = vi.fn().mockResolvedValue('success');
      
      const result = await errorRecovery.retryWithBackoff(operation, 3);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    test('succeeds after retries', async () => {
      const operation = vi.fn()
        .mockRejectedValueOnce(new Error('First failure'))
        .mockRejectedValueOnce(new Error('Second failure'))
        .mockResolvedValue('success');
      
      const result = await errorRecovery.retryWithBackoff(operation, 3);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    test('throws RetryExhaustedError after max retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Persistent failure'));
      
      await expect(errorRecovery.retryWithBackoff(operation, 2))
        .rejects.toThrow(RetryExhaustedError);
      
      expect(operation).toHaveBeenCalledTimes(2);
    });

    test('includes original error in RetryExhaustedError', async () => {
      const originalError = new Error('Original failure');
      const operation = vi.fn().mockRejectedValue(originalError);
      
      try {
        await errorRecovery.retryWithBackoff(operation, 1);
      } catch (error) {
        expect(error).toBeInstanceOf(RetryExhaustedError);
        expect((error as RetryExhaustedError).originalError).toBe(originalError);
        expect((error as RetryExhaustedError).attempts).toBe(1);
      }
    });

    test('uses operation ID for tracking retries', async () => {
      const operation = vi.fn().mockRejectedValue(new Error('Failure'));
      
      // First call with same ID should fail after 1 attempt
      await expect(errorRecovery.retryWithBackoff(operation, 1, 'test-op'))
        .rejects.toThrow(RetryExhaustedError);
      
      // Second call with same ID should start fresh
      operation.mockResolvedValue('success');
      const result = await errorRecovery.retryWithBackoff(operation, 1, 'test-op');
      
      expect(result).toBe('success');
    });
  });

  describe('Graceful Degradation', () => {
    test('executes fallback action on error', () => {
      const error = new Error('Test error');
      const fallbackAction = vi.fn();
      
      errorRecovery.gracefulDegrade(error, fallbackAction);
      
      expect(fallbackAction).toHaveBeenCalledTimes(1);
    });

    test('handles fallback action errors gracefully', () => {
      const error = new Error('Test error');
      const fallbackAction = vi.fn().mockImplementation(() => {
        throw new Error('Fallback failed');
      });
      
      // Should not throw even if fallback fails
      expect(() => errorRecovery.gracefulDegrade(error, fallbackAction))
        .not.toThrow();
      
      expect(fallbackAction).toHaveBeenCalledTimes(1);
    });
  });

  describe('Resource Management', () => {
    test('registers and unregisters resources', () => {
      const resource: TestResource = {
        type: 'file',
        identifier: 'test-file',
        cleanup: vi.fn().mockResolvedValue(undefined)
      };
      
      errorRecovery.registerResource(resource);
      errorRecovery.unregisterResource('test-file');
      
      // Should not throw since resource was unregistered
      expect(async () => await errorRecovery.emergencyCleanup())
        .not.toThrow();
    });

    test('tracks multiple resources', () => {
      const resources: TestResource[] = [
        {
          type: 'file',
          identifier: 'file1',
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        {
          type: 'process',
          identifier: 'process1',
          cleanup: vi.fn().mockResolvedValue(undefined)
        }
      ];
      
      resources.forEach(r => errorRecovery.registerResource(r));
      
      expect(resources).toHaveLength(2);
    });
  });

  describe('Emergency Cleanup', () => {
    test('cleans up all registered resources', async () => {
      const resources: TestResource[] = [
        {
          type: 'file',
          identifier: 'file1',
          cleanup: vi.fn().mockResolvedValue(undefined)
        },
        {
          type: 'process',
          identifier: 'process1',
          cleanup: vi.fn().mockResolvedValue(undefined)
        }
      ];
      
      resources.forEach(r => errorRecovery.registerResource(r));
      
      await errorRecovery.emergencyCleanup();
      
      resources.forEach(r => {
        expect(r.cleanup).toHaveBeenCalledTimes(1);
      });
    });

    test('cleans up resources in correct order', async () => {
      const cleanupOrder: string[] = [];
      
      const resources: TestResource[] = [
        {
          type: 'directory',
          identifier: 'dir1',
          cleanup: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('directory');
          })
        },
        {
          type: 'file',
          identifier: 'file1',
          cleanup: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('file');
          })
        },
        {
          type: 'process',
          identifier: 'process1',
          cleanup: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('process');
          })
        },
        {
          type: 'server',
          identifier: 'server1',
          cleanup: vi.fn().mockImplementation(async () => {
            cleanupOrder.push('server');
          })
        }
      ];
      
      resources.forEach(r => errorRecovery.registerResource(r));
      
      await errorRecovery.emergencyCleanup();
      
      // Should clean up in order: process, server, file, directory
      expect(cleanupOrder).toEqual(['process', 'server', 'file', 'directory']);
    });

    test('continues cleanup even if some resources fail', async () => {
      const resources: TestResource[] = [
        {
          type: 'file',
          identifier: 'file1',
          cleanup: vi.fn().mockRejectedValue(new Error('Cleanup failed'))
        },
        {
          type: 'file',
          identifier: 'file2',
          cleanup: vi.fn().mockResolvedValue(undefined)
        }
      ];
      
      resources.forEach(r => errorRecovery.registerResource(r));
      
      await expect(errorRecovery.emergencyCleanup())
        .rejects.toThrow(EmergencyCleanupError);
      
      // Both cleanup methods should have been called
      resources.forEach(r => {
        expect(r.cleanup).toHaveBeenCalledTimes(1);
      });
    });

    test('cleans up provided resources instead of registered ones', async () => {
      const registeredResource: TestResource = {
        type: 'file',
        identifier: 'registered',
        cleanup: vi.fn().mockResolvedValue(undefined)
      };
      
      const providedResource: TestResource = {
        type: 'file',
        identifier: 'provided',
        cleanup: vi.fn().mockResolvedValue(undefined)
      };
      
      errorRecovery.registerResource(registeredResource);
      
      await errorRecovery.emergencyCleanup([providedResource]);
      
      expect(registeredResource.cleanup).not.toHaveBeenCalled();
      expect(providedResource.cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('Error Reporting', () => {
    test('creates detailed error report', () => {
      const error = new Error('Test error');
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: []
      };
      
      const report = errorRecovery.createErrorReport(error, context);
      
      expect(report.errorType).toBe('Error');
      expect(report.message).toBe('Test error');
      expect(report.context.operation).toBe('test_operation');
      expect(report.context.phase).toBe('execution');
      expect(report.suggestions).toBeInstanceOf(Array);
      expect(report.severity).toMatch(/^(low|medium|high|critical)$/);
    });

    test('generates appropriate suggestions for timeout errors', () => {
      const error = new Error('Operation timeout after 5000ms');
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: []
      };
      
      const report = errorRecovery.createErrorReport(error, context);
      
      expect(report.suggestions).toContain('Consider increasing timeout values');
      expect(report.suggestions).toContain('Check if the application is responding correctly');
    });

    test('generates appropriate suggestions for file errors', () => {
      const error = new Error('ENOENT: no such file or directory');
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: []
      };
      
      const report = errorRecovery.createErrorReport(error, context);
      
      expect(report.suggestions).toContain('Verify file paths are correct');
      expect(report.suggestions).toContain('Check if required files were created during setup');
    });

    test('assesses error severity correctly', () => {
      const testCases = [
        { error: new Error('EMFILE: too many open files'), expectedSeverity: 'critical' },
        { error: new Error('spawn ENOENT'), expectedSeverity: 'high' },
        { error: new Error('Operation timeout'), expectedSeverity: 'medium' },
        { error: new Error('Assertion failed'), expectedSeverity: 'medium' }
      ];
      
      for (const testCase of testCases) {
        const context = {
          operation: 'test_operation',
          phase: 'execution' as const,
          resources: []
        };
        
        const report = errorRecovery.createErrorReport(testCase.error, context);
        expect(report.severity).toBe(testCase.expectedSeverity);
      }
    });
  });

  describe('Test Failure Handling', () => {
    test('handles test failure with recovery', async () => {
      const error = new Error('Test failure');
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: [],
        retryableOperation: vi.fn().mockResolvedValue('recovered')
      };
      
      const recoveryOptions = {
        attemptRecovery: true,
        retryOperation: true,
        maxRetries: 1
      };
      
      const result = await errorRecovery.handleTestFailure(error, context, recoveryOptions);
      
      expect(result.recoveryAttempted).toBe(true);
      expect(result.recoverySuccessful).toBe(true);
      expect(result.finalState).toBe('recovered');
    });

    test('handles test failure without recovery', async () => {
      const error = new Error('Test failure');
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: []
      };
      
      const recoveryOptions = {
        attemptRecovery: false
      };
      
      const result = await errorRecovery.handleTestFailure(error, context, recoveryOptions);
      
      expect(result.recoveryAttempted).toBe(false);
      expect(result.recoverySuccessful).toBe(false);
      expect(result.finalState).toBe('failed');
    });

    test('performs cleanup after test failure', async () => {
      const error = new Error('Test failure');
      const cleanupResource: TestResource = {
        type: 'file',
        identifier: 'test-file',
        cleanup: vi.fn().mockResolvedValue(undefined)
      };
      
      const context = {
        operation: 'test_operation',
        phase: 'execution' as const,
        resources: [cleanupResource]
      };
      
      const result = await errorRecovery.handleTestFailure(error, context);
      
      expect(result.cleanupPerformed).toBe(true);
      expect(cleanupResource.cleanup).toHaveBeenCalledTimes(1);
    });
  });
});
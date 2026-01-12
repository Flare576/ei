// E2E Test Harness Tests
// Comprehensive tests for the E2ETestHarness implementation

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from './harness.js';
import { TestConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('E2ETestHarness', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(() => {
    harness = new E2ETestHarnessImpl();
  });

  afterEach(async () => {
    // Ensure cleanup happens even if tests fail
    try {
      await harness.cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  describe('Lifecycle Management', () => {
    test('should setup and cleanup successfully', async () => {
      const config: TestConfig = {
        tempDirPrefix: 'harness-test',
        mockServerPort: 3001,
        appTimeout: 3000
      };

      await harness.setup(config);
      
      // Verify temp directory was created
      const tempPath = harness.getTempDataPath();
      expect(tempPath).toBeTruthy();
      expect(fs.existsSync(tempPath!)).toBe(true);

      // Verify environment variables were set
      expect(process.env.EI_DATA_PATH).toBe(tempPath);
      expect(process.env.EI_LLM_BASE_URL).toContain('localhost:3001');

      await harness.cleanup();

      // Verify temp directory was cleaned up
      expect(fs.existsSync(tempPath!)).toBe(false);
    });

    test('should prevent double setup', async () => {
      const config: TestConfig = { tempDirPrefix: 'double-setup-test' };
      
      await harness.setup(config);
      
      await expect(harness.setup(config)).rejects.toThrow('already set up');
      
      await harness.cleanup();
    });

    test('should handle cleanup errors gracefully', async () => {
      const config: TestConfig = { tempDirPrefix: 'cleanup-error-test' };
      
      await harness.setup(config);
      
      // Manually delete temp directory to simulate cleanup error
      const tempPath = harness.getTempDataPath();
      if (tempPath && fs.existsSync(tempPath)) {
        await fs.promises.rm(tempPath, { recursive: true, force: true });
      }
      
      // Cleanup should not throw even if temp directory is already gone
      await expect(harness.cleanup()).resolves.not.toThrow();
    });
  });

  describe('Configuration Management', () => {
    test('should use default configuration when none provided', async () => {
      await harness.setup({});
      
      const tempPath = harness.getTempDataPath();
      expect(tempPath).toContain('e2e-test'); // Default prefix
      
      await harness.cleanup();
    });

    test('should apply custom configuration', async () => {
      const config: TestConfig = {
        tempDirPrefix: 'custom-prefix',
        mockServerPort: 3002,
        appTimeout: 8000,
        cleanupTimeout: 5000
      };

      await harness.setup(config);
      
      const tempPath = harness.getTempDataPath();
      expect(tempPath).toContain('custom-prefix');
      expect(process.env.EI_LLM_BASE_URL).toContain('localhost:3002');
      
      await harness.cleanup();
    });
  });

  describe('Mock Server Integration', () => {
    test('should configure mock responses', async () => {
      await harness.setup({ mockServerPort: 3003 });
      
      harness.setMockResponse('/v1/chat/completions', 'Custom test response', 100);
      
      // Verify mock server is accessible
      const requestHistory = harness.getMockRequestHistory();
      expect(Array.isArray(requestHistory)).toBe(true);
      
      await harness.cleanup();
    });

    test('should enable streaming responses', async () => {
      await harness.setup({ mockServerPort: 3004 });
      
      const chunks = ['Hello', ' ', 'world', '!'];
      harness.enableMockStreaming('/v1/chat/completions', chunks);
      
      // This test verifies the method doesn't throw
      // Full streaming functionality is tested in mock-server.test.ts
      
      await harness.cleanup();
    });
  });

  describe('File System Operations', () => {
    test('should create and monitor files', async () => {
      await harness.setup({ tempDirPrefix: 'file-ops-test' });
      
      const tempPath = harness.getTempDataPath()!;
      const testFile = path.join(tempPath, 'test.txt');
      
      // Test file creation detection
      const creationPromise = harness.waitForFileCreation('test.txt', 2000);
      
      // Create the file after a brief delay
      setTimeout(async () => {
        await fs.promises.writeFile(testFile, 'test content');
      }, 100);
      
      await creationPromise;
      
      // Verify file exists
      harness.assertFileExists('test.txt');
      
      await harness.cleanup();
    });

    test('should wait for file content changes', async () => {
      await harness.setup({ tempDirPrefix: 'file-content-test' });
      
      const tempPath = harness.getTempDataPath()!;
      const testFile = path.join(tempPath, 'content.txt');
      
      // Create initial file
      await fs.promises.writeFile(testFile, 'initial content');
      
      // Wait for specific content
      const contentPromise = harness.waitForFileContent('content.txt', 'updated content', 2000);
      
      // Update file content after a brief delay
      setTimeout(async () => {
        await fs.promises.writeFile(testFile, 'updated content');
      }, 100);
      
      const content = await contentPromise;
      expect(content).toBe('updated content');
      
      await harness.cleanup();
    });
  });

  describe('Assertion Methods', () => {
    test('should assert file existence correctly', async () => {
      await harness.setup({ tempDirPrefix: 'assertion-test' });
      
      const tempPath = harness.getTempDataPath()!;
      const existingFile = path.join(tempPath, 'exists.txt');
      
      // Create a file
      await fs.promises.writeFile(existingFile, 'content');
      
      // Should not throw for existing file
      harness.assertFileExists('exists.txt');
      
      // Should throw for non-existing file
      expect(() => harness.assertFileDoesNotExist('exists.txt')).toThrow();
      expect(() => harness.assertFileExists('nonexistent.txt')).toThrow();
      
      await harness.cleanup();
    });

    test('should assert file content correctly', async () => {
      await harness.setup({ tempDirPrefix: 'content-assertion-test' });
      
      const tempPath = harness.getTempDataPath()!;
      const testFile = path.join(tempPath, 'content.txt');
      
      await fs.promises.writeFile(testFile, 'Hello world!');
      
      // Should not throw for matching content
      await harness.assertFileContent('content.txt', 'Hello world!');
      await harness.assertFileContent('content.txt', /Hello \w+!/);
      
      // Should throw for non-matching content
      await expect(harness.assertFileContent('content.txt', 'Goodbye')).rejects.toThrow();
      
      await harness.cleanup();
    });

    test('should assert directory structure correctly', async () => {
      await harness.setup({ tempDirPrefix: 'directory-test' });
      
      const tempPath = harness.getTempDataPath()!;
      const testDir = path.join(tempPath, 'testdir');
      
      // Create directory with files
      await fs.promises.mkdir(testDir, { recursive: true });
      await fs.promises.writeFile(path.join(testDir, 'file1.txt'), 'content1');
      await fs.promises.writeFile(path.join(testDir, 'file2.txt'), 'content2');
      
      // Should not throw for existing directory
      harness.assertDirectoryExists('testdir');
      harness.assertDirectoryExists('testdir', ['file1.txt', 'file2.txt']);
      
      // Should throw for missing files
      expect(() => harness.assertDirectoryExists('testdir', ['missing.txt'])).toThrow();
      
      await harness.cleanup();
    });

    test('should assert mock request interactions', async () => {
      await harness.setup({ mockServerPort: 3005 });
      
      // Initially no requests
      harness.assertMockRequestCount(0);
      
      // This would normally be called by the application
      // For testing, we just verify the assertion methods work
      expect(() => harness.assertMockRequestReceived('/v1/chat/completions')).toThrow();
      
      await harness.cleanup();
    });
  });

  describe('Wait Conditions', () => {
    test('should wait for custom conditions', async () => {
      await harness.setup({ tempDirPrefix: 'condition-test' });
      
      let conditionMet = false;
      
      const conditionPromise = harness.waitForCondition(
        () => conditionMet,
        'test condition',
        2000,
        50
      );
      
      // Set condition to true after delay
      setTimeout(() => {
        conditionMet = true;
      }, 100);
      
      await conditionPromise;
      
      await harness.cleanup();
    });

    test('should timeout on unmet conditions', async () => {
      await harness.setup({ tempDirPrefix: 'timeout-test' });
      
      const conditionPromise = harness.waitForCondition(
        () => false, // Never true
        'impossible condition',
        500, // Short timeout
        50
      );
      
      await expect(conditionPromise).rejects.toThrow('timeout');
      
      await harness.cleanup();
    });
  });

  describe('Error Handling', () => {
    test('should handle setup failures gracefully', async () => {
      // Try to use an invalid port (negative number)
      const config: TestConfig = {
        mockServerPort: -1
      };
      
      await expect(harness.setup(config)).rejects.toThrow();
      
      // Harness should still be in clean state
      expect(harness.getTempDataPath()).toBeNull();
    });

    test('should provide meaningful error messages', async () => {
      // Test without setup
      await expect(harness.startApp()).rejects.toThrow('must be set up');
      await expect(harness.waitForUIChange()).rejects.toThrow('not running');
      
      expect(() => harness.assertFileExists('nonexistent')).toThrow('not set up');
    });
  });

  describe('State Management', () => {
    test('should track application running state', async () => {
      await harness.setup({ tempDirPrefix: 'state-test' });
      
      // Initially not running
      expect(harness.isAppRunning()).toBe(false);
      harness.assertProcessState(false);
      
      // Should throw when trying to assert running state
      expect(() => harness.assertProcessState(true)).toThrow();
      
      await harness.cleanup();
    });

    test('should provide utility methods', async () => {
      await harness.setup({ tempDirPrefix: 'utility-test' });
      
      // Test utility methods don't throw
      expect(harness.getTempDataPath()).toBeTruthy();
      expect(Array.isArray(harness.getMockRequestHistory())).toBe(true);
      
      await harness.cleanup();
    });
  });
});
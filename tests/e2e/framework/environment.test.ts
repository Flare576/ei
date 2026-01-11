// Environment Manager unit tests
// Tests for the environment management component

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnvironmentManagerImpl } from './environment.js';
import { EnvironmentConfig } from '../types.js';

describe('Environment Manager Unit Tests', () => {
  let envManager: EnvironmentManagerImpl;
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    envManager = new EnvironmentManagerImpl();
    // Store original environment for restoration
    originalEnv = {
      EI_DATA_PATH: process.env.EI_DATA_PATH,
      EI_LLM_BASE_URL: process.env.EI_LLM_BASE_URL,
      EI_LLM_API_KEY: process.env.EI_LLM_API_KEY,
      EI_LLM_MODEL: process.env.EI_LLM_MODEL
    };
  });

  afterEach(async () => {
    // Clean up environment manager
    await envManager.cleanup();
    
    // Restore original environment
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('Temporary Directory Management', () => {
    test('creates unique temp directories with prefix', async () => {
      const prefix = 'test-env';
      const dir1 = await envManager.createTempDir(prefix);
      const dir2 = await envManager.createTempDir(prefix);

      // Directories should be different
      expect(dir1).not.toBe(dir2);
      
      // Both should exist
      expect(fs.existsSync(dir1)).toBe(true);
      expect(fs.existsSync(dir2)).toBe(true);
      
      // Both should be in temp directory
      expect(dir1).toContain(os.tmpdir());
      expect(dir2).toContain(os.tmpdir());
      
      // Both should contain the prefix
      expect(path.basename(dir1)).toContain(prefix);
      expect(path.basename(dir2)).toContain(prefix);
    });

    test('tracks created temp directories', async () => {
      const dir1 = await envManager.createTempDir('test');
      const dir2 = await envManager.createTempDir('test');
      
      const trackedDirs = envManager.getTempDirectories();
      expect(trackedDirs).toContain(dir1);
      expect(trackedDirs).toContain(dir2);
      expect(trackedDirs).toHaveLength(2);
    });

    test('cleans up temp directories', async () => {
      const tempDir = await envManager.createTempDir('cleanup-test');
      
      // Create a file in the temp directory
      const testFile = path.join(tempDir, 'test.txt');
      await fs.promises.writeFile(testFile, 'test content');
      
      expect(fs.existsSync(tempDir)).toBe(true);
      expect(fs.existsSync(testFile)).toBe(true);
      
      await envManager.cleanupTempDir(tempDir);
      
      expect(fs.existsSync(tempDir)).toBe(false);
      expect(fs.existsSync(testFile)).toBe(false);
    });

    test('handles cleanup of non-existent directory gracefully', async () => {
      const tempDir = await envManager.createTempDir('nonexistent-test');
      
      // Manually remove the directory
      await fs.promises.rm(tempDir, { recursive: true, force: true });
      
      // Cleanup should not throw
      await expect(envManager.cleanupTempDir(tempDir)).resolves.not.toThrow();
    });

    test('throws error when cleaning up untracked directory', async () => {
      const untrackedDir = path.join(os.tmpdir(), 'untracked-dir');
      
      await expect(envManager.cleanupTempDir(untrackedDir))
        .rejects.toThrow(`Directory ${untrackedDir} was not created by this EnvironmentManager`);
    });
  });

  describe('Environment Variable Management', () => {
    test('sets and restores environment variables', () => {
      const testConfig: EnvironmentConfig = {
        EI_DATA_PATH: '/test/data/path',
        EI_LLM_BASE_URL: 'http://test.example.com',
        EI_LLM_API_KEY: 'test-key',
        EI_LLM_MODEL: 'test-model'
      };

      envManager.setTestEnvironment(testConfig);

      // Check that environment variables are set
      expect(process.env.EI_DATA_PATH).toBe('/test/data/path');
      expect(process.env.EI_LLM_BASE_URL).toBe('http://test.example.com');
      expect(process.env.EI_LLM_API_KEY).toBe('test-key');
      expect(process.env.EI_LLM_MODEL).toBe('test-model');

      envManager.restoreEnvironment();

      // Check that original values are restored
      expect(process.env.EI_DATA_PATH).toBe(originalEnv.EI_DATA_PATH);
      expect(process.env.EI_LLM_BASE_URL).toBe(originalEnv.EI_LLM_BASE_URL);
      expect(process.env.EI_LLM_API_KEY).toBe(originalEnv.EI_LLM_API_KEY);
      expect(process.env.EI_LLM_MODEL).toBe(originalEnv.EI_LLM_MODEL);
    });

    test('handles undefined original environment variables', () => {
      // Ensure a variable is undefined
      delete process.env.EI_TEST_VAR;
      
      const testConfig = {
        EI_DATA_PATH: '/test/path',
        EI_LLM_BASE_URL: 'http://test.com',
        EI_LLM_API_KEY: 'key',
        EI_LLM_MODEL: 'model',
        EI_TEST_VAR: 'test-value'
      } as EnvironmentConfig & { EI_TEST_VAR: string };

      envManager.setTestEnvironment(testConfig);
      expect(process.env.EI_TEST_VAR).toBe('test-value');

      envManager.restoreEnvironment();
      expect(process.env.EI_TEST_VAR).toBeUndefined();
    });
  });

  describe('File System Monitoring', () => {
    test('watches file changes', async () => {
      const tempDir = await envManager.createTempDir('watch-test');
      const testFile = path.join(tempDir, 'watch-me.txt');
      
      // Create initial file
      await fs.promises.writeFile(testFile, 'initial content');
      
      let changeEvent: string | null = null;
      const watcher = envManager.watchFile(testFile, (event) => {
        changeEvent = event;
      });

      // Modify the file
      await fs.promises.writeFile(testFile, 'modified content');
      
      // Wait a bit for the file system event
      await new Promise(resolve => setTimeout(resolve, 100));
      
      expect(changeEvent).toBeTruthy();
      expect(changeEvent).toContain('change');
      
      watcher.close();
    });

    test('tracks watched files', async () => {
      const tempDir = await envManager.createTempDir('track-test');
      const file1 = path.join(tempDir, 'file1.txt');
      const file2 = path.join(tempDir, 'file2.txt');
      
      await fs.promises.writeFile(file1, 'content1');
      await fs.promises.writeFile(file2, 'content2');
      
      const watcher1 = envManager.watchFile(file1, () => {});
      const watcher2 = envManager.watchFile(file2, () => {});
      
      const watchedFiles = envManager.getWatchedFiles();
      expect(watchedFiles).toContain(file1);
      expect(watchedFiles).toContain(file2);
      expect(watchedFiles).toHaveLength(2);
      
      watcher1.close();
      watcher2.close();
    });

    test('prevents watching same file twice', async () => {
      const tempDir = await envManager.createTempDir('duplicate-watch-test');
      const testFile = path.join(tempDir, 'test.txt');
      
      await fs.promises.writeFile(testFile, 'content');
      
      const watcher1 = envManager.watchFile(testFile, () => {});
      
      expect(() => envManager.watchFile(testFile, () => {}))
        .toThrow(`File ${testFile} is already being watched`);
      
      watcher1.close();
    });

    test('unwatches files correctly', async () => {
      const tempDir = await envManager.createTempDir('unwatch-test');
      const testFile = path.join(tempDir, 'test.txt');
      
      await fs.promises.writeFile(testFile, 'content');
      
      const watcher = envManager.watchFile(testFile, () => {});
      expect(envManager.getWatchedFiles()).toContain(testFile);
      
      envManager.unwatchFile(watcher);
      expect(envManager.getWatchedFiles()).not.toContain(testFile);
    });
  });

  describe('Complete Cleanup', () => {
    test('cleans up all resources', async () => {
      // Create temp directories
      const dir1 = await envManager.createTempDir('cleanup-all-1');
      const dir2 = await envManager.createTempDir('cleanup-all-2');
      
      // Set environment variables
      const testConfig: EnvironmentConfig = {
        EI_DATA_PATH: '/test/cleanup',
        EI_LLM_BASE_URL: 'http://cleanup.test',
        EI_LLM_API_KEY: 'cleanup-key',
        EI_LLM_MODEL: 'cleanup-model'
      };
      envManager.setTestEnvironment(testConfig);
      
      // Create file watchers
      const file1 = path.join(dir1, 'watch1.txt');
      const file2 = path.join(dir2, 'watch2.txt');
      await fs.promises.writeFile(file1, 'content1');
      await fs.promises.writeFile(file2, 'content2');
      
      envManager.watchFile(file1, () => {});
      envManager.watchFile(file2, () => {});
      
      // Verify everything is set up
      expect(envManager.getTempDirectories()).toHaveLength(2);
      expect(envManager.getWatchedFiles()).toHaveLength(2);
      expect(process.env.EI_DATA_PATH).toBe('/test/cleanup');
      
      // Cleanup everything
      await envManager.cleanup();
      
      // Verify everything is cleaned up
      expect(envManager.getTempDirectories()).toHaveLength(0);
      expect(envManager.getWatchedFiles()).toHaveLength(0);
      expect(fs.existsSync(dir1)).toBe(false);
      expect(fs.existsSync(dir2)).toBe(false);
      expect(process.env.EI_DATA_PATH).toBe(originalEnv.EI_DATA_PATH);
    });
  });
});
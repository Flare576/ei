// Environment Manager Implementation
// Handles temporary directory creation, cleanup, and environment variable management

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EnvironmentManager, EnvironmentConfig, FileWatcher } from '../types.js';

export class EnvironmentManagerImpl implements EnvironmentManager {
  private originalEnv: Record<string, string | undefined> = {};
  private tempDirs: Set<string> = new Set();
  private watchers: Map<string, fs.FSWatcher> = new Map();

  /**
   * Creates a unique temporary directory with the given prefix
   * Requirements: 1.1 - Create temporary data directory for each test
   */
  async createTempDir(prefix: string): Promise<string> {
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 8);
    const dirName = `${prefix}-${timestamp}-${randomSuffix}`;
    const tempPath = path.join(os.tmpdir(), dirName);

    try {
      await fs.promises.mkdir(tempPath, { recursive: true });
      this.tempDirs.add(tempPath);
      return tempPath;
    } catch (error) {
      throw new Error(`Failed to create temp directory ${tempPath}: ${error}`);
    }
  }

  /**
   * Recursively removes a temporary directory and all its contents
   * Requirements: 1.3 - Clean up all temporary files and directories after test completion
   */
  async cleanupTempDir(dirPath: string): Promise<void> {
    if (!this.tempDirs.has(dirPath)) {
      throw new Error(`Directory ${dirPath} was not created by this EnvironmentManager`);
    }

    try {
      // Check if directory exists before attempting to remove
      await fs.promises.access(dirPath);
      await fs.promises.rm(dirPath, { recursive: true, force: true });
      this.tempDirs.delete(dirPath);
    } catch (error: any) {
      // If directory doesn't exist (ENOENT), that's fine - it's already cleaned up
      if (error.code !== 'ENOENT') {
        throw new Error(`Failed to cleanup temp directory ${dirPath}: ${error}`);
      }
      // Still remove from tracking set even if directory didn't exist
      this.tempDirs.delete(dirPath);
    }
  }

  /**
   * Sets test environment variables and stores originals for restoration
   * Requirements: 1.1 - Application uses temporary directory for all data operations
   */
  setTestEnvironment(config: EnvironmentConfig): void {
    // Store original values for restoration
    for (const key of Object.keys(config)) {
      if (!(key in this.originalEnv)) {
        this.originalEnv[key] = process.env[key];
      }
    }

    // Set new environment variables
    Object.assign(process.env, config);
  }

  /**
   * Restores original environment variables
   * Requirements: 1.3 - Clean up all test artifacts after completion
   */
  restoreEnvironment(): void {
    for (const [key, originalValue] of Object.entries(this.originalEnv)) {
      if (originalValue === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originalValue;
      }
    }
    this.originalEnv = {};
  }

  /**
   * Watches a file or directory for changes
   * Requirements: 3.2 - Detect and record file modifications
   */
  watchFile(filePath: string, callback: (event: string) => void): FileWatcher {
    if (this.watchers.has(filePath)) {
      throw new Error(`File ${filePath} is already being watched`);
    }

    const watcher = fs.watch(filePath, { persistent: false }, (eventType, filename) => {
      const event = `${eventType}:${filename || path.basename(filePath)}`;
      callback(event);
    });

    this.watchers.set(filePath, watcher);

    return {
      close: () => {
        watcher.close();
        this.watchers.delete(filePath);
      }
    };
  }

  /**
   * Stops watching a file
   * Requirements: 3.2 - Handle file change events and notifications
   */
  unwatchFile(watcher: FileWatcher): void {
    watcher.close();
  }

  /**
   * Cleanup all resources managed by this EnvironmentManager
   * This is a convenience method for complete cleanup
   */
  async cleanup(): Promise<void> {
    // Close all file watchers
    for (const watcher of this.watchers.values()) {
      watcher.close();
    }
    this.watchers.clear();

    // Clean up all temp directories
    const cleanupPromises = Array.from(this.tempDirs).map(dir => 
      this.cleanupTempDir(dir).catch(error => {
        console.warn(`Warning: Failed to cleanup temp directory ${dir}:`, error);
      })
    );
    await Promise.all(cleanupPromises);

    // Restore environment
    this.restoreEnvironment();
  }

  /**
   * Get list of all temp directories created by this manager
   * Useful for testing and debugging
   */
  getTempDirectories(): string[] {
    return Array.from(this.tempDirs);
  }

  /**
   * Get list of all files currently being watched
   * Useful for testing and debugging
   */
  getWatchedFiles(): string[] {
    return Array.from(this.watchers.keys());
  }
}
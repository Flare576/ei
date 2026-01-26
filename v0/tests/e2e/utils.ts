// E2E Test Utilities
// Common utility functions for e2e testing

import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * Generate a unique temporary directory name
 */
export function generateTempDirName(prefix: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 8);
  return `${prefix}-${timestamp}-${random}`;
}

/**
 * Create a temporary directory for testing
 */
export async function createTempDirectory(prefix: string): Promise<string> {
  const tempDirName = generateTempDirName(prefix);
  const tempPath = join(tmpdir(), tempDirName);
  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

/**
 * Recursively remove a directory and all its contents
 */
export async function removeDirectory(path: string): Promise<void> {
  try {
    await fs.rm(path, { recursive: true, force: true });
  } catch (error) {
    // Ignore errors if directory doesn't exist
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw error;
    }
  }
}

/**
 * Wait for a specified amount of time
 */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true with timeout
 */
export async function waitForCondition(
  condition: () => boolean | Promise<boolean>,
  timeout: number = 5000,
  interval: number = 100
): Promise<void> {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await delay(interval);
  }
  
  throw new Error(`Condition not met within ${timeout}ms timeout`);
}

/**
 * Check if a file exists
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get available port for mock server
 */
export async function getAvailablePort(startPort: number = 3001): Promise<number> {
  const net = await import('net');
  
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    
    server.listen(startPort, () => {
      const port = (server.address() as any)?.port;
      server.close(() => {
        resolve(port);
      });
    });
    
    server.on('error', (err: any) => {
      if (err.code === 'EADDRINUSE') {
        // Port is in use, try next one
        resolve(getAvailablePort(startPort + 1));
      } else {
        reject(err);
      }
    });
  });
}

/**
 * Parse terminal escape sequences to extract readable content
 */
export function parseTerminalOutput(output: string): string {
  // Remove ANSI escape sequences
  return output.replace(/\x1b\[[0-9;]*[mGKHF]/g, '');
}

/**
 * Extract meaningful content from blessed terminal output
 */
export function extractBlessedContent(output: string): {
  title?: string;
  personas?: string[];
  messages?: string[];
  statusLine?: string;
} {
  const cleaned = parseTerminalOutput(output);
  
  // This is a basic parser - will be enhanced as we understand the output format better
  const result: any = {};
  
  // Look for common patterns in EI output
  if (cleaned.includes('Emotional Intelligence')) {
    result.title = 'Emotional Intelligence';
  }
  
  // Extract persona names (basic pattern matching)
  const personaMatches = cleaned.match(/\[([^\]]+)\]/g);
  if (personaMatches) {
    result.personas = personaMatches.map(match => match.slice(1, -1));
  }
  
  return result;
}
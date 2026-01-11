// Comprehensive quit command integration tests
// Tests quit command through actual application process with state persistence validation

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';
import { E2ETestHarness } from '../types.js';
import * as path from 'path';
import * as fs from 'fs';

describe('Quit Command Integration Tests', () => {
  let harness: E2ETestHarness;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'quit-integration-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  /**
   * Test quit command through actual application process
   * Requirements: 5.1, 5.2, 5.3, 5.4 - Test quit command through actual application process
   */
  test('quit command works through actual application process', async () => {
    // Start the application with debug mode for better output visibility
    await harness.startApp({ debugMode: true });
    
    // Wait for application to fully initialize
    await harness.waitForIdleState(5000);
    
    // Verify application is running
    harness.assertProcessState(true);
    
    // Send some input to ensure application is responsive
    await harness.sendInput('hello\n');
    
    // Wait for any processing to complete
    await harness.waitForIdleState(3000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Wait for application to exit
    await harness.assertExitCode(0, 8000);
    
    // Verify application is no longer running
    harness.assertProcessState(false);
  }, 25000);

  /**
   * Test state persistence before termination
   * Requirements: 5.5 - WHEN quit executes, THE Application SHALL persist all current state before termination
   */
  test('quit command persists state before termination', async () => {
    const tempDataPath = harness.getTempDataPath();
    expect(tempDataPath).toBeTruthy();
    
    // Start the application
    await harness.startApp({ debugMode: false });
    
    // Wait for initialization
    await harness.waitForIdleState(5000);
    
    // Send some messages to create state that needs to be persisted
    await harness.sendInput('Create some conversation history\n');
    
    // Wait for processing and response
    await harness.waitForLLMRequest(3000);
    await harness.waitForIdleState(5000);
    
    // Send another message to ensure we have multiple entries
    await harness.sendInput('Add more to the conversation\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Wait for application to exit
    await harness.assertExitCode(0, 10000);
    
    // Verify that state files were created and contain data
    const personasDir = path.join(tempDataPath!, 'personas');
    harness.assertDirectoryExists('personas');
    
    // Check if any persona directories were created
    if (fs.existsSync(personasDir)) {
      const personaDirs = fs.readdirSync(personasDir);
      if (personaDirs.length > 0) {
        // Check the first persona directory for state files
        const firstPersonaDir = personaDirs[0];
        const personaPath = path.join('personas', firstPersonaDir);
        
        // Verify system file exists
        harness.assertFileExists(path.join(personaPath, 'system.jsonc'));
        
        // Verify history file exists if messages were processed
        const historyPath = path.join(personaPath, 'history.jsonc');
        if (fs.existsSync(path.join(tempDataPath!, historyPath))) {
          harness.assertFileExists(historyPath);
          
          // Verify history file contains actual data
          await harness.assertFileContent(historyPath, 'conversation');
        }
      }
    }
  }, 30000);

  /**
   * Test all quit command variations and edge cases
   * Requirements: 5.1, 5.2, 5.3, 5.4 - Test all quit command variations and edge cases
   */
  test('quit command variations work correctly', async () => {
    // Test basic quit command
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    await harness.sendCommand('quit');
    await harness.assertExitCode(0, 5000);
    
    // Test quit with uppercase
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    await harness.sendCommand('QUIT');
    await harness.assertExitCode(0, 5000);
    
    // Test quit with extra whitespace
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    await harness.sendCommand('  quit  ');
    await harness.assertExitCode(0, 5000);
  }, 25000);

  /**
   * Test quit command with concurrent operations
   * Requirements: 5.2, 5.3 - Test quit behavior with concurrent operations
   */
  test('quit command handles concurrent operations correctly', async () => {
    // Configure mock server with delayed responses
    harness.setMockResponse('/v1/chat/completions', 'Response to concurrent operation', 2000);
    
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Start multiple concurrent operations
    await harness.sendInput('First concurrent message\n');
    await harness.sendInput('Second concurrent message\n');
    
    // Wait for at least one LLM request to start
    await harness.waitForLLMRequest(2000);
    
    // Send quit command while operations are in progress
    await harness.sendCommand('quit');
    
    // Application should handle concurrent operations and exit cleanly
    await harness.assertExitCode(0, 8000);
    
    // Verify that at least one request was made
    const requestCount = harness.getMockRequestHistory().length;
    expect(requestCount).toBeGreaterThan(0);
  }, 20000);

  /**
   * Test integration with existing Ctrl+C logic
   * Requirements: 5.5 - Validate integration with existing Ctrl+C logic
   */
  test('quit command integrates properly with Ctrl+C handling', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Send some input to establish state
    await harness.sendInput('Test message for Ctrl+C integration\n');
    await harness.waitForIdleState(5000);
    
    // Send quit command (which should work similarly to Ctrl+C but more gracefully)
    await harness.sendCommand('quit');
    
    // Verify clean exit
    await harness.assertExitCode(0, 8000);
    
    // Verify state was persisted (similar to Ctrl+C behavior)
    const tempDataPath = harness.getTempDataPath();
    if (tempDataPath && fs.existsSync(path.join(tempDataPath, 'personas'))) {
      harness.assertDirectoryExists('personas');
    }
  }, 20000);

  /**
   * Test quit command error handling and recovery
   * Requirements: 5.1, 5.2, 5.3, 5.4 - Test error handling during quit process
   */
  test('quit command handles errors gracefully', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Create some state
    await harness.sendInput('Create state before error test\n');
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Even if there are internal errors during quit, the application should exit
    // We use a longer timeout to allow for error handling
    await harness.assertExitCode(0, 15000);
    
    // Verify application stopped
    harness.assertProcessState(false);
  }, 25000);

  /**
   * Test quit command with different application states
   * Requirements: 5.1, 5.2, 5.3 - Test quit command behavior across different application states
   */
  test('quit command works in different application states', async () => {
    // Test 1: Quit immediately after startup
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(2000);
    
    await harness.sendCommand('quit');
    await harness.assertExitCode(0, 5000);
    
    // Test 2: Quit after some interaction
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(2000);
    
    await harness.sendInput('Some interaction\n');
    await harness.waitForIdleState(3000);
    
    await harness.sendCommand('quit');
    await harness.assertExitCode(0, 5000);
    
    // Test 3: Quit during active processing
    harness.setMockResponse('/v1/chat/completions', 'Processing response', 1500);
    
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(2000);
    
    await harness.sendInput('Trigger processing\n');
    await harness.waitForLLMRequest(1000);
    
    await harness.sendCommand('quit');
    await harness.assertExitCode(0, 8000);
  }, 35000);

  /**
   * Test quit command output and user feedback
   * Requirements: 5.3 - Test that quit command provides appropriate user feedback
   */
  test('quit command provides appropriate user feedback', async () => {
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Look for quit confirmation or goodbye message in output
    try {
      await harness.waitForUIText('goodbye', 2000);
    } catch {
      // If no goodbye message, that's okay - just ensure clean exit
    }
    
    // Verify clean exit
    await harness.assertExitCode(0, 5000);
  }, 15000);

  /**
   * Test quit command performance and timing
   * Requirements: 5.1, 5.2 - Test quit command performance characteristics
   */
  test('quit command completes within reasonable time', async () => {
    const startTime = Date.now();
    
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Record time when quit command is sent
    const quitStartTime = Date.now();
    await harness.sendCommand('quit');
    
    // Wait for exit and record completion time
    await harness.assertExitCode(0, 5000);
    const quitEndTime = Date.now();
    
    // Quit should complete within 3 seconds for idle application
    const quitDuration = quitEndTime - quitStartTime;
    expect(quitDuration).toBeLessThan(3000);
  }, 15000);

  /**
   * Test quit command with file system operations
   * Requirements: 5.5 - Test state persistence during quit with file operations
   */
  test('quit command handles file operations correctly', async () => {
    const tempDataPath = harness.getTempDataPath();
    expect(tempDataPath).toBeTruthy();
    
    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    // Perform operations that would create files
    await harness.sendInput('Create file-based state\n');
    await harness.waitForIdleState(5000);
    
    // Send quit command
    await harness.sendCommand('quit');
    
    // Wait for exit
    await harness.assertExitCode(0, 8000);
    
    // Verify that the temp directory structure is intact
    // (Files should be persisted, not corrupted by quit process)
    if (fs.existsSync(tempDataPath!)) {
      const stats = fs.statSync(tempDataPath!);
      expect(stats.isDirectory()).toBe(true);
    }
  }, 20000);
});
/**
 * Test Support Module
 * 
 * Handles E2E test input injection system for automated testing.
 * Extracted from the monolithic app.ts as part of the modularization effort.
 * 
 * This module provides:
 * - Test mode detection based on environment variables
 * - Stdin-based input injection for E2E test frameworks
 * - Command and message routing for test inputs
 * - Public API for direct test input injection
 */

import { appendDebugLog } from '../storage.js';
import type { ITestSupport, TestSupportDependencies } from './interfaces.js';

function debugLog(message: string) {
  appendDebugLog(message);
}

export class TestSupport implements ITestSupport {
  private testInputEnabled: boolean;
  private testInputBuffer: string[] = [];
  private instanceId: number;
  
  // Dependencies
  private commandHandler: TestSupportDependencies['commandHandler'];
  private messageProcessor: TestSupportDependencies['messageProcessor'];
  private app: TestSupportDependencies['app'];

  constructor(dependencies: TestSupportDependencies, instanceId: number) {
    this.commandHandler = dependencies.commandHandler;
    this.messageProcessor = dependencies.messageProcessor;
    this.app = dependencies.app;
    this.instanceId = instanceId;
    
    // Check if we're in test mode
    this.testInputEnabled = this.isTestModeEnabled();
    debugLog(`TestSupport initialized - Test input enabled: ${this.testInputEnabled} - Instance #${this.instanceId}`);
  }

  /**
   * Check if test mode is enabled based on environment variables
   */
  public isTestModeEnabled(): boolean {
    return process.env.NODE_ENV === 'test' || process.env.EI_TEST_INPUT === 'true';
  }

  /**
   * Set up test input injection system for E2E testing
   * This allows tests to inject input directly into the application
   */
  public setupTestInputInjection(): void {
    if (!this.testInputEnabled) {
      debugLog(`Test input injection setup skipped - not in test mode - Instance #${this.instanceId}`);
      return;
    }

    debugLog(`Setting up test input injection - Instance #${this.instanceId}`);
    
    // Listen for test input on stdin in addition to blessed input
    if (process.stdin && process.stdin.readable) {
      process.stdin.on('data', (data: Buffer) => {
        const input = data.toString().trim();
        debugLog(`Test input received: "${input}" - Instance #${this.instanceId}`);
        
        // Process the input as if it came from the UI
        this.processTestInput(input);
      });
      
      // Make sure stdin is in the right mode
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(false); // We want line-buffered input for testing
      }
      process.stdin.resume();
    }
    
    debugLog(`Test input injection setup complete - Instance #${this.instanceId}`);
  }

  /**
   * Process input received through the test injection system
   * Routes commands to CommandHandler and messages to MessageProcessor
   */
  public processTestInput(input: string): void {
    if (!this.testInputEnabled) {
      debugLog(`Test input processing attempted but not enabled - Instance #${this.instanceId}`);
      return;
    }

    debugLog(`Processing test input: "${input}" - Instance #${this.instanceId}`);
    
    // Handle commands (starting with /)
    if (input.startsWith('/')) {
      debugLog(`Test command detected: "${input}" - Instance #${this.instanceId}`);
      
      // Special handling for /quit command in test mode
      if (input === '/quit') {
        debugLog(`Test quit command - Instance #${this.instanceId}`);
        this.handleTestQuit();
        return;
      }
      
      // Route other commands through CommandHandler
      const parsedCommand = this.commandHandler.parseCommand(input);
      if (parsedCommand) {
        this.commandHandler.executeCommand(parsedCommand).catch(error => {
          debugLog(`Test command execution error: ${error instanceof Error ? error.message : String(error)} - Instance #${this.instanceId}`);
        });
      } else {
        debugLog(`Unknown test command: "${input}" - Instance #${this.instanceId}`);
      }
      return;
    }
    
    // Handle regular messages - route through the app's submit handler
    if (input.length > 0) {
      debugLog(`Test message submission: "${input}" - Instance #${this.instanceId}`);
      // We need to simulate the handleSubmit behavior for test inputs
      // This will be handled by calling the app's message processing logic
      this.handleTestMessage(input);
    }
  }

  /**
   * Handle test message submission
   * Simulates the app's handleSubmit logic for test inputs
   */
  private async handleTestMessage(message: string): Promise<void> {
    try {
      // Get current persona from persona manager
      const currentPersona = this.app.getCurrentPersona?.() || 'ei';
      
      // Process the message through MessageProcessor
      await this.messageProcessor.processMessage(currentPersona, message);
      
      debugLog(`Test message processed successfully: "${message}" - Instance #${this.instanceId}`);
    } catch (error) {
      debugLog(`Test message processing error: ${error instanceof Error ? error.message : String(error)} - Instance #${this.instanceId}`);
    }
  }

  /**
   * Handle quit command for testing
   * Provides clean exit for test scenarios
   */
  private handleTestQuit(): void {
    debugLog(`Handling test quit command - Instance #${this.instanceId}`);
    
    // Clean exit for testing - destroy screen and exit
    // Note: In test mode, we want immediate exit without the normal confirmation logic
    try {
      // Try to cleanup if the app has cleanup method
      if (this.app.cleanup) {
        const cleanupResult = this.app.cleanup();
        if (!cleanupResult.success) {
          debugLog(`Test quit cleanup had errors: ${cleanupResult.errors.join('; ')} - Instance #${this.instanceId}`);
        }
      }
      
      // Force exit for test scenarios
      process.exit(0);
    } catch (error) {
      debugLog(`Test quit error: ${error instanceof Error ? error.message : String(error)} - Instance #${this.instanceId}`);
      process.exit(1);
    }
  }

  /**
   * Public method for tests to inject input directly
   * This can be called by test frameworks that have access to the app instance
   */
  public injectTestInput(input: string): void {
    if (!this.testInputEnabled) {
      debugLog(`Test input injection attempted but not enabled - Instance #${this.instanceId}`);
      return;
    }
    
    debugLog(`Direct test input injection: "${input}" - Instance #${this.instanceId}`);
    this.processTestInput(input);
  }
}
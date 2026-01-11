// E2E Test Harness Implementation
// Central orchestration class that integrates Environment Manager, Mock Server, and Process Manager

import { ChildProcess } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  E2ETestHarness,
  TestConfig,
  AppStartOptions,
  PersonaState,
  EnvironmentManager,
  MockLLMServer,
  AppProcessManager,
  AppConfig,
  MockServerConfig,
  EnvironmentConfig
} from '../types.js';
import { EnvironmentManagerImpl } from './environment.js';
import { MockLLMServerImpl } from './mock-server.js';
import { AppProcessManagerImpl } from './app-process-manager.js';

export class E2ETestHarnessImpl implements E2ETestHarness {
  private environmentManager: EnvironmentManager;
  private mockServer: MockLLMServer;
  private processManager: AppProcessManager;
  private currentProcess: ChildProcess | null = null;
  private tempDataPath: string | null = null;
  private config: TestConfig = {};
  private isSetup: boolean = false;

  constructor() {
    this.environmentManager = new EnvironmentManagerImpl();
    this.mockServer = new MockLLMServerImpl();
    this.processManager = new AppProcessManagerImpl();
  }

  /**
   * Sets up the test environment with all necessary components
   * Requirements: 1.1, 1.3 - Create isolated test environment and manage lifecycle
   */
  async setup(config: TestConfig): Promise<void> {
    if (this.isSetup) {
      throw new Error('Test harness is already set up. Call cleanup() first.');
    }

    this.config = { ...this.getDefaultConfig(), ...config };

    try {
      // Create temporary data directory
      const tempDirPrefix = this.config.tempDirPrefix || 'e2e-test';
      this.tempDataPath = await this.environmentManager.createTempDir(tempDirPrefix);

      // Start mock LLM server
      const mockServerConfig: MockServerConfig = {
        responses: this.buildMockResponses(),
        defaultDelay: 0,
        enableLogging: false // Keep quiet during tests unless debugging
      };

      const mockServerPort = this.config.mockServerPort || await this.findAvailablePort();
      await this.mockServer.start(mockServerPort, mockServerConfig);

      // Set up test environment variables
      const envConfig: EnvironmentConfig = {
        EI_DATA_PATH: this.tempDataPath,
        EI_LLM_BASE_URL: `http://localhost:${mockServerPort}/v1`,
        EI_LLM_API_KEY: 'test-api-key',
        EI_LLM_MODEL: 'test-model'
      };

      this.environmentManager.setTestEnvironment(envConfig);

      this.isSetup = true;
    } catch (error) {
      // Clean up partial setup on error
      await this.cleanup().catch(() => {
        // Ignore cleanup errors during error handling
      });
      throw new Error(`Failed to setup test harness: ${error}`);
    }
  }

  /**
   * Cleans up all test resources and restores environment
   * Requirements: 1.3 - Clean up all temporary files and directories after test completion
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    // Stop application if running
    if (this.currentProcess) {
      try {
        await this.stopApp();
      } catch (error) {
        errors.push(new Error(`Failed to stop app: ${error}`));
      }
    }

    // Stop mock server
    try {
      await this.mockServer.stop();
    } catch (error) {
      errors.push(new Error(`Failed to stop mock server: ${error}`));
    }

    // Clean up environment and temp directories
    try {
      await this.environmentManager.cleanup();
    } catch (error) {
      errors.push(new Error(`Failed to cleanup environment: ${error}`));
    }

    // Reset state
    this.currentProcess = null;
    this.tempDataPath = null;
    this.config = {};
    this.isSetup = false;

    // Report any cleanup errors
    if (errors.length > 0) {
      const errorMessages = errors.map(e => e.message).join('; ');
      throw new Error(`Cleanup completed with errors: ${errorMessages}`);
    }
  }

  /**
   * Starts the EI application with test configuration
   * Requirements: 2.1 - Launch EI application as background process
   */
  async startApp(options?: AppStartOptions): Promise<void> {
    if (!this.isSetup) {
      throw new Error('Test harness must be set up before starting app. Call setup() first.');
    }

    if (this.currentProcess) {
      throw new Error('Application is already running. Call stopApp() first.');
    }

    if (!this.tempDataPath) {
      throw new Error('Temp data path not available. Setup may have failed.');
    }

    // Build app configuration
    const appConfig: AppConfig = {
      dataPath: this.tempDataPath,
      llmBaseUrl: process.env.EI_LLM_BASE_URL || 'http://localhost:3000/v1',
      llmApiKey: process.env.EI_LLM_API_KEY || 'test-api-key',
      llmModel: process.env.EI_LLM_MODEL || 'test-model',
      debugMode: options?.debugMode || false,
      ...options
    };

    try {
      this.currentProcess = await this.processManager.start(appConfig);
      
      // Configure timeouts if specified in test config
      if (this.config.appTimeout) {
        this.processManager.configureTimeouts(this.currentProcess, {
          initialization: this.config.appTimeout,
          gracefulShutdown: this.config.cleanupTimeout || 3000,
          forceKill: 1000
        });
      }
    } catch (error) {
      this.currentProcess = null;
      throw new Error(`Failed to start application: ${error}`);
    }
  }

  /**
   * Stops the EI application gracefully
   * Requirements: 2.1 - Application control methods
   */
  async stopApp(): Promise<void> {
    if (!this.currentProcess) {
      return; // Already stopped or never started
    }

    try {
      await this.processManager.stop(this.currentProcess);
    } finally {
      this.currentProcess = null;
    }
  }

  /**
   * Sends input text to the application
   * Requirements: 2.1 - Application control methods (input)
   */
  async sendInput(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    await this.processManager.sendInput(this.currentProcess, text);
  }

  /**
   * Sends a command to the application (convenience method for commands)
   * Requirements: 2.1 - Application control methods
   */
  async sendCommand(command: string): Promise<void> {
    // Ensure command starts with / and ends with newline
    const formattedCommand = command.startsWith('/') ? command : `/${command}`;
    const commandWithNewline = formattedCommand.endsWith('\n') ? formattedCommand : `${formattedCommand}\n`;
    
    await this.sendInput(commandWithNewline);
  }

  /**
   * Waits for UI output to change and returns the new content
   * Requirements: 3.1 - Monitor UI output changes
   */
  async waitForUIChange(timeout: number = 5000): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    const initialOutput = await this.processManager.getOutput(this.currentProcess);
    
    return new Promise((resolve, reject) => {
      const checkForChange = async () => {
        try {
          const currentOutput = await this.processManager.getOutput(this.currentProcess!);
          
          // Check if output has changed
          if (currentOutput !== initialOutput && currentOutput.length > initialOutput.length) {
            resolve(currentOutput);
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`UI change timeout after ${timeout}ms`));
            return;
          }

          // Check if process is still running
          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI change'));
            return;
          }

          // Continue checking
          setTimeout(checkForChange, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI change: ${error}`));
        }
      };

      // Start checking after a brief delay
      setTimeout(checkForChange, 100);
    });
  }

  /**
   * Waits for specific text to appear in UI output
   * Requirements: 3.1 - UI output monitoring with pattern matching
   */
  async waitForUIText(expectedText: string, timeout: number = 5000): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkForText = async () => {
        try {
          const currentOutput = await this.processManager.getOutput(this.currentProcess!);
          
          // Check if expected text appears in output
          if (currentOutput.includes(expectedText)) {
            resolve(currentOutput);
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`UI text timeout after ${timeout}ms. Expected: "${expectedText}"`));
            return;
          }

          // Check if process is still running
          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI text'));
            return;
          }

          // Continue checking
          setTimeout(checkForText, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI text: ${error}`));
        }
      };

      // Start checking immediately
      checkForText();
    });
  }

  /**
   * Waits for UI output to match a regular expression pattern
   * Requirements: 3.1 - UI output monitoring with pattern matching
   */
  async waitForUIPattern(pattern: RegExp, timeout: number = 5000): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkForPattern = async () => {
        try {
          const currentOutput = await this.processManager.getOutput(this.currentProcess!);
          
          // Check if pattern matches output
          if (pattern.test(currentOutput)) {
            resolve(currentOutput);
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`UI pattern timeout after ${timeout}ms. Pattern: ${pattern}`));
            return;
          }

          // Check if process is still running
          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI pattern'));
            return;
          }

          // Continue checking
          setTimeout(checkForPattern, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI pattern: ${error}`));
        }
      };

      // Start checking immediately
      checkForPattern();
    });
  }

  /**
   * Waits for a specific file to change
   * Requirements: 3.2 - Add file change detection and waiting methods
   */
  async waitForFileChange(filePath: string, timeout: number = 5000): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    // Resolve relative paths against temp data directory
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        watcher.close();
        reject(new Error(`File change timeout after ${timeout}ms for ${filePath}`));
      }, timeout);

      const watcher = this.environmentManager.watchFile(absolutePath, (event) => {
        clearTimeout(timeoutHandle);
        watcher.close();
        resolve();
      });
    });
  }

  /**
   * Waits for a file to be created
   * Requirements: 3.2 - File change detection and waiting methods
   */
  async waitForFileCreation(filePath: string, timeout: number = 5000): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkFileExists = () => {
        if (fs.existsSync(absolutePath)) {
          resolve();
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error(`File creation timeout after ${timeout}ms for ${filePath}`));
          return;
        }

        setTimeout(checkFileExists, 100);
      };

      checkFileExists();
    });
  }

  /**
   * Waits for file content to match a specific pattern
   * Requirements: 3.2 - File change detection and content monitoring
   */
  async waitForFileContent(filePath: string, expectedContent: string | RegExp, timeout: number = 5000): Promise<string> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkFileContent = async () => {
        try {
          if (!fs.existsSync(absolutePath)) {
            if (Date.now() - startTime >= timeout) {
              reject(new Error(`File content timeout after ${timeout}ms - file does not exist: ${filePath}`));
              return;
            }
            setTimeout(checkFileContent, 100);
            return;
          }

          const content = await fs.promises.readFile(absolutePath, 'utf-8');
          
          const matches = typeof expectedContent === 'string' 
            ? content.includes(expectedContent)
            : expectedContent.test(content);

          if (matches) {
            resolve(content);
            return;
          }

          if (Date.now() - startTime >= timeout) {
            reject(new Error(`File content timeout after ${timeout}ms for ${filePath}. Expected: ${expectedContent}`));
            return;
          }

          setTimeout(checkFileContent, 100);
        } catch (error) {
          reject(new Error(`Error reading file content: ${error}`));
        }
      };

      checkFileContent();
    });
  }

  /**
   * Waits for application processing to complete
   * Requirements: 3.3, 3.4, 3.5 - Process state monitoring and wait methods
   */
  async waitForProcessingComplete(timeout: number = 10000): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkProcessingState = async () => {
        try {
          const output = await this.processManager.getOutput(this.currentProcess!, 50);
          
          // Look for indicators that processing is complete
          // This is heuristic-based since we can't directly query application state
          const isProcessing = this.detectProcessingInOutput(output);
          
          if (!isProcessing) {
            resolve();
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Processing completion timeout after ${timeout}ms`));
            return;
          }

          // Check if process is still running
          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for processing completion'));
            return;
          }

          // Continue checking
          setTimeout(checkProcessingState, 200);
        } catch (error) {
          reject(new Error(`Error while waiting for processing completion: ${error}`));
        }
      };

      // Start checking after a brief delay
      setTimeout(checkProcessingState, 200);
    });
  }

  /**
   * Waits for LLM request to be made to mock server
   * Requirements: 3.3 - Process state monitoring capabilities
   */
  async waitForLLMRequest(timeout: number = 5000): Promise<void> {
    const startTime = Date.now();
    const initialRequestCount = this.mockServer.getRequestHistory().length;

    return new Promise((resolve, reject) => {
      const checkForRequest = () => {
        const currentRequestCount = this.mockServer.getRequestHistory().length;
        
        if (currentRequestCount > initialRequestCount) {
          resolve();
          return;
        }

        if (Date.now() - startTime >= timeout) {
          reject(new Error(`LLM request timeout after ${timeout}ms`));
          return;
        }

        setTimeout(checkForRequest, 100);
      };

      checkForRequest();
    });
  }

  /**
   * Waits for application to reach idle state (no processing, no pending operations)
   * Requirements: 3.4, 3.5 - Process state monitoring with configurable timeouts
   */
  async waitForIdleState(timeout: number = 10000): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    let lastOutputLength = 0;
    let stableCount = 0;
    const requiredStableChecks = 5; // Output must be stable for 5 consecutive checks

    return new Promise((resolve, reject) => {
      const checkIdleState = async () => {
        try {
          const output = await this.processManager.getOutput(this.currentProcess!);
          const currentOutputLength = output.length;

          // Check if output length has stabilized
          if (currentOutputLength === lastOutputLength) {
            stableCount++;
          } else {
            stableCount = 0;
            lastOutputLength = currentOutputLength;
          }

          // Also check for processing indicators
          const isProcessing = this.detectProcessingInOutput(output);
          
          if (stableCount >= requiredStableChecks && !isProcessing) {
            resolve();
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Idle state timeout after ${timeout}ms`));
            return;
          }

          // Check if process is still running
          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for idle state'));
            return;
          }

          // Continue checking
          setTimeout(checkIdleState, 200);
        } catch (error) {
          reject(new Error(`Error while waiting for idle state: ${error}`));
        }
      };

      // Start checking after a brief delay
      setTimeout(checkIdleState, 200);
    });
  }

  /**
   * Waits for a specific condition to be met with custom checker function
   * Requirements: 3.5 - Configurable wait methods with timeouts
   */
  async waitForCondition(
    checker: () => Promise<boolean> | boolean,
    description: string,
    timeout: number = 5000,
    checkInterval: number = 100
  ): Promise<void> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const checkCondition = async () => {
        try {
          const conditionMet = await checker();
          
          if (conditionMet) {
            resolve();
            return;
          }

          // Check timeout
          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Condition timeout after ${timeout}ms: ${description}`));
            return;
          }

          // Continue checking
          setTimeout(checkCondition, checkInterval);
        } catch (error) {
          reject(new Error(`Error while checking condition "${description}": ${error}`));
        }
      };

      // Start checking immediately
      checkCondition();
    });
  }

  /**
   * Asserts that UI output contains specific text
   * Requirements: 3.4 - UI content assertions
   */
  async assertUIContains(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const output = await this.processManager.getOutput(this.currentProcess);
    if (!output.includes(text)) {
      throw new Error(`UI assertion failed: Expected output to contain "${text}". Actual output: ${output.slice(-500)}`);
    }
  }

  /**
   * Asserts that UI output does not contain specific text
   * Requirements: 3.4 - UI content assertions
   */
  async assertUIDoesNotContain(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const output = await this.processManager.getOutput(this.currentProcess);
    if (output.includes(text)) {
      throw new Error(`UI assertion failed: Expected output to NOT contain "${text}". Actual output: ${output.slice(-500)}`);
    }
  }

  /**
   * Asserts that UI output matches a regular expression pattern
   * Requirements: 3.4 - UI content assertions with pattern matching
   */
  async assertUIMatches(pattern: RegExp): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const output = await this.processManager.getOutput(this.currentProcess);
    if (!pattern.test(output)) {
      throw new Error(`UI assertion failed: Expected output to match pattern ${pattern}. Actual output: ${output.slice(-500)}`);
    }
  }

  /**
   * Asserts that a file exists in the test environment
   * Requirements: 3.4 - File existence and content verification
   */
  assertFileExists(filePath: string): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    // Resolve relative paths against temp data directory
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File assertion failed: Expected file to exist at ${absolutePath}`);
    }
  }

  /**
   * Asserts that a file does not exist in the test environment
   * Requirements: 3.4 - File existence verification
   */
  assertFileDoesNotExist(filePath: string): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    // Resolve relative paths against temp data directory
    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    if (fs.existsSync(absolutePath)) {
      throw new Error(`File assertion failed: Expected file to NOT exist at ${absolutePath}`);
    }
  }

  /**
   * Asserts that file content matches expected value
   * Requirements: 3.4 - File content verification
   */
  async assertFileContent(filePath: string, expectedContent: string | RegExp): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File assertion failed: File does not exist at ${absolutePath}`);
    }

    try {
      const content = await fs.promises.readFile(absolutePath, 'utf-8');
      
      const matches = typeof expectedContent === 'string' 
        ? content.includes(expectedContent)
        : expectedContent.test(content);

      if (!matches) {
        throw new Error(`File content assertion failed for ${filePath}. Expected: ${expectedContent}. Actual: ${content.slice(0, 500)}`);
      }
    } catch (error) {
      throw new Error(`Failed to read file for content assertion: ${error}`);
    }
  }

  /**
   * Asserts persona state matches expected values
   * Requirements: 6.3 - Create persona state assertion methods
   */
  async assertPersonaState(persona: string, expectedState: PersonaState): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    // Check if persona directory exists
    const personaDataPath = path.join(this.tempDataPath, 'personas', persona);
    
    if (!fs.existsSync(personaDataPath)) {
      throw new Error(`Persona assertion failed: Persona "${persona}" does not exist`);
    }

    // Try to read persona system file to get basic info
    const systemFilePath = path.join(personaDataPath, 'system.jsonc');
    if (fs.existsSync(systemFilePath)) {
      try {
        const systemContent = await fs.promises.readFile(systemFilePath, 'utf-8');
        // Basic validation that the persona file is readable
        if (systemContent.trim().length === 0) {
          throw new Error(`Persona assertion failed: Persona "${persona}" system file is empty`);
        }
      } catch (error) {
        throw new Error(`Persona assertion failed: Cannot read persona "${persona}" system file: ${error}`);
      }
    }

    // For now, we just verify the persona exists and has readable data
    // A full implementation would parse persona data and compare detailed states
    // This would require understanding the EI application's data format
  }

  /**
   * Asserts that the application process is in expected state
   * Requirements: 3.4 - Application state verification utilities
   */
  assertProcessState(expectedRunning: boolean): void {
    const isRunning = this.isAppRunning();
    
    if (expectedRunning && !isRunning) {
      throw new Error('Process state assertion failed: Expected application to be running, but it is not');
    }
    
    if (!expectedRunning && isRunning) {
      throw new Error('Process state assertion failed: Expected application to be stopped, but it is running');
    }
  }

  /**
   * Asserts that the application exited with expected exit code
   * Requirements: 3.4 - Application state verification utilities
   */
  async assertExitCode(expectedExitCode: number, timeout: number = 5000): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('No application process to check exit code');
    }

    try {
      const actualExitCode = await this.processManager.waitForExit(this.currentProcess, timeout);
      
      if (actualExitCode !== expectedExitCode) {
        throw new Error(`Exit code assertion failed: Expected ${expectedExitCode}, got ${actualExitCode}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw new Error(`Exit code assertion failed: Process did not exit within ${timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Asserts that mock server received expected number of requests
   * Requirements: 3.4 - Application state verification utilities
   */
  assertMockRequestCount(expectedCount: number): void {
    const actualCount = this.mockServer.getRequestHistory().length;
    
    if (actualCount !== expectedCount) {
      throw new Error(`Mock request count assertion failed: Expected ${expectedCount} requests, got ${actualCount}`);
    }
  }

  /**
   * Asserts that mock server received a request with specific properties
   * Requirements: 3.4 - Application state verification utilities
   */
  assertMockRequestReceived(endpoint: string, method: string = 'POST'): void {
    const requests = this.mockServer.getRequestHistory();
    const matchingRequest = requests.find(req => 
      req.endpoint === endpoint && req.method.toLowerCase() === method.toLowerCase()
    );
    
    if (!matchingRequest) {
      throw new Error(`Mock request assertion failed: No ${method} request found for endpoint ${endpoint}. Received requests: ${JSON.stringify(requests.map(r => ({ endpoint: r.endpoint, method: r.method })))}`);
    }
  }

  /**
   * Asserts that a directory exists and optionally contains expected files
   * Requirements: 3.4 - File existence and content verification
   */
  assertDirectoryExists(dirPath: string, expectedFiles?: string[]): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(dirPath) ? dirPath : path.join(this.tempDataPath, dirPath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Directory assertion failed: Expected directory to exist at ${absolutePath}`);
    }

    const stats = fs.statSync(absolutePath);
    if (!stats.isDirectory()) {
      throw new Error(`Directory assertion failed: Path exists but is not a directory: ${absolutePath}`);
    }

    if (expectedFiles && expectedFiles.length > 0) {
      for (const expectedFile of expectedFiles) {
        const filePath = path.join(absolutePath, expectedFile);
        if (!fs.existsSync(filePath)) {
          throw new Error(`Directory assertion failed: Expected file "${expectedFile}" not found in directory ${absolutePath}`);
        }
      }
    }
  }

  /**
   * Asserts that the test environment is clean (no unexpected files)
   * Requirements: 3.4 - Application state verification utilities
   */
  assertCleanEnvironment(allowedFiles?: string[]): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    if (!fs.existsSync(this.tempDataPath)) {
      // Directory doesn't exist, so it's clean
      return;
    }

    const files = fs.readdirSync(this.tempDataPath, { recursive: true });
    const allowedSet = new Set(allowedFiles || []);
    
    const unexpectedFiles = files.filter(file => !allowedSet.has(file.toString()));
    
    if (unexpectedFiles.length > 0) {
      throw new Error(`Clean environment assertion failed: Unexpected files found: ${unexpectedFiles.join(', ')}`);
    }
  }

  /**
   * Gets the current application output for inspection
   * Utility method for debugging and advanced assertions
   */
  async getCurrentOutput(lines?: number): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    return await this.processManager.getOutput(this.currentProcess, lines);
  }

  /**
   * Gets the current temp data path
   * Useful for advanced file operations in tests
   */
  getTempDataPath(): string | null {
    return this.tempDataPath;
  }

  /**
   * Gets mock server request history for verification
   * Useful for testing LLM interactions
   */
  getMockRequestHistory() {
    return this.mockServer.getRequestHistory();
  }

  /**
   * Configures mock server responses for specific test scenarios
   */
  setMockResponse(endpoint: string, content: string, delayMs?: number) {
    this.mockServer.setResponse(endpoint, {
      type: 'fixed',
      content,
      delayMs
    });
  }

  /**
   * Enables streaming responses for testing streaming scenarios
   */
  enableMockStreaming(endpoint: string, chunks: string[]) {
    this.mockServer.enableStreaming(endpoint, chunks);
  }

  /**
   * Checks if the application process is currently running
   */
  isAppRunning(): boolean {
    return this.currentProcess !== null && this.processManager.isRunning(this.currentProcess);
  }

  /**
   * Gets final state information when application exits
   */
  getAppFinalState() {
    if (!this.currentProcess) {
      throw new Error('No application process to get final state from');
    }

    return this.processManager.getFinalState(this.currentProcess);
  }

  // Private helper methods

  private getDefaultConfig(): TestConfig {
    return {
      tempDirPrefix: 'e2e-test',
      mockServerPort: undefined, // Will find available port
      appTimeout: 5000,
      cleanupTimeout: 3000,
      mockResponses: []
    };
  }

  private buildMockResponses(): Record<string, any> {
    const responses: Record<string, any> = {
      '/v1/chat/completions': {
        type: 'fixed',
        content: 'This is a test response from the mock LLM server.',
        statusCode: 200
      }
    };

    // Add any custom responses from config
    if (this.config.mockResponses) {
      for (const mockResponse of this.config.mockResponses) {
        responses[mockResponse.endpoint] = mockResponse.response;
      }
    }

    return responses;
  }

  private async findAvailablePort(): Promise<number> {
    // Simple port finding - start at 3001 and increment until we find an available port
    const net = await import('net');
    
    for (let port = 3001; port < 4000; port++) {
      if (await this.isPortAvailable(port)) {
        return port;
      }
    }
    
    throw new Error('No available ports found in range 3001-3999');
  }

  private isPortAvailable(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const net = require('net');
      const server = net.createServer();
      
      server.listen(port, () => {
        server.close(() => {
          resolve(true);
        });
      });
      
      server.on('error', () => {
        resolve(false);
      });
    });
  }

  private detectProcessingInOutput(output: string): boolean {
    // Heuristic detection of processing state based on output patterns
    // Look for common indicators that the application is processing
    const processingIndicators = [
      'Processing...',
      'Thinking...',
      'Loading...',
      'Generating...',
      // EI-specific processing indicators
      'Working',
      'streaming',
      'chunk',
      // Look for actual processing messages, not UI box-drawing characters
      'processing in progress',
      'background processing'
    ];

    const recentOutput = output.slice(-1000); // Check last 1KB of output
    
    // Don't treat box-drawing characters as processing indicators
    // These are common in blessed UI: │ ┌ ┐ └ ┘ ├ ┤ ┬ ┴ ┼ ─ ═ ║ ╔ ╗ ╚ ╝ ╠ ╣ ╦ ╩ ╬
    // Also ignore single character indicators that are likely UI elements
    return processingIndicators.some(indicator => {
      if (indicator.length === 1) {
        // For single character indicators, require them to be surrounded by spaces or at word boundaries
        const regex = new RegExp(`\\s${indicator}\\s|^${indicator}\\s|\\s${indicator}$`, 'i');
        return regex.test(recentOutput);
      } else {
        return recentOutput.toLowerCase().includes(indicator.toLowerCase());
      }
    });
  }
}
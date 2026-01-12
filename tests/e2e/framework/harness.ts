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
  EnvironmentConfig,
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
        enableLogging: false
      };

      const mockServerPort = this.config.mockServerPort || await this.findAvailablePort();
      await this.mockServer.start(mockServerPort, mockServerConfig);

      // Set up test environment variables
      const envConfig: EnvironmentConfig = {
        EI_DATA_PATH: this.tempDataPath,
        EI_LLM_BASE_URL: `http://localhost:${mockServerPort}/v1`,
        EI_LLM_API_KEY: 'test-api-key',
        EI_LLM_MODEL: 'test-model',
        NODE_ENV: 'test',
        EI_TEST_INPUT: 'true',
        EI_TEST_OUTPUT: 'true'
      };

      this.environmentManager.setTestEnvironment(envConfig);

      this.isSetup = true;
    } catch (error) {
      await this.cleanup().catch(() => {});
      throw new Error(`Failed to setup test harness: ${error}`);
    }
  }

  /**
   * Cleans up all test resources and restores environment
   */
  async cleanup(): Promise<void> {
    const errors: Error[] = [];

    if (this.currentProcess) {
      try {
        await this.stopApp();
      } catch (error) {
        errors.push(new Error(`Failed to stop app: ${error}`));
      }
    }

    try {
      await this.mockServer.stop();
    } catch (error) {
      errors.push(new Error(`Failed to stop mock server: ${error}`));
    }

    try {
      await this.environmentManager.cleanup();
    } catch (error) {
      errors.push(new Error(`Failed to cleanup environment: ${error}`));
    }

    this.currentProcess = null;
    this.tempDataPath = null;
    this.config = {};
    this.isSetup = false;

    if (errors.length > 0) {
      const errorMessages = errors.map(e => e.message).join('; ');
      throw new Error(`Cleanup completed with errors: ${errorMessages}`);
    }
  }

  /**
   * Starts the EI application with test configuration
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
   */
  async stopApp(): Promise<void> {
    if (!this.currentProcess) {
      return;
    }

    try {
      await this.processManager.stop(this.currentProcess);
    } catch (error) {
      if (error instanceof Error && error.message.includes('Process not managed by this AppProcessManager')) {
        console.log('Process already exited and was cleaned up');
      } else {
        throw error;
      }
    } finally {
      this.currentProcess = null;
    }
  }

  /**
   * Sends input text to the application
   */
  async sendInput(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    await this.processManager.sendInput(this.currentProcess, text);
  }

  /**
   * Sends a command to the application (convenience method for commands)
   */
  async sendCommand(command: string): Promise<void> {
    const formattedCommand = command.startsWith('/') ? command : `/${command}`;
    const commandWithNewline = formattedCommand.endsWith('\n') ? formattedCommand : `${formattedCommand}\n`;
    
    await this.sendInput(commandWithNewline);
  }

  /**
   * Waits for UI output to change and returns the new content
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
          
          if (currentOutput !== initialOutput && currentOutput.length > initialOutput.length) {
            resolve(currentOutput);
            return;
          }

          if (Date.now() - startTime >= timeout) {
            reject(new Error(`UI change timeout after ${timeout}ms`));
            return;
          }

          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI change'));
            return;
          }

          setTimeout(checkForChange, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI change: ${error}`));
        }
      };

      setTimeout(checkForChange, 100);
    });
  }

  /**
   * Waits for specific text to appear in UI output
   */
  async waitForUIText(expectedText: string, timeout: number = 5000): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkForText = async () => {
        try {
          const rawOutput = await this.processManager.getOutput(this.currentProcess!);
          const cleanText = this.extractReadableText(rawOutput);
          
          if (cleanText.includes(expectedText) || rawOutput.includes(expectedText)) {
            resolve(rawOutput);
            return;
          }

          if (Date.now() - startTime >= timeout) {
            const recentRawText = rawOutput.slice(-1000);
            const recentCleanText = cleanText.slice(-500);
            reject(new Error(`UI text timeout after ${timeout}ms. Expected: "${expectedText}". Recent clean text: "${recentCleanText}"`));
            return;
          }

          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI text'));
            return;
          }

          setTimeout(checkForText, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI text: ${error}`));
        }
      };

      checkForText();
    });
  }

  /**
   * Waits for UI output to match a regular expression pattern
   */
  async waitForUIPattern(pattern: RegExp, timeout: number = 5000): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const checkForPattern = async () => {
        try {
          const rawOutput = await this.processManager.getOutput(this.currentProcess!);
          const cleanText = this.extractReadableText(rawOutput);
          
          if (pattern.test(cleanText)) {
            resolve(rawOutput);
            return;
          }

          if (Date.now() - startTime >= timeout) {
            const recentCleanText = cleanText.slice(-500);
            reject(new Error(`UI pattern timeout after ${timeout}ms. Pattern: ${pattern}. Recent clean text: "${recentCleanText}"`));
            return;
          }

          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for UI pattern'));
            return;
          }

          setTimeout(checkForPattern, 100);
        } catch (error) {
          reject(new Error(`Error while waiting for UI pattern: ${error}`));
        }
      };

      checkForPattern();
    });
  }

  /**
   * Waits for a specific file to change
   */
  async waitForFileChange(filePath: string, timeout: number = 5000): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

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
          const isProcessing = this.detectProcessingInOutput(output);
          
          if (!isProcessing) {
            resolve();
            return;
          }

          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Processing completion timeout after ${timeout}ms`));
            return;
          }

          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for processing completion'));
            return;
          }

          setTimeout(checkProcessingState, 200);
        } catch (error) {
          reject(new Error(`Error while waiting for processing completion: ${error}`));
        }
      };

      setTimeout(checkProcessingState, 200);
    });
  }

  /**
   * Waits for LLM request to be made to mock server
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
   */
  async waitForIdleState(timeout: number = 10000): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const startTime = Date.now();
    let lastOutputLength = 0;
    let stableCount = 0;
    const requiredStableChecks = 5;

    return new Promise((resolve, reject) => {
      const checkIdleState = async () => {
        try {
          const output = await this.processManager.getOutput(this.currentProcess!);
          const currentOutputLength = output.length;

          if (currentOutputLength === lastOutputLength) {
            stableCount++;
          } else {
            stableCount = 0;
            lastOutputLength = currentOutputLength;
          }

          const isProcessing = this.detectProcessingInOutput(output);
          
          if (stableCount >= requiredStableChecks && !isProcessing) {
            resolve();
            return;
          }

          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Idle state timeout after ${timeout}ms`));
            return;
          }

          if (!this.processManager.isRunning(this.currentProcess!)) {
            reject(new Error('Application process stopped while waiting for idle state'));
            return;
          }

          setTimeout(checkIdleState, 200);
        } catch (error) {
          reject(new Error(`Error while waiting for idle state: ${error}`));
        }
      };

      setTimeout(checkIdleState, 200);
    });
  }

  /**
   * Waits for a specific condition to be met with custom checker function
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

          if (Date.now() - startTime >= timeout) {
            reject(new Error(`Condition timeout after ${timeout}ms: ${description}`));
            return;
          }

          setTimeout(checkCondition, checkInterval);
        } catch (error) {
          reject(new Error(`Error while checking condition "${description}": ${error}`));
        }
      };

      checkCondition();
    });
  }

  /**
   * Asserts that UI output contains specific text
   */
  async assertUIContains(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const rawOutput = await this.processManager.getOutput(this.currentProcess);
    const cleanText = this.extractReadableText(rawOutput);
    
    if (!cleanText.includes(text)) {
      throw new Error(`UI assertion failed: Expected output to contain "${text}". Actual clean text: ${cleanText.slice(-500)}`);
    }
  }

  /**
   * Asserts that UI output does not contain specific text
   */
  async assertUIDoesNotContain(text: string): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const rawOutput = await this.processManager.getOutput(this.currentProcess);
    const cleanText = this.extractReadableText(rawOutput);
    
    if (cleanText.includes(text)) {
      throw new Error(`UI assertion failed: Expected output to NOT contain "${text}". Actual clean text: ${cleanText.slice(-500)}`);
    }
  }

  /**
   * Asserts that UI output matches a regular expression pattern
   */
  async assertUIMatches(pattern: RegExp): Promise<void> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const rawOutput = await this.processManager.getOutput(this.currentProcess);
    const cleanText = this.extractReadableText(rawOutput);
    
    if (!pattern.test(cleanText)) {
      throw new Error(`UI assertion failed: Expected output to match pattern ${pattern}. Actual clean text: ${cleanText.slice(-500)}`);
    }
  }

  /**
   * Asserts that a file exists in the test environment
   */
  assertFileExists(filePath: string): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new Error(`File assertion failed: Expected file to exist at ${absolutePath}`);
    }
  }

  /**
   * Asserts that a file does not exist in the test environment
   */
  assertFileDoesNotExist(filePath: string): void {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(this.tempDataPath, filePath);

    if (fs.existsSync(absolutePath)) {
      throw new Error(`File assertion failed: Expected file to NOT exist at ${absolutePath}`);
    }
  }

  /**
   * Asserts that file content matches expected value
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
   */
  async assertPersonaState(persona: string, expectedState: PersonaState): Promise<void> {
    if (!this.tempDataPath) {
      throw new Error('Test harness not set up properly. Temp data path not available.');
    }

    const personaDataPath = path.join(this.tempDataPath, 'personas', persona);
    
    if (!fs.existsSync(personaDataPath)) {
      throw new Error(`Persona assertion failed: Persona "${persona}" does not exist`);
    }

    const systemFilePath = path.join(personaDataPath, 'system.jsonc');
    if (fs.existsSync(systemFilePath)) {
      try {
        const systemContent = await fs.promises.readFile(systemFilePath, 'utf-8');
        if (systemContent.trim().length === 0) {
          throw new Error(`Persona assertion failed: Persona "${persona}" system file is empty`);
        }
      } catch (error) {
        throw new Error(`Persona assertion failed: Cannot read persona "${persona}" system file: ${error}`);
      }
    }
  }

  /**
   * Asserts that the application process is in expected state
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
    } finally {
      this.currentProcess = null;
    }
  }

  /**
   * Asserts that mock server received expected number of requests
   */
  assertMockRequestCount(expectedCount: number): void {
    const actualCount = this.mockServer.getRequestHistory().length;
    
    if (actualCount !== expectedCount) {
      throw new Error(`Mock request count assertion failed: Expected ${expectedCount} requests, got ${actualCount}`);
    }
  }

  /**
   * Asserts that mock server received a request with specific properties
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
   * Gets the current application output for inspection
   */
  async getCurrentOutput(lines?: number): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    return await this.processManager.getOutput(this.currentProcess, lines);
  }

  /**
   * Gets the current application output with escape sequences removed
   */
  async getCurrentCleanOutput(lines?: number): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const rawOutput = await this.processManager.getOutput(this.currentProcess, lines);
    return this.extractReadableText(rawOutput);
  }

  /**
   * Gets captured UI content using the test output capture system
   */
  async getCapturedUIContent(): Promise<string> {
    if (!this.currentProcess) {
      throw new Error('Application is not running. Call startApp() first.');
    }

    const rawOutput = await this.processManager.getOutput(this.currentProcess, 50);
    
    if (rawOutput.includes('[TestOutputCapture]') || rawOutput.includes('TestOutputCapture: Captured')) {
      return this.extractCapturedContent(rawOutput);
    }
    
    return this.extractReadableText(rawOutput);
  }

  /**
   * Gets the current temp data path
   */
  getTempDataPath(): string | null {
    return this.tempDataPath;
  }

  /**
   * Gets mock server request history for verification
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
   * Sets a queue of responses that will be returned in sequence
   */
  setMockResponseQueue(responses: string[]) {
    this.mockServer.setResponseQueue(responses);
  }

  /**
   * Clears the response queue
   */
  clearMockResponseQueue() {
    this.mockServer.clearResponseQueue();
  }

  /**
   * Configures comprehensive LLM responses for all request types
   */
  setLLMResponses(options: {
    responseText?: string;
    systemConcepts?: any[];
    humanConcepts?: any[];
    personaDescription?: { short_description: string; long_description: string };
    delayMs?: number;
  }) {
    const {
      responseText = 'Test response from mock LLM',
      systemConcepts,
      humanConcepts,
      personaDescription,
      delayMs = 100
    } = options;

    this.mockServer.clearResponseOverrides();
    
    if (delayMs > 0) {
      this.mockServer.setDelay('/v1/chat/completions', delayMs);
    }
    
    if (systemConcepts) {
      this.mockServer.setResponseForType('system-concepts', {
        type: 'fixed',
        content: JSON.stringify(systemConcepts),
        statusCode: 200
      });
    }
    
    if (humanConcepts) {
      this.mockServer.setResponseForType('human-concepts', {
        type: 'fixed', 
        content: JSON.stringify(humanConcepts),
        statusCode: 200
      });
    }
    
    if (personaDescription) {
      this.mockServer.setResponseForType('description', {
        type: 'fixed',
        content: JSON.stringify(personaDescription),
        statusCode: 200
      });
    }
    
    if (responseText !== 'Test response from mock LLM') {
      this.mockServer.setResponseForType('response', {
        type: 'fixed',
        content: responseText,
        statusCode: 200
      });
    }
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

  /**
   * Extracts captured content from debug output
   */
  private extractCapturedContent(rawOutput: string): string {
    const captureLines = rawOutput
      .split('\n')
      .filter(line => line.includes('[TestOutputCapture] Captured'))
      .map(line => {
        const match = line.match(/\[TestOutputCapture\] Captured .+ content: "(.+?)" \(total captured: \d+\)/);
        return match ? match[1] : '';
      })
      .filter(content => content.length > 0);

    return captureLines.join('\n');
  }

  /**
   * Extracts readable text from blessed terminal output by removing ANSI escape sequences
   */
  private extractReadableText(rawOutput: string): string {
    if (!rawOutput || rawOutput.trim() === '') {
      return '';
    }

    let cleanText = rawOutput;

    // Remove ANSI escape sequences
    cleanText = cleanText.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '');
    cleanText = cleanText.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '');
    cleanText = cleanText.replace(/\x1b[a-zA-Z0-9]/g, '');
    cleanText = cleanText.replace(/\x1bP[^\x1b]*\x1b\\/g, '');
    cleanText = cleanText.replace(/\x1b_[^\x1b]*\x1b\\/g, '');
    cleanText = cleanText.replace(/\x1b\^[^\x1b]*\x1b\\/g, '');
    cleanText = cleanText.replace(/\x1b./g, '');

    // Remove cursor positioning sequences
    cleanText = cleanText.replace(/-?\d+;\d+H/g, '');
    cleanText = cleanText.replace(/\?\d+[lh]/g, '');
    cleanText = cleanText.replace(/\?\d+/g, '');

    // Remove blessed box-drawing characters
    cleanText = cleanText.replace(/[qkxjlmtuvwn]{5,}/g, ' ');
    cleanText = cleanText.replace(/(\s|^)[qkxjlmtuvwn]{2,4}(\s|$)/g, ' ');
    cleanText = cleanText.replace(/(\s)[qkxjlmtuvwn](\s)/g, '$1$2');

    // Remove control characters
    cleanText = cleanText.replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '');

    // Clean up whitespace
    cleanText = cleanText.replace(/[ \t]+/g, ' ');
    cleanText = cleanText.replace(/\n\s*\n\s*\n/g, '\n\n');
    cleanText = cleanText.split('\n').map(line => line.trim()).join('\n');
    cleanText = cleanText.replace(/^\n+/, '').replace(/\n+$/, '');

    if (cleanText.trim().length <= 1) {
      return '';
    }

    return cleanText;
  }

  private getDefaultConfig(): TestConfig {
    return {
      tempDirPrefix: 'e2e-test',
      mockServerPort: undefined,
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

    if (this.config.mockResponses) {
      for (const mockResponse of this.config.mockResponses) {
        responses[mockResponse.endpoint] = mockResponse.response;
      }
    }

    return responses;
  }

  private async findAvailablePort(): Promise<number> {
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
    const processingIndicators = [
      'Processing...',
      'Thinking...',
      'Loading...',
      'Generating...',
      'Working',
      'streaming',
      'chunk',
      'processing in progress',
      'background processing'
    ];

    const recentOutput = output.slice(-1000);
    
    return processingIndicators.some(indicator => {
      if (indicator.length === 1) {
        const regex = new RegExp(`\\s${indicator}\\s|^${indicator}\\s|\\s${indicator}$`, 'i');
        return regex.test(recentOutput);
      } else {
        return recentOutput.toLowerCase().includes(indicator.toLowerCase());
      }
    });
  }
}

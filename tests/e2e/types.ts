// TypeScript interfaces for E2E testing framework components
// Based on the design document specifications

import { ChildProcess } from 'child_process';
import { HooksManager } from './framework/hooks-manager.js';

// ============================================================================
// E2E Test Harness Interfaces
// ============================================================================

export interface E2ETestHarness {
  // Lifecycle management
  setup(config: TestConfig): Promise<void>;
  cleanup(): Promise<void>;
  
  // Application control
  startApp(options?: AppStartOptions): Promise<void>;
  stopApp(): Promise<void>;
  sendInput(text: string): Promise<void>;
  sendCommand(command: string): Promise<void>;
  
  // State observation
  waitForUIChange(timeout?: number): Promise<string>;
  waitForUIText(expectedText: string, timeout?: number): Promise<string>;
  waitForUIPattern(pattern: RegExp, timeout?: number): Promise<string>;
  waitForFileChange(filePath: string, timeout?: number): Promise<void>;
  waitForFileCreation(filePath: string, timeout?: number): Promise<void>;
  waitForFileContent(filePath: string, expectedContent: string | RegExp, timeout?: number): Promise<string>;
  waitForProcessingComplete(timeout?: number): Promise<void>;
  waitForLLMRequest(timeout?: number): Promise<void>;
  waitForIdleState(timeout?: number): Promise<void>;
  waitForCondition(checker: () => Promise<boolean> | boolean, description: string, timeout?: number, checkInterval?: number): Promise<void>;
  
  // Assertions
  assertUIContains(text: string): Promise<void>;
  assertUIDoesNotContain(text: string): Promise<void>;
  assertUIMatches(pattern: RegExp): Promise<void>;
  assertFileExists(filePath: string): void;
  assertFileDoesNotExist(filePath: string): void;
  assertFileContent(filePath: string, expectedContent: string | RegExp): Promise<void>;
  assertPersonaState(persona: string, expectedState: PersonaState): Promise<void>;
  assertProcessState(expectedRunning: boolean): void;
  assertExitCode(expectedExitCode: number, timeout?: number): Promise<void>;
  assertMockRequestCount(expectedCount: number): void;
  assertMockRequestReceived(endpoint: string, method?: string): void;
  assertDirectoryExists(dirPath: string, expectedFiles?: string[]): void;
  assertCleanEnvironment(allowedFiles?: string[]): void;
  
  // Utility methods
  getCurrentOutput(lines?: number): Promise<string>;
  getTempDataPath(): string | null;
  getMockRequestHistory(): any[];
  setMockResponse(endpoint: string, content: string, delayMs?: number): void;
  setMockResponseQueue(responses: string[]): void;
  clearMockResponseQueue(): void;
  enableMockStreaming(endpoint: string, chunks: string[]): void;
  isAppRunning(): boolean;
  getAppFinalState(): any;
  
  // Hooks and extensibility
  getHooksManager(): HooksManager;
  executeTestScenario(scenario: TestScenario): Promise<void>;
}

export interface TestConfig {
  tempDirPrefix?: string;
  mockServerPort?: number;
  appTimeout?: number;
  cleanupTimeout?: number;
  mockResponses?: MockResponseConfig[];
}

export interface AppStartOptions {
  dataPath?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  debugMode?: boolean;
  usePty?: boolean; // Use pseudoterminal for better blessed app testing
}

// ============================================================================
// Mock LLM Server Interfaces
// ============================================================================

export interface MockLLMServer {
  start(port: number, config: MockServerConfig): Promise<void>;
  stop(): Promise<void>;
  
  // Response configuration
  setResponse(endpoint: string, response: MockResponse): void;
  setResponseQueue(responses: string[]): void;
  clearResponseQueue(): void;
  setDelay(endpoint: string, delayMs: number): void;
  enableStreaming(endpoint: string, chunks: string[]): void;
  
  // Request monitoring
  getRequestHistory(): MockRequest[];
  clearRequestHistory(): void;
  
  // Streaming interruption support
  getActiveStreamCount(): number;
  interruptAllStreams(): void;
}

export interface MockServerConfig {
  responses: Record<string, MockResponse>;
  defaultDelay?: number;
  enableLogging?: boolean;
}

export interface MockResponse {
  type: 'fixed' | 'streaming' | 'error';
  content: string | string[];
  delayMs?: number;
  statusCode?: number;
}

export interface MockRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: any;
  timestamp: number;
}

export interface MockResponseConfig {
  endpoint: string;
  response: MockResponse;
}

// ============================================================================
// Application Process Manager Interfaces
// ============================================================================

export interface AppProcessManager {
  start(config: AppConfig): Promise<ChildProcess>;
  stop(process: ChildProcess): Promise<void>;
  
  // Input/Output
  sendInput(process: ChildProcess, text: string): Promise<void>;
  getOutput(process: ChildProcess, lines?: number): Promise<string>;
  
  // State monitoring
  isRunning(process: ChildProcess): boolean;
  waitForExit(process: ChildProcess, timeout?: number): Promise<number>;
  
  // Timeout configuration
  configureTimeouts(process: ChildProcess, timeouts: Partial<ProcessTimeouts>): void;
  getTimeouts(process: ChildProcess): ProcessTimeouts;
  
  // Final state capture
  getFinalState(process: ChildProcess): ProcessFinalState;
}

export interface ProcessTimeouts {
  initialization: number;
  gracefulShutdown: number;
  forceKill: number;
}

export interface ProcessFinalState {
  exitCode: number | null;
  runtime: number;
  finalOutput: string;
  wasKilled: boolean;
  startTime: number;
  config: AppConfig;
}

export interface AppConfig {
  dataPath: string;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  debugMode?: boolean;
  usePty?: boolean; // Use pseudoterminal for better blessed app testing
}

// ============================================================================
// Environment Manager Interfaces
// ============================================================================

export interface EnvironmentManager {
  createTempDir(prefix: string): Promise<string>;
  cleanupTempDir(path: string): Promise<void>;
  
  // Environment setup
  setTestEnvironment(config: EnvironmentConfig): void;
  restoreEnvironment(): void;
  
  // File system monitoring
  watchFile(filePath: string, callback: (event: string) => void): FileWatcher;
  unwatchFile(watcher: FileWatcher): void;
}

export interface EnvironmentConfig {
  EI_DATA_PATH: string;
  EI_LLM_BASE_URL: string;
  EI_LLM_API_KEY: string;
  EI_LLM_MODEL: string;
}

export interface FileWatcher {
  close(): void;
}

// ============================================================================
// Test Scenario Configuration Interfaces
// ============================================================================

export interface TestScenario {
  name: string;
  description: string;
  setup: TestSetupConfig;
  steps: TestStep[];
  assertions: TestAssertion[];
  cleanup?: TestCleanupConfig;
}

export interface TestSetupConfig {
  personas?: PersonaConfig[];
  mockResponses?: MockResponseConfig[];
  initialData?: InitialDataConfig;
}

export interface TestStep {
  type: 'input' | 'command' | 'wait' | 'assert';
  action: string;
  timeout?: number;
  expectedResult?: any;
}

export interface TestAssertion {
  type: 'ui' | 'file' | 'state' | 'process';
  target: string;
  condition: string;
  expected: any;
}

export interface TestCleanupConfig {
  removeFiles?: string[];
  killProcesses?: boolean;
  restoreEnvironment?: boolean;
}

export interface PersonaConfig {
  name: string;
  systemPrompt?: string;
  initialMessages?: string[];
}

export interface InitialDataConfig {
  personas?: PersonaConfig[];
  concepts?: Record<string, any>;
  history?: Record<string, any[]>;
}

// ============================================================================
// Application State Models
// ============================================================================

export interface PersonaState {
  name: string;
  isProcessing: boolean;
  unreadCount: number;
  lastActivity: number;
  messageQueue: string[];
}

export interface ApplicationState {
  activePersona: string;
  personas: PersonaState[];
  isProcessing: boolean;
  inputHasText: boolean;
  statusMessage?: string;
}

// ============================================================================
// Error Recovery Interfaces
// ============================================================================

export interface ErrorRecovery {
  // Automatic retry with exponential backoff
  retryWithBackoff<T>(operation: () => Promise<T>, maxRetries: number): Promise<T>;
  
  // Graceful degradation for non-critical failures
  gracefulDegrade(error: Error, fallbackAction: () => void): void;
  
  // Resource cleanup on error
  emergencyCleanup(resources: TestResource[]): Promise<void>;
}

export interface TestResource {
  type: 'process' | 'file' | 'directory' | 'server';
  identifier: string;
  cleanup: () => Promise<void>;
}

// ============================================================================
// TUI Test Integration (Optional)
// ============================================================================

export interface TUITestIntegration {
  // Enhanced terminal interaction capabilities
  captureScreenshot(): Promise<Buffer>;
  assertTerminalContent(expectedContent: string): void;
  sendKeySequence(keys: string[]): Promise<void>;
  waitForTerminalRender(timeout?: number): Promise<void>;
}
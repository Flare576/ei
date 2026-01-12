import { ChildProcess } from 'child_process';

export interface E2ETestHarness {
  setup(config: TestConfig): Promise<void>;
  cleanup(): Promise<void>;
  
  startApp(options?: AppStartOptions): Promise<void>;
  stopApp(): Promise<void>;
  sendInput(text: string): Promise<void>;
  sendCommand(command: string): Promise<void>;
  
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
  
  getCurrentOutput(lines?: number): Promise<string>;
  getCurrentCleanOutput(lines?: number): Promise<string>;
  getCapturedUIContent(): Promise<string>;
  getTempDataPath(): string | null;
  getMockRequestHistory(): MockRequest[];
  setMockResponse(endpoint: string, content: string, delayMs?: number): void;
  setMockResponseQueue(responses: string[]): void;
  clearMockResponseQueue(): void;
  setLLMResponses(options: LLMResponseOptions): void;
  enableMockStreaming(endpoint: string, chunks: string[]): void;
  isAppRunning(): boolean;
  getAppFinalState(): ProcessFinalState;
}

export interface LLMResponseOptions {
  responseText?: string;
  systemConcepts?: any[];
  humanConcepts?: any[];
  personaDescription?: { short_description: string; long_description: string };
  delayMs?: number;
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
  usePty?: boolean;
}

export interface MockLLMServer {
  start(port: number, config: MockServerConfig): Promise<void>;
  stop(): Promise<void>;
  
  setResponse(endpoint: string, response: MockResponse): void;
  setResponseForType(requestType: string, response: MockResponse): void;
  clearResponseOverrides(): void;
  setResponseQueue(responses: string[]): void;
  clearResponseQueue(): void;
  setDelay(endpoint: string, delayMs: number): void;
  enableStreaming(endpoint: string, chunks: string[]): void;
  
  getRequestHistory(): MockRequest[];
  clearRequestHistory(): void;
  
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
  responseTime?: number;
  error?: boolean;
  streaming?: boolean;
}

export interface MockResponseConfig {
  endpoint: string;
  response: MockResponse;
}

export interface AppProcessManager {
  start(config: AppConfig): Promise<ChildProcess>;
  stop(process: ChildProcess): Promise<void>;
  
  sendInput(process: ChildProcess, text: string): Promise<void>;
  getOutput(process: ChildProcess, lines?: number): Promise<string>;
  
  isRunning(process: ChildProcess): boolean;
  waitForExit(process: ChildProcess, timeout?: number): Promise<number>;
  
  configureTimeouts(process: ChildProcess, timeouts: Partial<ProcessTimeouts>): void;
  getTimeouts(process: ChildProcess): ProcessTimeouts;
  
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
  usePty?: boolean;
}

export interface EnvironmentManager {
  createTempDir(prefix: string): Promise<string>;
  cleanupTempDir(path: string): Promise<void>;
  cleanup(): Promise<void>;
  
  setTestEnvironment(config: EnvironmentConfig): void;
  restoreEnvironment(): void;
  
  watchFile(filePath: string, callback: (event: string) => void): FileWatcher;
  unwatchFile(watcher: FileWatcher): void;
}

export interface EnvironmentConfig {
  EI_DATA_PATH: string;
  EI_LLM_BASE_URL: string;
  EI_LLM_API_KEY: string;
  EI_LLM_MODEL: string;
  NODE_ENV?: string;
  EI_TEST_INPUT?: string;
  EI_TEST_OUTPUT?: string;
}

export interface FileWatcher {
  close(): void;
}

export interface PersonaState {
  name: string;
  isProcessing: boolean;
  unreadCount: number;
  lastActivity: number;
  messageQueue: string[];
}

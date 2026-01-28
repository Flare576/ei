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
  type: "fixed" | "streaming" | "error";
  content: string | string[];
  delayMs?: number;
  statusCode?: number;
}

export interface MockRequest {
  endpoint: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  timestamp: number;
  responseTime?: number;
  error?: boolean;
  streaming?: boolean;
}

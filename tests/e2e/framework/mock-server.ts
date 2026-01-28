import express, { type Express, type Request, type Response } from "express";
import type { Server } from "http";
import type {
  MockLLMServer,
  MockServerConfig,
  MockResponse,
  MockRequest,
} from "../types.js";

export class MockLLMServerImpl implements MockLLMServer {
  private app: Express;
  private server: Server | null = null;
  private port = 0;
  private config: MockServerConfig;
  private requestHistory: MockRequest[] = [];
  private responseOverrides: Map<string, MockResponse> = new Map();
  private responseTypeOverrides: Map<string, MockResponse> = new Map();
  private delayOverrides: Map<string, number> = new Map();
  private streamingConfigs: Map<string, string[]> = new Map();
  private activeStreams: Set<Response> = new Set();
  private responseQueue: string[] = [];
  private responseQueueIndex = 0;

  constructor() {
    this.app = express();
    this.app.use((_req, res, next) => {
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (_req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
    this.app.use(express.json());
    this.setupRoutes();
    this.config = {
      responses: {},
      defaultDelay: 0,
      enableLogging: false,
    };
  }

  async start(port: number, config: MockServerConfig): Promise<void> {
    this.port = port;
    this.config = { ...this.config, ...config };

    return new Promise((resolve, reject) => {
      this.server = this.app.listen(port, () => {
        if (this.config.enableLogging) {
          console.log(`Mock LLM Server started on port ${port}`);
        }
        resolve();
      });

      this.server.on("error", (error) => {
        reject(error);
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) {
      return;
    }

    this.interruptAllStreams();
    this.requestHistory = [];
    this.responseQueue = [];
    this.responseQueueIndex = 0;
    this.responseOverrides.clear();
    this.responseTypeOverrides.clear();
    this.delayOverrides.clear();
    this.streamingConfigs.clear();

    return new Promise((resolve) => {
      this.server!.close(() => {
        if (this.config.enableLogging) {
          console.log("Mock LLM Server stopped");
        }
        this.server = null;
        resolve();
      });
    });
  }

  setResponse(endpoint: string, response: MockResponse): void {
    this.responseOverrides.set(endpoint, response);
  }

  setResponseForType(requestType: string, response: MockResponse): void {
    this.responseTypeOverrides.set(requestType, response);
  }

  clearResponseOverrides(): void {
    this.responseOverrides.clear();
    this.responseTypeOverrides.clear();
  }

  setResponseQueue(responses: string[]): void {
    this.responseQueue = [...responses];
    this.responseQueueIndex = 0;
  }

  clearResponseQueue(): void {
    this.responseQueue = [];
    this.responseQueueIndex = 0;
  }

  setDelay(endpoint: string, delayMs: number): void {
    this.delayOverrides.set(endpoint, delayMs);
  }

  enableStreaming(endpoint: string, chunks: string[]): void {
    this.streamingConfigs.set(endpoint, chunks);
  }

  getRequestHistory(): MockRequest[] {
    return [...this.requestHistory];
  }

  clearRequestHistory(): void {
    this.requestHistory = [];
  }

  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  interruptAllStreams(): void {
    for (const res of this.activeStreams) {
      try {
        if (!res.destroyed) {
          res.destroy();
        }
      } catch {
        // Ignore errors when destroying streams
      }
    }
    this.activeStreams.clear();
  }

  private setupRoutes(): void {
    this.app.post("/v1/chat/completions", async (req: Request, res: Response) => {
      await this.handleChatCompletions(req, res);
    });

    this.app.get("/health", (_req: Request, res: Response) => {
      res.json({ status: "ok", timestamp: Date.now() });
    });

    this.app.get("/test/requests", (_req: Request, res: Response) => {
      res.json(this.requestHistory);
    });

    this.app.delete("/test/requests", (_req: Request, res: Response) => {
      this.clearRequestHistory();
      res.json({ cleared: true });
    });
  }

  private async handleChatCompletions(req: Request, res: Response): Promise<void> {
    const endpoint = "/v1/chat/completions";

    const mockRequest: MockRequest = {
      endpoint,
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.body,
      timestamp: Date.now(),
    };
    this.requestHistory.push(mockRequest);

    if (this.requestHistory.length > 100) {
      this.requestHistory = this.requestHistory.slice(-50);
    }

    if (this.config.enableLogging) {
      console.log(`Mock LLM Server: ${req.method} ${endpoint}`, {
        model: req.body.model,
        messages: req.body.messages?.length ?? 0,
        stream: req.body.stream ?? false,
      });
    }

    const requestType = this.detectRequestType(req.body.messages);
    const response = this.getResponseForRequestType(requestType, endpoint);
    const delay = this.getDelayForEndpoint(endpoint);
    const streamingChunks = this.streamingConfigs.get(endpoint);

    if (delay > 0) {
      await this.sleep(delay);
    }

    if (response.type === "error") {
      res.status(response.statusCode ?? 500).json({
        error: {
          message: typeof response.content === "string" ? response.content : "Mock error",
          type: "mock_error",
          code: "mock_error",
        },
      });
      return;
    }

    if (req.body.stream || response.type === "streaming" || streamingChunks) {
      await this.handleStreamingResponse(req, res, response, streamingChunks);
      return;
    }

    await this.handleFixedResponse(req, res, response);
  }

  private detectRequestType(
    messages: Array<{ role: string; content: string }>
  ): "response" | "system-concepts" | "human-concepts" | "description" | "unknown" {
    if (!messages || messages.length === 0) {
      return "unknown";
    }

    const systemMessage = messages.find((m) => m.role === "system");
    if (!systemMessage?.content) {
      return "unknown";
    }

    const content = systemMessage.content.toLowerCase();

    if (content.includes("you are ei") && content.includes("companion")) {
      return "response";
    }

    if (content.includes("system") && content.includes("concepts")) {
      return "system-concepts";
    }

    if (content.includes("human") && content.includes("concepts")) {
      return "human-concepts";
    }

    if (content.includes("description") && content.includes("persona")) {
      return "description";
    }

    return "response";
  }

  private getResponseForRequestType(requestType: string, endpoint: string): MockResponse {
    if (this.responseQueue.length > 0 && this.responseQueueIndex < this.responseQueue.length) {
      const queuedResponse = this.responseQueue[this.responseQueueIndex];
      this.responseQueueIndex++;
      return {
        type: "fixed",
        content: queuedResponse,
        statusCode: 200,
      };
    }

    const override = this.responseOverrides.get(endpoint);
    if (override) {
      return override;
    }

    const typeOverride = this.responseTypeOverrides.get(requestType);
    if (typeOverride) {
      return typeOverride;
    }

    switch (requestType) {
      case "system-concepts":
        return {
          type: "fixed",
          content: JSON.stringify([]),
          statusCode: 200,
        };

      case "human-concepts":
        return {
          type: "fixed",
          content: "[]",
          statusCode: 200,
        };

      case "description":
        return {
          type: "fixed",
          content: JSON.stringify({
            short_description: "Test AI assistant",
            long_description: "A helpful test assistant for automated testing.",
          }),
          statusCode: 200,
        };

      case "response":
      default:
        return {
          type: "fixed",
          content: "Hello! This is a test response from the mock LLM server.",
          statusCode: 200,
        };
    }
  }

  private async handleFixedResponse(
    req: Request,
    res: Response,
    response: MockResponse
  ): Promise<void> {
    const content = Array.isArray(response.content)
      ? response.content.join("")
      : response.content;

    const openaiResponse = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: req.body.model ?? "mock-model",
      choices: [
        {
          index: 0,
          message: {
            role: "assistant",
            content: content,
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: content.length,
        total_tokens: 10 + content.length,
      },
    };

    res.json(openaiResponse);
  }

  private async handleStreamingResponse(
    req: Request,
    res: Response,
    response: MockResponse,
    streamingChunks?: string[]
  ): Promise<void> {
    res.setHeader("Content-Type", "text/plain; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    this.activeStreams.add(res);

    const chunks =
      streamingChunks ??
      (Array.isArray(response.content) ? response.content : [response.content]);

    const baseResponse = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: req.body.model ?? "mock-model",
    };

    const state = { clientDisconnected: false };

    res.on("close", () => {
      state.clientDisconnected = true;
      this.activeStreams.delete(res);
    });

    try {
      for (let i = 0; i < chunks.length; i++) {
        if (state.clientDisconnected || res.destroyed) {
          break;
        }

        const chunk = chunks[i];
        const streamChunk = {
          ...baseResponse,
          choices: [
            {
              index: 0,
              delta: { content: chunk },
              finish_reason: null,
            },
          ],
        };

        res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);

        if (i < chunks.length - 1) {
          await this.sleep(10);
        }
      }

      if (!state.clientDisconnected && !res.destroyed) {
        const finalChunk = {
          ...baseResponse,
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        };
        res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }
    } finally {
      this.activeStreams.delete(res);
    }
  }

  private getDelayForEndpoint(endpoint: string): number {
    const override = this.delayOverrides.get(endpoint);
    if (override !== undefined) {
      return override;
    }
    return this.config.defaultDelay ?? 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

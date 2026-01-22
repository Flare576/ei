// Mock LLM Server Implementation
// Provides OpenAI-compatible API endpoints for controlled testing

import express, { Express, Request, Response } from 'express';
import { Server } from 'http';
import { 
  MockLLMServer, 
  MockServerConfig, 
  MockResponse, 
  MockRequest 
} from '../types.js';

export class MockLLMServerImpl implements MockLLMServer {
  private app: Express;
  private server: Server | null = null;
  private port: number = 0;
  private config: MockServerConfig;
  private requestHistory: MockRequest[] = [];
  private responseOverrides: Map<string, MockResponse> = new Map();
  private responseTypeOverrides: Map<string, MockResponse> = new Map();
  private delayOverrides: Map<string, number> = new Map();
  private streamingConfigs: Map<string, string[]> = new Map();
  private activeStreams: Set<Response> = new Set();
  private responseQueue: string[] = [];
  private responseQueueIndex: number = 0;

  constructor() {
    this.app = express();
    this.app.use(express.json());
    this.setupRoutes();
    this.config = {
      responses: {},
      defaultDelay: 0,
      enableLogging: true
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
      
      this.server.on('error', (error) => {
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
          console.log('Mock LLM Server stopped');
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

  // Additional methods for testing interruption scenarios
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  interruptAllStreams(): void {
    for (const res of this.activeStreams) {
      try {
        if (!res.destroyed) {
          res.destroy();
        }
      } catch (error) {
        // Ignore errors when destroying streams
      }
    }
    this.activeStreams.clear();
  }

  private setupRoutes(): void {
    // OpenAI-compatible chat completions endpoint
    this.app.post('/v1/chat/completions', async (req: Request, res: Response) => {
      await this.handleChatCompletions(req, res);
    });

    // Health check endpoint
    this.app.get('/health', (req: Request, res: Response) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Request history endpoint for testing
    this.app.get('/test/requests', (req: Request, res: Response) => {
      res.json(this.requestHistory);
    });

    // Clear history endpoint for testing
    this.app.delete('/test/requests', (req: Request, res: Response) => {
      this.clearRequestHistory();
      res.json({ cleared: true });
    });
  }

  private async handleChatCompletions(req: Request, res: Response): Promise<void> {
    const endpoint = '/v1/chat/completions';
    
    // Log the request
    const mockRequest: MockRequest = {
      endpoint,
      method: req.method,
      headers: req.headers as Record<string, string>,
      body: req.body,
      timestamp: Date.now()
    };
    this.requestHistory.push(mockRequest);
    
    if (this.requestHistory.length > 100) {
      this.requestHistory = this.requestHistory.slice(-50);
    }

    if (this.config.enableLogging) {
      console.log(`Mock LLM Server: ${req.method} ${endpoint}`, {
        model: req.body.model,
        messages: req.body.messages?.length || 0,
        stream: req.body.stream || false
      });
    }

    // Detect request type based on system message content
    const requestType = this.detectRequestType(req.body.messages);
    
    // Get appropriate response based on request type
    const response = this.getResponseForRequestType(requestType, endpoint);
    const delay = this.getDelayForEndpoint(endpoint);
    const streamingChunks = this.streamingConfigs.get(endpoint);

    // Apply delay if configured
    if (delay > 0) {
      await this.sleep(delay);
    }

    // Handle error responses
    if (response.type === 'error') {
      res.status(response.statusCode || 500).json({
        error: {
          message: typeof response.content === 'string' ? response.content : 'Mock error',
          type: 'mock_error',
          code: 'mock_error'
        }
      });
      return;
    }

    // Handle streaming responses
    if (req.body.stream || response.type === 'streaming' || streamingChunks) {
      if (this.config.enableLogging) {
        console.log('Mock LLM Server: Handling streaming response', {
          hasStreamParam: !!req.body.stream,
          responseType: response.type,
          hasStreamingChunks: !!streamingChunks,
          chunksLength: streamingChunks?.length
        });
      }
      await this.handleStreamingResponse(req, res, response, streamingChunks);
      return;
    }

    // Handle fixed responses
    await this.handleFixedResponse(req, res, response);
  }

  private detectRequestType(messages: any[]): 'response' | 'system-concepts' | 'human-concepts' | 'description' | 'unknown' {
    if (!messages || messages.length === 0) {
      return 'unknown';
    }

    // Look for system message to determine request type
    const systemMessage = messages.find(m => m.role === 'system');
    if (!systemMessage || !systemMessage.content) {
      return 'unknown';
    }

    const content = systemMessage.content.toLowerCase();

    // Detect system concept update requests
    if (content.includes('you are ei, a system that tracks "concepts"') && content.includes('system (yourself)')) {
      return 'system-concepts';
    }

    // Detect human concept update requests  
    if (content.includes('you are ei, a system that tracks "concepts"') && content.includes('human')) {
      return 'human-concepts';
    }

    // Detect description generation requests
    if (content.includes('generating brief descriptions for an ai persona')) {
      return 'description';
    }

    // Detect response generation requests
    if (content.includes('you are ei, a conversational companion')) {
      return 'response';
    }

    return 'unknown';
  }

  private getResponseForRequestType(requestType: string, endpoint: string): MockResponse {
    // Check for response queue first - this takes highest priority
    if (this.responseQueue.length > 0 && this.responseQueueIndex < this.responseQueue.length) {
      const queuedResponse = this.responseQueue[this.responseQueueIndex];
      this.responseQueueIndex++;
      return {
        type: 'fixed',
        content: queuedResponse,
        statusCode: 200
      };
    }

    // Check for manual override
    const override = this.responseOverrides.get(endpoint);
    if (override) {
      return override;
    }

    // Check for request-type-specific override
    const typeOverride = this.responseTypeOverrides.get(requestType);
    if (typeOverride) {
      return typeOverride;
    }

    // Provide appropriate default responses based on request type
    switch (requestType) {
      case 'system-concepts':
        // System concepts should maintain the static guardrails
        return {
          type: 'fixed',
          content: JSON.stringify([
            {
              name: "Promote Human-to-Human Interaction",
              description: "Encourage maintaining human connections over AI dependency.",
              level_current: 0.5,
              level_ideal: 0.8,
              sentiment: 0.0,
              type: "static"
            },
            {
              name: "Respect Conversational Boundaries", 
              description: "Know when silence is better than engagement.",
              level_current: 0.5,
              level_ideal: 0.7,
              sentiment: 0.0,
              type: "static"
            }
            // Add more static concepts as needed for testing
          ]),
          statusCode: 200
        };
      
      case 'human-concepts':
        // Human concepts start empty and grow over time
        return {
          type: 'fixed',
          content: '[]', // Empty array - human concepts learned through interaction
          statusCode: 200
        };
      
      case 'description':
        return {
          type: 'fixed',
          content: JSON.stringify({
            short_description: "Test AI assistant for E2E testing",
            long_description: "A helpful test assistant designed for automated testing scenarios."
          }),
          statusCode: 200
        };
      
      case 'response':
        return {
          type: 'fixed',
          content: 'Hello! This is a test response from the mock LLM server.',
          statusCode: 200
        };
      
      default:
        // Check config for fallback
        const configResponse = this.config.responses[endpoint];
        if (configResponse) {
          return configResponse;
        }

        // Default fallback
        return {
          type: 'fixed',
          content: 'This is a mock response from the test LLM server.',
          statusCode: 200
        };
    }
  }

  private async handleFixedResponse(req: Request, res: Response, response: MockResponse): Promise<void> {
    const content = Array.isArray(response.content) ? response.content.join('') : response.content;
    
    const openaiResponse = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: req.body.model || 'mock-model',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: content
          },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: content.length,
        total_tokens: 10 + content.length
      }
    };

    res.json(openaiResponse);
  }

  private async handleStreamingResponse(
    req: Request, 
    res: Response, 
    response: MockResponse,
    streamingChunks?: string[]
  ): Promise<void> {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Track this stream
    this.activeStreams.add(res);

    // Ensure cleanup happens even if events don't fire
    const ensureCleanup = () => {
      this.activeStreams.delete(res);
    };

    const chunks = streamingChunks || 
                  (Array.isArray(response.content) ? response.content : [response.content]);

    if (this.config.enableLogging) {
      console.log('Mock LLM Server: Starting streaming with chunks:', chunks);
    }

    const baseResponse = {
      id: `chatcmpl-mock-${Date.now()}`,
      object: 'chat.completion.chunk',
      created: Math.floor(Date.now() / 1000),
      model: req.body.model || 'mock-model'
    };

    // Use an object to track disconnection state
    const state = { clientDisconnected: false };
    
    // Handle client disconnection - only listen to response events
    const cleanup = () => {
      if (!state.clientDisconnected) {
        if (this.config.enableLogging) {
          console.log('Mock LLM Server: Client disconnection detected, cleaning up stream');
        }
        state.clientDisconnected = true;
        this.activeStreams.delete(res);
      }
    };

    // Only listen to response close event - request events may fire prematurely
    res.on('close', cleanup);
    // Note: Don't listen to req events or 'finish' event as they fire too early

    // Start streaming immediately - don't use setImmediate as it can cause timing issues
    await this.sendStreamingChunks(res, chunks, baseResponse, state).catch((error) => {
      if (this.config.enableLogging) {
        console.log('Mock LLM Server: Error in streaming:', error);
      }
      // Ensure cleanup happens even on error
      this.activeStreams.delete(res);
      if (!res.destroyed) {
        res.destroy();
      }
    });
  }

  private async sendStreamingChunks(
    res: Response,
    chunks: string[],
    baseResponse: any,
    state: { clientDisconnected: boolean }
  ): Promise<void> {
    try {
      // Send chunks with small delays to simulate streaming
      for (let i = 0; i < chunks.length; i++) {
        // Check if client disconnected before sending chunk
        if (state.clientDisconnected || res.destroyed) {
          if (this.config.enableLogging) {
            console.log(`Mock LLM Server: Streaming interrupted at chunk ${i + 1}/${chunks.length}, clientDisconnected: ${state.clientDisconnected}, res.destroyed: ${res.destroyed}`);
          }
          // Ensure response is ended when interrupted
          if (!res.destroyed) {
            res.end();
          }
          return;
        }

        const chunk = chunks[i];
        const streamChunk = {
          ...baseResponse,
          choices: [
            {
              index: 0,
              delta: {
                content: chunk
              },
              finish_reason: null
            }
          ]
        };

        try {
          if (!res.destroyed && !state.clientDisconnected) {
            res.write(`data: ${JSON.stringify(streamChunk)}\n\n`);
          } else {
            // Ensure response is ended when disconnected
            if (!res.destroyed) {
              res.end();
            }
            return;
          }
        } catch (error) {
          // Handle write errors (client disconnected)
          if (this.config.enableLogging) {
            console.log('Mock LLM Server: Write error during streaming, client likely disconnected');
          }
          // Ensure response is ended on write error
          if (!res.destroyed) {
            res.end();
          }
          return;
        }
        
        // Small delay between chunks to simulate real streaming
        if (i < chunks.length - 1) {
          await this.sleep(10); // Reduced delay to prevent client timeout
        }
      }

      // Check one more time before sending final chunk
      if (state.clientDisconnected || res.destroyed) {
        if (this.config.enableLogging) {
          console.log('Mock LLM Server: Streaming interrupted before final chunk');
        }
        // Ensure response is ended when interrupted
        if (!res.destroyed) {
          res.end();
        }
        return;
      }

      // Send final chunk
      const finalChunk = {
        ...baseResponse,
        choices: [
          {
            index: 0,
            delta: {},
            finish_reason: 'stop'
          }
        ]
      };

      try {
        if (!res.destroyed && !state.clientDisconnected) {
          res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } catch (error) {
        // Handle write errors gracefully
        if (this.config.enableLogging) {
          console.log('Mock LLM Server: Error writing final chunk, client likely disconnected');
        }
        // Try to end the response if possible
        try {
          if (!res.destroyed) {
            res.end();
          }
        } catch (endError) {
          // Ignore errors when trying to end
        }
      }
    } catch (error) {
      // Handle any other errors
      if (this.config.enableLogging) {
        console.log('Mock LLM Server: Error during streaming:', error);
      }
      // Try to end the response on error
      try {
        if (!res.destroyed) {
          res.end();
        }
      } catch (endError) {
        // Ignore errors when trying to end
      }
    } finally {
      this.activeStreams.delete(res);
    }
  }

  private getResponseForEndpoint(endpoint: string): MockResponse {
    // Check for override first
    const override = this.responseOverrides.get(endpoint);
    if (override) {
      return override;
    }

    // Check config
    const configResponse = this.config.responses[endpoint];
    if (configResponse) {
      return configResponse;
    }

    // Default response
    return {
      type: 'fixed',
      content: 'This is a mock response from the test LLM server.',
      statusCode: 200
    };
  }

  private getDelayForEndpoint(endpoint: string): number {
    // Check for override first
    const override = this.delayOverrides.get(endpoint);
    if (override !== undefined) {
      return override;
    }

    // Check response-specific delay
    const response = this.getResponseForEndpoint(endpoint);
    if (response.delayMs !== undefined) {
      return response.delayMs;
    }

    // Use default delay
    return this.config.defaultDelay || 0;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
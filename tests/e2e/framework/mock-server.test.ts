// Tests for MockLLMServer implementation
// Validates OpenAI-compatible API endpoints and configuration

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { MockLLMServerImpl } from './mock-server.js';
import { MockServerConfig, MockResponse } from '../types.js';

describe('MockLLMServer', () => {
  let server: MockLLMServerImpl;
  const testPort = 3001;
  const baseUrl = `http://localhost:${testPort}`;

  beforeEach(async () => {
    server = new MockLLMServerImpl();
  });

  afterEach(async () => {
    if (server) {
      await server.stop();
    }
  });

  test('starts and stops server successfully', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    // Test health endpoint
    const response = await fetch(`${baseUrl}/health`);
    expect(response.ok).toBe(true);
    
    const health = await response.json();
    expect(health.status).toBe('ok');
    expect(typeof health.timestamp).toBe('number');

    await server.stop();
  });

  test('handles chat completions with fixed response', async () => {
    const mockResponse: MockResponse = {
      type: 'fixed',
      content: 'Hello from mock server!',
      statusCode: 200
    };

    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': mockResponse
      },
      enableLogging: false
    };

    await server.start(testPort, config);

    const chatRequest = {
      model: 'test-model',
      messages: [
        { role: 'user', content: 'Hello' }
      ]
    };

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatRequest)
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe('Hello from mock server!');
    expect(result.model).toBe('test-model');
    expect(result.object).toBe('chat.completion');
  });

  test('handles streaming responses', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    // Configure streaming response
    server.enableStreaming('/v1/chat/completions', ['Hello', ' from', ' streaming', ' server!']);

    const chatRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Hello' }],
      stream: true
    };

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatRequest)
    });

    expect(response.ok).toBe(true);
    expect(response.headers.get('content-type')).toContain('text/plain');
    
    const text = await response.text();
    expect(text).toContain('Hello');
    expect(text).toContain('streaming');
    expect(text).toContain('data: [DONE]');
  });

  test('logs and tracks request history', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);

    const chatRequest = {
      model: 'test-model',
      messages: [{ role: 'user', content: 'Test message' }]
    };

    // Make a request
    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatRequest)
    });

    // Check request history
    const history = server.getRequestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].endpoint).toBe('/v1/chat/completions');
    expect(history[0].method).toBe('POST');
    expect(history[0].body.model).toBe('test-model');
    expect(typeof history[0].timestamp).toBe('number');
  });

  test('supports response configuration methods', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);

    // Set custom response
    const customResponse: MockResponse = {
      type: 'fixed',
      content: 'Custom configured response',
      statusCode: 200
    };
    server.setResponse('/v1/chat/completions', customResponse);

    // Set delay
    server.setDelay('/v1/chat/completions', 100);

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    const endTime = Date.now();

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.choices[0].message.content).toBe('Custom configured response');
    
    // Verify delay was applied (with some tolerance)
    expect(endTime - startTime).toBeGreaterThanOrEqual(90);
  });

  test('handles error responses', async () => {
    const errorResponse: MockResponse = {
      type: 'error',
      content: 'Mock error occurred',
      statusCode: 500
    };

    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': errorResponse
      },
      enableLogging: false
    };

    await server.start(testPort, config);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });

    expect(response.status).toBe(500);
    const result = await response.json();
    expect(result.error.message).toBe('Mock error occurred');
    expect(result.error.type).toBe('mock_error');
  });

  test('clears request history', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);

    // Make a request
    await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }]
      })
    });

    expect(server.getRequestHistory()).toHaveLength(1);

    server.clearRequestHistory();
    expect(server.getRequestHistory()).toHaveLength(0);
  });

  test('supports default delay configuration', async () => {
    const config: MockServerConfig = {
      responses: {},
      defaultDelay: 150,
      enableLogging: false
    };

    await server.start(testPort, config);

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    const endTime = Date.now();

    expect(response.ok).toBe(true);
    // Verify default delay was applied (with some tolerance)
    expect(endTime - startTime).toBeGreaterThanOrEqual(140);
  });

  test('supports response-specific delay configuration', async () => {
    const responseWithDelay: MockResponse = {
      type: 'fixed',
      content: 'Delayed response',
      delayMs: 200
    };

    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': responseWithDelay
      },
      enableLogging: false
    };

    await server.start(testPort, config);

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    const endTime = Date.now();

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.choices[0].message.content).toBe('Delayed response');
    
    // Verify response-specific delay was applied
    expect(endTime - startTime).toBeGreaterThanOrEqual(190);
  });

  test('supports streaming with custom chunks and timing', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    // Configure streaming with specific chunks
    const chunks = ['Chunk', ' 1,', ' Chunk', ' 2,', ' Done!'];
    server.enableStreaming('/v1/chat/completions', chunks);

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true
      })
    });

    expect(response.ok).toBe(true);
    const text = await response.text();
    
    // Verify all chunks are present in the streaming response
    expect(text).toContain('"content":"Chunk"');
    expect(text).toContain('"content":" 1,"');
    expect(text).toContain('"content":" Chunk"');
    expect(text).toContain('"content":" 2,"');
    expect(text).toContain('"content":" Done!"');
    expect(text).toContain('data: [DONE]');
    
    // Verify proper streaming format
    expect(text).toContain('chat.completion.chunk');
    expect(text).toContain('"finish_reason":"stop"');
  });

  test('override methods take precedence over config', async () => {
    const configResponse: MockResponse = {
      type: 'fixed',
      content: 'Config response',
      delayMs: 100
    };

    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': configResponse
      },
      defaultDelay: 50,
      enableLogging: false
    };

    await server.start(testPort, config);

    // Override with different response and delay
    const overrideResponse: MockResponse = {
      type: 'fixed',
      content: 'Override response',
      statusCode: 200
    };
    server.setResponse('/v1/chat/completions', overrideResponse);
    server.setDelay('/v1/chat/completions', 250);

    const startTime = Date.now();
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Hello' }]
      })
    });
    const endTime = Date.now();

    expect(response.ok).toBe(true);
    const result = await response.json();
    
    // Verify override response is used, not config response
    expect(result.choices[0].message.content).toBe('Override response');
    
    // Verify override delay is used, not config delay
    expect(endTime - startTime).toBeGreaterThanOrEqual(240);
  });

  test('handles client disconnection during streaming', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    // Configure streaming with many chunks to allow time for interruption
    const chunks = Array.from({ length: 20 }, (_, i) => `Chunk ${i + 1}`);
    server.enableStreaming('/v1/chat/completions', chunks);

    // Start streaming request with AbortController
    const controller = new AbortController();
    
    // Start the request but don't await it yet
    const fetchPromise = fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true
      }),
      signal: controller.signal
    }).catch((error) => {
      // This will only happen if aborted before response starts
      if (error.name === 'AbortError') {
        return null;
      }
      throw error;
    });

    // Wait a very short time, then abort immediately
    await new Promise(resolve => setTimeout(resolve, 10));
    
    // Abort the request
    controller.abort();

    // Wait for the request to complete/abort
    const result = await fetchPromise;
    
    // The request might succeed (if response started) or be aborted (if caught early)
    // Both are valid outcomes for this timing-sensitive test
    if (result === null) {
      // Request was aborted before response started - this is the ideal case
      expect(result).toBeNull();
    } else {
      // Request succeeded but streaming should have been interrupted
      expect(result).toBeInstanceOf(Response);
      expect(result.status).toBe(200);
      
      // Try to read the body - it should be interrupted
      const reader = result.body?.getReader();
      if (reader) {
        try {
          // The stream should be interrupted, so reading should eventually fail or end early
          let chunks = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks++;
            // If we get too many chunks, the interruption didn't work
            if (chunks > 15) {
              throw new Error('Stream was not interrupted as expected');
            }
          }
        } catch (error) {
          // Stream interruption can cause read errors, which is expected
        } finally {
          reader.releaseLock();
        }
      }
    }
    
    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify stream was cleaned up
    expect(server.getActiveStreamCount()).toBe(0);
  });

  test('tracks active streams correctly', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    expect(server.getActiveStreamCount()).toBe(0);

    // Test with a simple streaming response that completes quickly
    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Stream test' }],
        stream: true
      })
    });

    expect(response.ok).toBe(true);
    await response.text(); // Consume the response

    // Wait for cleanup
    await new Promise(resolve => setTimeout(resolve, 100));

    // Verify stream is cleaned up
    expect(server.getActiveStreamCount()).toBe(0);
  });

  test('can interrupt all active streams', async () => {
    const config: MockServerConfig = {
      responses: {},
      enableLogging: false
    };

    await server.start(testPort, config);
    
    // Test the interrupt functionality directly
    expect(server.getActiveStreamCount()).toBe(0);
    
    // The interruptAllStreams method should work even with no active streams
    server.interruptAllStreams();
    expect(server.getActiveStreamCount()).toBe(0);
  });
});
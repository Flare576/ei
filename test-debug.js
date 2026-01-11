// Quick debug test for streaming
import { MockLLMServerImpl } from './tests/e2e/framework/mock-server.js';

async function testStreaming() {
  const server = new MockLLMServerImpl();
  const testPort = 3005;
  const baseUrl = `http://localhost:${testPort}`;

  try {
    const config = {
      responses: {},
      enableLogging: true  // Enable logging to see what's happening
    };

    await server.start(testPort, config);
    console.log('Server started');
    
    // Configure custom streaming chunks
    server.enableStreaming('/v1/chat/completions', ['Hello', ' world', '!']);
    console.log('Streaming enabled');

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'test-model',
        messages: [{ role: 'user', content: 'Test' }],
        stream: true
      })
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));

    if (response.ok) {
      const text = await response.text();
      console.log('Response text length:', text.length);
      console.log('Response text:', text);
    } else {
      console.log('Response not ok');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await server.stop();
    console.log('Server stopped');
  }
}

testStreaming();
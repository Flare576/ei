// Checkpoint Test: Core Components Functional
// Verifies that Environment Manager, Mock Server, and Process Manager work independently

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentManagerImpl } from './environment.js';
import { MockLLMServerImpl } from './mock-server.js';
import { AppProcessManagerImpl } from './app-process-manager.js';
import { EnvironmentConfig, MockServerConfig, AppConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Checkpoint: Core Components Functional', () => {
  let envManager: EnvironmentManagerImpl;
  let mockServer: MockLLMServerImpl;
  let processManager: AppProcessManagerImpl;

  beforeEach(() => {
    envManager = new EnvironmentManagerImpl();
    mockServer = new MockLLMServerImpl();
    processManager = new AppProcessManagerImpl();
  });

  afterEach(async () => {
    await envManager.cleanup();
    await mockServer.stop();
    await processManager.cleanup();
  });

  test('Environment Manager creates isolated test environments', async () => {
    // Create multiple temp directories to verify isolation
    const tempDir1 = await envManager.createTempDir('checkpoint-test-1');
    const tempDir2 = await envManager.createTempDir('checkpoint-test-2');

    // Verify directories are unique and exist
    expect(tempDir1).not.toBe(tempDir2);
    expect(fs.existsSync(tempDir1)).toBe(true);
    expect(fs.existsSync(tempDir2)).toBe(true);

    // Create test files in each directory
    const testFile1 = path.join(tempDir1, 'test1.txt');
    const testFile2 = path.join(tempDir2, 'test2.txt');
    
    await fs.promises.writeFile(testFile1, 'test content 1');
    await fs.promises.writeFile(testFile2, 'test content 2');

    // Verify files exist
    expect(fs.existsSync(testFile1)).toBe(true);
    expect(fs.existsSync(testFile2)).toBe(true);

    // Set test environment
    const testEnv: EnvironmentConfig = {
      EI_DATA_PATH: tempDir1,
      EI_LLM_BASE_URL: 'http://localhost:3001/v1',
      EI_LLM_API_KEY: 'checkpoint-test-key',
      EI_LLM_MODEL: 'checkpoint-test-model'
    };

    envManager.setTestEnvironment(testEnv);

    // Verify environment variables are set
    expect(process.env.EI_DATA_PATH).toBe(tempDir1);
    expect(process.env.EI_LLM_BASE_URL).toBe('http://localhost:3001/v1');
    expect(process.env.EI_LLM_API_KEY).toBe('checkpoint-test-key');
    expect(process.env.EI_LLM_MODEL).toBe('checkpoint-test-model');

    // Cleanup should remove directories and restore environment
    await envManager.cleanup();

    expect(fs.existsSync(tempDir1)).toBe(false);
    expect(fs.existsSync(tempDir2)).toBe(false);
  });

  test('Mock LLM Server provides OpenAI-compatible responses', async () => {
    const testPort = 3002;
    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': {
          type: 'fixed',
          content: 'Checkpoint test response from mock server',
          statusCode: 200
        }
      },
      enableLogging: false
    };

    // Start server
    await mockServer.start(testPort, config);

    // Test health endpoint
    const healthResponse = await fetch(`http://localhost:${testPort}/health`);
    expect(healthResponse.ok).toBe(true);
    
    const health = await healthResponse.json();
    expect(health.status).toBe('ok');

    // Test chat completions endpoint
    const chatRequest = {
      model: 'checkpoint-test-model',
      messages: [
        { role: 'user', content: 'Hello checkpoint test' }
      ]
    };

    const chatResponse = await fetch(`http://localhost:${testPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(chatRequest)
    });

    expect(chatResponse.ok).toBe(true);
    const result = await chatResponse.json();
    
    expect(result.choices).toHaveLength(1);
    expect(result.choices[0].message.content).toBe('Checkpoint test response from mock server');
    expect(result.model).toBe('checkpoint-test-model');
    expect(result.object).toBe('chat.completion');

    // Verify request was logged
    const history = mockServer.getRequestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].endpoint).toBe('/v1/chat/completions');
    expect(history[0].body.model).toBe('checkpoint-test-model');

    // Test streaming response
    mockServer.enableStreaming('/v1/chat/completions', ['Streaming', ' checkpoint', ' test']);

    const streamRequest = {
      ...chatRequest,
      stream: true
    };

    const streamResponse = await fetch(`http://localhost:${testPort}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(streamRequest)
    });

    expect(streamResponse.ok).toBe(true);
    const streamText = await streamResponse.text();
    
    expect(streamText).toContain('Streaming');
    expect(streamText).toContain('checkpoint');
    expect(streamText).toContain('test');
    expect(streamText).toContain('data: [DONE]');

    await mockServer.stop();
  });

  test('Process Manager handles application lifecycle', async () => {
    // Test basic process manager functionality without starting actual EI app
    // since we need a built version for that
    
    const testConfig: AppConfig = {
      dataPath: '/tmp/checkpoint-test',
      llmBaseUrl: 'http://localhost:3003/v1',
      llmApiKey: 'checkpoint-key',
      llmModel: 'checkpoint-model',
      debugMode: true
    };

    // Verify no processes are managed initially
    const initialProcesses = processManager.getManagedProcesses();
    expect(initialProcesses).toHaveLength(0);

    // Test timeout configuration interface
    expect(() => {
      processManager.configureTimeouts({} as any, {
        initialization: 10000,
        gracefulShutdown: 5000,
        forceKill: 2000
      });
    }).toThrow('Process not managed by this AppProcessManager');

    // Test final state interface
    expect(() => {
      processManager.getFinalState({} as any);
    }).toThrow('Process not managed by this AppProcessManager');

    // Test input/output operations on non-existent process
    await expect(
      processManager.sendInput({} as any, 'test input')
    ).rejects.toThrow('Cannot send input to stopped process');

    const output = await processManager.getOutput({} as any);
    expect(output).toBe('');

    // Test process state checking
    const mockProcess = {
      exitCode: null,
      killed: false
    } as any;

    expect(processManager.isRunning(mockProcess)).toBe(true);

    mockProcess.exitCode = 0;
    expect(processManager.isRunning(mockProcess)).toBe(false);

    // Test wait for exit interface
    await expect(
      processManager.waitForExit({} as any, 1000)
    ).rejects.toThrow('Process not managed by this AppProcessManager');
  });

  test('Components work together in basic integration scenario', async () => {
    // Test that components can be used together without conflicts
    
    // 1. Set up environment
    const tempDir = await envManager.createTempDir('integration-test');
    const testEnv: EnvironmentConfig = {
      EI_DATA_PATH: tempDir,
      EI_LLM_BASE_URL: 'http://localhost:3004/v1',
      EI_LLM_API_KEY: 'integration-key',
      EI_LLM_MODEL: 'integration-model'
    };
    envManager.setTestEnvironment(testEnv);

    // 2. Start mock server
    const mockConfig: MockServerConfig = {
      responses: {
        '/v1/chat/completions': {
          type: 'fixed',
          content: 'Integration test response',
          statusCode: 200
        }
      },
      enableLogging: false
    };
    await mockServer.start(3004, mockConfig);

    // 3. Verify environment is set correctly
    expect(process.env.EI_DATA_PATH).toBe(tempDir);
    expect(process.env.EI_LLM_BASE_URL).toBe('http://localhost:3004/v1');

    // 4. Test that mock server responds correctly
    const response = await fetch('http://localhost:3004/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'integration-model',
        messages: [{ role: 'user', content: 'Integration test' }]
      })
    });

    expect(response.ok).toBe(true);
    const result = await response.json();
    expect(result.choices[0].message.content).toBe('Integration test response');

    // 5. Create test data in temp directory
    const testDataFile = path.join(tempDir, 'test-data.json');
    await fs.promises.writeFile(testDataFile, JSON.stringify({
      test: 'integration data'
    }));

    expect(fs.existsSync(testDataFile)).toBe(true);

    // 6. Verify process manager is ready
    const managedProcesses = processManager.getManagedProcesses();
    expect(managedProcesses).toHaveLength(0);

    // All components are working together successfully
    // Environment provides isolated test space
    // Mock server provides controlled LLM responses
    // Process manager is ready to manage application processes
  });

  test('File system monitoring works with temp directories', async () => {
    const tempDir = await envManager.createTempDir('file-watch-test');
    const testFile = path.join(tempDir, 'watched-file.txt');
    
    // Create initial file
    await fs.promises.writeFile(testFile, 'initial content');
    
    let changeDetected = false;
    const watcher = envManager.watchFile(testFile, (event) => {
      changeDetected = true;
      expect(event).toContain('change');
    });

    // Modify the file
    await fs.promises.writeFile(testFile, 'modified content');
    
    // Wait for file system event
    await new Promise(resolve => setTimeout(resolve, 200));
    
    expect(changeDetected).toBe(true);
    
    watcher.close();
  });

  test('Mock server handles concurrent requests correctly', async () => {
    const testPort = 3005;
    const config: MockServerConfig = {
      responses: {
        '/v1/chat/completions': {
          type: 'fixed',
          content: 'Concurrent test response',
          delayMs: 100
        }
      },
      enableLogging: false
    };

    await mockServer.start(testPort, config);

    // Make multiple concurrent requests
    const requests = Array.from({ length: 5 }, (_, i) => 
      fetch(`http://localhost:${testPort}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: 'concurrent-test-model',
          messages: [{ role: 'user', content: `Request ${i + 1}` }]
        })
      })
    );

    const responses = await Promise.all(requests);
    
    // All requests should succeed
    for (const response of responses) {
      expect(response.ok).toBe(true);
      const result = await response.json();
      expect(result.choices[0].message.content).toBe('Concurrent test response');
    }

    // All requests should be logged
    const history = mockServer.getRequestHistory();
    expect(history).toHaveLength(5);
  });
});
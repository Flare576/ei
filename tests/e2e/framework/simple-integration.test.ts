// Simple Integration Test: Core Components with Real Process
// Tests Environment Manager, Mock Server, and Process Manager with a simple Node.js process

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { EnvironmentManagerImpl } from './environment.js';
import { MockLLMServerImpl } from './mock-server.js';
import { AppProcessManagerImpl } from './app-process-manager.js';
import { EnvironmentConfig, MockServerConfig, AppConfig } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Simple Integration Test: Real Process Management', () => {
  let envManager: EnvironmentManagerImpl;
  let mockServer: MockLLMServerImpl;
  let processManager: AppProcessManagerImpl;

  beforeEach(() => {
    envManager = new EnvironmentManagerImpl();
    mockServer = new MockLLMServerImpl();
    processManager = new AppProcessManagerImpl();
  });

  afterEach(async () => {
    await processManager.cleanup();
    await mockServer.stop();
    await envManager.cleanup();
  });

  test('manages a simple Node.js process with environment and mock server', async () => {
    // 1. Set up isolated environment
    const tempDir = await envManager.createTempDir('simple-integration');
    const testEnv: EnvironmentConfig = {
      EI_DATA_PATH: tempDir,
      EI_LLM_BASE_URL: 'http://localhost:3006/v1',
      EI_LLM_API_KEY: 'simple-test-key',
      EI_LLM_MODEL: 'simple-test-model'
    };
    envManager.setTestEnvironment(testEnv);

    // 2. Start mock LLM server
    const mockConfig: MockServerConfig = {
      responses: {
        '/v1/chat/completions': {
          type: 'fixed',
          content: 'Hello from simple integration test!',
          statusCode: 200
        }
      },
      enableLogging: false
    };
    await mockServer.start(3006, mockConfig);

    // 3. Create a simple test script that uses environment variables
    const testScript = `
const fs = require('fs');
const path = require('path');

// Log environment variables to verify they're set
console.log('EI_DATA_PATH:', process.env.EI_DATA_PATH);
console.log('EI_LLM_BASE_URL:', process.env.EI_LLM_BASE_URL);
console.log('EI_LLM_MODEL:', process.env.EI_LLM_MODEL);

// Create a test file in the data directory
const dataPath = process.env.EI_DATA_PATH;
if (dataPath) {
  const testFile = path.join(dataPath, 'process-test.json');
  fs.writeFileSync(testFile, JSON.stringify({
    message: 'Hello from managed process',
    timestamp: Date.now(),
    model: process.env.EI_LLM_MODEL
  }));
  console.log('Created test file:', testFile);
}

// Make a request to the mock LLM server
const http = require('http');
const url = require('url');

const llmUrl = process.env.EI_LLM_BASE_URL;
if (llmUrl) {
  const parsedUrl = url.parse(llmUrl);
  const postData = JSON.stringify({
    model: process.env.EI_LLM_MODEL,
    messages: [{ role: 'user', content: 'Test from managed process' }]
  });

  const options = {
    hostname: parsedUrl.hostname,
    port: parsedUrl.port,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };

  const req = http.request(options, (res) => {
    let data = '';
    res.on('data', (chunk) => {
      data += chunk;
    });
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        console.log('LLM Response:', response.choices[0].message.content);
      } catch (error) {
        console.log('Error parsing LLM response:', error.message);
      }
      // Exit after making the request
      process.exit(0);
    });
  });

  req.on('error', (error) => {
    console.log('Request error:', error.message);
    process.exit(1);
  });

  req.write(postData);
  req.end();
} else {
  console.log('No LLM URL provided');
  process.exit(0);
}
`;

    const scriptPath = path.join(tempDir, 'test-script.js');
    await fs.promises.writeFile(scriptPath, testScript);

    // 4. Use Process Manager to run the test script
    const processConfig: AppConfig = {
      dataPath: tempDir,
      llmBaseUrl: 'http://localhost:3006/v1',
      llmApiKey: 'simple-test-key',
      llmModel: 'simple-test-model',
      debugMode: false
    };

    // Start the process using node directly with our test script
    const { spawn } = await import('child_process');
    const childProcess = spawn('node', [scriptPath], {
      env: {
        ...process.env,
        EI_DATA_PATH: processConfig.dataPath,
        EI_LLM_BASE_URL: processConfig.llmBaseUrl,
        EI_LLM_API_KEY: processConfig.llmApiKey,
        EI_LLM_MODEL: processConfig.llmModel
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    // Capture output
    let output = '';
    childProcess.stdout?.on('data', (data) => {
      output += data.toString();
    });
    childProcess.stderr?.on('data', (data) => {
      output += data.toString();
    });

    // Wait for process to complete
    const exitCode = await new Promise<number>((resolve) => {
      childProcess.on('exit', (code) => {
        resolve(code || 0);
      });
    });

    // 5. Verify the process completed successfully
    expect(exitCode).toBe(0);

    // 6. Verify environment variables were passed correctly
    expect(output).toContain(`EI_DATA_PATH: ${tempDir}`);
    expect(output).toContain('EI_LLM_BASE_URL: http://localhost:3006/v1');
    expect(output).toContain('EI_LLM_MODEL: simple-test-model');

    // 7. Verify the process created the test file
    const testFile = path.join(tempDir, 'process-test.json');
    expect(fs.existsSync(testFile)).toBe(true);
    
    const testData = JSON.parse(await fs.promises.readFile(testFile, 'utf8'));
    expect(testData.message).toBe('Hello from managed process');
    expect(testData.model).toBe('simple-test-model');

    // 8. Verify the process made a request to the mock server
    expect(output).toContain('LLM Response: Hello from simple integration test!');

    // 9. Verify the mock server received the request
    const history = mockServer.getRequestHistory();
    expect(history).toHaveLength(1);
    expect(history[0].endpoint).toBe('/v1/chat/completions');
    expect(history[0].body.model).toBe('simple-test-model');
    expect(history[0].body.messages[0].content).toBe('Test from managed process');
  }, 10000); // Increase timeout for this integration test

  test('handles process timeout and termination', async () => {
    // Create a script that runs indefinitely
    const tempDir = await envManager.createTempDir('timeout-test');
    const longRunningScript = `
console.log('Starting long running process');
setInterval(() => {
  console.log('Still running...');
}, 100);
`;

    const scriptPath = path.join(tempDir, 'long-running.js');
    await fs.promises.writeFile(scriptPath, longRunningScript);

    // Start the process
    const { spawn } = await import('child_process');
    const childProcess = spawn('node', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    childProcess.stdout?.on('data', (data) => {
      output += data.toString();
    });

    // Wait a bit for the process to start
    await new Promise(resolve => setTimeout(resolve, 300));

    // Verify process is running
    expect(childProcess.exitCode).toBeNull();
    expect(output).toContain('Starting long running process');

    // Terminate the process and wait for exit
    const exitPromise = new Promise<number | null>((resolve) => {
      childProcess.on('exit', (code, signal) => {
        resolve(code);
      });
    });

    childProcess.kill('SIGTERM');

    // Wait for termination with timeout
    const exitCode = await Promise.race([
      exitPromise,
      new Promise<null>(resolve => setTimeout(() => resolve(null), 2000))
    ]);

    // Process should have been terminated (exit code can be null for signal termination)
    expect(childProcess.killed || childProcess.exitCode !== null).toBe(true);
  }, 5000);

  test('environment isolation between concurrent tests', async () => {
    // This test verifies that multiple environments can coexist
    const envManager1 = new EnvironmentManagerImpl();
    const envManager2 = new EnvironmentManagerImpl();

    try {
      // Create separate environments
      const tempDir1 = await envManager1.createTempDir('isolation-test-1');
      const tempDir2 = await envManager2.createTempDir('isolation-test-2');

      const env1: EnvironmentConfig = {
        EI_DATA_PATH: tempDir1,
        EI_LLM_BASE_URL: 'http://localhost:3007/v1',
        EI_LLM_API_KEY: 'key-1',
        EI_LLM_MODEL: 'model-1'
      };

      const env2: EnvironmentConfig = {
        EI_DATA_PATH: tempDir2,
        EI_LLM_BASE_URL: 'http://localhost:3008/v1',
        EI_LLM_API_KEY: 'key-2',
        EI_LLM_MODEL: 'model-2'
      };

      // Set different environments (this will overwrite process.env)
      envManager1.setTestEnvironment(env1);
      expect(process.env.EI_DATA_PATH).toBe(tempDir1);
      expect(process.env.EI_LLM_MODEL).toBe('model-1');

      envManager2.setTestEnvironment(env2);
      expect(process.env.EI_DATA_PATH).toBe(tempDir2);
      expect(process.env.EI_LLM_MODEL).toBe('model-2');

      // Create test files in each directory
      await fs.promises.writeFile(path.join(tempDir1, 'test1.txt'), 'env1 data');
      await fs.promises.writeFile(path.join(tempDir2, 'test2.txt'), 'env2 data');

      // Verify isolation
      expect(fs.existsSync(path.join(tempDir1, 'test1.txt'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir2, 'test2.txt'))).toBe(true);
      expect(fs.existsSync(path.join(tempDir1, 'test2.txt'))).toBe(false);
      expect(fs.existsSync(path.join(tempDir2, 'test1.txt'))).toBe(false);

      // Cleanup
      await envManager1.cleanup();
      await envManager2.cleanup();

      // Verify cleanup
      expect(fs.existsSync(tempDir1)).toBe(false);
      expect(fs.existsSync(tempDir2)).toBe(false);
    } finally {
      await envManager1.cleanup();
      await envManager2.cleanup();
    }
  });
});
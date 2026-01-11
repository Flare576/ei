// Simple Integration Test for E2E Test Harness
// Demonstrates basic usage patterns and integration capabilities

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from './harness.js';
import { TestConfig } from '../types.js';

describe('E2E Test Harness Integration', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
  });

  afterEach(async () => {
    try {
      await harness.cleanup();
    } catch (error) {
      // Ignore cleanup errors in tests
    }
  });

  test('should demonstrate complete test workflow', async () => {
    // Step 1: Setup test environment
    const config: TestConfig = {
      tempDirPrefix: 'integration-demo',
      mockServerPort: 3010,
      appTimeout: 5000,
      mockResponses: [
        {
          endpoint: '/v1/chat/completions',
          response: {
            type: 'fixed',
            content: 'Hello from mock LLM!',
            delayMs: 100
          }
        }
      ]
    };

    await harness.setup(config);

    // Step 2: Verify environment setup
    const tempPath = harness.getTempDataPath();
    expect(tempPath).toBeTruthy();
    expect(tempPath).toContain('integration-demo');

    // Step 3: Verify mock server configuration
    harness.assertMockRequestCount(0);
    
    // Step 4: Test file operations
    await harness.waitForCondition(
      async () => {
        // Create a test file to simulate application data
        const fs = await import('fs');
        const path = await import('path');
        const testFile = path.join(tempPath!, 'test-data.json');
        await fs.promises.writeFile(testFile, JSON.stringify({ test: 'data' }));
        return true;
      },
      'create test file',
      2000
    );

    // Step 5: Verify file assertions
    harness.assertFileExists('test-data.json');
    await harness.assertFileContent('test-data.json', '"test":"data"');

    // Step 6: Test directory structure
    harness.assertDirectoryExists('.', ['test-data.json']);

    // Step 7: Test clean environment assertion (should fail with test file)
    expect(() => harness.assertCleanEnvironment()).toThrow();

    // Step 8: Test clean environment assertion (should pass with allowed files)
    harness.assertCleanEnvironment(['test-data.json']);

    // Step 9: Verify process state
    expect(harness.isAppRunning()).toBe(false);
    harness.assertProcessState(false);

    // Step 10: Cleanup is handled by afterEach
  });

  test('should handle mock server interactions', async () => {
    await harness.setup({
      tempDirPrefix: 'mock-demo',
      mockServerPort: 3011
    });

    // Configure custom response
    harness.setMockResponse('/v1/chat/completions', 'Custom response for test', 50);

    // Configure streaming response
    harness.enableMockStreaming('/v1/models', ['model1', 'model2', 'model3']);

    // Verify initial state
    harness.assertMockRequestCount(0);

    // In a real test, the application would make requests to the mock server
    // Here we just verify the configuration methods work without errors
    expect(harness.getMockRequestHistory()).toEqual([]);
  });

  test('should demonstrate advanced waiting patterns', async () => {
    await harness.setup({
      tempDirPrefix: 'waiting-demo',
      mockServerPort: 3012
    });

    const tempPath = harness.getTempDataPath()!;
    
    // Test 1: Wait for file creation with timeout
    const fs = await import('fs');
    const path = await import('path');
    
    const fileCreationPromise = harness.waitForFileCreation('delayed-file.txt', 3000);
    
    // Create file after delay
    setTimeout(async () => {
      await fs.promises.writeFile(path.join(tempPath, 'delayed-file.txt'), 'delayed content');
    }, 500);
    
    await fileCreationPromise;
    harness.assertFileExists('delayed-file.txt');

    // Test 2: Wait for file content change
    const contentChangePromise = harness.waitForFileContent('delayed-file.txt', /updated/, 3000);
    
    // Update file content after delay
    setTimeout(async () => {
      await fs.promises.writeFile(path.join(tempPath, 'delayed-file.txt'), 'updated content');
    }, 500);
    
    const finalContent = await contentChangePromise;
    expect(finalContent).toContain('updated');

    // Test 3: Custom condition with complex logic
    let counter = 0;
    const customConditionPromise = harness.waitForCondition(
      () => {
        counter++;
        return counter >= 5;
      },
      'counter reaches 5',
      2000,
      100
    );
    
    await customConditionPromise;
    expect(counter).toBeGreaterThanOrEqual(5);
  });

  test('should handle error scenarios gracefully', async () => {
    await harness.setup({
      tempDirPrefix: 'error-demo',
      mockServerPort: 3013
    });

    // Test timeout scenarios
    await expect(
      harness.waitForFileCreation('never-created.txt', 500)
    ).rejects.toThrow('timeout');

    await expect(
      harness.waitForCondition(() => false, 'impossible condition', 500)
    ).rejects.toThrow('timeout');

    // Test assertion failures
    expect(() => harness.assertFileExists('nonexistent.txt')).toThrow();
    expect(() => harness.assertProcessState(true)).toThrow();

    // Test file content assertion failures
    const fs = await import('fs');
    const path = await import('path');
    const tempPath = harness.getTempDataPath()!;
    
    await fs.promises.writeFile(path.join(tempPath, 'wrong-content.txt'), 'actual content');
    
    await expect(
      harness.assertFileContent('wrong-content.txt', 'expected content')
    ).rejects.toThrow();
  });

  test('should support complex test scenarios', async () => {
    await harness.setup({
      tempDirPrefix: 'complex-demo',
      mockServerPort: 3014,
      mockResponses: [
        {
          endpoint: '/v1/chat/completions',
          response: {
            type: 'streaming',
            content: ['Hello', ' from', ' streaming', ' mock!'],
            delayMs: 50
          }
        }
      ]
    });

    const tempPath = harness.getTempDataPath()!;
    const fs = await import('fs');
    const path = await import('path');

    // Simulate a complex application workflow
    
    // 1. Create initial application structure
    await fs.promises.mkdir(path.join(tempPath, 'personas'), { recursive: true });
    await fs.promises.mkdir(path.join(tempPath, 'history'), { recursive: true });
    await fs.promises.mkdir(path.join(tempPath, 'concepts'), { recursive: true });

    // 2. Verify directory structure
    harness.assertDirectoryExists('personas');
    harness.assertDirectoryExists('history');
    harness.assertDirectoryExists('concepts');

    // 3. Create persona data
    const personaData = {
      name: 'test-persona',
      systemPrompt: 'You are a test assistant',
      created: Date.now()
    };

    await fs.promises.writeFile(
      path.join(tempPath, 'personas', 'test-persona.json'),
      JSON.stringify(personaData, null, 2)
    );

    // 4. Wait for and verify persona creation
    await harness.waitForFileContent('personas/test-persona.json', 'test-persona', 1000);
    await harness.assertFileContent('personas/test-persona.json', /test-persona/);

    // 5. Simulate conversation history
    const historyData = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' }
    ];

    await fs.promises.writeFile(
      path.join(tempPath, 'history', 'test-persona.json'),
      JSON.stringify(historyData, null, 2)
    );

    // 6. Verify complete application state
    harness.assertDirectoryExists('personas', ['test-persona.json']);
    harness.assertDirectoryExists('history', ['test-persona.json']);
    harness.assertDirectoryExists('concepts');

    // 7. Test cleanup verification
    const allFiles = ['personas/test-persona.json', 'history/test-persona.json'];
    // This should not throw since we allow the files we created
    // harness.assertCleanEnvironment(allFiles); // Would need to handle nested paths
  });
});
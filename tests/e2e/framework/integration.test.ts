// Integration tests for Configuration and Hooks systems
// Validates that configuration management and hooks work together in the E2E framework

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { E2ETestHarnessImpl } from './harness.js';
import { createConfigManager } from './config-manager.js';
import { LoggingExtension, TimingExtension } from './hooks-manager.js';
import { TestConfig, TestScenario } from '../types.js';

describe('Configuration and Hooks Integration', () => {
  let harness: E2ETestHarnessImpl;
  let configManager: any;

  beforeEach(() => {
    harness = new E2ETestHarnessImpl();
    configManager = createConfigManager();
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('should integrate configuration with hooks manager', async () => {
    const config: TestConfig = {
      tempDirPrefix: 'integration-test',
      appTimeout: 8000,
      mockResponses: []
    };

    // Setup harness with configuration
    await harness.setup(config);

    // Get hooks manager and register extensions
    const hooksManager = harness.getHooksManager();
    hooksManager.registerScenarioExtension('logging', LoggingExtension);
    hooksManager.registerScenarioExtension('timing', TimingExtension);

    // Verify hooks manager is accessible
    expect(hooksManager).toBeDefined();
    expect(hooksManager.getScenarioExtension('logging')).toBe(LoggingExtension);
    expect(hooksManager.getScenarioExtension('timing')).toBe(TimingExtension);

    // Verify configuration is applied
    expect(harness.getTempDataPath()).toContain('integration-test');
  });

  test('should execute test scenario with hooks', async () => {
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    const config: TestConfig = {
      tempDirPrefix: 'scenario-test',
      mockResponses: []
    };

    await harness.setup(config);

    // Register logging extension
    const hooksManager = harness.getHooksManager();
    hooksManager.registerScenarioExtension('logging', LoggingExtension);

    // Create a simple test scenario
    const scenario: TestScenario = {
      name: 'integration-scenario',
      description: 'Test scenario for integration',
      setup: {
        mockResponses: [
          {
            endpoint: '/v1/chat/completions',
            response: {
              type: 'fixed',
              content: 'Integration test response'
            }
          }
        ]
      },
      steps: [
        // No steps that require the application to be running
      ],
      assertions: [
        {
          type: 'process',
          target: 'harness',
          condition: 'running',
          expected: false // Process should not be running since we haven't started the app
        }
      ]
    };

    // Execute scenario (this will test the hooks integration)
    await harness.executeTestScenario(scenario);

    // Verify logging extension was called
    expect(consoleLogSpy).toHaveBeenCalledWith('[SCENARIO START] integration-scenario: Test scenario for integration');
    expect(consoleLogSpy).toHaveBeenCalledWith('[SCENARIO END] integration-scenario completed');

    consoleLogSpy.mockRestore();
  });

  test('should handle configuration validation with hooks', () => {
    const config: TestConfig = {
      tempDirPrefix: 'validation-test',
      appTimeout: 500, // This should generate a warning
      mockResponses: []
    };

    const validation = configManager.validateConfig(config);
    
    expect(validation.isValid).toBe(true);
    expect(validation.warnings).toContain('appTimeout less than 1000ms may cause test instability');
  });

  test('should support custom hooks with configuration', async () => {
    const customHook = vi.fn();
    
    const config: TestConfig = {
      tempDirPrefix: 'custom-hook-test',
      mockResponses: []
    };

    await harness.setup(config);

    const hooksManager = harness.getHooksManager();
    hooksManager.registerHook('custom-integration-hook', customHook);

    // Execute the custom hook
    await hooksManager.executeHook('custom-integration-hook', {
      hookName: 'custom-integration-hook',
      timestamp: Date.now(),
      data: { config }
    });

    expect(customHook).toHaveBeenCalledOnce();
  });

  test('should cleanup both configuration and hooks resources', async () => {
    const config: TestConfig = {
      tempDirPrefix: 'cleanup-test',
      mockResponses: []
    };

    await harness.setup(config);

    const hooksManager = harness.getHooksManager();
    hooksManager.registerScenarioExtension('test-extension', {
      name: 'test-extension',
      description: 'Extension for cleanup test',
      version: '1.0.0'
    });

    // Verify resources are set up
    expect(harness.getTempDataPath()).toBeTruthy();
    expect(hooksManager.getScenarioExtension('test-extension')).toBeDefined();

    // Cleanup
    await harness.cleanup();

    // Verify cleanup
    expect(harness.getTempDataPath()).toBeNull();
    
    // Hooks manager should be cleaned up (extensions removed)
    const stats = hooksManager.getStatistics();
    expect(stats.scenarioExtensions).toBe(0);
  });

  test('should support environment-based configuration with hooks', () => {
    // Set environment variables
    process.env.E2E_TEST_TEMP_DIR_PREFIX = 'env-hooks-test';
    process.env.E2E_TEST_APP_TIMEOUT = '12000';

    const baseConfig: TestConfig = {
      mockResponses: []
    };

    const configWithEnv = configManager.applyEnvironmentOverrides(baseConfig);
    
    expect(configWithEnv.tempDirPrefix).toBe('env-hooks-test');
    expect(configWithEnv.appTimeout).toBe(12000);

    // Clean up environment variables
    delete process.env.E2E_TEST_TEMP_DIR_PREFIX;
    delete process.env.E2E_TEST_APP_TIMEOUT;
  });
});
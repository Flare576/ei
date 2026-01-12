// Tests for Extensibility Hooks System
// Validates hook registration, pre/post test hooks, custom scenarios, and plugin extensibility

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { 
  HooksManagerImpl, 
  createHooksManager, 
  LoggingExtension, 
  TimingExtension,
  HookHandler,
  TestHookHandler,
  ScenarioHookHandler,
  E2EPlugin,
  ScenarioExtension
} from './hooks-manager.js';
import { TestConfig, TestScenario, E2ETestHarness } from '../types.js';

describe('HooksManager', () => {
  let hooksManager: HooksManagerImpl;
  let mockHarness: E2ETestHarness;

  beforeEach(() => {
    hooksManager = new HooksManagerImpl();
    mockHarness = {} as E2ETestHarness; // Mock harness for testing
  });

  afterEach(async () => {
    await hooksManager.cleanup();
  });

  describe('Basic Hook Registration and Execution', () => {
    test('should register and execute hooks', async () => {
      const mockHandler = vi.fn();
      const hookName = 'test-hook';
      
      hooksManager.registerHook(hookName, mockHandler);
      
      await hooksManager.executeHook(hookName, {
        hookName,
        timestamp: Date.now(),
        data: { test: 'data' }
      });
      
      expect(mockHandler).toHaveBeenCalledOnce();
    });

    test('should execute multiple handlers for same hook', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const hookName = 'multi-handler-hook';
      
      hooksManager.registerHook(hookName, handler1);
      hooksManager.registerHook(hookName, handler2);
      
      await hooksManager.executeHook(hookName, {
        hookName,
        timestamp: Date.now()
      });
      
      expect(handler1).toHaveBeenCalledOnce();
      expect(handler2).toHaveBeenCalledOnce();
    });

    test('should unregister hooks', async () => {
      const mockHandler = vi.fn();
      const hookName = 'unregister-test';
      
      hooksManager.registerHook(hookName, mockHandler);
      hooksManager.unregisterHook(hookName, mockHandler);
      
      await hooksManager.executeHook(hookName, {
        hookName,
        timestamp: Date.now()
      });
      
      expect(mockHandler).not.toHaveBeenCalled();
    });

    test('should handle hook execution errors gracefully', async () => {
      const errorHandler = vi.fn().mockRejectedValue(new Error('Hook failed'));
      const successHandler = vi.fn();
      const hookName = 'error-test';
      
      hooksManager.registerHook(hookName, errorHandler);
      hooksManager.registerHook(hookName, successHandler);
      
      // Should not throw, but should log warnings
      await hooksManager.executeHook(hookName, {
        hookName,
        timestamp: Date.now()
      });
      
      expect(errorHandler).toHaveBeenCalledOnce();
      expect(successHandler).toHaveBeenCalledOnce();
      
      const history = hooksManager.getExecutionHistory();
      expect(history).toHaveLength(1);
      expect(history[0].errors).toHaveLength(1);
      expect(history[0].warnings).toHaveLength(1);
    });
  });

  describe('Pre/Post Test Hooks', () => {
    test('should register and execute before-test hooks', async () => {
      const beforeHandler = vi.fn();
      
      hooksManager.registerBeforeTest(beforeHandler);
      
      await hooksManager.executeBeforeTest({
        hookName: 'before-test',
        timestamp: Date.now(),
        testName: 'test-case',
        config: {} as TestConfig,
        harness: mockHarness
      });
      
      expect(beforeHandler).toHaveBeenCalledOnce();
    });

    test('should register and execute after-test hooks', async () => {
      const afterHandler = vi.fn();
      
      hooksManager.registerAfterTest(afterHandler);
      
      await hooksManager.executeAfterTest({
        hookName: 'after-test',
        timestamp: Date.now(),
        testName: 'test-case',
        config: {} as TestConfig,
        harness: mockHarness
      });
      
      expect(afterHandler).toHaveBeenCalledOnce();
    });

    test('should register and execute scenario hooks', async () => {
      const beforeScenario = vi.fn();
      const afterScenario = vi.fn();
      
      hooksManager.registerBeforeScenario(beforeScenario);
      hooksManager.registerAfterScenario(afterScenario);
      
      const mockScenario: TestScenario = {
        name: 'test-scenario',
        description: 'Test scenario',
        setup: {},
        steps: [],
        assertions: []
      };
      
      const context = {
        hookName: 'scenario-test',
        timestamp: Date.now(),
        scenario: mockScenario,
        harness: mockHarness
      };
      
      await hooksManager.executeBeforeScenario(context);
      await hooksManager.executeAfterScenario(context);
      
      expect(beforeScenario).toHaveBeenCalledOnce();
      expect(afterScenario).toHaveBeenCalledOnce();
    });

    test('should handle hook failures gracefully', async () => {
      const failingHandler = vi.fn().mockRejectedValue(new Error('Hook failed'));
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      
      hooksManager.registerBeforeTest(failingHandler);
      
      // Should not throw
      await hooksManager.executeBeforeTest({
        hookName: 'before-test',
        timestamp: Date.now(),
        testName: 'test-case',
        config: {} as TestConfig,
        harness: mockHarness
      });
      
      expect(failingHandler).toHaveBeenCalledOnce();
      expect(consoleWarnSpy).toHaveBeenCalled();
      
      consoleWarnSpy.mockRestore();
    });
  });

  describe('Scenario Extensions', () => {
    test('should register and retrieve scenario extensions', () => {
      const extension: ScenarioExtension = {
        name: 'test-extension',
        description: 'Test extension',
        version: '1.0.0'
      };
      
      hooksManager.registerScenarioExtension('test-extension', extension);
      
      const retrieved = hooksManager.getScenarioExtension('test-extension');
      expect(retrieved).toBe(extension);
    });

    test('should execute scenario extension hooks', async () => {
      const beforeScenario = vi.fn();
      const afterScenario = vi.fn();
      const beforeStep = vi.fn();
      const afterStep = vi.fn();
      
      const extension: ScenarioExtension = {
        name: 'hook-extension',
        description: 'Extension with hooks',
        version: '1.0.0',
        beforeScenario,
        afterScenario,
        beforeStep,
        afterStep
      };
      
      hooksManager.registerScenarioExtension('hook-extension', extension);
      
      const mockScenario: TestScenario = {
        name: 'test-scenario',
        description: 'Test scenario',
        setup: {},
        steps: [{ type: 'input', action: 'test' }],
        assertions: []
      };
      
      const context = {
        hookName: 'scenario-test',
        timestamp: Date.now(),
        scenario: mockScenario,
        harness: mockHarness,
        stepIndex: 0
      };
      
      await hooksManager.executeBeforeScenario(context);
      await hooksManager.executeBeforeStep(context);
      await hooksManager.executeAfterStep(context);
      await hooksManager.executeAfterScenario(context);
      
      expect(beforeScenario).toHaveBeenCalledOnce();
      expect(afterScenario).toHaveBeenCalledOnce();
      expect(beforeStep).toHaveBeenCalledOnce();
      expect(afterStep).toHaveBeenCalledOnce();
    });

    test('should execute custom steps', async () => {
      const customStepHandler = vi.fn().mockResolvedValue('step result');
      
      const extension: ScenarioExtension = {
        name: 'custom-step-extension',
        description: 'Extension with custom steps',
        version: '1.0.0',
        customStepTypes: {
          'custom-action': customStepHandler
        }
      };
      
      hooksManager.registerScenarioExtension('custom-step-extension', extension);
      
      const context = {
        hookName: 'custom-step',
        timestamp: Date.now(),
        scenario: {} as TestScenario,
        harness: mockHarness
      };
      
      const result = await hooksManager.executeCustomStep('custom-action', 'test action', context);
      
      expect(customStepHandler).toHaveBeenCalledWith('test action', context);
      expect(result).toBe('step result');
    });

    test('should execute custom assertions', async () => {
      const customAssertionHandler = vi.fn();
      
      const extension: ScenarioExtension = {
        name: 'custom-assertion-extension',
        description: 'Extension with custom assertions',
        version: '1.0.0',
        customAssertionTypes: {
          'custom-assert': customAssertionHandler
        }
      };
      
      hooksManager.registerScenarioExtension('custom-assertion-extension', extension);
      
      const context = {
        hookName: 'custom-assertion',
        timestamp: Date.now(),
        scenario: {} as TestScenario,
        harness: mockHarness
      };
      
      await hooksManager.executeCustomAssertion('custom-assert', 'target', 'condition', 'expected', context);
      
      expect(customAssertionHandler).toHaveBeenCalledWith('target', 'condition', 'expected', context);
    });

    test('should throw error for unknown custom step types', async () => {
      const context = {
        hookName: 'unknown-step',
        timestamp: Date.now(),
        scenario: {} as TestScenario,
        harness: mockHarness
      };
      
      await expect(hooksManager.executeCustomStep('unknown-type', 'action', context))
        .rejects.toThrow('No handler found for custom step type: unknown-type');
    });
  });

  describe('Plugin System', () => {
    test('should register and retrieve plugins', async () => {
      const plugin: E2EPlugin = {
        name: 'test-plugin',
        version: '1.0.0',
        description: 'Test plugin'
      };
      
      await hooksManager.registerPlugin(plugin);
      
      const retrieved = hooksManager.getPlugin('test-plugin');
      expect(retrieved).toBe(plugin);
      
      const allPlugins = hooksManager.listPlugins();
      expect(allPlugins).toContain(plugin);
    });

    test('should initialize plugins', async () => {
      const initializeFn = vi.fn();
      
      const plugin: E2EPlugin = {
        name: 'init-plugin',
        version: '1.0.0',
        description: 'Plugin with initialization',
        initialize: initializeFn
      };
      
      await hooksManager.registerPlugin(plugin);
      
      expect(initializeFn).toHaveBeenCalledWith(hooksManager, {});
    });

    test('should register plugin hooks', async () => {
      const pluginHook = vi.fn();
      
      const plugin: E2EPlugin = {
        name: 'hook-plugin',
        version: '1.0.0',
        description: 'Plugin with hooks',
        hooks: {
          'plugin-hook': pluginHook
        }
      };
      
      await hooksManager.registerPlugin(plugin);
      
      await hooksManager.executeHook('plugin-hook', {
        hookName: 'plugin-hook',
        timestamp: Date.now()
      });
      
      expect(pluginHook).toHaveBeenCalledOnce();
    });

    test('should register plugin scenario extensions', async () => {
      const extension: ScenarioExtension = {
        name: 'plugin-extension',
        description: 'Extension from plugin',
        version: '1.0.0'
      };
      
      const plugin: E2EPlugin = {
        name: 'extension-plugin',
        version: '1.0.0',
        description: 'Plugin with extensions',
        scenarioExtensions: [extension]
      };
      
      await hooksManager.registerPlugin(plugin);
      
      const retrieved = hooksManager.getScenarioExtension('plugin-extension');
      expect(retrieved).toBe(extension);
    });

    test('should check plugin dependencies', async () => {
      const dependencyPlugin: E2EPlugin = {
        name: 'dependency',
        version: '1.0.0',
        description: 'Dependency plugin'
      };
      
      const dependentPlugin: E2EPlugin = {
        name: 'dependent',
        version: '1.0.0',
        description: 'Plugin with dependency',
        dependencies: ['dependency']
      };
      
      // Should fail without dependency
      await expect(hooksManager.registerPlugin(dependentPlugin))
        .rejects.toThrow('requires dependency dependency');
      
      // Should succeed with dependency
      await hooksManager.registerPlugin(dependencyPlugin);
      await hooksManager.registerPlugin(dependentPlugin);
      
      expect(hooksManager.getPlugin('dependent')).toBe(dependentPlugin);
    });

    test('should unregister plugins and clean up', async () => {
      const cleanupFn = vi.fn();
      const pluginHook = vi.fn();
      
      const extension: ScenarioExtension = {
        name: 'cleanup-extension',
        description: 'Extension to be cleaned up',
        version: '1.0.0'
      };
      
      const plugin: E2EPlugin = {
        name: 'cleanup-plugin',
        version: '1.0.0',
        description: 'Plugin to be cleaned up',
        cleanup: cleanupFn,
        hooks: {
          'cleanup-hook': pluginHook
        },
        scenarioExtensions: [extension]
      };
      
      await hooksManager.registerPlugin(plugin);
      await hooksManager.unregisterPlugin('cleanup-plugin');
      
      expect(cleanupFn).toHaveBeenCalledOnce();
      expect(hooksManager.getPlugin('cleanup-plugin')).toBeUndefined();
      expect(hooksManager.getScenarioExtension('cleanup-extension')).toBeUndefined();
      
      // Hook should no longer execute
      await hooksManager.executeHook('cleanup-hook', {
        hookName: 'cleanup-hook',
        timestamp: Date.now()
      });
      
      expect(pluginHook).not.toHaveBeenCalled();
    });

    test('should handle plugin initialization failures', async () => {
      const failingInitialize = vi.fn().mockRejectedValue(new Error('Init failed'));
      
      const plugin: E2EPlugin = {
        name: 'failing-plugin',
        version: '1.0.0',
        description: 'Plugin that fails to initialize',
        initialize: failingInitialize
      };
      
      await expect(hooksManager.registerPlugin(plugin))
        .rejects.toThrow('Plugin failing-plugin initialization failed');
      
      expect(hooksManager.getPlugin('failing-plugin')).toBeUndefined();
    });
  });

  describe('Built-in Extensions', () => {
    test('should provide logging extension', () => {
      expect(LoggingExtension.name).toBe('logging');
      expect(LoggingExtension.beforeScenario).toBeDefined();
      expect(LoggingExtension.afterScenario).toBeDefined();
      expect(LoggingExtension.beforeStep).toBeDefined();
      expect(LoggingExtension.afterStep).toBeDefined();
    });

    test('should provide timing extension', () => {
      expect(TimingExtension.name).toBe('timing');
      expect(TimingExtension.beforeScenario).toBeDefined();
      expect(TimingExtension.afterScenario).toBeDefined();
      expect(TimingExtension.beforeStep).toBeDefined();
      expect(TimingExtension.afterStep).toBeDefined();
    });

    test('should execute logging extension hooks', async () => {
      const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      
      hooksManager.registerScenarioExtension('logging', LoggingExtension);
      
      const mockScenario: TestScenario = {
        name: 'logging-test',
        description: 'Test logging extension',
        setup: {},
        steps: [{ type: 'input', action: 'test input' }],
        assertions: []
      };
      
      const context = {
        hookName: 'logging-test',
        timestamp: Date.now(),
        scenario: mockScenario,
        harness: mockHarness,
        stepIndex: 0
      };
      
      await hooksManager.executeBeforeScenario(context);
      await hooksManager.executeBeforeStep(context);
      await hooksManager.executeAfterStep(context);
      await hooksManager.executeAfterScenario(context);
      
      expect(consoleLogSpy).toHaveBeenCalledWith('[SCENARIO START] logging-test: Test logging extension');
      expect(consoleLogSpy).toHaveBeenCalledWith('[STEP 1] input: test input');
      expect(consoleLogSpy).toHaveBeenCalledWith('[STEP 1] completed');
      expect(consoleLogSpy).toHaveBeenCalledWith('[SCENARIO END] logging-test completed');
      
      consoleLogSpy.mockRestore();
    });
  });

  describe('Statistics and Monitoring', () => {
    test('should provide statistics', async () => {
      const handler1 = vi.fn();
      const handler2 = vi.fn();
      const beforeTest = vi.fn();
      const extension: ScenarioExtension = {
        name: 'stats-extension',
        description: 'Extension for stats',
        version: '1.0.0'
      };
      
      hooksManager.registerHook('hook1', handler1);
      hooksManager.registerHook('hook1', handler2);
      hooksManager.registerBeforeTest(beforeTest);
      hooksManager.registerScenarioExtension('stats-extension', extension);
      
      const stats = hooksManager.getStatistics();
      
      expect(stats.totalHooks).toBe(1);
      expect(stats.totalHandlers).toBe(2);
      expect(stats.beforeTestHandlers).toBe(1);
      expect(stats.scenarioExtensions).toBe(1);
    });

    test('should track execution history', async () => {
      const handler = vi.fn();
      
      hooksManager.registerHook('tracked-hook', handler);
      
      await hooksManager.executeHook('tracked-hook', {
        hookName: 'tracked-hook',
        timestamp: Date.now()
      });
      
      const history = hooksManager.getExecutionHistory();
      
      expect(history).toHaveLength(1);
      expect(history[0].hookName).toBe('tracked-hook');
      expect(history[0].handlersExecuted).toBe(1);
      expect(history[0].errors).toHaveLength(0);
    });

    test('should clear execution history', async () => {
      const handler = vi.fn();
      
      hooksManager.registerHook('clear-test', handler);
      await hooksManager.executeHook('clear-test', {
        hookName: 'clear-test',
        timestamp: Date.now()
      });
      
      expect(hooksManager.getExecutionHistory()).toHaveLength(1);
      
      hooksManager.clearExecutionHistory();
      
      expect(hooksManager.getExecutionHistory()).toHaveLength(0);
    });
  });

  describe('Factory Function', () => {
    test('should create hooks manager instance', () => {
      const manager = createHooksManager();
      expect(manager).toBeInstanceOf(HooksManagerImpl);
    });
  });
});
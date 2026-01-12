// Extensibility Hooks System for E2E Testing Framework
// Implements hook registration, pre/post test hooks, custom scenarios, and plugin-style extensibility
// Requirements: 8.4

import { TestConfig, TestScenario, E2ETestHarness } from '../types.js';

export interface HooksManager {
  // Hook registration and execution
  registerHook(hookName: string, handler: HookHandler): void;
  unregisterHook(hookName: string, handler: HookHandler): void;
  executeHook(hookName: string, context: HookContext): Promise<void>;
  
  // Pre/post test hooks
  registerBeforeTest(handler: TestHookHandler): void;
  registerAfterTest(handler: TestHookHandler): void;
  registerBeforeScenario(handler: ScenarioHookHandler): void;
  registerAfterScenario(handler: ScenarioHookHandler): void;
  
  // Custom scenario extension points
  registerScenarioExtension(extensionName: string, extension: ScenarioExtension): void;
  getScenarioExtension(extensionName: string): ScenarioExtension | undefined;
  
  // Plugin-style extensibility
  registerPlugin(plugin: E2EPlugin): void;
  unregisterPlugin(pluginName: string): void;
  getPlugin(pluginName: string): E2EPlugin | undefined;
  listPlugins(): E2EPlugin[];
}

export interface HookHandler {
  (context: HookContext): Promise<void> | void;
}

export interface TestHookHandler {
  (context: TestHookContext): Promise<void> | void;
}

export interface ScenarioHookHandler {
  (context: ScenarioHookContext): Promise<void> | void;
}

export interface HookContext {
  hookName: string;
  timestamp: number;
  data?: any;
}

export interface TestHookContext extends HookContext {
  testName: string;
  config: TestConfig;
  harness: E2ETestHarness;
  tempDataPath?: string;
}

export interface ScenarioHookContext extends HookContext {
  scenario: TestScenario;
  harness: E2ETestHarness;
  stepIndex?: number;
  stepResult?: any;
}

export interface ScenarioExtension {
  name: string;
  description: string;
  version: string;
  
  // Extension points for custom scenario behavior
  beforeScenario?(context: ScenarioHookContext): Promise<void> | void;
  afterScenario?(context: ScenarioHookContext): Promise<void> | void;
  beforeStep?(context: ScenarioHookContext): Promise<void> | void;
  afterStep?(context: ScenarioHookContext): Promise<void> | void;
  
  // Custom step types
  customStepTypes?: Record<string, CustomStepHandler>;
  
  // Custom assertion types
  customAssertionTypes?: Record<string, CustomAssertionHandler>;
}

export interface CustomStepHandler {
  (action: string, context: ScenarioHookContext): Promise<any>;
}

export interface CustomAssertionHandler {
  (target: string, condition: string, expected: any, context: ScenarioHookContext): Promise<void>;
}

export interface E2EPlugin {
  name: string;
  version: string;
  description: string;
  author?: string;
  
  // Plugin lifecycle
  initialize?(hooksManager: HooksManager, config: TestConfig): Promise<void> | void;
  cleanup?(): Promise<void> | void;
  
  // Plugin capabilities
  hooks?: Record<string, HookHandler>;
  scenarioExtensions?: ScenarioExtension[];
  configSchema?: any; // JSON schema for plugin-specific configuration
  
  // Plugin dependencies
  dependencies?: string[];
  optionalDependencies?: string[];
}

export interface HookExecutionResult {
  hookName: string;
  executionTime: number;
  handlersExecuted: number;
  errors: Error[];
  warnings: string[];
}

export class HooksManagerImpl implements HooksManager {
  private hooks: Map<string, Set<HookHandler>> = new Map();
  private beforeTestHandlers: Set<TestHookHandler> = new Set();
  private afterTestHandlers: Set<TestHookHandler> = new Set();
  private beforeScenarioHandlers: Set<ScenarioHookHandler> = new Set();
  private afterScenarioHandlers: Set<ScenarioHookHandler> = new Set();
  private scenarioExtensions: Map<string, ScenarioExtension> = new Map();
  private plugins: Map<string, E2EPlugin> = new Map();
  private executionHistory: HookExecutionResult[] = [];

  /**
   * Registers a hook handler for a specific hook name
   * Requirements: 8.4 - Hook registration and execution
   */
  registerHook(hookName: string, handler: HookHandler): void {
    if (!this.hooks.has(hookName)) {
      this.hooks.set(hookName, new Set());
    }
    
    this.hooks.get(hookName)!.add(handler);
  }

  /**
   * Unregisters a hook handler
   * Requirements: 8.4 - Hook registration and execution
   */
  unregisterHook(hookName: string, handler: HookHandler): void {
    const handlers = this.hooks.get(hookName);
    if (handlers) {
      handlers.delete(handler);
      
      // Clean up empty hook sets
      if (handlers.size === 0) {
        this.hooks.delete(hookName);
      }
    }
  }

  /**
   * Executes all handlers for a specific hook
   * Requirements: 8.4 - Hook registration and execution
   */
  async executeHook(hookName: string, context: HookContext): Promise<void> {
    const handlers = this.hooks.get(hookName);
    if (!handlers || handlers.size === 0) {
      return;
    }

    const startTime = Date.now();
    const errors: Error[] = [];
    const warnings: string[] = [];
    let handlersExecuted = 0;

    // Execute all handlers for this hook
    for (const handler of handlers) {
      try {
        await handler(context);
        handlersExecuted++;
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
        warnings.push(`Hook handler failed for ${hookName}: ${error}`);
      }
    }

    // Record execution result
    const result: HookExecutionResult = {
      hookName,
      executionTime: Date.now() - startTime,
      handlersExecuted,
      errors,
      warnings
    };

    this.executionHistory.push(result);

    // If any handlers failed, log warnings but don't fail the hook execution
    // This allows tests to continue even if non-critical hooks fail
    if (warnings.length > 0) {
      console.warn(`Hook execution warnings for ${hookName}:`, warnings);
    }
  }

  /**
   * Registers a handler to run before each test
   * Requirements: 8.4 - Pre/post test hooks
   */
  registerBeforeTest(handler: TestHookHandler): void {
    this.beforeTestHandlers.add(handler);
  }

  /**
   * Registers a handler to run after each test
   * Requirements: 8.4 - Pre/post test hooks
   */
  registerAfterTest(handler: TestHookHandler): void {
    this.afterTestHandlers.add(handler);
  }

  /**
   * Registers a handler to run before each scenario
   * Requirements: 8.4 - Pre/post test hooks
   */
  registerBeforeScenario(handler: ScenarioHookHandler): void {
    this.beforeScenarioHandlers.add(handler);
  }

  /**
   * Registers a handler to run after each scenario
   * Requirements: 8.4 - Pre/post test hooks
   */
  registerAfterScenario(handler: ScenarioHookHandler): void {
    this.afterScenarioHandlers.add(handler);
  }

  /**
   * Executes all before-test hooks
   * Requirements: 8.4 - Pre/post test hooks
   */
  async executeBeforeTest(context: TestHookContext): Promise<void> {
    for (const handler of this.beforeTestHandlers) {
      try {
        await handler(context);
      } catch (error) {
        console.warn(`Before-test hook failed: ${error}`);
      }
    }
  }

  /**
   * Executes all after-test hooks
   * Requirements: 8.4 - Pre/post test hooks
   */
  async executeAfterTest(context: TestHookContext): Promise<void> {
    for (const handler of this.afterTestHandlers) {
      try {
        await handler(context);
      } catch (error) {
        console.warn(`After-test hook failed: ${error}`);
      }
    }
  }

  /**
   * Executes all before-scenario hooks
   * Requirements: 8.4 - Pre/post test hooks
   */
  async executeBeforeScenario(context: ScenarioHookContext): Promise<void> {
    for (const handler of this.beforeScenarioHandlers) {
      try {
        await handler(context);
      } catch (error) {
        console.warn(`Before-scenario hook failed: ${error}`);
      }
    }

    // Also execute scenario extension hooks
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.beforeScenario) {
        try {
          await extension.beforeScenario(context);
        } catch (error) {
          console.warn(`Scenario extension before-hook failed (${extension.name}): ${error}`);
        }
      }
    }
  }

  /**
   * Executes all after-scenario hooks
   * Requirements: 8.4 - Pre/post test hooks
   */
  async executeAfterScenario(context: ScenarioHookContext): Promise<void> {
    // Execute scenario extension hooks first
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.afterScenario) {
        try {
          await extension.afterScenario(context);
        } catch (error) {
          console.warn(`Scenario extension after-hook failed (${extension.name}): ${error}`);
        }
      }
    }

    for (const handler of this.afterScenarioHandlers) {
      try {
        await handler(context);
      } catch (error) {
        console.warn(`After-scenario hook failed: ${error}`);
      }
    }
  }

  /**
   * Executes before-step hooks from scenario extensions
   * Requirements: 8.4 - Custom scenario extension points
   */
  async executeBeforeStep(context: ScenarioHookContext): Promise<void> {
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.beforeStep) {
        try {
          await extension.beforeStep(context);
        } catch (error) {
          console.warn(`Scenario extension before-step hook failed (${extension.name}): ${error}`);
        }
      }
    }
  }

  /**
   * Executes after-step hooks from scenario extensions
   * Requirements: 8.4 - Custom scenario extension points
   */
  async executeAfterStep(context: ScenarioHookContext): Promise<void> {
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.afterStep) {
        try {
          await extension.afterStep(context);
        } catch (error) {
          console.warn(`Scenario extension after-step hook failed (${extension.name}): ${error}`);
        }
      }
    }
  }

  /**
   * Registers a scenario extension
   * Requirements: 8.4 - Custom scenario extension points
   */
  registerScenarioExtension(extensionName: string, extension: ScenarioExtension): void {
    if (this.scenarioExtensions.has(extensionName)) {
      console.warn(`Scenario extension ${extensionName} is already registered. Overriding.`);
    }
    
    this.scenarioExtensions.set(extensionName, extension);
  }

  /**
   * Gets a scenario extension by name
   * Requirements: 8.4 - Custom scenario extension points
   */
  getScenarioExtension(extensionName: string): ScenarioExtension | undefined {
    return this.scenarioExtensions.get(extensionName);
  }

  /**
   * Executes a custom step using scenario extensions
   * Requirements: 8.4 - Custom scenario extension points
   */
  async executeCustomStep(stepType: string, action: string, context: ScenarioHookContext): Promise<any> {
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.customStepTypes && extension.customStepTypes[stepType]) {
        try {
          return await extension.customStepTypes[stepType](action, context);
        } catch (error) {
          throw new Error(`Custom step ${stepType} failed in extension ${extension.name}: ${error}`);
        }
      }
    }
    
    throw new Error(`No handler found for custom step type: ${stepType}`);
  }

  /**
   * Executes a custom assertion using scenario extensions
   * Requirements: 8.4 - Custom scenario extension points
   */
  async executeCustomAssertion(assertionType: string, target: string, condition: string, expected: any, context: ScenarioHookContext): Promise<void> {
    for (const extension of this.scenarioExtensions.values()) {
      if (extension.customAssertionTypes && extension.customAssertionTypes[assertionType]) {
        try {
          await extension.customAssertionTypes[assertionType](target, condition, expected, context);
          return;
        } catch (error) {
          throw new Error(`Custom assertion ${assertionType} failed in extension ${extension.name}: ${error}`);
        }
      }
    }
    
    throw new Error(`No handler found for custom assertion type: ${assertionType}`);
  }

  /**
   * Registers a plugin
   * Requirements: 8.4 - Plugin-style extensibility for advanced use cases
   */
  async registerPlugin(plugin: E2EPlugin): Promise<void> {
    if (this.plugins.has(plugin.name)) {
      console.warn(`Plugin ${plugin.name} is already registered. Overriding.`);
    }

    // Check dependencies
    if (plugin.dependencies) {
      for (const dependency of plugin.dependencies) {
        if (!this.plugins.has(dependency)) {
          throw new Error(`Plugin ${plugin.name} requires dependency ${dependency} which is not registered`);
        }
      }
    }

    // Register the plugin
    this.plugins.set(plugin.name, plugin);

    // Register plugin hooks
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        this.registerHook(hookName, handler);
      }
    }

    // Register plugin scenario extensions
    if (plugin.scenarioExtensions) {
      for (const extension of plugin.scenarioExtensions) {
        this.registerScenarioExtension(extension.name, extension);
      }
    }

    // Initialize the plugin
    if (plugin.initialize) {
      try {
        await plugin.initialize(this, {} as TestConfig); // Config would be passed from test harness
      } catch (error) {
        // Remove plugin if initialization fails
        this.plugins.delete(plugin.name);
        throw new Error(`Plugin ${plugin.name} initialization failed: ${error}`);
      }
    }
  }

  /**
   * Unregisters a plugin and cleans up its hooks
   * Requirements: 8.4 - Plugin-style extensibility for advanced use cases
   */
  async unregisterPlugin(pluginName: string): Promise<void> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      return;
    }

    // Clean up plugin hooks
    if (plugin.hooks) {
      for (const [hookName, handler] of Object.entries(plugin.hooks)) {
        this.unregisterHook(hookName, handler);
      }
    }

    // Clean up plugin scenario extensions
    if (plugin.scenarioExtensions) {
      for (const extension of plugin.scenarioExtensions) {
        this.scenarioExtensions.delete(extension.name);
      }
    }

    // Call plugin cleanup
    if (plugin.cleanup) {
      try {
        await plugin.cleanup();
      } catch (error) {
        console.warn(`Plugin ${pluginName} cleanup failed: ${error}`);
      }
    }

    this.plugins.delete(pluginName);
  }

  /**
   * Gets a plugin by name
   * Requirements: 8.4 - Plugin-style extensibility for advanced use cases
   */
  getPlugin(pluginName: string): E2EPlugin | undefined {
    return this.plugins.get(pluginName);
  }

  /**
   * Lists all registered plugins
   * Requirements: 8.4 - Plugin-style extensibility for advanced use cases
   */
  listPlugins(): E2EPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Gets hook execution history for debugging and monitoring
   */
  getExecutionHistory(): HookExecutionResult[] {
    return [...this.executionHistory];
  }

  /**
   * Clears hook execution history
   */
  clearExecutionHistory(): void {
    this.executionHistory = [];
  }

  /**
   * Gets statistics about registered hooks and plugins
   */
  getStatistics() {
    return {
      totalHooks: this.hooks.size,
      totalHandlers: Array.from(this.hooks.values()).reduce((sum, handlers) => sum + handlers.size, 0),
      beforeTestHandlers: this.beforeTestHandlers.size,
      afterTestHandlers: this.afterTestHandlers.size,
      beforeScenarioHandlers: this.beforeScenarioHandlers.size,
      afterScenarioHandlers: this.afterScenarioHandlers.size,
      scenarioExtensions: this.scenarioExtensions.size,
      plugins: this.plugins.size,
      executionHistory: this.executionHistory.length
    };
  }

  /**
   * Cleans up all hooks and plugins
   */
  async cleanup(): Promise<void> {
    // Clean up all plugins
    const pluginNames = Array.from(this.plugins.keys());
    for (const pluginName of pluginNames) {
      await this.unregisterPlugin(pluginName);
    }

    // Clear all hooks
    this.hooks.clear();
    this.beforeTestHandlers.clear();
    this.afterTestHandlers.clear();
    this.beforeScenarioHandlers.clear();
    this.afterScenarioHandlers.clear();
    this.scenarioExtensions.clear();
    this.executionHistory = [];
  }
}

// Factory function for creating hooks manager instances
export function createHooksManager(): HooksManager {
  return new HooksManagerImpl();
}

// Built-in scenario extensions

/**
 * Logging extension that logs test execution details
 */
export const LoggingExtension: ScenarioExtension = {
  name: 'logging',
  description: 'Logs test execution details for debugging',
  version: '1.0.0',
  
  beforeScenario: async (context) => {
    console.log(`[SCENARIO START] ${context.scenario.name}: ${context.scenario.description}`);
  },
  
  afterScenario: async (context) => {
    console.log(`[SCENARIO END] ${context.scenario.name} completed`);
  },
  
  beforeStep: async (context) => {
    if (context.stepIndex !== undefined) {
      const step = context.scenario.steps[context.stepIndex];
      console.log(`[STEP ${context.stepIndex + 1}] ${step.type}: ${step.action}`);
    }
  },
  
  afterStep: async (context) => {
    if (context.stepIndex !== undefined) {
      console.log(`[STEP ${context.stepIndex + 1}] completed`);
    }
  }
};

/**
 * Timing extension that measures execution times
 */
export const TimingExtension: ScenarioExtension = {
  name: 'timing',
  description: 'Measures and reports execution times',
  version: '1.0.0',
  
  beforeScenario: async (context) => {
    (context as any).startTime = Date.now();
  },
  
  afterScenario: async (context) => {
    const startTime = (context as any).startTime;
    if (startTime) {
      const duration = Date.now() - startTime;
      console.log(`[TIMING] Scenario ${context.scenario.name} took ${duration}ms`);
    }
  },
  
  beforeStep: async (context) => {
    if (context.stepIndex !== undefined) {
      (context as any).stepStartTime = Date.now();
    }
  },
  
  afterStep: async (context) => {
    const stepStartTime = (context as any).stepStartTime;
    if (stepStartTime && context.stepIndex !== undefined) {
      const duration = Date.now() - stepStartTime;
      console.log(`[TIMING] Step ${context.stepIndex + 1} took ${duration}ms`);
    }
  }
};
// Test Scenario Configuration System
// Implements scenario loading, step execution, and assertion evaluation

import * as fs from 'fs';
import * as path from 'path';
import {
  TestScenario,
  TestStep,
  TestAssertion,
  TestSetupConfig,
  TestCleanupConfig,
  E2ETestHarness,
  PersonaConfig,
  InitialDataConfig,
  MockResponseConfig,
  TestResource
} from '../types.js';
import { 
  ErrorRecoveryImpl, 
  ErrorContext, 
  RecoveryOptions,
  RetryExhaustedError,
  EmergencyCleanupError
} from './error-recovery.js';

/**
 * Test scenario execution engine that loads configurations and executes test steps
 * Requirements: 6.1, 6.2 - Comprehensive test scenarios and configuration system
 */
export class TestScenarioRunner {
  private harness: E2ETestHarness;
  private currentScenario: TestScenario | null = null;
  private executionContext: Map<string, any> = new Map();
  private errorRecovery: ErrorRecoveryImpl;
  private resources: TestResource[] = [];

  constructor(harness: E2ETestHarness) {
    this.harness = harness;
    this.errorRecovery = new ErrorRecoveryImpl();
  }

  /**
   * Loads a test scenario from a configuration file
   * Requirements: 6.1 - Test scenario loading from configuration files
   */
  async loadScenarioFromFile(filePath: string): Promise<TestScenario> {
    try {
      const absolutePath = path.resolve(filePath);
      
      if (!fs.existsSync(absolutePath)) {
        throw new Error(`Scenario file not found: ${absolutePath}`);
      }

      const fileContent = await fs.promises.readFile(absolutePath, 'utf-8');
      const scenarioData = JSON.parse(fileContent);
      
      // Validate scenario structure
      this.validateScenarioStructure(scenarioData);
      
      return scenarioData as TestScenario;
    } catch (error) {
      throw new Error(`Failed to load scenario from ${filePath}: ${error}`);
    }
  }

  /**
   * Loads a test scenario from a configuration object
   * Requirements: 6.1 - Test scenario configuration system
   */
  loadScenarioFromObject(scenario: TestScenario): TestScenario {
    this.validateScenarioStructure(scenario);
    return scenario;
  }

  /**
   * Executes a complete test scenario with error handling and recovery
   * Requirements: 6.1, 6.2, 6.4, 7.2 - Test execution with error handling and recovery
   */
  async executeScenario(scenario: TestScenario, recoveryOptions?: RecoveryOptions): Promise<TestScenarioResult> {
    this.currentScenario = scenario;
    this.executionContext.clear();
    this.resources = [];
    
    const startTime = Date.now();
    const result: TestScenarioResult = {
      scenarioName: scenario.name,
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      setupResult: null,
      stepResults: [],
      assertionResults: [],
      cleanupResult: null,
      error: null,
      errorReport: null,
      recoveryAttempted: false
    };

    try {
      // Register scenario-level resources for cleanup
      this.registerScenarioResources();

      // Execute setup phase with error handling
      result.setupResult = await this.executePhaseWithRecovery(
        'setup',
        () => this.executeSetup(scenario.setup),
        recoveryOptions
      );
      
      // Execute test steps with error handling
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        const stepResult = await this.executeStepWithRecovery(step, i, recoveryOptions);
        result.stepResults.push(stepResult);
        
        // Stop execution if step failed and it's not marked as optional
        if (!stepResult.success && !this.isOptionalStep(step)) {
          throw new Error(`Step ${i + 1} failed: ${stepResult.error}`);
        }
      }
      
      // Execute assertions with error handling
      for (let i = 0; i < scenario.assertions.length; i++) {
        const assertion = scenario.assertions[i];
        const assertionResult = await this.executeAssertionWithRecovery(assertion, i, recoveryOptions);
        result.assertionResults.push(assertionResult);
        
        // Stop execution if assertion failed
        if (!assertionResult.success) {
          throw new Error(`Assertion ${i + 1} failed: ${assertionResult.error}`);
        }
      }
      
      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      
      // Handle test failure with recovery mechanisms
      const context: ErrorContext = {
        operation: 'scenario_execution',
        phase: 'execution',
        resources: this.resources
      };
      
      try {
        const failureResult = await this.errorRecovery.handleTestFailure(
          error instanceof Error ? error : new Error(String(error)),
          context,
          recoveryOptions
        );
        
        result.errorReport = failureResult.errorReport;
        result.recoveryAttempted = failureResult.recoveryAttempted;
        
        // If recovery was successful, update the result
        if (failureResult.recoverySuccessful && failureResult.finalState === 'recovered') {
          result.success = true;
          result.error = null;
        }
      } catch (recoveryError) {
        console.error(`Recovery failed: ${recoveryError}`);
      }
    } finally {
      // Always execute cleanup with error handling
      if (scenario.cleanup) {
        result.cleanupResult = await this.executePhaseWithRecovery(
          'cleanup',
          () => this.executeCleanup(scenario.cleanup!),
          { ...recoveryOptions, performCleanup: true }
        );
      } else {
        // Perform emergency cleanup if no explicit cleanup specified
        try {
          await this.errorRecovery.emergencyCleanup(this.resources);
        } catch (cleanupError) {
          console.warn(`Emergency cleanup failed: ${cleanupError}`);
        }
      }
      
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
    }

    return result;
  }

  /**
   * Executes the setup phase of a test scenario
   * Requirements: 6.1 - Test scenario setup configuration
   */
  private async executeSetup(setup: TestSetupConfig): Promise<TestPhaseResult> {
    const startTime = Date.now();
    const result: TestPhaseResult = {
      phase: 'setup',
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      details: {},
      error: null
    };

    try {
      // Set up initial data if specified
      if (setup.initialData) {
        await this.setupInitialData(setup.initialData);
        result.details.initialDataSetup = true;
      }

      // Configure mock responses if specified
      if (setup.mockResponses && setup.mockResponses.length > 0) {
        await this.setupMockResponses(setup.mockResponses);
        result.details.mockResponsesConfigured = setup.mockResponses.length;
      }

      // Set up personas if specified
      if (setup.personas && setup.personas.length > 0) {
        await this.setupPersonas(setup.personas);
        result.details.personasSetup = setup.personas.length;
      }

      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
    }

    return result;
  }

  /**
   * Executes a single test step
   * Requirements: 6.2 - Test step execution engine
   */
  private async executeStep(step: TestStep, stepIndex: number): Promise<TestStepResult> {
    const startTime = Date.now();
    const result: TestStepResult = {
      stepIndex,
      stepType: step.type,
      action: step.action,
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      output: null,
      error: null
    };

    try {
      switch (step.type) {
        case 'input':
          await this.executeInputStep(step);
          break;
        case 'command':
          await this.executeCommandStep(step);
          break;
        case 'wait':
          result.output = await this.executeWaitStep(step);
          break;
        case 'assert':
          await this.executeAssertStep(step);
          break;
        default:
          throw new Error(`Unknown step type: ${step.type}`);
      }

      // Store expected result if provided
      if (step.expectedResult !== undefined) {
        this.executionContext.set(`step_${stepIndex}_result`, step.expectedResult);
      }

      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
    }

    return result;
  }

  /**
   * Executes a test assertion
   * Requirements: 6.2 - Assertion evaluation system
   */
  private async executeAssertion(assertion: TestAssertion, assertionIndex: number): Promise<TestAssertionResult> {
    const startTime = Date.now();
    const result: TestAssertionResult = {
      assertionIndex,
      assertionType: assertion.type,
      target: assertion.target,
      condition: assertion.condition,
      expected: assertion.expected,
      actual: null,
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      error: null
    };

    try {
      switch (assertion.type) {
        case 'ui':
          result.actual = await this.executeUIAssertion(assertion);
          break;
        case 'file':
          result.actual = await this.executeFileAssertion(assertion);
          break;
        case 'state':
          result.actual = await this.executeStateAssertion(assertion);
          break;
        case 'process':
          result.actual = await this.executeProcessAssertion(assertion);
          break;
        default:
          throw new Error(`Unknown assertion type: ${assertion.type}`);
      }

      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
    }

    return result;
  }

  /**
   * Executes the cleanup phase of a test scenario
   * Requirements: 6.1 - Test scenario cleanup configuration
   */
  private async executeCleanup(cleanup: TestCleanupConfig): Promise<TestPhaseResult> {
    const startTime = Date.now();
    const result: TestPhaseResult = {
      phase: 'cleanup',
      success: false,
      startTime,
      endTime: 0,
      duration: 0,
      details: {},
      error: null
    };

    try {
      // Remove specified files
      if (cleanup.removeFiles && cleanup.removeFiles.length > 0) {
        await this.cleanupFiles(cleanup.removeFiles);
        result.details.filesRemoved = cleanup.removeFiles.length;
      }

      // Kill processes if specified
      if (cleanup.killProcesses) {
        await this.harness.stopApp();
        result.details.processesKilled = true;
      }

      // Restore environment if specified
      if (cleanup.restoreEnvironment) {
        // Environment restoration is handled by the harness cleanup
        result.details.environmentRestored = true;
      }

      result.success = true;
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
    } finally {
      result.endTime = Date.now();
      result.duration = result.endTime - result.startTime;
    }

    return result;
  }

  // Error handling wrapper methods

  /**
   * Executes a phase (setup/cleanup) with error recovery
   * Requirements: 6.4, 7.2 - Error handling and recovery mechanisms
   */
  private async executePhaseWithRecovery<T>(
    phase: 'setup' | 'cleanup',
    operation: () => Promise<T>,
    recoveryOptions?: RecoveryOptions
  ): Promise<T> {
    const context: ErrorContext = {
      operation: `${phase}_phase`,
      phase,
      resources: this.resources,
      retryableOperation: operation
    };

    try {
      return await this.errorRecovery.retryWithBackoff(
        operation,
        recoveryOptions?.maxRetries || 2,
        context.operation
      );
    } catch (error) {
      if (error instanceof RetryExhaustedError) {
        console.error(`${phase} phase failed after retries: ${error.message}`);
        
        // For setup failures, we might want to try graceful degradation
        if (phase === 'setup' && recoveryOptions?.fallbackAction) {
          this.errorRecovery.gracefulDegrade(error.originalError, recoveryOptions.fallbackAction);
        }
      }
      throw error;
    }
  }

  /**
   * Executes a test step with error recovery
   * Requirements: 6.4, 7.2 - Error handling for test step execution
   */
  private async executeStepWithRecovery(
    step: TestStep,
    stepIndex: number,
    recoveryOptions?: RecoveryOptions
  ): Promise<TestStepResult> {
    const context: ErrorContext = {
      operation: `step_${stepIndex}_${step.type}`,
      phase: 'execution',
      resources: this.resources,
      retryableOperation: () => this.executeStepOperation(step)
    };

    try {
      return await this.executeStep(step, stepIndex);
    } catch (error) {
      const stepResult: TestStepResult = {
        stepIndex,
        stepType: step.type,
        action: step.action,
        success: false,
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
        output: null,
        error: error instanceof Error ? error.message : String(error)
      };

      // Attempt recovery for non-optional steps
      if (!this.isOptionalStep(step) && recoveryOptions?.attemptRecovery !== false) {
        try {
          const failureResult = await this.errorRecovery.handleTestFailure(
            error instanceof Error ? error : new Error(String(error)),
            context,
            recoveryOptions
          );

          if (failureResult.recoverySuccessful) {
            stepResult.success = true;
            stepResult.error = null;
            stepResult.output = 'Recovered after failure';
          }
        } catch (recoveryError) {
          console.warn(`Step recovery failed: ${recoveryError}`);
        }
      }

      return stepResult;
    }
  }

  /**
   * Executes an assertion with error recovery
   * Requirements: 6.4, 7.2 - Error handling for assertion evaluation
   */
  private async executeAssertionWithRecovery(
    assertion: TestAssertion,
    assertionIndex: number,
    recoveryOptions?: RecoveryOptions
  ): Promise<TestAssertionResult> {
    const context: ErrorContext = {
      operation: `assertion_${assertionIndex}_${assertion.type}`,
      phase: 'assertion',
      resources: this.resources
    };

    try {
      return await this.executeAssertion(assertion, assertionIndex);
    } catch (error) {
      const assertionResult: TestAssertionResult = {
        assertionIndex,
        assertionType: assertion.type,
        target: assertion.target,
        condition: assertion.condition,
        expected: assertion.expected,
        actual: null,
        success: false,
        startTime: Date.now(),
        endTime: Date.now(),
        duration: 0,
        error: error instanceof Error ? error.message : String(error)
      };

      // For assertions, we typically don't retry, but we can provide detailed error reporting
      const errorReport = this.errorRecovery.createErrorReport(
        error instanceof Error ? error : new Error(String(error)),
        context
      );

      console.error(`Assertion failed with detailed report: ${JSON.stringify(errorReport, null, 2)}`);

      return assertionResult;
    }
  }

  /**
   * Registers scenario-level resources for cleanup
   * Requirements: 6.4 - Resource management and cleanup
   */
  private registerScenarioResources(): void {
    // Register harness as a resource for cleanup
    const harnessResource: TestResource = {
      type: 'process',
      identifier: 'test_harness',
      cleanup: async () => {
        if (this.harness.isAppRunning()) {
          await this.harness.stopApp();
        }
        await this.harness.cleanup();
      }
    };

    this.resources.push(harnessResource);
    this.errorRecovery.registerResource(harnessResource);

    // Register temp directory as a resource
    const tempDataPath = this.harness.getTempDataPath();
    if (tempDataPath) {
      const tempDirResource: TestResource = {
        type: 'directory',
        identifier: tempDataPath,
        cleanup: async () => {
          // Cleanup is handled by harness, but we track it for reporting
        }
      };

      this.resources.push(tempDirResource);
      this.errorRecovery.registerResource(tempDirResource);
    }
  }

  /**
   * Executes just the step operation for retry purposes
   * Requirements: 6.4 - Retryable operations
   */
  private async executeStepOperation(step: TestStep): Promise<any> {
    switch (step.type) {
      case 'input':
        return await this.executeInputStep(step);
      case 'command':
        return await this.executeCommandStep(step);
      case 'wait':
        return await this.executeWaitStep(step);
      case 'assert':
        return await this.executeAssertStep(step);
      default:
        throw new Error(`Unknown step type: ${step.type}`);
    }
  }

  // Step execution methods

  private async executeInputStep(step: TestStep): Promise<void> {
    await this.harness.sendInput(step.action);
  }

  private async executeCommandStep(step: TestStep): Promise<void> {
    await this.harness.sendCommand(step.action);
  }

  private async executeWaitStep(step: TestStep): Promise<string> {
    const timeout = step.timeout || 5000;
    
    // Parse wait action to determine what to wait for
    if (step.action.startsWith('ui:')) {
      const expectedText = step.action.substring(3);
      return await this.harness.waitForUIText(expectedText, timeout);
    } else if (step.action.startsWith('file:')) {
      const filePath = step.action.substring(5);
      await this.harness.waitForFileChange(filePath, timeout);
      return `File changed: ${filePath}`;
    } else if (step.action === 'processing') {
      await this.harness.waitForProcessingComplete(timeout);
      return 'Processing completed';
    } else if (step.action === 'idle') {
      await this.harness.waitForIdleState(timeout);
      return 'Application reached idle state';
    } else if (step.action === 'llm_request') {
      await this.harness.waitForLLMRequest(timeout);
      return 'LLM request received';
    } else {
      throw new Error(`Unknown wait action: ${step.action}`);
    }
  }

  private async executeAssertStep(step: TestStep): Promise<void> {
    // Parse assert action to determine what to assert
    if (step.action.startsWith('ui_contains:')) {
      const expectedText = step.action.substring(12);
      await this.harness.assertUIContains(expectedText);
    } else if (step.action.startsWith('ui_not_contains:')) {
      const expectedText = step.action.substring(16);
      await this.harness.assertUIDoesNotContain(expectedText);
    } else if (step.action.startsWith('file_exists:')) {
      const filePath = step.action.substring(12);
      this.harness.assertFileExists(filePath);
    } else if (step.action.startsWith('file_not_exists:')) {
      const filePath = step.action.substring(16);
      this.harness.assertFileDoesNotExist(filePath);
    } else if (step.action === 'process_running') {
      this.harness.assertProcessState(true);
    } else if (step.action === 'process_stopped') {
      this.harness.assertProcessState(false);
    } else {
      throw new Error(`Unknown assert action: ${step.action}`);
    }
  }

  // Assertion execution methods

  private async executeUIAssertion(assertion: TestAssertion): Promise<string> {
    const output = await this.harness.getCurrentOutput();
    
    switch (assertion.condition) {
      case 'contains':
        if (!output.includes(assertion.expected)) {
          throw new Error(`UI does not contain expected text: "${assertion.expected}"`);
        }
        break;
      case 'not_contains':
        if (output.includes(assertion.expected)) {
          throw new Error(`UI contains unexpected text: "${assertion.expected}"`);
        }
        break;
      case 'matches':
        const pattern = new RegExp(assertion.expected);
        if (!pattern.test(output)) {
          throw new Error(`UI does not match expected pattern: ${assertion.expected}`);
        }
        break;
      default:
        throw new Error(`Unknown UI assertion condition: ${assertion.condition}`);
    }
    
    return output;
  }

  private async executeFileAssertion(assertion: TestAssertion): Promise<string | boolean> {
    switch (assertion.condition) {
      case 'exists':
        this.harness.assertFileExists(assertion.target);
        return true;
      case 'not_exists':
        this.harness.assertFileDoesNotExist(assertion.target);
        return false;
      case 'content_contains':
        await this.harness.assertFileContent(assertion.target, assertion.expected);
        return assertion.expected;
      case 'content_matches':
        const pattern = new RegExp(assertion.expected);
        await this.harness.assertFileContent(assertion.target, pattern);
        return assertion.expected;
      default:
        throw new Error(`Unknown file assertion condition: ${assertion.condition}`);
    }
  }

  private async executeStateAssertion(assertion: TestAssertion): Promise<any> {
    switch (assertion.condition) {
      case 'persona_exists':
        // Check if persona directory exists
        const tempDataPath = this.harness.getTempDataPath();
        if (!tempDataPath) {
          throw new Error('Temp data path not available for state assertion');
        }
        const personaPath = path.join(tempDataPath, 'personas', assertion.target);
        if (!fs.existsSync(personaPath)) {
          throw new Error(`Persona "${assertion.target}" does not exist`);
        }
        return true;
      case 'persona_state':
        // This would require parsing persona state from files
        // For now, just verify persona exists
        await this.harness.assertPersonaState(assertion.target, assertion.expected);
        return assertion.expected;
      default:
        throw new Error(`Unknown state assertion condition: ${assertion.condition}`);
    }
  }

  private async executeProcessAssertion(assertion: TestAssertion): Promise<boolean> {
    switch (assertion.condition) {
      case 'running':
        this.harness.assertProcessState(assertion.expected);
        return assertion.expected;
      case 'exit_code':
        await this.harness.assertExitCode(assertion.expected);
        return assertion.expected;
      case 'mock_requests':
        this.harness.assertMockRequestCount(assertion.expected);
        return assertion.expected;
      default:
        throw new Error(`Unknown process assertion condition: ${assertion.condition}`);
    }
  }

  // Setup helper methods

  private async setupInitialData(initialData: InitialDataConfig): Promise<void> {
    const tempDataPath = this.harness.getTempDataPath();
    if (!tempDataPath) {
      throw new Error('Temp data path not available for initial data setup');
    }

    // Set up personas if specified
    if (initialData.personas) {
      for (const persona of initialData.personas) {
        await this.createPersonaData(tempDataPath, persona);
      }
    }

    // Set up concepts if specified
    if (initialData.concepts) {
      await this.createConceptsData(tempDataPath, initialData.concepts);
    }

    // Set up history if specified
    if (initialData.history) {
      await this.createHistoryData(tempDataPath, initialData.history);
    }
  }

  private async setupMockResponses(mockResponses: MockResponseConfig[]): Promise<void> {
    for (const mockResponse of mockResponses) {
      this.harness.setMockResponse(
        mockResponse.endpoint,
        typeof mockResponse.response.content === 'string' 
          ? mockResponse.response.content 
          : mockResponse.response.content.join(''),
        mockResponse.response.delayMs
      );
    }
  }

  private async setupPersonas(personas: PersonaConfig[]): Promise<void> {
    const tempDataPath = this.harness.getTempDataPath();
    if (!tempDataPath) {
      throw new Error('Temp data path not available for persona setup');
    }

    for (const persona of personas) {
      await this.createPersonaData(tempDataPath, persona);
    }
  }

  private async createPersonaData(tempDataPath: string, persona: PersonaConfig): Promise<void> {
    const personaDir = path.join(tempDataPath, 'personas', persona.name);
    await fs.promises.mkdir(personaDir, { recursive: true });

    // Create system.jsonc file
    const systemData = {
      name: persona.name,
      systemPrompt: persona.systemPrompt || `You are ${persona.name}, a helpful AI assistant.`,
      created: new Date().toISOString()
    };

    await fs.promises.writeFile(
      path.join(personaDir, 'system.jsonc'),
      JSON.stringify(systemData, null, 2),
      'utf-8'
    );

    // Create initial messages if specified
    if (persona.initialMessages && persona.initialMessages.length > 0) {
      const historyData = persona.initialMessages.map((message, index) => ({
        id: `initial_${index}`,
        content: message,
        role: index % 2 === 0 ? 'user' : 'assistant',
        timestamp: new Date().toISOString()
      }));

      await fs.promises.writeFile(
        path.join(personaDir, 'history.jsonc'),
        JSON.stringify(historyData, null, 2),
        'utf-8'
      );
    }
  }

  private async createConceptsData(tempDataPath: string, concepts: Record<string, any>): Promise<void> {
    const conceptsPath = path.join(tempDataPath, 'concepts.jsonc');
    await fs.promises.writeFile(
      conceptsPath,
      JSON.stringify(concepts, null, 2),
      'utf-8'
    );
  }

  private async createHistoryData(tempDataPath: string, history: Record<string, any[]>): Promise<void> {
    for (const [personaName, messages] of Object.entries(history)) {
      const personaDir = path.join(tempDataPath, 'personas', personaName);
      await fs.promises.mkdir(personaDir, { recursive: true });

      await fs.promises.writeFile(
        path.join(personaDir, 'history.jsonc'),
        JSON.stringify(messages, null, 2),
        'utf-8'
      );
    }
  }

  private async cleanupFiles(filePaths: string[]): Promise<void> {
    const tempDataPath = this.harness.getTempDataPath();
    if (!tempDataPath) {
      return; // Nothing to clean up
    }

    for (const filePath of filePaths) {
      const absolutePath = path.isAbsolute(filePath) ? filePath : path.join(tempDataPath, filePath);
      
      try {
        if (fs.existsSync(absolutePath)) {
          const stats = fs.statSync(absolutePath);
          if (stats.isDirectory()) {
            await fs.promises.rmdir(absolutePath, { recursive: true });
          } else {
            await fs.promises.unlink(absolutePath);
          }
        }
      } catch (error) {
        // Log but don't fail cleanup for individual file errors
        console.warn(`Failed to cleanup file ${absolutePath}: ${error}`);
      }
    }
  }

  // Validation and utility methods

  private validateScenarioStructure(scenario: any): void {
    if (!scenario.name || typeof scenario.name !== 'string') {
      throw new Error('Scenario must have a valid name');
    }

    if (!scenario.description || typeof scenario.description !== 'string') {
      throw new Error('Scenario must have a valid description');
    }

    if (!scenario.setup || typeof scenario.setup !== 'object') {
      throw new Error('Scenario must have a valid setup configuration');
    }

    if (!Array.isArray(scenario.steps)) {
      throw new Error('Scenario must have a valid steps array');
    }

    if (!Array.isArray(scenario.assertions)) {
      throw new Error('Scenario must have a valid assertions array');
    }

    // Validate each step
    for (let i = 0; i < scenario.steps.length; i++) {
      const step = scenario.steps[i];
      if (!step.type || !['input', 'command', 'wait', 'assert'].includes(step.type)) {
        throw new Error(`Step ${i + 1} must have a valid type (input, command, wait, assert)`);
      }
      if (!step.action || typeof step.action !== 'string') {
        throw new Error(`Step ${i + 1} must have a valid action`);
      }
    }

    // Validate each assertion
    for (let i = 0; i < scenario.assertions.length; i++) {
      const assertion = scenario.assertions[i];
      if (!assertion.type || !['ui', 'file', 'state', 'process'].includes(assertion.type)) {
        throw new Error(`Assertion ${i + 1} must have a valid type (ui, file, state, process)`);
      }
      if (!assertion.target || typeof assertion.target !== 'string') {
        throw new Error(`Assertion ${i + 1} must have a valid target`);
      }
      if (!assertion.condition || typeof assertion.condition !== 'string') {
        throw new Error(`Assertion ${i + 1} must have a valid condition`);
      }
    }
  }

  private isOptionalStep(step: TestStep): boolean {
    // Steps can be marked as optional by including "optional: true" in the step
    return (step as any).optional === true;
  }
}

// Result interfaces for test scenario execution

export interface TestScenarioResult {
  scenarioName: string;
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  setupResult: TestPhaseResult | null;
  stepResults: TestStepResult[];
  assertionResults: TestAssertionResult[];
  cleanupResult: TestPhaseResult | null;
  error: string | null;
  errorReport?: any | null;
  recoveryAttempted?: boolean;
}

export interface TestPhaseResult {
  phase: 'setup' | 'cleanup';
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  details: Record<string, any>;
  error: string | null;
}

export interface TestStepResult {
  stepIndex: number;
  stepType: string;
  action: string;
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  output: any;
  error: string | null;
}

export interface TestAssertionResult {
  assertionIndex: number;
  assertionType: string;
  target: string;
  condition: string;
  expected: any;
  actual: any;
  success: boolean;
  startTime: number;
  endTime: number;
  duration: number;
  error: string | null;
}
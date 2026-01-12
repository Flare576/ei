// Test Scenario Configuration System Tests
// Validates scenario loading, step execution, and assertion evaluation

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { TestScenarioRunner, TestScenarioResult } from './test-scenario.js';
import { E2ETestHarnessImpl } from './harness.js';
import { TestScenario, TestStep, TestAssertion } from '../types.js';

describe('TestScenarioRunner', () => {
  let harness: E2ETestHarnessImpl;
  let scenarioRunner: TestScenarioRunner;
  let tempDir: string;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    scenarioRunner = new TestScenarioRunner(harness);
    
    // Create temporary directory for test files
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'scenario-test-'));
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      await fs.promises.rmdir(tempDir, { recursive: true });
    }
  });

  describe('Scenario Loading', () => {
    test('loads scenario from valid JSON file', async () => {
      const scenario: TestScenario = {
        name: 'Test Scenario',
        description: 'A test scenario for validation',
        setup: {
          mockResponses: []
        },
        steps: [
          {
            type: 'input',
            action: 'hello world'
          }
        ],
        assertions: [
          {
            type: 'ui',
            target: 'output',
            condition: 'contains',
            expected: 'hello'
          }
        ]
      };

      const scenarioPath = path.join(tempDir, 'test-scenario.json');
      await fs.promises.writeFile(scenarioPath, JSON.stringify(scenario, null, 2));

      const loadedScenario = await scenarioRunner.loadScenarioFromFile(scenarioPath);
      
      expect(loadedScenario.name).toBe('Test Scenario');
      expect(loadedScenario.description).toBe('A test scenario for validation');
      expect(loadedScenario.steps).toHaveLength(1);
      expect(loadedScenario.assertions).toHaveLength(1);
    });

    test('throws error for non-existent file', async () => {
      const nonExistentPath = path.join(tempDir, 'non-existent.json');
      
      await expect(scenarioRunner.loadScenarioFromFile(nonExistentPath))
        .rejects.toThrow('Scenario file not found');
    });

    test('throws error for invalid JSON', async () => {
      const invalidJsonPath = path.join(tempDir, 'invalid.json');
      await fs.promises.writeFile(invalidJsonPath, '{ invalid json }');
      
      await expect(scenarioRunner.loadScenarioFromFile(invalidJsonPath))
        .rejects.toThrow('Failed to load scenario');
    });

    test('loads scenario from object', () => {
      const scenario: TestScenario = {
        name: 'Object Scenario',
        description: 'Loaded from object',
        setup: {},
        steps: [],
        assertions: []
      };

      const loadedScenario = scenarioRunner.loadScenarioFromObject(scenario);
      
      expect(loadedScenario.name).toBe('Object Scenario');
      expect(loadedScenario.description).toBe('Loaded from object');
    });
  });

  describe('Scenario Validation', () => {
    test('validates scenario structure - missing name', () => {
      const invalidScenario = {
        description: 'Missing name',
        setup: {},
        steps: [],
        assertions: []
      };

      expect(() => scenarioRunner.loadScenarioFromObject(invalidScenario as TestScenario))
        .toThrow('Scenario must have a valid name');
    });

    test('validates scenario structure - missing description', () => {
      const invalidScenario = {
        name: 'Test',
        setup: {},
        steps: [],
        assertions: []
      };

      expect(() => scenarioRunner.loadScenarioFromObject(invalidScenario as TestScenario))
        .toThrow('Scenario must have a valid description');
    });

    test('validates scenario structure - invalid steps', () => {
      const invalidScenario = {
        name: 'Test',
        description: 'Test scenario',
        setup: {},
        steps: [{ type: 'invalid', action: 'test' }],
        assertions: []
      };

      expect(() => scenarioRunner.loadScenarioFromObject(invalidScenario as TestScenario))
        .toThrow('Step 1 must have a valid type');
    });

    test('validates scenario structure - invalid assertions', () => {
      const invalidScenario = {
        name: 'Test',
        description: 'Test scenario',
        setup: {},
        steps: [],
        assertions: [{ type: 'invalid', target: 'test', condition: 'test', expected: 'test' }]
      };

      expect(() => scenarioRunner.loadScenarioFromObject(invalidScenario as TestScenario))
        .toThrow('Assertion 1 must have a valid type');
    });
  });

  describe('Step Execution Logic', () => {
    test('validates step types', () => {
      const validStepTypes = ['input', 'command', 'wait', 'assert'];
      
      for (const stepType of validStepTypes) {
        const scenario: TestScenario = {
          name: 'Step Type Test',
          description: 'Testing step types',
          setup: {},
          steps: [{ type: stepType as any, action: 'test' }],
          assertions: []
        };

        expect(() => scenarioRunner.loadScenarioFromObject(scenario))
          .not.toThrow();
      }
    });

    test('validates assertion types', () => {
      const validAssertionTypes = ['ui', 'file', 'state', 'process'];
      
      for (const assertionType of validAssertionTypes) {
        const scenario: TestScenario = {
          name: 'Assertion Type Test',
          description: 'Testing assertion types',
          setup: {},
          steps: [],
          assertions: [{ 
            type: assertionType as any, 
            target: 'test', 
            condition: 'test', 
            expected: 'test' 
          }]
        };

        expect(() => scenarioRunner.loadScenarioFromObject(scenario))
          .not.toThrow();
      }
    });
  });

  describe('Configuration Structure', () => {
    test('handles complex scenario configuration', () => {
      const complexScenario: TestScenario = {
        name: 'Complex Test Scenario',
        description: 'A comprehensive test scenario with all features',
        setup: {
          personas: [
            {
              name: 'test-persona',
              systemPrompt: 'You are a test assistant',
              initialMessages: ['Hello', 'How can I help?']
            }
          ],
          mockResponses: [
            {
              endpoint: '/v1/chat/completions',
              response: {
                type: 'fixed',
                content: 'Mock response',
                delayMs: 100
              }
            }
          ],
          initialData: {
            personas: [
              {
                name: 'initial-persona',
                systemPrompt: 'Initial persona'
              }
            ],
            concepts: {
              'test-concept': 'test-value'
            },
            history: {
              'test-persona': [
                { role: 'user', content: 'Test message' }
              ]
            }
          }
        },
        steps: [
          {
            type: 'input',
            action: 'hello',
            timeout: 5000
          },
          {
            type: 'command',
            action: '/help',
            expectedResult: 'help displayed'
          },
          {
            type: 'wait',
            action: 'ui:Welcome',
            timeout: 3000
          },
          {
            type: 'assert',
            action: 'ui_contains:Welcome'
          }
        ],
        assertions: [
          {
            type: 'ui',
            target: 'output',
            condition: 'contains',
            expected: 'Welcome'
          },
          {
            type: 'file',
            target: 'personas/test-persona/system.jsonc',
            condition: 'exists',
            expected: true
          },
          {
            type: 'state',
            target: 'test-persona',
            condition: 'persona_exists',
            expected: true
          },
          {
            type: 'process',
            target: 'application',
            condition: 'running',
            expected: true
          }
        ],
        cleanup: {
          removeFiles: ['temp-file.txt'],
          killProcesses: true,
          restoreEnvironment: true
        }
      };

      expect(() => scenarioRunner.loadScenarioFromObject(complexScenario))
        .not.toThrow();
      
      expect(complexScenario.setup.personas).toHaveLength(1);
      expect(complexScenario.setup.mockResponses).toHaveLength(1);
      expect(complexScenario.steps).toHaveLength(4);
      expect(complexScenario.assertions).toHaveLength(4);
      expect(complexScenario.cleanup).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    test('handles missing required fields gracefully', () => {
      const scenarios = [
        { description: 'Missing name', setup: {}, steps: [], assertions: [] },
        { name: 'Test', setup: {}, steps: [], assertions: [] }, // Missing description
        { name: 'Test', description: 'Test', steps: [], assertions: [] }, // Missing setup
        { name: 'Test', description: 'Test', setup: {} }, // Missing steps and assertions
      ];

      for (const scenario of scenarios) {
        expect(() => scenarioRunner.loadScenarioFromObject(scenario as TestScenario))
          .toThrow();
      }
    });

    test('handles invalid step configurations', () => {
      const invalidSteps = [
        { action: 'test' }, // Missing type
        { type: 'input' }, // Missing action
        { type: 'invalid', action: 'test' }, // Invalid type
      ];

      for (const step of invalidSteps) {
        const scenario: TestScenario = {
          name: 'Test',
          description: 'Test',
          setup: {},
          steps: [step as TestStep],
          assertions: []
        };

        expect(() => scenarioRunner.loadScenarioFromObject(scenario))
          .toThrow();
      }
    });

    test('handles invalid assertion configurations', () => {
      const invalidAssertions = [
        { target: 'test', condition: 'test', expected: 'test' }, // Missing type
        { type: 'ui', condition: 'test', expected: 'test' }, // Missing target
        { type: 'ui', target: 'test', expected: 'test' }, // Missing condition
        { type: 'invalid', target: 'test', condition: 'test', expected: 'test' }, // Invalid type
      ];

      for (const assertion of invalidAssertions) {
        const scenario: TestScenario = {
          name: 'Test',
          description: 'Test',
          setup: {},
          steps: [],
          assertions: [assertion as TestAssertion]
        };

        expect(() => scenarioRunner.loadScenarioFromObject(scenario))
          .toThrow();
      }
    });
  });
});
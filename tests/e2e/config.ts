// E2E Test Configuration
// Default configuration values for e2e testing framework

import { TestConfig } from './types.js';

export const DEFAULT_E2E_CONFIG: TestConfig = {
  tempDirPrefix: 'ei-e2e-test',
  mockServerPort: 3001,
  appTimeout: 10000, // 10 seconds for app startup
  cleanupTimeout: 5000, // 5 seconds for cleanup operations
  mockResponses: []
};

export const DEFAULT_MOCK_SERVER_CONFIG = {
  responses: {
    '/v1/chat/completions': {
      type: 'fixed' as const,
      content: JSON.stringify({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: Date.now(),
        model: 'test-model',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'This is a test response from the mock LLM server.'
          },
          finish_reason: 'stop'
        }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25
        }
      }),
      statusCode: 200
    }
  },
  defaultDelay: 100, // 100ms default delay
  enableLogging: true
};

export const DEFAULT_APP_CONFIG = {
  dataPath: '', // Will be set to temp directory
  llmBaseUrl: 'http://localhost:3001', // Points to mock server
  llmApiKey: 'test-key',
  llmModel: 'test-model',
  debugMode: false
};

export const DEFAULT_ENVIRONMENT_CONFIG = {
  EI_DATA_PATH: '', // Will be set to temp directory
  EI_LLM_BASE_URL: 'http://localhost:3001',
  EI_LLM_API_KEY: 'test-key',
  EI_LLM_MODEL: 'test-model'
};
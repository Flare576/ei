// Tests for Configuration Management System
// Validates file-based loading, programmatic API, environment overrides, and validation

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { E2EConfigManagerImpl, createConfigManager, loadConfigFromFile, createDefaultConfig, validateConfiguration } from './config-manager.js';
import { TestConfig } from '../types.js';

describe('E2EConfigManager', () => {
  let configManager: E2EConfigManagerImpl;
  let tempDir: string;
  let testConfigPath: string;

  beforeEach(async () => {
    configManager = new E2EConfigManagerImpl();
    
    // Create temporary directory for test files
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'config-test-'));
    testConfigPath = path.join(tempDir, 'test-config.json');
  });

  afterEach(async () => {
    // Clean up temporary directory
    if (fs.existsSync(tempDir)) {
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }
    
    // Clean up environment variables
    delete process.env.E2E_TEST_TEMP_DIR_PREFIX;
    delete process.env.E2E_TEST_MOCK_SERVER_PORT;
    delete process.env.E2E_TEST_APP_TIMEOUT;
    delete process.env.E2E_TEST_CLEANUP_TIMEOUT;
  });

  describe('Default Configuration', () => {
    test('should provide valid default configuration', () => {
      const defaultConfig = configManager.getDefaultConfig();
      
      expect(defaultConfig.tempDirPrefix).toBe('ei-e2e-test');
      expect(defaultConfig.mockServerPort).toBeUndefined();
      expect(defaultConfig.appTimeout).toBe(10000);
      expect(defaultConfig.cleanupTimeout).toBe(5000);
      expect(defaultConfig.mockResponses).toEqual([]);
    });

    test('should validate default configuration', () => {
      const defaultConfig = configManager.getDefaultConfig();
      const validation = configManager.validateConfig(defaultConfig);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
    });
  });

  describe('Programmatic Configuration API', () => {
    test('should create config with overrides', () => {
      const config = configManager.createConfig({
        tempDirPrefix: 'custom-test',
        appTimeout: 15000
      });
      
      expect(config.tempDirPrefix).toBe('custom-test');
      expect(config.appTimeout).toBe(15000);
      expect(config.cleanupTimeout).toBe(5000); // Should keep default
    });

    test('should merge configurations correctly', () => {
      const base: TestConfig = {
        tempDirPrefix: 'base-test',
        appTimeout: 10000,
        cleanupTimeout: 5000,
        mockResponses: [
          {
            endpoint: '/v1/chat/completions',
            response: { type: 'fixed', content: 'base response' }
          }
        ]
      };

      const override = {
        tempDirPrefix: 'override-test',
        mockResponses: [
          {
            endpoint: '/v1/chat/completions',
            response: { type: 'fixed', content: 'override response' }
          },
          {
            endpoint: '/v1/models',
            response: { type: 'fixed', content: 'models response' }
          }
        ]
      };

      const merged = configManager.mergeConfigs(base, override);
      
      expect(merged.tempDirPrefix).toBe('override-test');
      expect(merged.appTimeout).toBe(10000); // Should keep base value
      expect(merged.mockResponses).toHaveLength(2);
      expect(merged.mockResponses![0].response.content).toBe('override response');
      expect(merged.mockResponses![1].endpoint).toBe('/v1/models');
    });
  });

  describe('File-based Configuration', () => {
    test('should save and load configuration', async () => {
      const config: TestConfig = {
        tempDirPrefix: 'file-test',
        mockServerPort: 3002,
        appTimeout: 12000,
        cleanupTimeout: 6000,
        mockResponses: [
          {
            endpoint: '/v1/chat/completions',
            response: {
              type: 'fixed',
              content: 'test response',
              delayMs: 100,
              statusCode: 200
            }
          }
        ]
      };

      await configManager.saveToFile(config, testConfigPath);
      expect(fs.existsSync(testConfigPath)).toBe(true);

      const loadedConfig = await configManager.loadFromFile(testConfigPath);
      expect(loadedConfig).toEqual(config);
    });

    test('should generate config file with comments', async () => {
      const config: TestConfig = {
        tempDirPrefix: 'comment-test',
        appTimeout: 8000,
        mockResponses: []
      };

      await configManager.saveToFile(config, testConfigPath);
      const fileContent = await fs.promises.readFile(testConfigPath, 'utf-8');
      
      expect(fileContent).toContain('// E2E Test Configuration');
      expect(fileContent).toContain('// Prefix for temporary test directories');
      expect(fileContent).toContain('// Timeout for application startup');
    });

    test('should handle missing config file', async () => {
      const nonExistentPath = path.join(tempDir, 'missing.json');
      
      await expect(configManager.loadFromFile(nonExistentPath))
        .rejects.toThrow('Configuration file not found');
    });

    test('should handle invalid JSON', async () => {
      await fs.promises.writeFile(testConfigPath, '{ invalid json }', 'utf-8');
      
      await expect(configManager.loadFromFile(testConfigPath))
        .rejects.toThrow('Invalid JSON');
    });

    test('should parse JSONC with comments', async () => {
      const configWithComments = `{
        // This is a comment
        "tempDirPrefix": "jsonc-test",
        /* Multi-line
           comment */
        "appTimeout": 9000
      }`;

      await fs.promises.writeFile(testConfigPath, configWithComments, 'utf-8');
      const loadedConfig = await configManager.loadFromFile(testConfigPath);
      
      expect(loadedConfig.tempDirPrefix).toBe('jsonc-test');
      expect(loadedConfig.appTimeout).toBe(9000);
    });
  });

  describe('Environment Variable Overrides', () => {
    test('should apply environment overrides', () => {
      process.env.E2E_TEST_TEMP_DIR_PREFIX = 'env-test';
      process.env.E2E_TEST_MOCK_SERVER_PORT = '3003';
      process.env.E2E_TEST_APP_TIMEOUT = '20000';

      const baseConfig = configManager.getDefaultConfig();
      const configWithEnv = configManager.applyEnvironmentOverrides(baseConfig);
      
      expect(configWithEnv.tempDirPrefix).toBe('env-test');
      expect(configWithEnv.mockServerPort).toBe(3003);
      expect(configWithEnv.appTimeout).toBe(20000);
      expect(configWithEnv.cleanupTimeout).toBe(5000); // Should keep default
    });

    test('should get environment config', () => {
      process.env.E2E_TEST_TEMP_DIR_PREFIX = 'env-prefix';
      process.env.E2E_TEST_CLEANUP_TIMEOUT = '7000';

      const envConfig = configManager.getEnvironmentConfig();
      
      expect(envConfig.tempDirPrefix).toBe('env-prefix');
      expect(envConfig.cleanupTimeout).toBe(7000);
      expect(envConfig.mockServerPort).toBeUndefined();
    });

    test('should ignore invalid environment values', () => {
      process.env.E2E_TEST_MOCK_SERVER_PORT = 'not-a-number';
      process.env.E2E_TEST_APP_TIMEOUT = 'invalid';

      const envConfig = configManager.getEnvironmentConfig();
      
      expect(envConfig.mockServerPort).toBeUndefined();
      expect(envConfig.appTimeout).toBeUndefined();
    });
  });

  describe('Configuration Validation', () => {
    test('should validate valid configuration', () => {
      const validConfig: TestConfig = {
        tempDirPrefix: 'valid-test',
        mockServerPort: 3004,
        appTimeout: 15000,
        cleanupTimeout: 8000,
        mockResponses: [
          {
            endpoint: '/v1/test',
            response: { type: 'fixed', content: 'test' }
          }
        ]
      };

      const validation = configManager.validateConfig(validConfig);
      
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toEqual([]);
    });

    test('should detect invalid tempDirPrefix', () => {
      const invalidConfig: TestConfig = {
        tempDirPrefix: 'invalid/prefix',
        mockResponses: []
      };

      const validation = configManager.validateConfig(invalidConfig);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('tempDirPrefix can only contain alphanumeric characters, underscores, and hyphens');
    });

    test('should detect invalid port numbers', () => {
      const invalidConfig: TestConfig = {
        mockServerPort: 80, // Too low
        mockResponses: []
      };

      const validation = configManager.validateConfig(invalidConfig);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('mockServerPort must be between 1024 and 65535');
    });

    test('should detect invalid timeout values', () => {
      const invalidConfig: TestConfig = {
        appTimeout: 'not-a-number' as any,
        cleanupTimeout: 'also-not-a-number' as any,
        mockResponses: []
      };

      const validation = configManager.validateConfig(invalidConfig);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('appTimeout must be a number');
      expect(validation.errors).toContain('cleanupTimeout must be a number');
    });

    test('should generate warnings for edge case values', () => {
      const edgeCaseConfig: TestConfig = {
        appTimeout: 500, // Very low
        cleanupTimeout: 500, // Very low
        mockResponses: []
      };

      const validation = configManager.validateConfig(edgeCaseConfig);
      
      expect(validation.isValid).toBe(true); // Valid but with warnings
      expect(validation.warnings).toContain('appTimeout less than 1000ms may cause test instability');
      expect(validation.warnings).toContain('cleanupTimeout less than 1000ms may cause incomplete cleanup');
    });

    test('should validate mock responses', () => {
      const invalidMockConfig: TestConfig = {
        mockResponses: [
          {
            endpoint: '', // Empty endpoint
            response: { type: 'fixed', content: 'test' }
          },
          {
            endpoint: '/v1/test',
            response: { type: 'invalid' as any, content: '' } // Invalid type and empty content
          }
        ]
      };

      const validation = configManager.validateConfig(invalidMockConfig);
      
      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain('mockResponses[0].endpoint is required');
      expect(validation.errors).toContain('mockResponses[1].response.type must be \'fixed\', \'streaming\', or \'error\'');
      expect(validation.errors).toContain('mockResponses[1].response.content is required');
    });
  });

  describe('Configuration Normalization', () => {
    test('should normalize partial configuration', () => {
      const partialConfig = {
        tempDirPrefix: 'partial-test'
      };

      const normalized = configManager.normalizeConfig(partialConfig);
      
      expect(normalized.tempDirPrefix).toBe('partial-test');
      expect(normalized.appTimeout).toBe(10000); // Should have default
      expect(normalized.cleanupTimeout).toBe(5000); // Should have default
      expect(normalized.mockResponses).toEqual([]); // Should have default
    });

    test('should apply environment overrides during normalization', () => {
      process.env.E2E_TEST_APP_TIMEOUT = '25000';

      const partialConfig = {
        tempDirPrefix: 'normalize-test'
      };

      const normalized = configManager.normalizeConfig(partialConfig);
      
      expect(normalized.tempDirPrefix).toBe('normalize-test');
      expect(normalized.appTimeout).toBe(25000); // Should have env override
    });
  });

  describe('Utility Functions', () => {
    test('should create config manager', () => {
      const manager = createConfigManager();
      expect(manager).toBeInstanceOf(E2EConfigManagerImpl);
    });

    test('should load config from file using utility', async () => {
      const config: TestConfig = {
        tempDirPrefix: 'utility-test',
        mockResponses: []
      };

      await fs.promises.writeFile(testConfigPath, JSON.stringify(config), 'utf-8');
      const loadedConfig = await loadConfigFromFile(testConfigPath);
      
      expect(loadedConfig.tempDirPrefix).toBe('utility-test');
    });

    test('should create default config using utility', () => {
      const config = createDefaultConfig({ tempDirPrefix: 'utility-default' });
      
      expect(config.tempDirPrefix).toBe('utility-default');
      expect(config.appTimeout).toBe(10000); // Should have default
    });

    test('should validate configuration using utility', () => {
      const config: TestConfig = {
        tempDirPrefix: 'utility-validate',
        mockResponses: []
      };

      const validation = validateConfiguration(config);
      
      expect(validation.isValid).toBe(true);
    });
  });
});
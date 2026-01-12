// Configuration Management System for E2E Testing Framework
// Implements file-based configuration loading, programmatic API, environment overrides, and validation
// Requirements: 8.1, 8.2, 8.3, 8.5

import * as fs from 'fs';
import * as path from 'path';
import { TestConfig, MockResponseConfig, AppConfig, EnvironmentConfig } from '../types.js';

export interface E2EConfigManager {
  // File-based configuration loading
  loadFromFile(configPath: string): Promise<TestConfig>;
  saveToFile(config: TestConfig, configPath: string): Promise<void>;
  
  // Programmatic configuration API
  createConfig(overrides?: Partial<TestConfig>): TestConfig;
  mergeConfigs(base: TestConfig, override: Partial<TestConfig>): TestConfig;
  
  // Environment-specific overrides
  applyEnvironmentOverrides(config: TestConfig): TestConfig;
  getEnvironmentConfig(): Partial<TestConfig>;
  
  // Configuration validation and defaults
  validateConfig(config: TestConfig): ValidationResult;
  getDefaultConfig(): TestConfig;
  normalizeConfig(config: Partial<TestConfig>): TestConfig;
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ConfigSchema {
  tempDirPrefix?: ConfigFieldSchema;
  mockServerPort?: ConfigFieldSchema;
  appTimeout?: ConfigFieldSchema;
  cleanupTimeout?: ConfigFieldSchema;
  mockResponses?: ConfigFieldSchema;
}

export interface ConfigFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  min?: number;
  max?: number;
  pattern?: RegExp;
  validator?: (value: any) => boolean;
  description?: string;
}

export class E2EConfigManagerImpl implements E2EConfigManager {
  private schema: ConfigSchema;
  private environmentPrefix = 'E2E_TEST_';

  constructor() {
    this.schema = this.buildConfigSchema();
  }

  /**
   * Loads configuration from a JSON or JSONC file
   * Requirements: 8.1 - File-based configuration loading
   */
  async loadFromFile(configPath: string): Promise<TestConfig> {
    try {
      if (!fs.existsSync(configPath)) {
        throw new Error(`Configuration file not found: ${configPath}`);
      }

      const fileContent = await fs.promises.readFile(configPath, 'utf-8');
      
      // Support both JSON and JSONC (JSON with comments)
      const config = this.parseJsonWithComments(fileContent);
      
      // Validate the loaded configuration
      const validation = this.validateConfig(config);
      if (!validation.isValid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Apply normalization and defaults
      return this.normalizeConfig(config);
    } catch (error) {
      throw new Error(`Failed to load configuration from ${configPath}: ${error}`);
    }
  }

  /**
   * Saves configuration to a JSON file with comments
   * Requirements: 8.1 - File-based configuration loading
   */
  async saveToFile(config: TestConfig, configPath: string): Promise<void> {
    try {
      // Validate before saving
      const validation = this.validateConfig(config);
      if (!validation.isValid) {
        throw new Error(`Cannot save invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Create directory if it doesn't exist
      const dir = path.dirname(configPath);
      if (!fs.existsSync(dir)) {
        await fs.promises.mkdir(dir, { recursive: true });
      }

      // Generate JSON with helpful comments
      const configWithComments = this.generateConfigWithComments(config);
      await fs.promises.writeFile(configPath, configWithComments, 'utf-8');
    } catch (error) {
      throw new Error(`Failed to save configuration to ${configPath}: ${error}`);
    }
  }

  /**
   * Creates a new configuration with optional overrides
   * Requirements: 8.2 - Programmatic configuration API
   */
  createConfig(overrides?: Partial<TestConfig>): TestConfig {
    const defaultConfig = this.getDefaultConfig();
    
    if (!overrides) {
      return defaultConfig;
    }

    return this.mergeConfigs(defaultConfig, overrides);
  }

  /**
   * Merges two configurations with deep merge support
   * Requirements: 8.2 - Programmatic configuration API
   */
  mergeConfigs(base: TestConfig, override: Partial<TestConfig>): TestConfig {
    const merged: TestConfig = { ...base };

    // Handle simple properties
    if (override.tempDirPrefix !== undefined) merged.tempDirPrefix = override.tempDirPrefix;
    if (override.mockServerPort !== undefined) merged.mockServerPort = override.mockServerPort;
    if (override.appTimeout !== undefined) merged.appTimeout = override.appTimeout;
    if (override.cleanupTimeout !== undefined) merged.cleanupTimeout = override.cleanupTimeout;

    // Handle complex properties (arrays/objects)
    if (override.mockResponses !== undefined) {
      if (base.mockResponses && override.mockResponses) {
        // Merge mock responses by endpoint, with override taking precedence
        const mergedResponses: MockResponseConfig[] = [...base.mockResponses];
        
        for (const overrideResponse of override.mockResponses) {
          const existingIndex = mergedResponses.findIndex(r => r.endpoint === overrideResponse.endpoint);
          if (existingIndex >= 0) {
            mergedResponses[existingIndex] = overrideResponse;
          } else {
            mergedResponses.push(overrideResponse);
          }
        }
        
        merged.mockResponses = mergedResponses;
      } else {
        merged.mockResponses = override.mockResponses;
      }
    }

    return merged;
  }

  /**
   * Applies environment variable overrides to configuration
   * Requirements: 8.3 - Environment-specific configuration overrides
   */
  applyEnvironmentOverrides(config: TestConfig): TestConfig {
    const envOverrides = this.getEnvironmentConfig();
    return this.mergeConfigs(config, envOverrides);
  }

  /**
   * Extracts configuration from environment variables
   * Requirements: 8.3 - Environment-specific configuration overrides
   */
  getEnvironmentConfig(): Partial<TestConfig> {
    const envConfig: Partial<TestConfig> = {};

    // Map environment variables to config properties
    const envMappings = {
      [`${this.environmentPrefix}TEMP_DIR_PREFIX`]: 'tempDirPrefix',
      [`${this.environmentPrefix}MOCK_SERVER_PORT`]: 'mockServerPort',
      [`${this.environmentPrefix}APP_TIMEOUT`]: 'appTimeout',
      [`${this.environmentPrefix}CLEANUP_TIMEOUT`]: 'cleanupTimeout'
    };

    for (const [envVar, configKey] of Object.entries(envMappings)) {
      const envValue = process.env[envVar];
      if (envValue !== undefined) {
        // Type conversion based on config key
        if (configKey === 'tempDirPrefix') {
          (envConfig as any)[configKey] = envValue;
        } else if (['mockServerPort', 'appTimeout', 'cleanupTimeout'].includes(configKey)) {
          const numValue = parseInt(envValue, 10);
          if (!isNaN(numValue)) {
            (envConfig as any)[configKey] = numValue;
          }
        }
      }
    }

    return envConfig;
  }

  /**
   * Validates configuration against schema and business rules
   * Requirements: 8.5 - Configuration validation and defaults
   */
  validateConfig(config: TestConfig): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Validate tempDirPrefix
    if (config.tempDirPrefix !== undefined) {
      if (typeof config.tempDirPrefix !== 'string') {
        errors.push('tempDirPrefix must be a string');
      } else if (config.tempDirPrefix.length === 0) {
        errors.push('tempDirPrefix cannot be empty');
      } else if (!/^[a-zA-Z0-9_-]+$/.test(config.tempDirPrefix)) {
        errors.push('tempDirPrefix can only contain alphanumeric characters, underscores, and hyphens');
      }
    }

    // Validate mockServerPort
    if (config.mockServerPort !== undefined) {
      if (typeof config.mockServerPort !== 'number') {
        errors.push('mockServerPort must be a number');
      } else if (config.mockServerPort < 1024 || config.mockServerPort > 65535) {
        errors.push('mockServerPort must be between 1024 and 65535');
      }
    }

    // Validate timeouts
    if (config.appTimeout !== undefined) {
      if (typeof config.appTimeout !== 'number') {
        errors.push('appTimeout must be a number');
      } else {
        if (config.appTimeout < 100) {
          errors.push('appTimeout must be at least 100ms');
        } else if (config.appTimeout < 1000) {
          warnings.push('appTimeout less than 1000ms may cause test instability');
        } else if (config.appTimeout > 60000) {
          warnings.push('appTimeout greater than 60000ms may cause slow tests');
        }
      }
    }

    if (config.cleanupTimeout !== undefined) {
      if (typeof config.cleanupTimeout !== 'number') {
        errors.push('cleanupTimeout must be a number');
      } else {
        if (config.cleanupTimeout < 100) {
          errors.push('cleanupTimeout must be at least 100ms');
        } else if (config.cleanupTimeout < 1000) {
          warnings.push('cleanupTimeout less than 1000ms may cause incomplete cleanup');
        }
      }
    }

    // Validate mockResponses
    if (config.mockResponses !== undefined) {
      if (!Array.isArray(config.mockResponses)) {
        errors.push('mockResponses must be an array');
      } else {
        for (let i = 0; i < config.mockResponses.length; i++) {
          const response = config.mockResponses[i];
          if (!response.endpoint) {
            errors.push(`mockResponses[${i}].endpoint is required`);
          }
          if (!response.response) {
            errors.push(`mockResponses[${i}].response is required`);
          } else {
            if (!['fixed', 'streaming', 'error'].includes(response.response.type)) {
              errors.push(`mockResponses[${i}].response.type must be 'fixed', 'streaming', or 'error'`);
            }
            if (!response.response.content) {
              errors.push(`mockResponses[${i}].response.content is required`);
            }
          }
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Returns the default configuration
   * Requirements: 8.5 - Configuration validation and defaults
   */
  getDefaultConfig(): TestConfig {
    return {
      tempDirPrefix: 'ei-e2e-test',
      mockServerPort: undefined, // Will auto-find available port
      appTimeout: 10000, // 10 seconds
      cleanupTimeout: 5000, // 5 seconds
      mockResponses: []
    };
  }

  /**
   * Normalizes partial configuration by applying defaults
   * Requirements: 8.5 - Configuration validation and defaults
   */
  normalizeConfig(config: Partial<TestConfig>): TestConfig {
    const defaultConfig = this.getDefaultConfig();
    const normalized = this.mergeConfigs(defaultConfig, config);
    
    // Apply environment overrides
    return this.applyEnvironmentOverrides(normalized);
  }

  // Private helper methods

  private buildConfigSchema(): ConfigSchema {
    return {
      tempDirPrefix: {
        type: 'string',
        required: false,
        pattern: /^[a-zA-Z0-9_-]+$/,
        description: 'Prefix for temporary test directories'
      },
      mockServerPort: {
        type: 'number',
        required: false,
        min: 1024,
        max: 65535,
        description: 'Port for mock LLM server'
      },
      appTimeout: {
        type: 'number',
        required: false,
        min: 1000,
        max: 300000,
        description: 'Timeout for application startup in milliseconds'
      },
      cleanupTimeout: {
        type: 'number',
        required: false,
        min: 1000,
        max: 60000,
        description: 'Timeout for cleanup operations in milliseconds'
      },
      mockResponses: {
        type: 'array',
        required: false,
        description: 'Array of mock response configurations'
      }
    };
  }

  private parseJsonWithComments(content: string): any {
    // Simple JSONC parser - removes // comments and /* */ comments
    const withoutComments = content
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove /* */ comments
      .replace(/\/\/.*$/gm, ''); // Remove // comments
    
    try {
      return JSON.parse(withoutComments);
    } catch (error) {
      throw new Error(`Invalid JSON: ${error}`);
    }
  }

  private generateConfigWithComments(config: TestConfig): string {
    const lines: string[] = [];
    
    lines.push('{');
    lines.push('  // E2E Test Configuration');
    lines.push('  // This file configures the E2E testing framework behavior');
    lines.push('');
    
    if (config.tempDirPrefix !== undefined) {
      lines.push('  // Prefix for temporary test directories');
      lines.push(`  "tempDirPrefix": ${JSON.stringify(config.tempDirPrefix)},`);
      lines.push('');
    }
    
    if (config.mockServerPort !== undefined) {
      lines.push('  // Port for mock LLM server (leave undefined to auto-find)');
      lines.push(`  "mockServerPort": ${config.mockServerPort},`);
      lines.push('');
    }
    
    if (config.appTimeout !== undefined) {
      lines.push('  // Timeout for application startup in milliseconds');
      lines.push(`  "appTimeout": ${config.appTimeout},`);
      lines.push('');
    }
    
    if (config.cleanupTimeout !== undefined) {
      lines.push('  // Timeout for cleanup operations in milliseconds');
      lines.push(`  "cleanupTimeout": ${config.cleanupTimeout},`);
      lines.push('');
    }
    
    if (config.mockResponses && config.mockResponses.length > 0) {
      lines.push('  // Mock response configurations');
      lines.push('  "mockResponses": [');
      
      for (let i = 0; i < config.mockResponses.length; i++) {
        const response = config.mockResponses[i];
        const isLast = i === config.mockResponses.length - 1;
        
        lines.push('    {');
        lines.push(`      "endpoint": ${JSON.stringify(response.endpoint)},`);
        lines.push('      "response": {');
        lines.push(`        "type": ${JSON.stringify(response.response.type)},`);
        lines.push(`        "content": ${JSON.stringify(response.response.content)}`);
        
        if (response.response.delayMs !== undefined) {
          lines.push(',');
          lines.push(`        "delayMs": ${response.response.delayMs}`);
        }
        
        if (response.response.statusCode !== undefined) {
          lines.push(',');
          lines.push(`        "statusCode": ${response.response.statusCode}`);
        }
        
        lines.push('      }');
        lines.push(`    }${isLast ? '' : ','}`);
      }
      
      lines.push('  ]');
    }
    
    // Remove trailing comma from last property
    const lastLineIndex = lines.length - 1;
    if (lines[lastLineIndex].endsWith(',')) {
      lines[lastLineIndex] = lines[lastLineIndex].slice(0, -1);
    }
    
    lines.push('}');
    
    return lines.join('\n');
  }
}

// Factory function for creating config manager instances
export function createConfigManager(): E2EConfigManager {
  return new E2EConfigManagerImpl();
}

// Utility functions for common configuration operations
export function loadConfigFromFile(configPath: string): Promise<TestConfig> {
  const manager = createConfigManager();
  return manager.loadFromFile(configPath);
}

export function createDefaultConfig(overrides?: Partial<TestConfig>): TestConfig {
  const manager = createConfigManager();
  return manager.createConfig(overrides);
}

export function validateConfiguration(config: TestConfig): ValidationResult {
  const manager = createConfigManager();
  return manager.validateConfig(config);
}
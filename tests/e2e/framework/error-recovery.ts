// Error Handling and Recovery Mechanisms
// Implements graceful error handling, retry logic, and emergency cleanup

import { ErrorRecovery, TestResource } from '../types.js';

/**
 * Error recovery implementation with exponential backoff and emergency cleanup
 * Requirements: 6.4, 7.2 - Graceful error handling and detailed error reporting
 */
export class ErrorRecoveryImpl implements ErrorRecovery {
  private resources: TestResource[] = [];
  private retryAttempts: Map<string, number> = new Map();
  private maxRetries: number = 3;
  private baseDelayMs: number = 1000;
  private maxDelayMs: number = 30000;

  /**
   * Registers a resource for potential cleanup
   * Requirements: 6.4 - Emergency cleanup procedures
   */
  registerResource(resource: TestResource): void {
    this.resources.push(resource);
  }

  /**
   * Unregisters a resource (when it's been cleaned up normally)
   */
  unregisterResource(identifier: string): void {
    this.resources = this.resources.filter(r => r.identifier !== identifier);
  }

  /**
   * Retries an operation with exponential backoff
   * Requirements: 6.4 - Automatic retry logic with exponential backoff
   */
  async retryWithBackoff<T>(
    operation: () => Promise<T>,
    maxRetries: number = this.maxRetries,
    operationId?: string
  ): Promise<T> {
    const id = operationId || `operation_${Date.now()}`;
    let attempt = this.retryAttempts.get(id) || 0;
    
    while (attempt < maxRetries) {
      try {
        const result = await operation();
        // Success - clear retry count
        this.retryAttempts.delete(id);
        return result;
      } catch (error) {
        attempt++;
        this.retryAttempts.set(id, attempt);
        
        if (attempt >= maxRetries) {
          // Max retries exceeded
          this.retryAttempts.delete(id);
          throw new RetryExhaustedError(
            `Operation failed after ${maxRetries} attempts: ${error}`,
            error instanceof Error ? error : new Error(String(error)),
            attempt
          );
        }
        
        // Calculate delay with exponential backoff and jitter
        const delay = Math.min(
          this.baseDelayMs * Math.pow(2, attempt - 1),
          this.maxDelayMs
        );
        const jitter = Math.random() * 0.1 * delay; // Add up to 10% jitter
        const totalDelay = delay + jitter;
        
        console.warn(`Operation attempt ${attempt} failed, retrying in ${Math.round(totalDelay)}ms: ${error}`);
        await this.sleep(totalDelay);
      }
    }
    
    // This should never be reached due to the throw above, but TypeScript needs it
    throw new Error('Unexpected retry loop exit');
  }

  /**
   * Handles non-critical failures gracefully
   * Requirements: 6.4 - Graceful error handling for test failures
   */
  gracefulDegrade(error: Error, fallbackAction: () => void): void {
    console.warn(`Graceful degradation triggered: ${error.message}`);
    
    try {
      fallbackAction();
      console.info('Fallback action completed successfully');
    } catch (fallbackError) {
      console.error(`Fallback action also failed: ${fallbackError}`);
      // Don't throw - this is graceful degradation
    }
  }

  /**
   * Performs emergency cleanup of all registered resources
   * Requirements: 6.4 - Emergency cleanup procedures
   */
  async emergencyCleanup(resources?: TestResource[]): Promise<void> {
    const resourcesToClean = resources || this.resources;
    const errors: Error[] = [];
    
    console.warn(`Starting emergency cleanup of ${resourcesToClean.length} resources`);
    
    // Group resources by type for optimal cleanup order
    const resourceGroups = this.groupResourcesByType(resourcesToClean);
    
    // Clean up in order: processes first, then servers, then files, then directories
    const cleanupOrder = ['process', 'server', 'file', 'directory'];
    
    for (const resourceType of cleanupOrder) {
      const resourcesOfType = resourceGroups.get(resourceType) || [];
      
      if (resourcesOfType.length > 0) {
        console.info(`Cleaning up ${resourcesOfType.length} ${resourceType} resources`);
        
        // Clean up resources of this type in parallel for speed
        const cleanupPromises = resourcesOfType.map(async (resource) => {
          try {
            await this.cleanupResourceWithTimeout(resource);
            console.debug(`Successfully cleaned up ${resource.type}: ${resource.identifier}`);
          } catch (error) {
            const cleanupError = new Error(
              `Failed to cleanup ${resource.type} "${resource.identifier}": ${error}`
            );
            errors.push(cleanupError);
            console.error(cleanupError.message);
          }
        });
        
        await Promise.allSettled(cleanupPromises);
      }
    }
    
    // Clear the resources list
    this.resources = [];
    
    // Report cleanup results
    if (errors.length > 0) {
      const errorSummary = errors.map(e => e.message).join('; ');
      throw new EmergencyCleanupError(
        `Emergency cleanup completed with ${errors.length} errors: ${errorSummary}`,
        errors
      );
    } else {
      console.info('Emergency cleanup completed successfully');
    }
  }

  /**
   * Creates a detailed error report for diagnostics
   * Requirements: 7.2 - Detailed error reporting and diagnostics
   */
  createErrorReport(error: Error, context: ErrorContext): ErrorReport {
    const report: ErrorReport = {
      timestamp: new Date().toISOString(),
      errorType: error.constructor.name,
      message: error.message,
      stack: error.stack || 'No stack trace available',
      context: {
        operation: context.operation,
        phase: context.phase,
        resources: context.resources || [],
        environment: this.captureEnvironmentInfo(),
        retryAttempts: Object.fromEntries(this.retryAttempts),
        registeredResources: this.resources.map(r => ({
          type: r.type,
          identifier: r.identifier
        }))
      },
      suggestions: this.generateErrorSuggestions(error, context),
      severity: this.assessErrorSeverity(error, context)
    };
    
    return report;
  }

  /**
   * Handles test failure scenarios with appropriate recovery actions
   * Requirements: 6.4 - Graceful error handling for test failures
   */
  async handleTestFailure(
    error: Error,
    context: ErrorContext,
    recoveryOptions: RecoveryOptions = {}
  ): Promise<TestFailureResult> {
    const startTime = Date.now();
    const errorReport = this.createErrorReport(error, context);
    
    console.error(`Test failure detected: ${error.message}`);
    console.info(`Error report: ${JSON.stringify(errorReport, null, 2)}`);
    
    const result: TestFailureResult = {
      originalError: error,
      errorReport,
      recoveryAttempted: false,
      recoverySuccessful: false,
      cleanupPerformed: false,
      duration: 0,
      finalState: 'failed'
    };
    
    try {
      // Attempt recovery if enabled
      if (recoveryOptions.attemptRecovery !== false) {
        result.recoveryAttempted = true;
        
        if (recoveryOptions.retryOperation && context.retryableOperation) {
          console.info('Attempting operation retry...');
          try {
            await this.retryWithBackoff(
              context.retryableOperation,
              recoveryOptions.maxRetries || 2,
              context.operation
            );
            result.recoverySuccessful = true;
            result.finalState = 'recovered';
            console.info('Recovery successful through retry');
          } catch (retryError) {
            console.warn(`Recovery retry failed: ${retryError}`);
          }
        }
        
        // If retry didn't work, try graceful degradation
        if (!result.recoverySuccessful && recoveryOptions.fallbackAction) {
          console.info('Attempting graceful degradation...');
          this.gracefulDegrade(error, recoveryOptions.fallbackAction);
          result.recoverySuccessful = true;
          result.finalState = 'degraded';
        }
      }
      
      // Perform cleanup if requested
      if (recoveryOptions.performCleanup !== false) {
        console.info('Performing cleanup after test failure...');
        await this.emergencyCleanup(context.resources);
        result.cleanupPerformed = true;
      }
      
    } catch (recoveryError) {
      console.error(`Recovery process failed: ${recoveryError}`);
      result.finalState = 'recovery_failed';
    } finally {
      result.duration = Date.now() - startTime;
    }
    
    return result;
  }

  // Private helper methods

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private groupResourcesByType(resources: TestResource[]): Map<string, TestResource[]> {
    const groups = new Map<string, TestResource[]>();
    
    for (const resource of resources) {
      const existing = groups.get(resource.type) || [];
      existing.push(resource);
      groups.set(resource.type, existing);
    }
    
    return groups;
  }

  private async cleanupResourceWithTimeout(resource: TestResource, timeoutMs: number = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeoutHandle = setTimeout(() => {
        reject(new Error(`Cleanup timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      
      resource.cleanup()
        .then(() => {
          clearTimeout(timeoutHandle);
          resolve();
        })
        .catch((error) => {
          clearTimeout(timeoutHandle);
          reject(error);
        });
    });
  }

  private captureEnvironmentInfo(): Record<string, any> {
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
      cwd: process.cwd(),
      env: {
        NODE_ENV: process.env.NODE_ENV,
        EI_DATA_PATH: process.env.EI_DATA_PATH,
        EI_LLM_BASE_URL: process.env.EI_LLM_BASE_URL
      }
    };
  }

  private generateErrorSuggestions(error: Error, context: ErrorContext): string[] {
    const suggestions: string[] = [];
    
    // Common error patterns and suggestions
    if (error.message.includes('timeout')) {
      suggestions.push('Consider increasing timeout values');
      suggestions.push('Check if the application is responding correctly');
      suggestions.push('Verify network connectivity if using remote services');
    }
    
    if (error.message.includes('ENOENT') || error.message.includes('file not found')) {
      suggestions.push('Verify file paths are correct');
      suggestions.push('Check if required files were created during setup');
      suggestions.push('Ensure proper cleanup from previous test runs');
    }
    
    if (error.message.includes('EADDRINUSE') || error.message.includes('port')) {
      suggestions.push('Check if another process is using the port');
      suggestions.push('Try using a different port number');
      suggestions.push('Ensure proper cleanup of previous test servers');
    }
    
    if (error.message.includes('spawn') || error.message.includes('process')) {
      suggestions.push('Verify the application executable exists');
      suggestions.push('Check file permissions');
      suggestions.push('Ensure all dependencies are installed');
    }
    
    if (context.phase === 'setup') {
      suggestions.push('Review test setup configuration');
      suggestions.push('Check if all required resources are available');
    }
    
    if (context.phase === 'execution') {
      suggestions.push('Review test step configuration');
      suggestions.push('Check application logs for additional context');
    }
    
    if (context.phase === 'cleanup') {
      suggestions.push('Some resources may require manual cleanup');
      suggestions.push('Check for hanging processes or locked files');
    }
    
    return suggestions;
  }

  private assessErrorSeverity(error: Error, context: ErrorContext): 'low' | 'medium' | 'high' | 'critical' {
    // Critical errors that indicate system-level problems
    if (error.message.includes('EMFILE') || error.message.includes('ENOMEM')) {
      return 'critical';
    }
    
    // High severity for setup/cleanup failures
    if (context.phase === 'setup' || context.phase === 'cleanup') {
      return 'high';
    }
    
    // High severity for process/server failures
    if (error.message.includes('spawn') || error.message.includes('server')) {
      return 'high';
    }
    
    // Medium severity for timeout/assertion failures
    if (error.message.includes('timeout') || error.message.includes('assertion')) {
      return 'medium';
    }
    
    // Default to medium severity
    return 'medium';
  }
}

// Custom error classes for better error handling

export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    public readonly originalError: Error,
    public readonly attempts: number
  ) {
    super(message);
    this.name = 'RetryExhaustedError';
  }
}

export class EmergencyCleanupError extends Error {
  constructor(
    message: string,
    public readonly cleanupErrors: Error[]
  ) {
    super(message);
    this.name = 'EmergencyCleanupError';
  }
}

// Supporting interfaces

export interface ErrorContext {
  operation: string;
  phase: 'setup' | 'execution' | 'cleanup' | 'assertion';
  resources?: TestResource[];
  retryableOperation?: () => Promise<any>;
}

export interface RecoveryOptions {
  attemptRecovery?: boolean;
  retryOperation?: boolean;
  maxRetries?: number;
  performCleanup?: boolean;
  fallbackAction?: () => void;
}

export interface ErrorReport {
  timestamp: string;
  errorType: string;
  message: string;
  stack: string;
  context: {
    operation: string;
    phase: string;
    resources: TestResource[];
    environment: Record<string, any>;
    retryAttempts: Record<string, number>;
    registeredResources: Array<{ type: string; identifier: string }>;
  };
  suggestions: string[];
  severity: 'low' | 'medium' | 'high' | 'critical';
}

export interface TestFailureResult {
  originalError: Error;
  errorReport: ErrorReport;
  recoveryAttempted: boolean;
  recoverySuccessful: boolean;
  cleanupPerformed: boolean;
  duration: number;
  finalState: 'failed' | 'recovered' | 'degraded' | 'recovery_failed';
}
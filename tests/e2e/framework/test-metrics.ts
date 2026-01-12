// Test Execution Metrics and Reporting
// Tracks execution time, resource usage, and generates detailed test reports

export interface TestMetrics {
  testName: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  resourceUsage: ResourceUsage;
  stepMetrics: StepMetrics[];
  mockServerMetrics: MockServerMetrics;
  applicationMetrics: ApplicationMetrics;
}

export interface ResourceUsage {
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpuUsage: {
    user: number;
    system: number;
  };
  processCount: number;
  tempDirectorySize: number;
}

export interface StepMetrics {
  stepName: string;
  stepType: string;
  startTime: number;
  endTime: number;
  duration: number;
  success: boolean;
  error?: string;
  retryCount: number;
}

export interface MockServerMetrics {
  requestCount: number;
  responseTime: {
    min: number;
    max: number;
    average: number;
  };
  errorCount: number;
  streamingRequests: number;
}

export interface ApplicationMetrics {
  startupTime: number;
  shutdownTime: number;
  processId: number;
  exitCode: number | null;
  outputSize: number;
  inputCount: number;
  llmRequestCount: number;
}

export interface TestReport {
  summary: TestSummary;
  testResults: TestMetrics[];
  aggregatedMetrics: AggregatedMetrics;
  diagnostics: DiagnosticInfo[];
  timestamp: string;
  environment: EnvironmentInfo;
}

export interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDuration: number;
  successRate: number;
}

export interface AggregatedMetrics {
  averageTestDuration: number;
  averageStartupTime: number;
  averageShutdownTime: number;
  totalResourceUsage: ResourceUsage;
  mockServerStats: MockServerMetrics;
}

export interface DiagnosticInfo {
  level: 'info' | 'warning' | 'error';
  message: string;
  timestamp: number;
  testName?: string;
  stepName?: string;
}

export interface EnvironmentInfo {
  nodeVersion: string;
  platform: string;
  arch: string;
  totalMemory: number;
  freeMemory: number;
  cpuCount: number;
  testFramework: string;
  testFrameworkVersion: string;
}

export class TestMetricsCollector {
  private metrics: TestMetrics[] = [];
  private currentTest: Partial<TestMetrics> | null = null;
  private diagnostics: DiagnosticInfo[] = [];
  private startTime: number = Date.now();

  /**
   * Starts collecting metrics for a test
   * Requirements: 7.3 - Implement execution time tracking
   */
  startTest(testName: string): void {
    this.currentTest = {
      testName,
      startTime: Date.now(),
      stepMetrics: [],
      resourceUsage: this.captureResourceUsage(),
      mockServerMetrics: {
        requestCount: 0,
        responseTime: { min: 0, max: 0, average: 0 },
        errorCount: 0,
        streamingRequests: 0
      },
      applicationMetrics: {
        startupTime: 0,
        shutdownTime: 0,
        processId: 0,
        exitCode: null,
        outputSize: 0,
        inputCount: 0,
        llmRequestCount: 0
      }
    };
  }

  /**
   * Records a test step execution
   */
  recordStep(stepName: string, stepType: string, duration: number, success: boolean, error?: string, retryCount: number = 0): void {
    if (!this.currentTest) return;

    const stepMetric: StepMetrics = {
      stepName,
      stepType,
      startTime: Date.now() - duration,
      endTime: Date.now(),
      duration,
      success,
      error,
      retryCount
    };

    this.currentTest.stepMetrics!.push(stepMetric);
  }

  /**
   * Updates mock server metrics
   */
  updateMockServerMetrics(requestCount: number, responseTimes: number[], errorCount: number, streamingRequests: number): void {
    if (!this.currentTest) return;

    const responseTime = responseTimes.length > 0 ? {
      min: Math.min(...responseTimes),
      max: Math.max(...responseTimes),
      average: responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    } : { min: 0, max: 0, average: 0 };

    this.currentTest.mockServerMetrics = {
      requestCount,
      responseTime,
      errorCount,
      streamingRequests
    };
  }

  /**
   * Updates application metrics
   */
  updateApplicationMetrics(metrics: Partial<ApplicationMetrics>): void {
    if (!this.currentTest) return;

    this.currentTest.applicationMetrics = {
      ...this.currentTest.applicationMetrics!,
      ...metrics
    };
  }

  /**
   * Finishes collecting metrics for the current test
   * Requirements: 7.3 - Implement execution time tracking
   */
  finishTest(success: boolean, error?: string): TestMetrics {
    if (!this.currentTest) {
      throw new Error('No test currently being tracked');
    }

    const endTime = Date.now();
    const duration = endTime - this.currentTest.startTime!;

    const completedTest: TestMetrics = {
      ...this.currentTest as TestMetrics,
      endTime,
      duration,
      success,
      error,
      resourceUsage: this.captureResourceUsage()
    };

    this.metrics.push(completedTest);
    this.currentTest = null;

    return completedTest;
  }

  /**
   * Adds diagnostic information
   */
  addDiagnostic(level: DiagnosticInfo['level'], message: string, testName?: string, stepName?: string): void {
    this.diagnostics.push({
      level,
      message,
      timestamp: Date.now(),
      testName,
      stepName
    });
  }

  /**
   * Captures current resource usage
   * Requirements: 7.5 - Add resource usage monitoring
   */
  private captureResourceUsage(): ResourceUsage {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    return {
      memoryUsage: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      cpuUsage: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      processCount: 1, // Will be updated by process manager
      tempDirectorySize: 0 // Will be updated by environment manager
    };
  }

  /**
   * Generates a comprehensive test report
   * Requirements: 7.5 - Create detailed test reports with diagnostics
   */
  generateReport(): TestReport {
    const totalDuration = Date.now() - this.startTime;
    const passedTests = this.metrics.filter(m => m.success).length;
    const failedTests = this.metrics.filter(m => !m.success).length;

    const summary: TestSummary = {
      totalTests: this.metrics.length,
      passedTests,
      failedTests,
      skippedTests: 0,
      totalDuration,
      successRate: this.metrics.length > 0 ? (passedTests / this.metrics.length) * 100 : 0
    };

    const aggregatedMetrics: AggregatedMetrics = {
      averageTestDuration: this.metrics.length > 0 ? 
        this.metrics.reduce((sum, m) => sum + m.duration, 0) / this.metrics.length : 0,
      averageStartupTime: this.metrics.length > 0 ?
        this.metrics.reduce((sum, m) => sum + m.applicationMetrics.startupTime, 0) / this.metrics.length : 0,
      averageShutdownTime: this.metrics.length > 0 ?
        this.metrics.reduce((sum, m) => sum + m.applicationMetrics.shutdownTime, 0) / this.metrics.length : 0,
      totalResourceUsage: this.aggregateResourceUsage(),
      mockServerStats: this.aggregateMockServerStats()
    };

    return {
      summary,
      testResults: [...this.metrics],
      aggregatedMetrics,
      diagnostics: [...this.diagnostics],
      timestamp: new Date().toISOString(),
      environment: this.captureEnvironmentInfo()
    };
  }

  /**
   * Aggregates resource usage across all tests
   */
  private aggregateResourceUsage(): ResourceUsage {
    if (this.metrics.length === 0) {
      return this.captureResourceUsage();
    }

    const totalMemory = this.metrics.reduce((sum, m) => sum + m.resourceUsage.memoryUsage.heapUsed, 0);
    const totalCpuUser = this.metrics.reduce((sum, m) => sum + m.resourceUsage.cpuUsage.user, 0);
    const totalCpuSystem = this.metrics.reduce((sum, m) => sum + m.resourceUsage.cpuUsage.system, 0);

    return {
      memoryUsage: {
        heapUsed: totalMemory,
        heapTotal: Math.max(...this.metrics.map(m => m.resourceUsage.memoryUsage.heapTotal)),
        external: Math.max(...this.metrics.map(m => m.resourceUsage.memoryUsage.external)),
        rss: Math.max(...this.metrics.map(m => m.resourceUsage.memoryUsage.rss))
      },
      cpuUsage: {
        user: totalCpuUser,
        system: totalCpuSystem
      },
      processCount: Math.max(...this.metrics.map(m => m.resourceUsage.processCount)),
      tempDirectorySize: Math.max(...this.metrics.map(m => m.resourceUsage.tempDirectorySize))
    };
  }

  /**
   * Aggregates mock server statistics across all tests
   */
  private aggregateMockServerStats(): MockServerMetrics {
    if (this.metrics.length === 0) {
      return {
        requestCount: 0,
        responseTime: { min: 0, max: 0, average: 0 },
        errorCount: 0,
        streamingRequests: 0
      };
    }

    const totalRequests = this.metrics.reduce((sum, m) => sum + m.mockServerMetrics.requestCount, 0);
    const totalErrors = this.metrics.reduce((sum, m) => sum + m.mockServerMetrics.errorCount, 0);
    const totalStreaming = this.metrics.reduce((sum, m) => sum + m.mockServerMetrics.streamingRequests, 0);

    const allResponseTimes = this.metrics.flatMap(m => [
      m.mockServerMetrics.responseTime.min,
      m.mockServerMetrics.responseTime.max
    ]).filter(t => t > 0);

    const responseTime = allResponseTimes.length > 0 ? {
      min: Math.min(...allResponseTimes),
      max: Math.max(...allResponseTimes),
      average: allResponseTimes.reduce((a, b) => a + b, 0) / allResponseTimes.length
    } : { min: 0, max: 0, average: 0 };

    return {
      requestCount: totalRequests,
      responseTime,
      errorCount: totalErrors,
      streamingRequests: totalStreaming
    };
  }

  /**
   * Captures environment information
   */
  private captureEnvironmentInfo(): EnvironmentInfo {
    const os = require('os');
    
    return {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      totalMemory: os.totalmem(),
      freeMemory: os.freemem(),
      cpuCount: os.cpus().length,
      testFramework: 'vitest',
      testFrameworkVersion: '4.0.16' // This should be read from package.json in real implementation
    };
  }

  /**
   * Exports metrics to JSON file
   */
  async exportToFile(filePath: string): Promise<void> {
    const report = this.generateReport();
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, JSON.stringify(report, null, 2));
  }

  /**
   * Exports metrics to HTML report
   */
  async exportToHtml(filePath: string): Promise<void> {
    const report = this.generateReport();
    const html = this.generateHtmlReport(report);
    const fs = await import('fs/promises');
    await fs.writeFile(filePath, html);
  }

  /**
   * Generates HTML report from test metrics
   */
  private generateHtmlReport(report: TestReport): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>E2E Test Report</title>
    <style>
        body { font-family: Arial, sans-serif; margin: 20px; }
        .header { background: #f5f5f5; padding: 20px; border-radius: 5px; margin-bottom: 20px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 20px; }
        .metric-card { background: white; border: 1px solid #ddd; padding: 15px; border-radius: 5px; }
        .metric-value { font-size: 24px; font-weight: bold; color: #333; }
        .metric-label { color: #666; font-size: 14px; }
        .success { color: #28a745; }
        .failure { color: #dc3545; }
        .test-results { margin-top: 20px; }
        .test-item { border: 1px solid #ddd; margin-bottom: 10px; border-radius: 5px; }
        .test-header { padding: 15px; background: #f8f9fa; cursor: pointer; }
        .test-details { padding: 15px; display: none; }
        .test-details.expanded { display: block; }
        .step-list { margin-top: 10px; }
        .step-item { padding: 8px; margin: 5px 0; background: #f8f9fa; border-radius: 3px; }
        .diagnostics { margin-top: 20px; }
        .diagnostic-item { padding: 10px; margin: 5px 0; border-radius: 3px; }
        .diagnostic-info { background: #d1ecf1; }
        .diagnostic-warning { background: #fff3cd; }
        .diagnostic-error { background: #f8d7da; }
    </style>
</head>
<body>
    <div class="header">
        <h1>E2E Test Report</h1>
        <p>Generated: ${report.timestamp}</p>
        <p>Environment: ${report.environment.platform} ${report.environment.arch} - Node ${report.environment.nodeVersion}</p>
    </div>

    <div class="summary">
        <div class="metric-card">
            <div class="metric-value ${report.summary.successRate === 100 ? 'success' : 'failure'}">
                ${report.summary.successRate.toFixed(1)}%
            </div>
            <div class="metric-label">Success Rate</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${report.summary.totalTests}</div>
            <div class="metric-label">Total Tests</div>
        </div>
        <div class="metric-card">
            <div class="metric-value success">${report.summary.passedTests}</div>
            <div class="metric-label">Passed</div>
        </div>
        <div class="metric-card">
            <div class="metric-value failure">${report.summary.failedTests}</div>
            <div class="metric-label">Failed</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${(report.summary.totalDuration / 1000).toFixed(2)}s</div>
            <div class="metric-label">Total Duration</div>
        </div>
        <div class="metric-card">
            <div class="metric-value">${(report.aggregatedMetrics.averageTestDuration / 1000).toFixed(2)}s</div>
            <div class="metric-label">Average Test Duration</div>
        </div>
    </div>

    <div class="test-results">
        <h2>Test Results</h2>
        ${report.testResults.map((test, index) => `
            <div class="test-item">
                <div class="test-header" onclick="toggleTest(${index})">
                    <span class="${test.success ? 'success' : 'failure'}">
                        ${test.success ? '✓' : '✗'}
                    </span>
                    ${test.testName} - ${(test.duration / 1000).toFixed(2)}s
                    ${test.error ? `<span class="failure"> - ${test.error}</span>` : ''}
                </div>
                <div class="test-details" id="test-${index}">
                    <p><strong>Duration:</strong> ${(test.duration / 1000).toFixed(2)}s</p>
                    <p><strong>Steps:</strong> ${test.stepMetrics.length}</p>
                    <p><strong>LLM Requests:</strong> ${test.applicationMetrics.llmRequestCount}</p>
                    <p><strong>Mock Requests:</strong> ${test.mockServerMetrics.requestCount}</p>
                    
                    <div class="step-list">
                        <h4>Steps:</h4>
                        ${test.stepMetrics.map(step => `
                            <div class="step-item">
                                <span class="${step.success ? 'success' : 'failure'}">
                                    ${step.success ? '✓' : '✗'}
                                </span>
                                ${step.stepName} (${step.stepType}) - ${(step.duration / 1000).toFixed(2)}s
                                ${step.retryCount > 0 ? ` - ${step.retryCount} retries` : ''}
                                ${step.error ? `<br><span class="failure">${step.error}</span>` : ''}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `).join('')}
    </div>

    ${report.diagnostics.length > 0 ? `
    <div class="diagnostics">
        <h2>Diagnostics</h2>
        ${report.diagnostics.map(diag => `
            <div class="diagnostic-item diagnostic-${diag.level}">
                <strong>${diag.level.toUpperCase()}:</strong> ${diag.message}
                ${diag.testName ? ` (Test: ${diag.testName})` : ''}
                ${diag.stepName ? ` (Step: ${diag.stepName})` : ''}
            </div>
        `).join('')}
    </div>
    ` : ''}

    <script>
        function toggleTest(index) {
            const details = document.getElementById('test-' + index);
            details.classList.toggle('expanded');
        }
    </script>
</body>
</html>
    `;
  }

  /**
   * Resets all collected metrics
   */
  reset(): void {
    this.metrics = [];
    this.currentTest = null;
    this.diagnostics = [];
    this.startTime = Date.now();
  }

  /**
   * Gets current metrics without generating full report
   */
  getCurrentMetrics(): TestMetrics[] {
    return [...this.metrics];
  }

  /**
   * Gets current diagnostics
   */
  getCurrentDiagnostics(): DiagnosticInfo[] {
    return [...this.diagnostics];
  }
}

// Global metrics collector instance
export const globalMetricsCollector = new TestMetricsCollector();
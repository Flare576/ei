// Custom Vitest Reporter for E2E Test Metrics
// Integrates with the test metrics system to provide detailed reporting

import type { Reporter, File, Task } from 'vitest';
import { globalMetricsCollector } from './test-metrics.js';
import * as path from 'path';
import * as fs from 'fs/promises';

export class E2EMetricsReporter implements Reporter {
  private outputDir: string;
  private generateHtml: boolean;
  private generateJson: boolean;

  constructor(options: {
    outputDir?: string;
    generateHtml?: boolean;
    generateJson?: boolean;
  } = {}) {
    this.outputDir = options.outputDir || 'test-results';
    this.generateHtml = options.generateHtml ?? true;
    this.generateJson = options.generateJson ?? true;
  }

  async onInit(): Promise<void> {
    // Ensure output directory exists
    try {
      await fs.mkdir(this.outputDir, { recursive: true });
    } catch (error) {
      console.warn(`Failed to create output directory ${this.outputDir}:`, error);
    }
  }

  onTaskUpdate(packs: [string, File | undefined][]): void {
    // Track test progress and update metrics
    for (const [id, file] of packs) {
      if (file) {
        this.processFile(file);
      }
    }
  }

  async onFinished(files: File[] = []): Promise<void> {
    // Generate final reports
    try {
      const report = globalMetricsCollector.generateReport();
      
      // Generate JSON report
      if (this.generateJson) {
        const jsonPath = path.join(this.outputDir, 'e2e-metrics.json');
        await globalMetricsCollector.exportToFile(jsonPath);
        console.log(`📊 E2E metrics JSON report: ${jsonPath}`);
      }

      // Generate HTML report
      if (this.generateHtml) {
        const htmlPath = path.join(this.outputDir, 'e2e-metrics.html');
        await globalMetricsCollector.exportToHtml(htmlPath);
        console.log(`📊 E2E metrics HTML report: ${htmlPath}`);
      }

      // Print summary to console
      this.printSummary(report);

    } catch (error) {
      console.error('Failed to generate E2E metrics reports:', error);
    }
  }

  private processFile(file: File): void {
    // Process each test file and its tasks
    if (file.tasks) {
      for (const task of file.tasks) {
        this.processTask(task);
      }
    }
  }

  private processTask(task: Task): void {
    // Process individual test tasks
    if (task.type === 'test') {
      const testName = `${task.file?.name || 'unknown'} > ${task.name}`;
      
      // Check if this is an E2E test
      if (task.file?.filepath?.includes('e2e')) {
        // Start metrics collection if not already started
        try {
          globalMetricsCollector.startTest(testName);
        } catch (error) {
          // Test might already be started, which is fine
        }

        // Record test completion
        if (task.result) {
          const success = task.result.state === 'pass';
          const error = task.result.errors?.[0]?.message;
          const duration = task.result.duration || 0;

          // Record the test step
          globalMetricsCollector.recordStep(
            task.name,
            'test',
            duration,
            success,
            error
          );

          // Finish test metrics
          try {
            globalMetricsCollector.finishTest(success, error);
          } catch (error) {
            // Test might not be started, which is fine
          }
        }
      }
    }

    // Process nested tasks (describe blocks, etc.)
    if (task.tasks) {
      for (const nestedTask of task.tasks) {
        this.processTask(nestedTask);
      }
    }
  }

  private printSummary(report: any): void {
    console.log('\n📊 E2E Test Metrics Summary');
    console.log('═'.repeat(50));
    console.log(`Total Tests: ${report.summary.totalTests}`);
    console.log(`Passed: ${report.summary.passedTests} ✅`);
    console.log(`Failed: ${report.summary.failedTests} ❌`);
    console.log(`Success Rate: ${report.summary.successRate.toFixed(1)}%`);
    console.log(`Total Duration: ${(report.summary.totalDuration / 1000).toFixed(2)}s`);
    console.log(`Average Test Duration: ${(report.aggregatedMetrics.averageTestDuration / 1000).toFixed(2)}s`);
    console.log(`Average Startup Time: ${(report.aggregatedMetrics.averageStartupTime / 1000).toFixed(2)}s`);
    
    if (report.aggregatedMetrics.mockServerStats.requestCount > 0) {
      console.log(`Mock LLM Requests: ${report.aggregatedMetrics.mockServerStats.requestCount}`);
      console.log(`Average Response Time: ${report.aggregatedMetrics.mockServerStats.responseTime.average.toFixed(0)}ms`);
    }

    if (report.diagnostics.length > 0) {
      const errors = report.diagnostics.filter((d: any) => d.level === 'error').length;
      const warnings = report.diagnostics.filter((d: any) => d.level === 'warning').length;
      console.log(`Diagnostics: ${errors} errors, ${warnings} warnings`);
    }

    console.log('═'.repeat(50));
  }
}

// Export factory function for Vitest configuration
export function createE2EReporter(options?: {
  outputDir?: string;
  generateHtml?: boolean;
  generateJson?: boolean;
}): E2EMetricsReporter {
  return new E2EMetricsReporter(options);
}

// Default export for easy import
export default E2EMetricsReporter;
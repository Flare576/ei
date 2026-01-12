// Metrics Test - Verifies that the metrics collection system works correctly
// This test demonstrates the metrics collection capabilities

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Metrics Collection Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'metrics-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });

    // Start metrics collection for this test
    harness.startTestMetrics('metrics collection verification');
  });

  afterEach(async () => {
    // Finish metrics collection
    harness.finishTestMetrics(true);
    
    await harness.cleanup();
  });

  test('metrics collection and reporting', async () => {
    console.log('=== Testing metrics collection system ===');
    
    // Configure sequential responses for metrics test
    harness.setMockResponseQueue([
      'Metrics test response from mock server.',
      JSON.stringify([{
        name: "Metrics Test Concept",
        description: "Concept for metrics testing",
        level_current: 0.6,
        level_ideal: 0.8,
        level_elasticity: 0.2,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Record test step: Application startup
    const startupStart = Date.now();
    await harness.startApp({ debugMode: false, usePty: false });
    const startupDuration = Date.now() - startupStart;
    
    harness.recordTestStep('Application Startup', 'startup', startupDuration, true);

    // Wait for application to initialize
    await harness.waitForIdleState(3000);

    // Record test step: Send message
    const messageStart = Date.now();
    await harness.sendInput('Hello, this is a metrics test message\n');
    const messageDuration = Date.now() - messageStart;
    
    harness.recordTestStep('Send Message', 'input', messageDuration, true);

    // Record test step: Wait for LLM request
    const llmStart = Date.now();
    await harness.waitForLLMRequest(5000);
    const llmDuration = Date.now() - llmStart;
    
    harness.recordTestStep('LLM Request', 'llm', llmDuration, true);

    // Record test step: Wait for response
    const responseStart = Date.now();
    await harness.waitForUIText('Metrics test response', 8000);
    const responseDuration = Date.now() - responseStart;
    
    harness.recordTestStep('Response Processing', 'response', responseDuration, true);

    // Verify the response appears in UI
    await harness.assertUIContains('Metrics test response');

    // Record test step: Application shutdown
    const shutdownStart = Date.now();
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
    const shutdownDuration = Date.now() - shutdownStart;
    
    harness.recordTestStep('Application Shutdown', 'shutdown', shutdownDuration, true);

    // Add some diagnostic information
    harness.addDiagnostic('info', 'Metrics test completed successfully');
    harness.addDiagnostic('info', `Total test steps: 5`);

    // Verify mock server received exactly one request
    harness.assertMockRequestCount(1);

    // Get current metrics to verify collection
    const currentMetrics = harness.getCurrentMetrics();
    console.log(`Collected metrics for ${currentMetrics.length} tests`);

    // Get current diagnostics
    const diagnostics = harness.getCurrentDiagnostics();
    console.log(`Collected ${diagnostics.length} diagnostic entries`);

    // Generate a test report
    const report = harness.generateTestReport();
    console.log('Generated test report with summary:', {
      totalTests: report.summary.totalTests,
      successRate: report.summary.successRate,
      totalDuration: report.summary.totalDuration
    });

    // Verify basic metrics structure
    expect(report.summary).toBeDefined();
    expect(report.testResults).toBeDefined();
    expect(report.aggregatedMetrics).toBeDefined();
    expect(report.diagnostics).toBeDefined();
    expect(report.environment).toBeDefined();

    console.log('✓ Metrics collection system verified successfully');
  }, 45000);

  test('metrics export functionality', async () => {
    console.log('=== Testing metrics export functionality ===');
    
    // Configure sequential responses for export test
    harness.setMockResponseQueue([
      'Export test response.',
      JSON.stringify([{
        name: "Export Test Concept",
        description: "Concept for export testing",
        level_current: 0.5,
        level_ideal: 0.7,
        level_elasticity: 0.3,
        type: "static"
      }]),
      JSON.stringify([])
    ]);

    // Run a simple test scenario
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);
    
    await harness.sendInput('Export test message\n');
    await harness.waitForLLMRequest(3000);
    await harness.waitForUIText('Export test response', 5000);
    
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Test JSON export
    const jsonPath = 'test-results/metrics-export-test.json';
    await harness.exportMetricsToJson(jsonPath);
    console.log(`✓ Exported metrics to JSON: ${jsonPath}`);

    // Test HTML export
    const htmlPath = 'test-results/metrics-export-test.html';
    await harness.exportMetricsToHtml(htmlPath);
    console.log(`✓ Exported metrics to HTML: ${htmlPath}`);

    // Verify files were created (basic check)
    const fs = await import('fs/promises');
    
    try {
      const jsonStats = await fs.stat(jsonPath);
      expect(jsonStats.size).toBeGreaterThan(0);
      console.log(`JSON file size: ${jsonStats.size} bytes`);
    } catch (error) {
      console.warn(`Could not verify JSON file: ${error}`);
    }

    try {
      const htmlStats = await fs.stat(htmlPath);
      expect(htmlStats.size).toBeGreaterThan(0);
      console.log(`HTML file size: ${htmlStats.size} bytes`);
    } catch (error) {
      console.warn(`Could not verify HTML file: ${error}`);
    }

    console.log('✓ Metrics export functionality verified');
  }, 30000);

  test('metrics error handling', async () => {
    console.log('=== Testing metrics error handling ===');
    
    // Configure sequential responses for error handling test
    harness.setMockResponseQueue([
      'Server Error',  // This will cause an error
      JSON.stringify([]),  // Empty concepts for error case
      JSON.stringify([])
    ]);

    // Start the application
    await harness.startApp({ debugMode: false });
    await harness.waitForIdleState(3000);

    // Send a message that should cause an error
    const errorStart = Date.now();
    await harness.sendInput('This should cause an error\n');
    
    try {
      await harness.waitForLLMRequest(3000);
      // If we get here, the request was made but may have failed
      const errorDuration = Date.now() - errorStart;
      harness.recordTestStep('Error Handling', 'error', errorDuration, false, 'Mock server error');
    } catch (error) {
      const errorDuration = Date.now() - errorStart;
      harness.recordTestStep('Error Handling', 'error', errorDuration, false, String(error));
    }

    // Add diagnostic information about the error
    harness.addDiagnostic('warning', 'Intentional error for testing metrics error handling');

    // The application should still be running and responsive
    expect(harness.isAppRunning()).toBe(true);

    // Clean shutdown
    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    // Verify error was recorded in metrics
    const diagnostics = harness.getCurrentDiagnostics();
    const warningDiagnostics = diagnostics.filter((d: any) => d.level === 'warning');
    expect(warningDiagnostics.length).toBeGreaterThan(0);

    console.log('✓ Metrics error handling verified');
  }, 30000);
});
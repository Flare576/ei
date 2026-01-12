// Simple E2E test to debug the mock server and text extraction
import { E2ETestHarnessImpl } from './tests/e2e/framework/harness.js';

async function debugE2ETest() {
  const harness = new E2ETestHarnessImpl();
  
  try {
    console.log('Setting up harness...');
    await harness.setup({
      tempDirPrefix: 'debug-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });

    console.log('Setting mock responses...');
    harness.setMockResponseQueue([
      'This is a test response that should appear in the UI.',
      JSON.stringify([]),
      JSON.stringify([])
    ]);

    console.log('Starting app...');
    await harness.startApp({ debugMode: true });

    console.log('Waiting for idle state...');
    await harness.waitForIdleState(3000);

    console.log('Sending test input...');
    await harness.sendInput('Test message\n');

    console.log('Waiting for LLM request...');
    await harness.waitForLLMRequest(3000);

    // Wait a bit for processing
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('Getting raw output...');
    const rawOutput = await harness.getCurrentOutput();
    console.log('Raw output length:', rawOutput.length);
    console.log('Raw output (first 500 chars):', rawOutput.slice(0, 500));

    console.log('Getting clean output...');
    const cleanOutput = await harness.getCurrentCleanOutput();
    console.log('Clean output length:', cleanOutput.length);
    console.log('Clean output:', cleanOutput);

    console.log('Mock request history:');
    const history = harness.getMockRequestHistory();
    console.log('Request count:', history.length);
    history.forEach((req, i) => {
      console.log(`Request ${i + 1}:`, req.endpoint, req.method);
    });

    console.log('Stopping app...');
    await harness.sendCommand('/quit');
    await harness.waitForCondition(() => !harness.isAppRunning(), 'App should stop', 5000);

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    console.log('Cleaning up...');
    await harness.cleanup();
  }
}

debugE2ETest().catch(console.error);
import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Model Command E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'model-command-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('/model shows current model configuration', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Model configuration');
    expect(output).toContain('ei');
    expect(output).toContain('Persona model');
    expect(output).toContain('Currently using');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/m alias shows model configuration', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/m');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Model configuration');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/model --list shows available providers', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model --list');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Available Providers');
    expect(output).toContain('local');
    expect(output).toContain('openai');
    expect(output).toContain('google');
    expect(output).toContain('anthropic');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/model local:test-model sets model and persists', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model local:test-model');
    await new Promise(resolve => setTimeout(resolve, 1000));

    let output = await harness.getCurrentOutput();
    expect(output).toContain("Model for 'ei' set to: local:test-model");

    await harness.sendCommand('/model');
    await new Promise(resolve => setTimeout(resolve, 1000));

    output = await harness.getCurrentOutput();
    expect(output).toContain('local:test-model');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    harness.assertFileExists('personas/ei/system.jsonc');
  }, 30000);

  test('/model --clear removes persona model', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model local:temp-model');
    await harness.waitForUIText("Model for 'ei' set to:", 2000);

    await harness.sendCommand('/model --clear');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Model override cleared');
    expect(output).toContain('Now using default');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/model --clear with no model set shows appropriate message', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model --clear');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('No model override set');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/model fake:model shows error for unknown provider', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model fake:gpt-5');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Error');
    expect(output).toContain('Unknown provider');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/model openai:gpt-4o shows error when API key not configured', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/model openai:gpt-4o');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Error');
    expect(output).toContain('No API key');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);
});

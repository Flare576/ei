import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Nick Commands E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'nick-commands-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('/nick list shows default persona aliases', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Aliases for ei');
    expect(output).toContain('default');
    expect(output).toContain('core');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick add creates new alias and persists', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick add testAlias');
    await new Promise(resolve => setTimeout(resolve, 1000));

    let output = await harness.getCurrentOutput();
    expect(output).toContain('Added alias "testAlias"');

    await harness.sendCommand('/nick');
    await new Promise(resolve => setTimeout(resolve, 1000));

    output = await harness.getCurrentOutput();
    expect(output).toContain('testAlias');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);

    harness.assertFileExists('personas/ei/system.jsonc');
  }, 30000);

  test('/nick add with multi-word quoted alias', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick add "Alice the Great"');
    await new Promise(resolve => setTimeout(resolve, 1000));

    let output = await harness.getCurrentOutput();
    expect(output).toContain('Added alias "Alice the Great"');

    await harness.sendCommand('/nick');
    await new Promise(resolve => setTimeout(resolve, 1000));

    output = await harness.getCurrentOutput();
    expect(output).toContain('Alice the Great');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick remove deletes alias', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick add tempAlias');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await harness.sendCommand('/nick remove tempAlias');
    await new Promise(resolve => setTimeout(resolve, 1000));

    let output = await harness.getCurrentOutput();
    expect(output).toContain('Removed alias "tempAlias"');

    await harness.sendCommand('/nick');
    await new Promise(resolve => setTimeout(resolve, 1000));

    output = await harness.getCurrentOutput();
    expect(output).not.toContain('tempAlias');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick remove with partial match', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick add uniqueTestAlias');
    await new Promise(resolve => setTimeout(resolve, 1000));

    await harness.sendCommand('/nick remove "uniqueTest"');
    await new Promise(resolve => setTimeout(resolve, 1000));

    let output = await harness.getCurrentOutput();
    expect(output).toContain('Removed alias "uniqueTestAlias"');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick add rejects duplicate aliases', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/nick add default');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Error');
    expect(output).toContain('already exists');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick shows no aliases message for persona without aliases', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona claude');
    await new Promise(resolve => setTimeout(resolve, 2000));

    await harness.sendCommand('/nick');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('has no aliases');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);

  test('/nick commands work with /n alias', async () => {
    harness.setMockResponseQueue([]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/n');
    await new Promise(resolve => setTimeout(resolve, 1000));

    const output = await harness.getCurrentOutput();
    expect(output).toContain('Aliases for ei');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 5000);
  }, 30000);
});

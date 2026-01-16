import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Multi-Persona E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'multi-persona-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('default ei persona exists on startup', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    // The default "ei" persona should be created by initializeDataDirectory
    harness.assertDirectoryExists('personas/ei', [
      'system.jsonc',
      'history.jsonc'
    ]);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('create new persona via interactive /persona command', async () => {
    // Mock responses for persona creation:
    // 1. createPersonaWithLLM (generates aliases, static adjustments, additional concepts)
    // 2. generatePersonaDescriptions (generates short/long descriptions)
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['tb', 'tbot'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'A helpful test bot',
        long_description: 'TestBot is a friendly assistant created for testing purposes.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    // Step 1: Request new persona - should prompt for confirmation
    await harness.sendCommand('/persona TestBot');
    await harness.waitForUIText('Create it?', 5000);

    // Step 2: Confirm creation - should prompt for description
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);

    // Step 3: Provide description - should create persona files
    await harness.sendInput('A friendly test assistant who loves helping\n');
    
    // Wait for persona creation to complete (LLM calls + file writes)
    await harness.waitForFileCreation('personas/TestBot/system.jsonc', 15000);

    // Verify both required files exist
    harness.assertDirectoryExists('personas/TestBot', [
      'system.jsonc',
      'history.jsonc'
    ]);

    // Verify system.jsonc has expected structure
    await harness.assertFileContent('personas/TestBot/system.jsonc', '"entity": "system"');
    await harness.assertFileContent('personas/TestBot/system.jsonc', '"aliases"');
    
    // Verify history.jsonc is initialized empty
    await harness.assertFileContent('personas/TestBot/history.jsonc', '"messages": []');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);

  test('persona creation can be cancelled', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona CancelMe');
    await harness.waitForUIText('Create it?', 5000);

    await harness.sendInput('n\n');
    await harness.waitForUIText('cancelled', 5000);

    harness.assertFileDoesNotExist('personas/CancelMe');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('switch to existing persona', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['sw'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Test persona for switching',
        long_description: 'A persona used to test switching functionality.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona SwitchTest');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('A test persona\n');
    await harness.waitForFileCreation('personas/SwitchTest/system.jsonc', 15000);

    await harness.sendCommand('/persona ei');
    await harness.waitForIdleState(3000);

    await harness.sendCommand('/persona SwitchTest');
    await harness.waitForIdleState(3000);

    expect(harness.isAppRunning()).toBe(true);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);

  test('list personas with /persona command (no args)', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona');
    await harness.waitForUIText('Available personas', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('persona name validation rejects invalid names', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona a');
    await harness.waitForUIText('at least 2 characters', 5000);

    await harness.sendCommand('/persona 123test');
    await harness.waitForUIText('must start with a letter', 5000);

    harness.assertFileDoesNotExist('personas/a');
    harness.assertFileDoesNotExist('personas/123test');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('send message to newly created persona', async () => {
    // Mock responses: 1-2 for persona creation, 3 for message response
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['msg'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Messaging test persona',
        long_description: 'A persona for testing message flow.'
      }),
      'Hello! I received your message and I am responding from MsgTest persona.'
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona MsgTest');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('A messaging test assistant\n');
    await harness.waitForFileCreation('personas/MsgTest/system.jsonc', 15000);
    await harness.waitForUIText('created!', 5000);
    await harness.waitForIdleState(3000);

    const testMessage = 'Hello MsgTest! This message is long enough to trigger immediate processing without debounce.';
    await harness.sendInput(`${testMessage}\n`);
    await harness.waitForLLMRequest(5000);
    
    await new Promise(resolve => setTimeout(resolve, 3000));

    const output = await harness.getCurrentCleanOutput();
    expect(output).toContain(testMessage.slice(0, 20));

    await harness.assertFileContent('personas/MsgTest/history.jsonc', 'Hello MsgTest');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 75000);
});

import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Delete Persona E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'delete-persona-test',
      appTimeout: 15000,
      cleanupTimeout: 8000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  test('/delete without argument shows usage message', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/delete');
    await harness.waitForUIText('Usage:', 5000);
    await harness.waitForUIText('archived persona', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/delete ei is blocked as system-critical', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/delete ei');
    await harness.waitForUIText('system-critical', 5000);

    harness.assertDirectoryExists('personas/ei', [
      'system.jsonc',
      'history.jsonc'
    ]);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/delete on non-existent persona shows error', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/delete NonExistent');
    await harness.waitForUIText('not found', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);

  test('/delete on active (non-archived) persona shows error', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['tp'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'A test persona',
        long_description: 'Created for testing deletion safety.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona TestPersona');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('A test persona for deletion\n');
    await harness.waitForFileCreation('personas/TestPersona/system.jsonc', 15000);

    await harness.sendCommand('/delete TestPersona');
    await harness.waitForUIText('only archived personas', 5000);
    await harness.waitForUIText('Use /archive first', 5000);

    harness.assertDirectoryExists('personas/TestPersona', [
      'system.jsonc',
      'history.jsonc'
    ]);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);

  test('delete persona - cancel at first confirmation', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['dp'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Deletion test',
        long_description: 'Created to test deletion cancellation.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona DeleteMe');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('Test persona\n');
    await harness.waitForFileCreation('personas/DeleteMe/system.jsonc', 15000);

    await harness.sendCommand('/archive DeleteMe');
    await harness.waitForUIText('Archived DeleteMe', 5000);

    await harness.sendCommand('/delete DeleteMe');
    await harness.waitForUIText('cannot be undone', 5000);
    await harness.sendInput('n\n');
    await harness.waitForUIText('cancelled', 5000);

    harness.assertDirectoryExists('personas/DeleteMe', [
      'system.jsonc',
      'history.jsonc'
    ]);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);

  test('delete persona - confirm deletion but keep human concepts', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['kp'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Keep test',
        long_description: 'Testing concept preservation.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona KeepConcepts');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('Test persona\n');
    await harness.waitForFileCreation('personas/KeepConcepts/system.jsonc', 15000);

    await harness.sendCommand('/archive KeepConcepts');
    await harness.waitForUIText('Archived KeepConcepts', 5000);

    await harness.sendCommand('/delete KeepConcepts');
    await harness.waitForUIText('cannot be undone', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('Delete topics created by', 5000);
    await harness.sendInput('n\n');
    await harness.waitForUIText('Deleted persona', 5000);

    harness.assertFileDoesNotExist('personas/KeepConcepts');
    harness.assertFileDoesNotExist('personas/KeepConcepts/system.jsonc');
    harness.assertFileDoesNotExist('personas/KeepConcepts/history.jsonc');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 60000);

  test('delete persona - confirm deletion and delete human concepts', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['dc'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Delete concepts test',
        long_description: 'Testing concept deletion.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona DeleteConcepts');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('Test persona\n');
    await harness.waitForFileCreation('personas/DeleteConcepts/system.jsonc', 15000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    await harness.modifyJsonFile('human.jsonc', (humanMap: any) => {
      humanMap.concepts = humanMap.concepts || [];
      humanMap.concepts.push({
        name: 'Test Topic from DeleteConcepts',
        description: 'A concept created by the persona we will delete',
        level_current: 0.5,
        level_ideal: 0.5,
        sentiment: 0.0,
        type: 'topic',
        learned_by: 'DeleteConcepts',
        last_updated: new Date().toISOString()
      });
      return humanMap;
    });

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.assertFileContent('human.jsonc', 'Test Topic from DeleteConcepts');
    await harness.assertFileContent('human.jsonc', '"learned_by": "DeleteConcepts"');

    await harness.sendCommand('/archive DeleteConcepts');
    await harness.waitForUIText('Archived DeleteConcepts', 5000);

    await harness.sendCommand('/delete DeleteConcepts');
    await harness.waitForUIText('cannot be undone', 5000);
    //
    // Wait for message to finish since we're only watching for the first part
    await new Promise(resolve => setTimeout(resolve, 500));
    await harness.sendInput('yes\n');
    await harness.waitForUIText('Delete topics created by', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('1 human concept', 15000);

    harness.assertFileDoesNotExist('personas/DeleteConcepts');
    harness.assertFileDoesNotExist('personas/DeleteConcepts/system.jsonc');
    harness.assertFileDoesNotExist('personas/DeleteConcepts/history.jsonc');

    await harness.assertFileDoesNotContain('human.jsonc', 'Test Topic from DeleteConcepts');
    await harness.assertFileDoesNotContain('human.jsonc', '"learned_by": "DeleteConcepts"');

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 90000);

  test('deleted persona directory is completely removed', async () => {
    harness.setMockResponseQueue([
      JSON.stringify({
        aliases: ['dr'],
        static_level_adjustments: {},
        additional_concepts: []
      }),
      JSON.stringify({
        short_description: 'Directory removal test',
        long_description: 'Testing complete cleanup.'
      })
    ]);

    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/persona DirRemove');
    await harness.waitForUIText('Create it?', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 5000);
    await harness.sendInput('Test\n');
    await harness.waitForFileCreation('personas/DirRemove/system.jsonc', 15000);

    harness.assertDirectoryExists('personas/DirRemove', [
      'system.jsonc',
      'history.jsonc'
    ]);

    await harness.sendCommand('/archive DirRemove');
    await harness.waitForUIText('Archived DirRemove', 5000);

    await harness.sendCommand('/delete DirRemove');
    await harness.waitForUIText('cannot be undone', 5000);
    await harness.sendInput('y\n');
    await harness.waitForUIText('Delete topics', 5000);
    await harness.sendInput('n\n');
    await harness.waitForUIText('Deleted persona', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);

    harness.assertFileDoesNotExist('personas/DirRemove');
  }, 60000);

  test('/help documents /delete command', async () => {
    await harness.startApp({ debugMode: false, usePty: false });
    await harness.waitForIdleState(5000);

    await harness.sendCommand('/help');
    await harness.waitForUIText('/delete', 5000);

    await harness.sendCommand('/quit');
    await harness.assertExitCode(0, 8000);
  }, 30000);
});

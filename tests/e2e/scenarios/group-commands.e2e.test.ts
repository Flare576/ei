import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { E2ETestHarnessImpl } from '../framework/harness.js';

describe('Group Commands E2E Tests', () => {
  let harness: E2ETestHarnessImpl;

  beforeEach(async () => {
    harness = new E2ETestHarnessImpl();
    
    await harness.setup({
      tempDirPrefix: 'group-commands-test',
      appTimeout: 10000,
      cleanupTimeout: 5000
    });
  });

  afterEach(async () => {
    await harness.cleanup();
  });

  async function createAndSwitchToTestPersona() {
    harness.setMockResponseQueue([
      JSON.stringify({ content: 'Hi! I am testpersona.', aliases: [] }),
    ]);
    
    await harness.sendCommand('/persona testpersona');
    await harness.waitForUIText("Persona 'testpersona' not found. Create it?", 3000);
    
    await harness.sendInput('y\n');
    await harness.waitForUIText('What should this persona be', 3000);
    
    await harness.sendInput('A test persona for group testing\n');
    await harness.waitForFileCreation('personas/testpersona/system.jsonc', 10000);
    await harness.waitForUIText('Switched to persona: testpersona', 5000);
  }

  describe('Ei persona blocking', () => {
    test('/g on ei shows error', async () => {
      harness.setMockResponseQueue([]);

      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await harness.sendCommand('/g');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Error');
      expect(output).toContain("Ei's groups are managed by the system");

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 30000);

    test('/gs on ei shows error', async () => {
      harness.setMockResponseQueue([]);

      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await harness.sendCommand('/gs');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Error');
      expect(output).toContain("Ei's groups are managed by the system");

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 30000);
  });

  describe('/g (primary group) command', () => {
    test('/g shows "(none)" when no primary group set', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group: (none)');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/g sets primary group and persists', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g Fellowship');
      await new Promise(resolve => setTimeout(resolve, 1000));

      let output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group set to: Fellowship');

      await harness.sendCommand('/g');
      await new Promise(resolve => setTimeout(resolve, 1000));

      output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group: Fellowship');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);

      harness.assertFileExists('personas/testpersona/system.jsonc');
    }, 45000);

    test('/g handles quoted group names with spaces', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g "LotR Crew"');
      await new Promise(resolve => setTimeout(resolve, 1000));

      let output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group set to: LotR Crew');

      await harness.sendCommand('/g');
      await new Promise(resolve => setTimeout(resolve, 1000));

      output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group: LotR Crew');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/g clear removes primary group', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g Fellowship');
      await harness.waitForUIText('Primary group set to', 2000);

      await harness.sendCommand('/g clear');
      await new Promise(resolve => setTimeout(resolve, 1000));

      let output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group cleared');

      await harness.sendCommand('/g');
      await new Promise(resolve => setTimeout(resolve, 1000));

      output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group: (none)');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/g with multiple args shows error', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g set Foo');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Error');
      expect(output).toContain('takes one argument');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/group works as alias for /g', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/group TestGroup');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Primary group set to: TestGroup');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);
  });

  describe('/gs (visible groups) command', () => {
    test('/gs shows "(none)" when no groups', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/gs');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Visible groups: (none)');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs adds group to visible groups', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/gs Personal');
      await new Promise(resolve => setTimeout(resolve, 1000));

      let output = await harness.getCurrentOutput();
      expect(output).toContain('Added "Personal" to visible groups');

      await harness.sendCommand('/gs');
      await new Promise(resolve => setTimeout(resolve, 1000));

      output = await harness.getCurrentOutput();
      expect(output).toContain('Visible groups:');
      expect(output).toContain('Personal');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs shows primary group with marker', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g Fellowship');
      await harness.waitForUIText('Primary group set to', 2000);

      await harness.sendCommand('/gs Personal');
      await harness.waitForUIText('Added "Personal"', 2000);

      await harness.sendCommand('/gs');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Fellowship (primary)');
      expect(output).toContain('Personal');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs warns when adding primary group', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/g Fellowship');
      await harness.waitForUIText('Primary group set to', 2000);

      await harness.sendCommand('/gs Fellowship');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Note:');
      expect(output).toContain('already visible as your primary group');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs remove removes group from visible', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/gs Work');
      await harness.waitForUIText('Added "Work"', 2000);

      await harness.sendCommand('/gs remove Work');
      await harness.waitForUIText('Removed "Work"', 2000);

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs clear removes all visible groups', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/gs Work');
      await harness.waitForUIText('Added "Work"', 2000);

      await harness.sendCommand('/gs Personal');
      await harness.waitForUIText('Added "Personal"', 2000);

      await harness.sendCommand('/gs clear');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Visible groups cleared');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/groups works as alias for /gs', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/groups TestGroup');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('Added "TestGroup" to visible groups');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);

    test('/gs remove errors when group not in list', async () => {
      await harness.startApp({ debugMode: false, usePty: false });
      await harness.waitForIdleState(5000);

      await createAndSwitchToTestPersona();

      await harness.sendCommand('/gs remove NonExistent');
      await new Promise(resolve => setTimeout(resolve, 1000));

      const output = await harness.getCurrentOutput();
      expect(output).toContain('not in visible groups');

      await harness.sendCommand('/quit');
      await harness.assertExitCode(0, 5000);
    }, 45000);


  });
});

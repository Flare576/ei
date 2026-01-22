import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { createBlessedMock } from '../helpers/blessed-mocks.js';
import { createStorageMocks } from '../helpers/storage-mocks.js';
import { createLLMMocks } from '../helpers/llm-mocks.js';
import { createQueueProcessorMock } from '../helpers/queue-processor-mock.js';

vi.mock('blessed', () => createBlessedMock());
vi.mock('../../src/storage.js', () => createStorageMocks());
vi.mock('../../src/llm.js', () => createLLMMocks());
vi.mock('../../src/queue-processor.js', () => createQueueProcessorMock());

vi.mock('../../src/processor.js', () => ({
  processEvent: vi.fn(() => Promise.resolve({
    response: 'Test response',
    aborted: false,
  })),
}));

import { EIApp } from '../../src/blessed/app.js';
import { 
  saveArchiveState, 
  loadArchiveState, 
  getArchivedPersonas, 
  findArchivedPersonaByNameOrAlias,
  listPersonas,
  findPersonaByNameOrAlias
} from '../../src/storage.js';

class TestableEIApp extends EIApp {
  public async testHandleCommand(input: string): Promise<void> {
    return (this as any).handleCommand(input);
  }
  
  public getTestStatusMessage(): string | null {
    return (this as any).statusMessage;
  }
  
  public getTestActivePersona(): string {
    return (this as any).activePersona;
  }
  
  public setTestPersonas(personas: any[]): void {
    (this as any).personas = personas;
  }
  
  public async testCleanup(): Promise<void> {
    try {
      await (this as any).cleanup();
    } catch (error) {
    }
  }
}

describe('Archive/Unarchive Persona Integration Tests', () => {
  let app: TestableEIApp;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = new TestableEIApp();
    await app.init();
  });

  afterEach(async () => {
    if (app) {
      await app.testCleanup();
    }
  });

  describe('/archive command', () => {
    test('archives active persona', async () => {
      vi.mocked(loadArchiveState).mockResolvedValue({ isArchived: false });
      vi.mocked(listPersonas).mockResolvedValue([{ name: 'ei', aliases: [] }]);
      
      await app.testHandleCommand('/archive');
      
      expect(saveArchiveState).toHaveBeenCalledWith('ei', {
        isArchived: true,
        archivedDate: expect.any(String)
      });
      expect(app.getTestStatusMessage()).toContain('Archived ei');
    });

    test('archives specified persona by name', async () => {
      app.setTestPersonas([
        { name: 'ei', aliases: [] },
        { name: 'claude', aliases: [] }
      ]);
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue('claude');
      vi.mocked(loadArchiveState).mockResolvedValue({ isArchived: false });
      
      await app.testHandleCommand('/archive claude');
      
      expect(saveArchiveState).toHaveBeenCalledWith('claude', {
        isArchived: true,
        archivedDate: expect.any(String)
      });
      expect(app.getTestStatusMessage()).toContain('Archived claude');
    });

    test('shows error when persona not found', async () => {
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue(null);
      
      await app.testHandleCommand('/archive nonexistent');
      
      expect(saveArchiveState).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain("Persona 'nonexistent' not found");
    });

    test('shows error when persona already archived', async () => {
      app.setTestPersonas([
        { name: 'ei', aliases: [] },
        { name: 'claude', aliases: [] }
      ]);
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue('claude');
      vi.mocked(loadArchiveState).mockResolvedValue({ 
        isArchived: true, 
        archivedDate: new Date().toISOString() 
      });
      
      await app.testHandleCommand('/archive claude');
      
      expect(saveArchiveState).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain('claude is already archived');
    });
  });

  describe('/unarchive command', () => {
    test('lists archived personas when no args provided', async () => {
      vi.mocked(getArchivedPersonas).mockResolvedValue([
        { name: 'archived1', aliases: [] },
        { name: 'archived2', aliases: [] }
      ]);
      
      await app.testHandleCommand('/unarchive');
      
      expect(app.getTestStatusMessage()).toContain('Archived personas:');
      expect(app.getTestStatusMessage()).toContain('1. archived1');
      expect(app.getTestStatusMessage()).toContain('2. archived2');
    });

    test('shows message when no archived personas exist', async () => {
      vi.mocked(getArchivedPersonas).mockResolvedValue([]);
      
      await app.testHandleCommand('/unarchive');
      
      expect(app.getTestStatusMessage()).toContain('No archived personas');
    });

    test('unarchives persona by name', async () => {
      vi.mocked(findArchivedPersonaByNameOrAlias).mockResolvedValue('archived1');
      vi.mocked(loadArchiveState).mockResolvedValue({ 
        isArchived: true, 
        archivedDate: new Date().toISOString() 
      });
      vi.mocked(listPersonas).mockResolvedValue([
        { name: 'ei', aliases: [] },
        { name: 'archived1', aliases: [] }
      ]);
      
      await app.testHandleCommand('/unarchive archived1');
      
      expect(saveArchiveState).toHaveBeenCalledWith('archived1', {
        isArchived: false,
        archivedDate: undefined
      });
      expect(app.getTestStatusMessage()).toContain('Unarchived archived1');
    });

    test('unarchives persona by number', async () => {
      vi.mocked(getArchivedPersonas).mockResolvedValue([
        { name: 'archived1', aliases: [] },
        { name: 'archived2', aliases: [] }
      ]);
      vi.mocked(loadArchiveState).mockResolvedValue({ 
        isArchived: true, 
        archivedDate: new Date().toISOString() 
      });
      vi.mocked(listPersonas).mockResolvedValue([{ name: 'ei', aliases: [] }]);
      
      await app.testHandleCommand('/unarchive 2');
      
      expect(saveArchiveState).toHaveBeenCalledWith('archived2', {
        isArchived: false,
        archivedDate: undefined
      });
      expect(app.getTestStatusMessage()).toContain('Unarchived archived2');
    });

    test('shows error when archived persona not found by name', async () => {
      vi.mocked(findArchivedPersonaByNameOrAlias).mockResolvedValue(null);
      
      await app.testHandleCommand('/unarchive nonexistent');
      
      expect(saveArchiveState).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain("Archived persona 'nonexistent' not found");
    });

    test('shows error when number is out of range', async () => {
      vi.mocked(getArchivedPersonas).mockResolvedValue([
        { name: 'archived1', aliases: [] }
      ]);
      
      await app.testHandleCommand('/unarchive 5');
      
      expect(saveArchiveState).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain("Archived persona '5' not found");
    });

    test('shows error when persona is not actually archived', async () => {
      vi.mocked(findArchivedPersonaByNameOrAlias).mockResolvedValue('claude');
      vi.mocked(loadArchiveState).mockResolvedValue({ isArchived: false });
      
      await app.testHandleCommand('/unarchive claude');
      
      expect(saveArchiveState).not.toHaveBeenCalled();
      expect(app.getTestStatusMessage()).toContain('claude is not archived');
    });
  });

  describe('/persona command with archived personas', () => {
    test('detects archived persona and instructs to use /unarchive', async () => {
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue(null);
      vi.mocked(findArchivedPersonaByNameOrAlias).mockResolvedValue('archived1');
      
      await app.testHandleCommand('/persona archived1');
      
      expect(app.getTestStatusMessage()).toContain("Persona 'archived1' is archived");
      expect(app.getTestStatusMessage()).toContain('/unarchive archived1');
    });

    test('does not prompt for creation when persona is archived', async () => {
      vi.mocked(findPersonaByNameOrAlias).mockResolvedValue(null);
      vi.mocked(findArchivedPersonaByNameOrAlias).mockResolvedValue('archived1');
      
      await app.testHandleCommand('/persona archived1');
      
      expect(app.getTestStatusMessage()).not.toContain('Create it?');
    });
  });
});

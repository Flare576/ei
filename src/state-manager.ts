import { readFile, writeFile, readdir, mkdir, unlink } from "fs/promises";
import { existsSync } from "fs";
import * as path from "path";
import {
  loadConceptMap,
  saveConceptMap,
  loadHistory,
  saveHistory,
  listPersonas,
  getDataPath,
} from "./storage.js";
import { SystemSnapshot, ConceptMap, ConversationHistory } from "./types.js";

interface SavedStateMetadata {
  id: string;
  name: string;
  timestamp: string;
  filePath: string;
}

interface StateIndex {
  states: SavedStateMetadata[];
}

/**
 * StateManager handles in-memory snapshot ring buffer for undo functionality.
 * 
 * Phase 1: In-memory ring buffer only (lost on app restart)
 * Phase 4: Disk persistence with `.ei-states/` directory
 */
export class StateManager {
  private snapshots: SystemSnapshot[] = [];
  private readonly maxSnapshots = 10;
  private readonly statesDir: string;
  private readonly maxDiskStates = 10;

  constructor() {
    this.statesDir = path.join(getDataPath(), ".ei-states");
    this.ensureStatesDirectory().catch(err => {
      console.error(`Failed to initialize .ei-states directory: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  private async ensureStatesDirectory(): Promise<void> {
    if (!existsSync(this.statesDir)) {
      await mkdir(this.statesDir, { recursive: true });
    }
  }

  async createSnapshot(): Promise<SystemSnapshot> {
    try {
      const humanConcepts = await loadConceptMap("human");
      const personas = await listPersonas();
      
      const personaData: SystemSnapshot["personas"] = {};
      
      for (const persona of personas) {
        try {
          const system = await loadConceptMap("system", persona.name);
          const history = await loadHistory(persona.name);
          
          personaData[persona.name] = {
            system,
            history,
          };
        } catch (err) {
          console.error(`Warning: Failed to snapshot persona "${persona.name}":`, err);
        }
      }

      const snapshot: SystemSnapshot = {
        timestamp: new Date().toISOString(),
        humanConcepts,
        personas: personaData,
      };

      return snapshot;
    } catch (err) {
      throw new Error(`Failed to create snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Restores a snapshot by writing it back to disk.
   * Uses existing storage functions - does not recreate directories.
   * 
   * WARNING: This is a destructive operation. Always capture current state before calling.
   * 
   * @param snapshot - The snapshot to restore
   * @throws Error if write operations fail
   */
  async restoreSnapshot(snapshot: SystemSnapshot): Promise<void> {
    try {
      await saveConceptMap(snapshot.humanConcepts);

      for (const [personaName, data] of Object.entries(snapshot.personas)) {
        try {
          await saveConceptMap(data.system, personaName);
          await saveHistory(data.history, personaName);
        } catch (err) {
          console.error(`Warning: Failed to restore persona "${personaName}":`, err);
        }
      }
    } catch (err) {
      throw new Error(`Failed to restore snapshot: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Captures a snapshot and adds it to the in-memory ring buffer.
   * If buffer exceeds maxSnapshots, oldest snapshot is removed (FIFO).
   * 
   * This should be called before any write operation to enable undo.
   */
  async captureSnapshot(): Promise<void> {
    const snapshot = await this.createSnapshot();
    this.snapshots.push(snapshot);
    
    if (this.snapshots.length > this.maxSnapshots) {
      this.snapshots.shift();
    }
  }

  /**
   * Pops n snapshots from the ring buffer and returns the nth snapshot to restore.
   * 
   * Example: undo(1) pops 1 snapshot and returns it (undoes last action)
   *          undo(3) pops 3 snapshots and returns the 3rd (undoes last 3 actions)
   * 
   * @param n - Number of snapshots to undo (default: 1)
   * @returns The snapshot to restore, or null if insufficient history
   */
  undo(n: number = 1): SystemSnapshot | null {
    if (n < 1) {
      throw new Error("Undo count must be at least 1");
    }

    if (this.snapshots.length === 0) {
      return null;
    }

    const actualCount = Math.min(n, this.snapshots.length);
    
    const removed: SystemSnapshot[] = [];
    for (let i = 0; i < actualCount; i++) {
      const snapshot = this.snapshots.pop();
      if (snapshot) {
        removed.push(snapshot);
      }
    }

    return removed[removed.length - 1] || null;
  }

  getSnapshotCount(): number {
    return this.snapshots.length;
  }

  clearSnapshots(): void {
    this.snapshots = [];
  }

  async saveStateToDisk(name?: string): Promise<void> {
    await this.ensureStatesDirectory();

    const snapshot = await this.createSnapshot();
    const index = await this.loadStateIndex();

    const nextId = this.getNextStateId(index.states);
    const stateName = name || snapshot.timestamp;
    const fileName = `${nextId}.jsonc`;
    const filePath = path.join(this.statesDir, fileName);

    await writeFile(filePath, JSON.stringify(snapshot, null, 2), "utf-8");

    const metadata: SavedStateMetadata = {
      id: nextId,
      name: stateName,
      timestamp: snapshot.timestamp,
      filePath: fileName,
    };

    index.states.push(metadata);

    if (index.states.length > this.maxDiskStates) {
      const removed = index.states.shift();
      if (removed) {
        const oldFilePath = path.join(this.statesDir, removed.filePath);
        try {
          await unlink(oldFilePath);
        } catch (err) {
          console.error(`Failed to delete old state file: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    }

    await this.saveStateIndex(index);
  }

  async listSavedStates(): Promise<SavedStateMetadata[]> {
    const index = await this.loadStateIndex();
    return index.states;
  }

  async loadStateFromDisk(nameOrNumber: string | number): Promise<SystemSnapshot> {
    const index = await this.loadStateIndex();

    let metadata: SavedStateMetadata | undefined;

    if (typeof nameOrNumber === 'number') {
      metadata = index.states[nameOrNumber - 1];
    } else {
      metadata = index.states.find(s => s.name === nameOrNumber || s.id === nameOrNumber);
    }

    if (!metadata) {
      throw new Error(`State not found: ${nameOrNumber}`);
    }

    const filePath = path.join(this.statesDir, metadata.filePath);
    const content = await readFile(filePath, "utf-8");
    return JSON.parse(content) as SystemSnapshot;
  }

  private async loadStateIndex(): Promise<StateIndex> {
    const indexPath = path.join(this.statesDir, "index.jsonc");

    if (!existsSync(indexPath)) {
      return { states: [] };
    }

    try {
      const content = await readFile(indexPath, "utf-8");
      return JSON.parse(content) as StateIndex;
    } catch (err) {
      console.error(`Failed to load state index, recreating: ${err instanceof Error ? err.message : String(err)}`);
      return { states: [] };
    }
  }

  private async saveStateIndex(index: StateIndex): Promise<void> {
    const indexPath = path.join(this.statesDir, "index.jsonc");
    await writeFile(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }

  private getNextStateId(existingStates: SavedStateMetadata[]): string {
    const existingIds = existingStates.map(s => {
      const match = s.id.match(/^state-(\d+)$/);
      return match ? parseInt(match[1], 10) : 0;
    });

    const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;
    const nextNum = maxId + 1;

    return `state-${String(nextNum).padStart(3, '0')}`;
  }
}

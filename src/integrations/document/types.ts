import type { StateManager } from "../../core/state-manager.js";
import type { Ei_Interface } from "../../core/types.js";

export interface DocumentImportOptions {
  stateManager: StateManager;
  interface: Ei_Interface;
  filePath: string;
  signal?: AbortSignal;
}

export interface DocumentImportResult {
  chunksQueued: number;
  documentName: string;
  batchId?: string;
}

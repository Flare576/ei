import { readFileSync } from "fs";
import { StateManager } from "../../src/core/state-manager.js";
import type { StorageState } from "../../src/core/types/integrations.js";
import type { Storage } from "../../src/storage/interface.js";
import { buildResponsePromptData } from "../../src/core/prompt-context-builder.js";
import type { ResponsePromptData } from "../../src/prompts/response/types.js";

const NULL_STORAGE: Storage = {
  isAvailable: async () => true,
  save: async () => {},
  load: async () => null,
  moveToBackup: async () => {},
  loadBackup: async () => null,
  saveRollingBackup: async () => {},
  getDataPath: () => "",
};

export interface StateFixture {
  sm: StateManager;
  personaId: string;
  personaName: string;
  buildPromptData: (currentMessage?: string) => Promise<ResponsePromptData>;
}

export async function loadStateFixture(personaDisplayName: string): Promise<StateFixture> {
  const stateFilePath = process.env.EXTERNAL_STATE_FILE;
  if (!stateFilePath) {
    throw new Error(
      "EXTERNAL_STATE_FILE is not set. Point it to a state.json snapshot.\n" +
      "Example: EXTERNAL_STATE_FILE=~/.local/share/ei/state.json npm run test:evals:real-data"
    );
  }

  let raw: string;
  try {
    raw = readFileSync(stateFilePath, "utf-8");
  } catch (err) {
    throw new Error(`Could not read state file at "${stateFilePath}": ${(err as Error).message}`);
  }

  let state: StorageState;
  try {
    state = JSON.parse(raw) as StorageState;
  } catch (err) {
    throw new Error(`State file at "${stateFilePath}" is not valid JSON: ${(err as Error).message}`);
  }

  const personaEntry = Object.entries(state.personas).find(
    ([, v]) => v.entity.display_name.toLowerCase() === personaDisplayName.toLowerCase()
  );
  if (!personaEntry) {
    const available = Object.values(state.personas).map(v => v.entity.display_name).join(", ");
    throw new Error(
      `No persona named "${personaDisplayName}" found in state file.\n` +
      `Available personas: ${available}`
    );
  }
  const [personaId] = personaEntry;

  const sm = new StateManager();
  await sm.initialize(NULL_STORAGE);
  sm.restoreFromState(state);

  return {
    sm,
    personaId,
    personaName: personaDisplayName,
    buildPromptData: (currentMessage?: string) =>
      buildResponsePromptData(sm, sm.persona_getById(personaId)!, false, currentMessage),
  };
}

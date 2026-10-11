import { describe, it, expect, vi, afterEach } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Processor } from "../../../src/core/processor.js";
import type { Ei_Interface, StorageState } from "../../../src/core/types.js";

vi.mock("../../../src/core/handlers/index.js", () => ({
  handlers: {},
  registerSearchHumanData: vi.fn(),
}));

vi.mock("../../../src/core/orchestrators/index.js", () => ({
  orchestratePersonaGeneration: vi.fn(),
  queueFactFind: vi.fn(),
  queueTopicScan: vi.fn(),
  queuePersonScan: vi.fn(),
  queueAllScans: vi.fn(),
  isNewDay: vi.fn(),
  isPastCeremonyTime: vi.fn(),
  shouldStartCeremony: vi.fn(() => false),
  startCeremony: vi.fn(),
  handleCeremonyProgress: vi.fn(),
  prunePersonaMessages: vi.fn(),
  runHumanCeremony: vi.fn(),
}));

function createInterface(): Ei_Interface {
  return {
    onPersonaAdded: () => {},
    onPersonaRemoved: () => {},
    onPersonaUpdated: () => {},
    onMessageAdded: () => {},
    onMessageProcessing: () => {},
    onMessageQueued: () => {},
    onMessageRecalled: () => {},
    onHumanUpdated: () => {},
    onQueueStateChanged: () => {},
    onError: () => {},
    onStateImported: () => {},
    onOneShotReturned: () => {},
  };
}

let dataDir: string | undefined;

afterEach(() => {
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
  dataDir = undefined;
  delete process.env.EI_DATA_PATH;
});

/** Real on-disk storage in an isolated temp data dir: save() writes state.json, load() reads it back, so a second Processor sees exactly what survived the disk round trip. */
function createDiskStorage(path: string) {
  const statePath = join(path, "state.json");
  return {
    getDataPath: () => path,
    isAvailable: vi.fn(async () => true),
    load: vi.fn(async () => (existsSync(statePath) ? (JSON.parse(readFileSync(statePath, "utf-8")) as StorageState) : null)),
    save: vi.fn(async (state: StorageState) => {
      writeFileSync(statePath, JSON.stringify(state));
    }),
    moveToBackup: vi.fn().mockResolvedValue(undefined),
    loadBackup: vi.fn().mockResolvedValue(null),
    saveRollingBackup: vi.fn().mockResolvedValue(undefined),
  };
}

describe("PersonaEntity.show_thinking persistence", () => {
  it("is never false on a newly created persona, an explicit false survives update + save + reload from disk, and a later unrelated update leaves it false", async () => {
    dataDir = mkdtempSync(join(tmpdir(), "ei-show-thinking-"));
    process.env.EI_DATA_PATH = dataDir;

    const first = new Processor(createInterface());
    await first.start(createDiskStorage(dataDir));

    await first.createPersona({ name: "ThinkBot", long_description: "A persona for show_thinking" });
    const personaId = (await first.resolvePersonaName("ThinkBot"))!;
    expect((await first.getPersona(personaId))!.show_thinking).not.toBe(false);

    await first.updatePersona(personaId, { show_thinking: false });
    await first.stop();

    const onDisk = JSON.parse(readFileSync(join(dataDir, "state.json"), "utf-8")) as StorageState;
    expect(onDisk.personas[personaId].entity.show_thinking).toBe(false);

    const second = new Processor(createInterface());
    await second.start(createDiskStorage(dataDir));
    const reloaded = await second.getPersona(personaId);
    expect(reloaded).not.toBeNull();
    expect(reloaded!.show_thinking).toBe(false);

    await second.updatePersona(personaId, { short_description: "unrelated change" });
    expect((await second.getPersona(personaId))!.show_thinking).toBe(false);
    await second.stop();
  });
});

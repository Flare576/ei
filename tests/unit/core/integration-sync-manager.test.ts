import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { IntegrationSyncManager } from "../../../src/core/integration-sync-manager.js";
import { StateManager } from "../../../src/core/state-manager.js";
import { LLMNextStep, type Ei_Interface, type PersonaEntity, type Person } from "../../../src/core/types.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { slugifyProjectPath } from "../../../src/integrations/omp/reader.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as tests/unit/core/handlers/extraction.test.ts and
// tests/unit/core/state-manager.test.ts. Real `StateManager` reaches Zod
// via entity-schemas.ts.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

function makeTestPersona(id: string, displayName: string): PersonaEntity {
  return {
    id,
    display_name: displayName,
    entity: "system",
    aliases: [displayName],
    short_description: `${displayName} description`,
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: new Date().toISOString(),
  };
}

function makeLinkedPerson(id: string, name: string, personaId: string): Person {
  return {
    id,
    name,
    description: `${name}'s description`,
    relationship: "AI Persona",
    sentiment: 0.5,
    exposure_current: 0.5,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
    validated_date: "",
    identifiers: [
      { type: "Ei Persona", value: personaId },
      { type: "Nickname", value: name, is_primary: true },
    ],
  };
}

function sessionInitLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ type: "session_init", id: "init-1", timestamp: "2026-08-01T00:00:00.000Z", ...overrides });
}

function messageLine(id: string, role: "user" | "assistant", text: string, timestamp: string): string {
  return JSON.stringify({ type: "message", id, timestamp, message: { role, content: [{ type: "text", text }] } });
}

function scanRequestsFor(sm: StateManager) {
  return sm.queue_getAllActiveItems().filter((r) => r.next_step === LLMNextStep.HandlePersonaSignalScan);
}

async function writeFixtureTree(sessionRoot: string): Promise<void> {
  await fs.mkdir(sessionRoot, { recursive: true });

  // CD1: root session file, directly in sessionRoot — excluded.
  await fs.writeFile(
    path.join(sessionRoot, "2026-08-01T00-00-00-000Z_uuid1.jsonl"),
    `${messageLine("m1", "user", "root session content", "2026-08-01T00:00:00.000Z")}\n`
  );

  const sessionDir = path.join(sessionRoot, "2026-08-01T00-00-00-000Z_uuid1");
  await fs.mkdir(sessionDir, { recursive: true });

  // CD2: flat, zero dots — subject "backend-engineer".
  await fs.writeFile(
    path.join(sessionDir, "AgentInventory.jsonl"),
    `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "You are backend-engineer." })}\n` +
      `${messageLine("m2", "assistant", "wrote thorough tests", "2026-08-01T00:01:00.000Z")}\n`
  );

  // CD3: nested one level deeper — subject "Beta".
  const nestedDir = path.join(sessionDir, "SisyphusFolderSweep");
  await fs.mkdir(nestedDir, { recursive: true });
  await fs.writeFile(
    path.join(nestedDir, "SisyphusFolderSweep.BetaReview.jsonl"),
    `${sessionInitLine({ agent: "Beta", systemPrompt: "You are Beta." })}\n` +
      `${messageLine("m3", "assistant", "reviewed a PR carefully", "2026-08-01T00:02:00.000Z")}\n`
  );
}

describe("IntegrationSyncManager.checkAndSyncOmp — R5/AT5", () => {
  let tmpHome: string;
  let fakeCwd: string;
  let sm: StateManager;
  let originalHome: string | undefined;

  beforeEach(async () => {
    tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "omp-sync-home-"));
    fakeCwd = path.join(tmpHome, "Projects", "TestProject");
    originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    sm = new StateManager();
    await sm.initialize(createMockStorage());

    // Two resolvable subjects with complete session_init and a linked
    // Person each — matching AT1/AT3's own "complete" fixture case.
    sm.persona_add(makeTestPersona("backend-engineer-persona", "Backend Engineer"));
    sm.human_person_upsert(makeLinkedPerson("backend-engineer-person", "Backend Engineer Bot", "backend-engineer-persona"));
    sm.persona_add(makeTestPersona("beta-persona", "Beta"));
    sm.human_person_upsert(makeLinkedPerson("beta-person", "Beta Bot", "beta-persona"));

    const slug = slugifyProjectPath(fakeCwd, tmpHome);
    const sessionRoot = path.join(tmpHome, ".omp", "agent", "sessions", slug);
    await writeFixtureTree(sessionRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    process.env.HOME = originalHome;
    await fs.rm(tmpHome, { recursive: true, force: true });
  });

  it("with omp.integration: true, the scheduler's own tick reaches Bolt 004's classifier for both CD2 and CD3 transcripts — never calling importOmpSessions directly", async () => {
    const human = sm.getHuman();
    sm.setHuman({
      ...human,
      settings: { ...human.settings, omp: { integration: true } },
    });

    const manager = new IntegrationSyncManager(sm, true, null, new AbortController(), {} as Ei_Interface);

    await manager.checkAll(sm.getHuman(), Date.now());

    await vi.waitFor(
      () => {
        expect(scanRequestsFor(sm)).toHaveLength(2);
      },
      { timeout: 4000, interval: 20 }
    );

    const subjectIds = scanRequestsFor(sm).map((r) => (r.data as Record<string, unknown>).subjectPersonaId);
    expect(subjectIds.sort()).toEqual(["backend-engineer-persona", "beta-persona"].sort());

    await vi.waitFor(
      () => {
        expect(Object.keys(sm.getHuman().settings?.omp?.processed_sessions ?? {})).toHaveLength(2);
      },
      { timeout: 4000, interval: 20 }
    );
  });

  it("with omp.integration left at its default, the tick never imports — zero observations, zero checkpoint writes", async () => {
    // omp.integration is left unset entirely (default-off, D6's opt-in
    // gate) — checkAll's own gate is synchronous, so nothing is ever
    // scheduled; there is no async work to wait for here.
    const manager = new IntegrationSyncManager(sm, true, null, new AbortController(), {} as Ei_Interface);

    await manager.checkAll(sm.getHuman(), Date.now());

    expect(scanRequestsFor(sm)).toHaveLength(0);
    expect(sm.getHuman().settings?.omp?.processed_sessions).toBeUndefined();
  });
});

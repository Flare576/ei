import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { importOmpSessions } from "../../../src/integrations/omp/importer.js";
import { resolveExternalMessage } from "../../../src/cli/retrieval.js";
import { StateManager } from "../../../src/core/state-manager.js";
import type { Message } from "../../../src/core/types.js";
import { parseMessageId } from "../../../src/core/utils/message-id.js";
import { createMockStorage } from "../../helpers/mock-storage.js";
import { ompHeader, ompIrcIncoming, ompMessage, ompSubAgent, writeOmpTree } from "../integrations/shared/omp-transcript-fixtures.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, z: (actual.z ?? actual.default ?? actual) as Record<string, unknown> };
});
vi.mock("../../../src/integrations/process-check.js", () => ({ isProcessRunning: vi.fn().mockResolvedValue(false) }));
// Embeddings are outside id round-tripping; never load a model here.
vi.mock("../../../src/core/embedding-service.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEmbeddingService: () => ({ embed: async () => [] }),
}));

const NOW = Date.parse("2026-08-02T12:00:00.000Z");

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

// Tested by Beta — 2026-10-22
describe("OMP imported message ids resolve back to the stored message", () => {
  it.each(["percent%20name", "project:colon"])("resolves every imported id, explicit and line-numbered, from project directory %s", async (projectDir) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-id-roundtrip-"));
    const previousCwd = process.cwd();
    try {
      const home = path.join(dir, "home");
      const unrelated = path.join(dir, "unrelated");
      await fs.mkdir(home);
      await fs.mkdir(unrelated);
      vi.stubEnv("HOME", home);
      vi.stubEnv("EI_DATA_PATH", dir);
      process.chdir(unrelated);

      // Line numbers: header 1, blank and non-message rows count like any other line.
      const tree = await writeOmpTree(path.join(home, ".omp", "agent", "sessions"), {
        projectDir,
        stem: "2026-08-01_root",
        main: [
          ompHeader({ id: "tree", cwd: "/nonexistent/header/main" }),
          ompMessage("user", "main explicit question", { id: "main-u1", agent: "worker" }),
          "",
          ompIrcIncoming("not a message"),
          ompMessage("assistant", "main idless answer", { id: null, agent: "worker" }),
          ompMessage("assistant", "repeated idless text", { id: null, agent: "worker" }),
          ompMessage("assistant", "repeated idless text", { id: null, agent: "worker" }),
        ],
        children: {
          P: ompSubAgent({
            agent: "worker",
            parentSession: "root",
            messages: [
              ompMessage("user", "child idless task", { id: null, attribution: "agent" }),
              "",
              ompMessage("assistant", "child explicit reply", { id: "c-a1" }),
              ompMessage("assistant", "repeated idless text", { id: null }),
              ompMessage("assistant", "repeated idless text", { id: null }),
            ],
          }),
        },
      });

      const expected: Record<string, { ids: string[]; contents: string[] }> = {
        [tree.rootFile]: {
          ids: ["main-u1", "line-5", "line-6", "line-7"],
          contents: ["main explicit question", "main idless answer", "repeated idless text", "repeated idless text"],
        },
        [tree.children.P]: {
          ids: ["line-3", "c-a1", "line-6", "line-7"],
          contents: ["child idless task", "child explicit reply", "repeated idless text", "repeated idless text"],
        },
      };

      const sm = new StateManager();
      await sm.initialize(createMockStorage());
      const human = sm.getHuman();
      sm.setHuman({ ...human, settings: { ...human.settings, omp: { integration: true, processed_sessions: {} } } });

      const snapshots: Message[][] = [];
      for (let call = 0; call < 2; call++) {
        const result = await importOmpSessions({ stateManager: sm, now: () => NOW });
        expect(result.blocksQueued).toBe(1);
        snapshots.push(structuredClone(sm.persona_getAll().flatMap(p => sm.messages_get(p.id)).filter(m => m.external)));
        for (const request of sm.queue_getAllActiveItems()) sm.queue_complete(request.id);
      }

      const seenSessions = new Set<string>();
      const allIds = new Set<string>();
      for (const snapshot of snapshots) {
        expect(snapshot).toHaveLength(4);
        const session = parseMessageId(snapshot[0].id).session!;
        expect(Object.keys(expected)).toContain(session);
        seenSessions.add(session);
        expect(snapshot.map(m => parseMessageId(m.id).session)).toEqual(Array(4).fill(session));
        expect(snapshot.map(m => parseMessageId(m.id).nativeId)).toEqual(expected[session].ids);
        expect(snapshot.map(m => m.content)).toEqual(expected[session].contents);

        for (const message of snapshot) {
          allIds.add(message.id);
          const resolved = await resolveExternalMessage(message.id, 0, 0);
          if (!resolved || !("origin_kind" in resolved)) throw new Error(`expected a resolved message for ${message.id}, got ${JSON.stringify(resolved)}`);
          expect(resolved.origin_kind).toBe("omp");
          expect(resolved.source_id).toBe(message.id);
          expect(resolved.content).toBe(message.content);
          expect(resolved.timestamp).toBe(message.timestamp);
        }
      }
      expect(seenSessions).toEqual(new Set(Object.keys(expected)));
      expect(allIds.size).toBe(8);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

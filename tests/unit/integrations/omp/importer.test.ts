import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { importOmpSessions } from "../../../../src/integrations/omp/importer.js";
import { OmpReader } from "../../../../src/integrations/omp/reader.js";
import { importPiSessions } from "../../../../src/integrations/pi/importer.js";
import type { IPiReader, PiSession } from "../../../../src/integrations/pi/types.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import { LLMNextStep, type LLMRequest, type Message } from "../../../../src/core/types.js";
import { BUILT_IN_FACTS } from "../../../../src/core/constants/built-in-facts.js";
import { handleTopicUpdate } from "../../../../src/core/handlers/human-matching.js";
import { formatMessagesAsPlaceholders, hydratePromptPlaceholders } from "../../../../src/prompts/message-utils.js";
import { parseMessageId } from "../../../../src/core/utils/message-id.js";
import { getMachineId } from "../../../../src/integrations/machine-id.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import { ompHeader, ompMessage, ompSessionInit, ompSubAgent, writeOmpTree } from "../shared/omp-transcript-fixtures.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, z: (actual.z ?? actual.default ?? actual) as Record<string, unknown> };
});
vi.mock("../../../../src/integrations/process-check.js", () => ({ isProcessRunning: vi.fn().mockResolvedValue(false) }));
// Embeddings are outside speaker attribution and source propagation; never load a model here.
vi.mock("../../../../src/core/embedding-service.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getEmbeddingService: () => ({ embed: async () => [] }),
}));

const NOW = Date.parse("2026-08-02T12:00:00.000Z");
const OLD = "2026-08-01T00:01:00.000Z";
const EXTRACTION = [LLMNextStep.HandleFactFind, LLMNextStep.HandleHumanPersonScan, LLMNextStep.HandleHumanTopicScan, LLMNextStep.HandleEventScan];
afterEach(() => vi.restoreAllMocks());

async function makeState(factsKnown = false) {
  const sm = new StateManager();
  await sm.initialize(createMockStorage());
  const human = sm.getHuman();
  sm.setHuman({ ...human, facts: BUILT_IN_FACTS.map(({ name }, n) => ({ id: `fact-${n}`, name, description: factsKnown ? `Known ${name}` : "", sentiment: 0, last_updated: OLD, validated_date: "" })), settings: { ...human.settings, omp: { integration: true, processed_sessions: {} } } });
  return sm;
}
function readerAt(root: string) {
  const reader = new OmpReader();
  return { listTrees: () => reader.listTrees(root), readTranscript: (file: string) => reader.readTranscript(file) };
}
function drain(sm: StateManager) {
  for (const request of sm.queue_getAllActiveItems()) sm.queue_complete(request.id);
}
function extraction(sm: StateManager): LLMRequest[] {
  return sm.queue_getAllActiveItems().filter(r => EXTRACTION.includes(r.next_step));
}
function stored(sm: StateManager): Message[] {
  return sm.persona_getAll().flatMap(p => sm.messages_get(p.id)).filter(m => m.external);
}
async function extractTopic(sm: StateManager, request: LLMRequest, name: string, messages: Message[], quotes = false) {
  await handleTopicUpdate({
    success: true, content: null,
    request: { ...request, data: { ...request.data, isNewItem: true, candidateName: name, candidateDescription: `Description of ${name}`, message_ids_to_mark: messages.map(m => m.id) } },
    parsed: { name, description: `Description of ${name}`, ...(quotes && { quotes: messages.map(m => ({ text: m.content, reason: "Exact recorded statement" })) }) },
  }, sm);
}

// Tested by Beta — 2026-10-22
describe("OMP tree importer", () => {
  it("discovers every project and depth independently of process cwd and header cwd, preserving exact sources", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-discovery-"));
    const previousCwd = process.cwd();
    try {
      const root = path.join(dir, "sessions");
      const unrelated = path.join(dir, "unrelated");
      await fs.mkdir(unrelated);
      process.chdir(unrelated);
      const run = async (cwd: string) => {
        const sm = await makeState();
        const files: string[] = [];
        for (const [n, projectDir] of ["not-a-path-slug!", "another arbitrary folder"].entries()) {
          const tree = await writeOmpTree(root, {
            projectDir, stem: `2026-08-01_root-${n}`,
            main: [ompHeader({ id: `tree-${n}`, cwd }), ompMessage("user", `main ${n}`, { id: "main", timestamp: OLD, agent: `main-${n}` })],
            children: { "P.C": [ompHeader({ id: `child-${n}`, cwd, parentSession: "root" }), ompSessionInit({ agent: `worker-${n}` }), ompMessage("assistant", `child ${n}`, { id: "child", timestamp: OLD })] },
          });
          files.push(tree.rootFile, tree.children["P.C"]);
        }
        const snapshots: Message[] = [];
        for (let tick = 0; tick < files.length; tick++) {
          const result = await importOmpSessions({ stateManager: sm, reader: readerAt(root), now: () => NOW });
          expect(result.blocksQueued).toBe(1);
          const requests = extraction(sm);
          expect(requests.length).toBeGreaterThan(0);
          const request = requests.find(r => r.next_step === LLMNextStep.HandleHumanTopicScan)!;
          const messages = sm.messages_get(request.data.personaId as string);
          expect(messages).toHaveLength(1);
          const transcript = files.find(file => file === parseMessageId(messages[0].id).session);
          expect(transcript).toBeDefined();
          const expectedSource = `omp:${getMachineId()}:${transcript}`;
          expect(request.data.sources).toEqual([expectedSource]);
          await extractTopic(sm, request, `topic-${tick}`, messages);
          expect(sm.getHuman().topics.find(t => t.name === `topic-${tick}`)?.sources).toEqual([expectedSource]);
          snapshots.push(...messages);
          drain(sm);
        }
        expect(snapshots.map(m => m.content).sort()).toEqual(["child 0", "child 1", "main 0", "main 1"]);
        expect(new Set(snapshots.map(m => parseMessageId(m.id).session))).toEqual(new Set(files));
        return { messages: snapshots, sources: sm.getHuman().topics.map(t => t.sources) };
      };
      const first = await run("/nonexistent/header/project-A");
      const second = await run("/other/nonexistent/header/project-B");
      expect(second).toEqual(first);
    } finally {
      process.chdir(previousCwd);
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("produces distinct individually persisted message ids containing each full transcript path, never a truncated basename", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-message-paths-"));
    try {
      const sm = await makeState();
      const paths: string[] = [];
      for (const [n, projectDir] of ["a", "b"].entries()) {
        const tree = await writeOmpTree(dir, { projectDir, stem: `2026-08-01_tree-${n}`, main: [ompHeader({ id: `tree-${n}` })], children: { Worker: ompSubAgent({ agent: "backend-engineer", messages: [ompMessage("assistant", `content from transcript ${n}`, { id: "m1", timestamp: OLD })] }) } });
        paths.push(tree.children.Worker);
      }
      const persisted: Message[] = [];
      for (const transcript of paths) {
        expect((await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW })).blocksQueued).toBe(1);
        const messages = stored(sm);
        expect(messages).toHaveLength(1);
        persisted.push(structuredClone(messages[0]));
        expect(parseMessageId(messages[0].id).session).toBe(transcript);
        expect(parseMessageId(messages[0].id).nativeId).toBe("m1");
        drain(sm);
      }
      expect(persisted[0].id).not.toBe(persisted[1].id);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it.each([{ count: 1, known: false }, { count: 3, known: false }, { count: 2, known: true }])("queues the same extraction request set as Pi for $count messages with known facts $known", async ({ count, known }) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-pi-scans-"));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
      const sm = await makeState(known);
      const pi = await makeState(known);
      expect(sm.getHuman().facts.map(f => f.name).sort()).toEqual(BUILT_IN_FACTS.map(f => f.name).sort());
      expect(sm.getHuman().facts.every(f => known ? !!f.description : f.description === "")).toBe(true);
      expect(sm.getHuman().settings?.ceremony?.event_window_hours ?? 8).toBe(8);
      const timestamp = known ? new Date(NOW - 60 * 60_000).toISOString() : OLD;
      const messages = Array.from({ length: count }, (_, n) => ({ id: `m${n}`, sessionId: "pi-session", role: "assistant" as const, content: `Recorded statement ${n}`, timestamp }));
      await writeOmpTree(dir, { stem: "2026-08-01_tree", main: [ompHeader({ id: "tree" })], children: { P: ompSubAgent({ agent: "reviewer", messages: messages.map(m => ompMessage(m.role, m.content, { id: m.id, timestamp: m.timestamp })) }) } });
      const session: PiSession = { id: "pi-session", title: "Synthetic session", cwd: "/unused", firstMessageAt: timestamp, lastMessageAt: timestamp, messages };
      const piReader: IPiReader = { getSessions: async () => [session], getMessageById: async () => null, isAvailable: async () => true };
      await importPiSessions({ stateManager: pi, reader: piReader });
      const result = await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW });
      expect(result.blocksQueued).toBe(1);
      expect(stored(sm).map(m => m.timestamp)).toEqual(messages.map(m => m.timestamp));
      expect(sm.persona_getByName("Reviewer")?.is_archived).toBe(true);
      expect(sm.queue_getAllActiveItems().some(r => r.next_step === LLMNextStep.HandlePersonaSignalScan)).toBe(false);
      const shape = (state: StateManager) => extraction(state).map(r => ({ next: r.next_step, messages: (r.data.message_ids_to_mark as string[]).map(id => parseMessageId(id).nativeId), filter: r.data.external_filter })).sort((a, b) => a.next.localeCompare(b.next));
      expect(shape(sm)).toEqual(shape(pi));
      expect(extraction(sm).map(r => r.next_step).sort()).toEqual((known ? [LLMNextStep.HandleHumanPersonScan, LLMNextStep.HandleHumanTopicScan] : EXTRACTION).slice().sort());
    } finally { vi.useRealTimers(); await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("preserves parent, direct-human and absent attribution through stored messages, rendering and quote anchors", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-speakers-"));
    try {
      const sm = await makeState();
      await writeOmpTree(dir, { stem: "2026-08-01_mixed", main: [ompHeader({ id: "mixed" })], children: { "P.C": ompSubAgent({ agent: "reviewer", messages: [
        ompMessage("user", "Parent assignment explicitly attributed", { attribution: "agent", id: "parent", timestamp: OLD }),
        ompMessage("user", "Human directly steering this conversation", { attribution: "user", id: "human", timestamp: OLD }),
        ompMessage("user", "Parent assignment without attribution field", { id: "absent", timestamp: OLD }),
        ompMessage("assistant", "Subagent own answer stays its own", { id: "answer", timestamp: OLD }),
      ] }) } });
      expect((await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW })).blocksQueued).toBe(1);
      const request = extraction(sm).find(r => r.next_step === LLMNextStep.HandleHumanTopicScan)!;
      const messages = stored(sm);
      expect(messages).toHaveLength(4);
      expect(messages.filter(m => ["parent", "absent"].includes(parseMessageId(m.id).nativeId) && m.role === "human")).toHaveLength(0);
      const expected = [
        { id: "parent", role: "system", speaker: "Parent agent" },
        { id: "human", role: "human", speaker: undefined },
        { id: "absent", role: "system", speaker: "Parent agent" },
        { id: "answer", role: "system", speaker: undefined },
      ];
      for (const row of expected) {
        const message = messages.find(m => parseMessageId(m.id).nativeId === row.id)!;
        expect(message.role).toBe(row.role);
        expect(message.speaker_name).toBe(row.speaker);
        const speaker = row.speaker ?? (row.role === "human" ? "human" : "Reviewer");
        const rendered = hydratePromptPlaceholders(formatMessagesAsPlaceholders([message], "Reviewer"), new Map([[message.id, message]]));
        expect(rendered).toBe(`[${speaker}]: ${message.content}`);
      }
      await extractTopic(sm, request, "Speaker anchors", messages, true);
      expect(sm.getHuman().quotes).toHaveLength(4);
      for (const row of expected) {
        const message = messages.find(m => parseMessageId(m.id).nativeId === row.id)!;
        const quote = sm.getHuman().quotes.find(q => q.message_id === message.id)!;
        expect(quote.speaker).toBe(row.speaker ?? (row.role === "human" ? "human" : "Reviewer"));
        expect(quote.text).toBe(message.content);
        expect(quote.start).toBe(0);
        expect(message.content).toBeDefined();
        expect(quote.end).toBe(message.content!.length);
      }
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("stores zero human messages for a parent-only nested transcript", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-parent-only-"));
    try {
      const sm = await makeState();
      await writeOmpTree(dir, { stem: "2026-08-01_parent-only", main: [ompHeader({ id: "parent-only" })], children: { P: ompSubAgent({ agent: "reviewer", messages: [ompMessage("user", "Parent explicit", { attribution: "agent", timestamp: OLD }), ompMessage("user", "Parent implicit", { timestamp: OLD })] }) } });
      await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW });
      expect(stored(sm)).toHaveLength(2);
      expect(stored(sm).filter(m => m.role === "human")).toHaveLength(0);
      expect(stored(sm).map(m => m.speaker_name)).toEqual(["Parent agent", "Parent agent"]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("keeps a main-session user with no attribution human rather than Parent agent", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-main-human-"));
    try {
      const sm = await makeState();
      await writeOmpTree(dir, { stem: "2026-08-01_main", main: [ompHeader({ id: "main" }), ompMessage("user", "The human speaks in the main session", { timestamp: OLD })] });
      await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW });
      const messages = stored(sm);
      expect(messages).toHaveLength(1);
      expect(messages[0].role).toBe("human");
      expect(messages[0]).not.toHaveProperty("speaker_name");
      expect(hydratePromptPlaceholders(formatMessagesAsPlaceholders(messages, "OhMyPi"), new Map(messages.map(m => [m.id, m])))).toBe(`[human]: ${messages[0].content}`);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("ignores Pi checkpoints on the first OMP pass and leaves all Pi settings byte-identical", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-independent-settings-"));
    try {
      const sm = await makeState();
      const human = sm.getHuman();
      const treeId = "00000000-0000-7000-8000-000000000019";
      sm.setHuman({ ...human, settings: { ...human.settings, pi: { integration: false, processed_sessions: { [treeId]: new Date(NOW - 1000).toISOString() }, polling_interval_ms: 12345, extraction_model: "unchanged:model" } } });
      const before = JSON.stringify(sm.getHuman().settings?.pi);
      const appended: Message[] = [];
      const append = sm.messages_append.bind(sm);
      vi.spyOn(sm, "messages_append").mockImplementation((personaId, message) => {
        appended.push(structuredClone(message));
        return append(personaId, message);
      });
      await writeOmpTree(dir, { stem: `2026-08-01_${treeId}`, main: [ompHeader({ id: treeId }), ompMessage("user", "First historical message", { id: "first", timestamp: OLD })] });
      const result = await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW });
      expect(result.blocksQueued).toBe(1);
      expect(sm.getHuman().settings?.omp?.processed_sessions).toEqual({ [treeId]: new Date(NOW).toISOString() });
      expect(JSON.stringify(sm.getHuman().settings?.pi)).toBe(before);
      const firstAppend = appended.find(message => parseMessageId(message.id).nativeId === "first");
      expect(firstAppend).toBeDefined();
      expect(firstAppend).not.toHaveProperty("f");
      expect(firstAppend).not.toHaveProperty("t");
      expect(firstAppend).not.toHaveProperty("p");
      expect(firstAppend).not.toHaveProperty("e");
      const message = stored(sm)[0];
      expect(message.content).toBe("First historical message");
      expect(extraction(sm).find(r => r.next_step === LLMNextStep.HandleHumanTopicScan)?.data.message_ids_to_mark).toEqual([message.id]);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });

  it("strips control characters from imported persona identities and transcript console output", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-control-characters-"));
    try {
      const sm = await makeState();
      const beforeCount = sm.persona_getAll().length;
      const output: string[] = [];
      for (const method of ["log", "warn", "error"] as const) {
        vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { output.push(...args.map(String)); });
      }
      await writeOmpTree(dir, {
        stem: "2026-08-01_00000000-0000-7000-8000-000000000020",
        main: [ompHeader({ id: "00000000-0000-7000-8000-000000000020" })],
        children: { "P\u0007\u001b": ompSubAgent({ agent: "backend\u0007\u001bengineer", messages: [ompMessage("assistant", "A sanitized imported identity", { timestamp: OLD })] }) },
      });
      expect((await importOmpSessions({ stateManager: sm, reader: readerAt(dir), now: () => NOW })).blocksQueued).toBe(1);
      expect(sm.persona_getAll()).toHaveLength(beforeCount + 1);
      const persona = sm.persona_getAll().find(p => sm.messages_get(p.id).some(m => m.external));
      expect(persona).toBeDefined();
      expect(persona!.display_name).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      const aliases = persona?.aliases ?? [];
      expect(aliases.length).toBeGreaterThan(0);
      for (const alias of aliases) expect(alias).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
      expect(output.some(argument => argument.includes("[OMP] Queued"))).toBe(true);
      for (const argument of output) expect(argument).not.toMatch(/[\u0000-\u001F\u007F-\u009F]/);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { importOmpSessions } from "../../../../src/integrations/omp/importer.js";
import { OmpReader } from "../../../../src/integrations/omp/reader.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import { ensureAgentPersona } from "../../../../src/core/personas/opencode-agent.js";
import { ContextStatus, type Message } from "../../../../src/core/types.js";
import * as ceremony from "../../../../src/core/orchestrators/ceremony.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import { ompHeader, ompMessage, ompSubAgent, writeOmpTree } from "../shared/omp-transcript-fixtures.js";

vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, z: (actual.z ?? actual.default ?? actual) as Record<string, unknown> };
});

const PLAN = Date.parse("2026-08-03T00:00:00.000Z");
const PREVIOUS = "2026-07-31T00:00:00.000Z";
const OLD = "2026-07-01T00:00:00.000Z";
const TREE = "queue-tree";
const iso = (ms: number) => new Date(ms).toISOString();

function storedMessage(id: string, external = true): Message {
  return { id, role: "human", content: id, timestamp: OLD, read: true, context_status: ContextStatus.Default, external };
}

function externalText(sm: StateManager, personaId: string): string[] {
  return sm.messages_get(personaId).filter((m) => m.external).map((m) => m.content ?? "");
}

function drain(sm: StateManager): void {
  for (const item of sm.queue_getAllActiveItems()) sm.queue_complete(item.id);
  expect(sm.queue_length()).toBe(0);
}

describe("OMP block queue and restart", () => {
  let root: string;
  let sm: StateManager;
  let reader: Pick<OmpReader, "listTrees" | "readTranscript">;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-block-queue-"));
    sm = new StateManager();
    await sm.initialize(createMockStorage());
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, omp: { integration: true } } });
    const realReader = new OmpReader();
    reader = { listTrees: () => realReader.listTrees(root), readTranscript: (file) => realReader.readTranscript(file) };
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(root, { recursive: true, force: true });
  });

  function run(now = PLAN) {
    return importOmpSessions({ stateManager: sm, reader, now: () => now });
  }

  function setPrevious(): void {
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, omp: { ...human.settings?.omp, processed_sessions: { [TREE]: PREVIOUS } } } });
  }

  async function threeBlocks(lastSkipped = false) {
    return writeOmpTree(root, {
      stem: `session_${TREE}`,
      main: [
        ompHeader({ id: TREE }),
        ompMessage("assistant", "main block", { agent: "worker", id: "main" }),
      ],
      children: {
        A: ompSubAgent({ agent: "worker", messages: [ompMessage("assistant", "first child", { id: "child-a", timestamp: "2026-08-01T01:00:00.000Z" })] }),
        B: ompSubAgent({ agent: "worker", messages: [
          ompMessage("assistant", "second child", { id: "child-b", timestamp: "2026-08-01T02:00:00.000Z" }),
          ompMessage("assistant", "after original plan", { id: "late", timestamp: iso(PLAN + 30 * 60_000) }),
        ] }),
        ...(lastSkipped ? {
          Z: ompSubAgent({ agent: "worker", messages: [ompMessage("assistant", "old block", { id: "old", timestamp: OLD })] }),
        } : {}),
      },
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
  }

  it("holds exactly the current block at every pending gate and preserves other personas and local messages", async () => {
    setPrevious();
    await threeBlocks(true);
    const worker = await ensureAgentPersona("worker", { stateManager: sm });
    const other = await ensureAgentPersona("other", { stateManager: sm });
    sm.messages_append(worker.id, storedMessage("previous external"));
    sm.messages_append(worker.id, storedMessage("local conversation", false));
    sm.messages_append(other.id, storedMessage("other persona external"));
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");

    for (const expected of ["main block", "first child", "second child"]) {
      const result = await run();
      expect(result.blocksQueued).toBe(1);
      expect(sm.queue_length()).toBeGreaterThan(0);
      expect(externalText(sm, worker.id)).toEqual([expected]);
      expect(externalText(sm, other.id)).toEqual(["other persona external"]);
      expect(sm.messages_get(worker.id).filter((m) => !m.external).map((m) => m.content)).toEqual(["local conversation"]);
      const writesBeforeGate = { remove: remove.mock.calls.length, append: append.mock.calls.length };
      const cursorBeforeGate = structuredClone(sm.getHuman().settings?.omp);
      const pendingIds = sm.queue_getAllActiveItems().map((item) => item.id);
      expect((await run()).blocksQueued).toBe(0);
      expect(externalText(sm, worker.id)).toEqual([expected]);
      expect(externalText(sm, other.id)).toEqual(["other persona external"]);
      expect(remove).toHaveBeenCalledTimes(writesBeforeGate.remove);
      expect(append).toHaveBeenCalledTimes(writesBeforeGate.append);
      expect(sm.getHuman().settings?.omp).toEqual(cursorBeforeGate);
      expect(sm.queue_getAllActiveItems().map((item) => item.id)).toEqual(pendingIds);
      drain(sm);
    }
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    expect(append.mock.calls.some(([, m]) => m.content === "old block")).toBe(false);
    expect(remove.mock.calls.every(([id]) => id === worker.id)).toBe(true);
  });

  it.each([false, true])("queues rewrites once after the last handled block and before completion (last block skipped: %s)", async (lastSkipped) => {
    setPrevious();
    if (lastSkipped) {
      await writeOmpTree(root, {
        stem: `session_${TREE}`, main: [ompHeader({ id: TREE }),
          ompMessage("assistant", "first main", { agent: "worker" }),
          ompMessage("assistant", "second main", { agent: "reviewer" })],
        children: { A: ompSubAgent({ agent: "worker", messages: [ompMessage("assistant", "old child", { timestamp: OLD })] }) },
        mtime: new Date("2026-08-02T00:00:00.000Z"),
      });
    } else {
      await threeBlocks();
    }
    const person = vi.spyOn(ceremony, "queuePersonRewritePhase");
    const topic = vi.spyOn(ceremony, "queueTopicRewritePhase");
    const writes = vi.spyOn(sm, "setHuman");
    const scans = vi.spyOn(sm, "queue_enqueue");
    const count = lastSkipped ? 2 : 3;
    for (let i = 0; i < count; i++) {
      expect((await run()).blocksQueued).toBe(1);
      if (i < count - 1 || lastSkipped) {
        expect(person).not.toHaveBeenCalled();
        expect(topic).not.toHaveBeenCalled();
      }
      if (i < count - 1 || lastSkipped) drain(sm);
    }
    if (lastSkipped) expect((await run()).blocksQueued).toBe(0);
    expect(person).toHaveBeenCalledTimes(1);
    expect(topic).toHaveBeenCalledTimes(1);
    const completion = writes.mock.calls.findIndex(([h]) => h.settings?.omp?.processed_sessions?.[TREE] === iso(PLAN));
    expect(completion).toBeGreaterThanOrEqual(0);
    expect(person.mock.invocationCallOrder[0]).toBeGreaterThan(scans.mock.invocationCallOrder.at(-1)!);
    expect(topic.mock.invocationCallOrder[0]).toBeGreaterThan(scans.mock.invocationCallOrder.at(-1)!);
    expect(person.mock.invocationCallOrder[0]).toBeLessThan(writes.mock.invocationCallOrder[completion]);
    expect(topic.mock.invocationCallOrder[0]).toBeLessThan(writes.mock.invocationCallOrder[completion]);
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
  });

  it("retains pre-crash scan history when a resumed completion queues no new scans", async () => {
    await threeBlocks();
    await run(); drain(sm);
    await run(); drain(sm);
    const realSetHuman = sm.setHuman.bind(sm);
    const crash = vi.spyOn(sm, "setHuman").mockImplementation((human) => {
      realSetHuman(human);
      if (human.settings?.omp?.current_tree?.done.length === 3) throw new Error("crash after final block checkpoint");
    });
    await expect(run()).rejects.toThrow("crash after final block checkpoint");
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toHaveLength(3);
    crash.mockRestore();
    drain(sm);
    const person = vi.spyOn(ceremony, "queuePersonRewritePhase");
    const topic = vi.spyOn(ceremony, "queueTopicRewritePhase");
    const writes = vi.spyOn(sm, "setHuman");
    const append = vi.spyOn(sm, "messages_append");
    const remove = vi.spyOn(sm, "messages_remove");
    const result = await run(PLAN + 3_600_000);
    expect(result).toMatchObject({ blocksQueued: 0, treesCompleted: 1, scansQueued: 0 });
    expect(append).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(person).toHaveBeenCalledTimes(1);
    expect(topic).toHaveBeenCalledTimes(1);
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0].settings?.omp).toMatchObject({ processed_sessions: { [TREE]: iso(PLAN) } });
    expect(writes.mock.calls[0][0].settings?.omp?.current_tree).toBeUndefined();
    expect(sm.queue_length()).toBe(0);
  });

  it.each([false, true])("completes a readable all-skipped tree without mutations and continues to the next tree (crashed: %s)", async (crashed) => {
    setPrevious();
    const skipped = await writeOmpTree(root, {
      stem: `skipped_${TREE}`, main: [ompHeader({ id: TREE }), ompMessage("assistant", "old root", { agent: "worker", timestamp: OLD })],
      children: { A: ompSubAgent({ agent: "worker", messages: [ompMessage("assistant", "old child", { timestamp: OLD })] }) },
      extraFiles: { "notes.md": "Only this non-transcript file changed." },
      mtime: new Date("2026-07-15T00:00:00.000Z"),
    });
    await fs.utimes(skipped.extraFiles["notes.md"], new Date("2026-08-01T00:00:00.000Z"), new Date("2026-08-01T00:00:00.000Z"));
    const worker = await ensureAgentPersona("worker", { stateManager: sm });
    sm.messages_append(worker.id, storedMessage("untouched external"));
    const person = vi.spyOn(ceremony, "queuePersonRewritePhase");
    const topic = vi.spyOn(ceremony, "queueTopicRewritePhase");
    const append = vi.spyOn(sm, "messages_append");
    const remove = vi.spyOn(sm, "messages_remove");
    const writes = vi.spyOn(sm, "setHuman");
    if (crashed) {
      const realRead = reader.readTranscript;
      let childReads = 0;
      const fail = vi.spyOn(reader, "readTranscript").mockImplementation(async (file) => {
        if (file === skipped.children.A && ++childReads === 2) throw new Error("crash before second skipped block");
        return realRead(file);
      });
      await expect(run()).rejects.toThrow("crash before second skipped block");
      expect(sm.getHuman().settings?.omp?.current_tree?.done ?? []).toEqual([]);
      expect(writes).not.toHaveBeenCalled();
      expect(person).not.toHaveBeenCalled();
      expect(topic).not.toHaveBeenCalled();
      fail.mockRestore();
    }
    const result = await run();
    expect(result).toEqual({ blocksQueued: 0, treesCompleted: 1, scansQueued: 0 });
    expect(writes).toHaveBeenCalledTimes(1);
    expect(writes.mock.calls[0][0].settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(writes.mock.calls[0][0].settings?.omp?.current_tree).toBeUndefined();
    expect(append).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(externalText(sm, worker.id)).toEqual(["untouched external"]);
    expect(person).not.toHaveBeenCalled();
    expect(topic).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
    const opens = vi.spyOn(reader, "readTranscript");
    expect((await run()).treesCompleted).toBe(0);
    expect(opens).not.toHaveBeenCalled();

    // A later non-transcript edit reopens the skipped tree; it must not starve the following tree.
    await fs.utimes(skipped.extraFiles["notes.md"], new Date(PLAN + 60_000), new Date(PLAN + 60_000));
    await writeOmpTree(root, { stem: "later_later-tree", main: [ompHeader({ id: "later-tree" }), ompMessage("assistant", "later tree work", { agent: "reviewer" })], mtime: new Date(PLAN + 120_000) });
    opens.mockClear();
    const later = await run(PLAN + 3_600_000);
    expect(later).toMatchObject({ treesCompleted: 2, blocksQueued: 1 });
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN + 3_600_000));
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(externalText(sm, reviewer.id)).toEqual(["later tree work"]);
    expect(writes.mock.calls.every(([h]) => (h.settings?.omp?.current_tree?.done ?? []).every((key) => !key.includes("skipped")))).toBe(true);
  });

  it("resumes after a checkpointed block with the original plan and never re-wipes a completed block", async () => {
    await threeBlocks();
    const realSetHuman = sm.setHuman.bind(sm);
    const crash = vi.spyOn(sm, "setHuman").mockImplementation((human) => {
      realSetHuman(human);
      if (human.settings?.omp?.current_tree?.done.length === 1) throw new Error("crash after first checkpoint");
    });
    await expect(run()).rejects.toThrow("crash after first checkpoint");
    const cursor = structuredClone(sm.getHuman().settings?.omp?.current_tree);
    expect(cursor?.planned_at).toBe(iso(PLAN));
    expect(cursor?.done).toHaveLength(1);
    crash.mockRestore();
    drain(sm);
    const writes = vi.spyOn(sm, "setHuman");
    const append = vi.spyOn(sm, "messages_append");
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toHaveLength(2);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["first child"]);
    drain(sm);
    expect((await run(PLAN + 3_600_000)).treesCompleted).toBe(1);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["first child", "second child"]);
    const completed = writes.mock.calls.filter(([h]) => h.settings?.omp?.processed_sessions?.[TREE] !== undefined);
    expect(completed).toHaveLength(1);
    expect(completed[0][0].settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(completed[0][0].settings?.omp?.current_tree).toBeUndefined();
    expect(writes.mock.calls.filter(([h]) => h.settings?.omp?.current_tree === undefined)).toHaveLength(1);
  });

  it("keeps two main-session persona keys distinct and stable across fresh importer invocations", async () => {
    await writeOmpTree(root, {
      stem: `main-personas_${TREE}`, main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "first persona", { agent: "worker", id: "worker-main" }),
        ompMessage("assistant", "second persona", { agent: "reviewer", id: "reviewer-main" })],
      children: { A: ompSubAgent({ agent: "other", messages: [ompMessage("assistant", "descendant", { id: "descendant" })] }) },
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const realSetHuman = sm.setHuman.bind(sm);
    const crash = vi.spyOn(sm, "setHuman").mockImplementation((human) => {
      realSetHuman(human);
      if (human.settings?.omp?.current_tree?.done.length === 1) throw new Error("crash between main personas");
    });
    await expect(run()).rejects.toThrow("crash between main personas");
    crash.mockRestore();
    const firstKey = sm.getHuman().settings?.omp?.current_tree?.done[0];
    const worker = sm.persona_getByName("Worker")!;
    drain(sm);
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    const keys = sm.getHuman().settings?.omp?.current_tree?.done ?? [];
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
    expect(keys[0]).toBe(firstKey);
    expect(externalText(sm, worker.id)).toEqual(["first persona"]);
    const reviewer = sm.persona_getByName("Reviewer");
    expect(reviewer).not.toBeNull();
    expect(externalText(sm, reviewer!.id)).toEqual(["second persona"]);
    expect(remove.mock.calls.some(([id]) => id === worker.id)).toBe(false);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["second persona"]);
    drain(sm);
    expect((await run(PLAN + 3_600_000)).treesCompleted).toBe(1);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["second persona", "descendant"]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
  });

  it("does not record a block as done if its scan enqueue crashes", async () => {
    await threeBlocks();
    const enqueue = vi.spyOn(sm, "queue_enqueue").mockImplementationOnce(() => { throw new Error("scan queue unavailable"); });
    await expect(run()).rejects.toThrow("scan queue unavailable");
    expect(sm.getHuman().settings?.omp?.current_tree?.done ?? []).toEqual([]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBeUndefined();
    expect(sm.queue_length()).toBe(0);
    enqueue.mockRestore();
    expect((await run()).blocksQueued).toBe(1);
    expect(sm.queue_length()).toBeGreaterThan(0);
    const worker = sm.persona_getByName("Worker")!;
    expect(externalText(sm, worker.id)).toEqual(["main block"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toHaveLength(1);
  });
});

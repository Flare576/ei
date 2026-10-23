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
import * as extraction from "../../../../src/core/orchestrators/human-extraction.js";
import type { ExtractionContext } from "../../../../src/core/orchestrators/human-extraction.js";
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
    const written = await threeBlocks();
    const base = path.basename(written.rootFile);
    const realSetHuman = sm.setHuman.bind(sm);
    const crash = vi.spyOn(sm, "setHuman").mockImplementation((human) => {
      realSetHuman(human);
      if (human.settings?.omp?.current_tree?.done.length === 1) throw new Error("crash after first checkpoint");
    });
    await expect(run()).rejects.toThrow("crash after first checkpoint");
    const cursor = structuredClone(sm.getHuman().settings?.omp?.current_tree);
    expect(cursor?.planned_at).toBe(iso(PLAN));
    expect(cursor?.done).toEqual([`${base}|Worker`]);
    crash.mockRestore();
    drain(sm);
    const writes = vi.spyOn(sm, "setHuman");
    const append = vi.spyOn(sm, "messages_append");
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Worker`, "A.jsonl"]);
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
    const written = await writeOmpTree(root, {
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
    const base = path.basename(written.rootFile);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Worker`]);
    const worker = sm.persona_getByName("Worker")!;
    drain(sm);
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    const keys = sm.getHuman().settings?.omp?.current_tree?.done ?? [];
    expect(keys).toEqual([`${base}|Worker`, `${base}|Reviewer`]);
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

  // Tested by `Beta` — 2026-10-22
  it("files main-session names that are aliases of one stored persona in a single block", async () => {
    const quality = await ensureAgentPersona("Quality", { stateManager: sm });
    expect(sm.persona_update(quality.id, { aliases: ["reviewer", "auditor"] })).toBe(true);
    const personasBefore = sm.persona_getAll().map((p) => p.id);
    expect(sm.persona_getAll().some((p) => p.display_name === "Reviewer")).toBe(false);
    expect(sm.persona_getAll().some((p) => p.display_name === "Auditor")).toBe(false);
    const contents = ["first", "second", "third", "fourth"];
    const agents = ["reviewer", "auditor", "reviewer", "auditor"];
    await writeOmpTree(root, {
      stem: `quality_${TREE}`,
      main: [ompHeader({ id: TREE }), ...contents.map((text, i) =>
        ompMessage("assistant", text, { agent: agents[i], id: `quality-${i}`, timestamp: iso(PLAN - 2 * 86_400_000 + (i + 1) * 60_000) }))],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const scans = vi.spyOn(extraction, "queueAllScans");
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");

    expect(await run()).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });
    expect(sm.queue_length()).toBeGreaterThan(0);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(scans.mock.calls[0][0].personaId).toBe(quality.id);
    expect(scans.mock.calls[0][0].messages_analyze.map((m) => m.content)).toEqual(contents);
    expect(externalText(sm, quality.id)).toEqual(contents);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(contents);
    expect(remove).not.toHaveBeenCalled();

    expect(await run()).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    drain(sm);
    expect(await run()).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(scans).toHaveBeenCalledTimes(1);
    expect(append).toHaveBeenCalledTimes(4);
    expect(remove).not.toHaveBeenCalled();
    expect(externalText(sm, quality.id)).toEqual(contents);
    expect(sm.persona_getAll().map((p) => p.id)).toEqual(personasBefore);
    expect(sm.persona_getAll().some((p) => p.display_name === "Reviewer")).toBe(false);
    expect(sm.persona_getAll().some((p) => p.display_name === "Auditor")).toBe(false);
  });

  it("groups differently-spelled names of one unstored persona into one block and keeps another persona separate", async () => {
    const written = await writeOmpTree(root, {
      stem: `spellings_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "spelled lower", { agent: "reviewer", id: "m1", timestamp: iso(PLAN - 2 * 86_400_000 + 60_000) }),
        ompMessage("assistant", "spelled title", { agent: "Reviewer", id: "m2", timestamp: iso(PLAN - 2 * 86_400_000 + 120_000) }),
        ompMessage("assistant", "spelled upper", { agent: "REVIEWER", id: "m3", timestamp: iso(PLAN - 2 * 86_400_000 + 180_000) }),
        ompMessage("assistant", "worker only", { agent: "worker", id: "m4", timestamp: iso(PLAN - 2 * 86_400_000 + 240_000) })],
      children: { A: ompSubAgent({ agent: "other", messages: [ompMessage("assistant", "child work", { id: "c1", timestamp: iso(PLAN - 2 * 86_400_000 + 300_000) })] }) },
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const base = path.basename(written.rootFile);
    expect(sm.persona_getByName("Reviewer")).toBeNull();
    expect(sm.persona_getByName("Worker")).toBeNull();
    const scans = vi.spyOn(extraction, "queueAllScans");

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(reviewer).not.toBeNull();
    expect(scans.mock.calls[0][0].messages_analyze.map((m) => m.content)).toEqual(["spelled lower", "spelled title", "spelled upper"]);
    expect(externalText(sm, reviewer.id)).toEqual(["spelled lower", "spelled title", "spelled upper"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`, `${base}|REVIEWER`]);
    expect(sm.persona_getByName("Worker")).toBeNull();

    drain(sm);
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    const worker = sm.persona_getByName("Worker")!;
    expect(worker).not.toBeNull();
    expect(worker.id).not.toBe(reviewer.id);
    expect(externalText(sm, worker.id)).toEqual(["worker only"]);
    expect(externalText(sm, reviewer.id)).toEqual(["spelled lower", "spelled title", "spelled upper"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`, `${base}|REVIEWER`, `${base}|Worker`]);

    drain(sm);
    expect((await run(PLAN + 3_600_000)).treesCompleted).toBe(1);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
  });

  it("resumes after a newly created first main persona without redoing its block", async () => {
    const written = await writeOmpTree(root, {
      stem: `restart-spellings_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "spelled lower", { agent: "reviewer", id: "m1", timestamp: iso(PLAN - 2 * 86_400_000 + 60_000) }),
        ompMessage("assistant", "spelled title", { agent: "Reviewer", id: "m2", timestamp: iso(PLAN - 2 * 86_400_000 + 120_000) }),
        ompMessage("assistant", "spelled upper", { agent: "REVIEWER", id: "m3", timestamp: iso(PLAN - 2 * 86_400_000 + 180_000) }),
        ompMessage("assistant", "worker only", { agent: "worker", id: "m4", timestamp: iso(PLAN - 2 * 86_400_000 + 240_000) })],
      children: { A: ompSubAgent({ agent: "Other", messages: [ompMessage("assistant", "child work", { id: "c1", timestamp: iso(PLAN - 2 * 86_400_000 + 300_000) })] }) },
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const base = path.basename(written.rootFile);
    expect(sm.persona_getByName("Reviewer")).toBeNull();
    const scans = vi.spyOn(extraction, "queueAllScans");
    const realSetHuman = sm.setHuman.bind(sm);
    const crash = vi.spyOn(sm, "setHuman").mockImplementation((human) => {
      realSetHuman(human);
      if (human.settings?.omp?.current_tree?.done.length === 2) throw new Error("crash after first main persona");
    });
    await expect(run()).rejects.toThrow("crash after first main persona");
    crash.mockRestore();
    const cursor = structuredClone(sm.getHuman().settings?.omp?.current_tree);
    expect(cursor?.done).toEqual([`${base}|Reviewer`, `${base}|REVIEWER`]);
    expect(cursor?.planned_at).toBe(iso(PLAN));
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(reviewer).not.toBeNull();
    expect(externalText(sm, reviewer.id)).toEqual(["spelled lower", "spelled title", "spelled upper"]);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(scans.mock.calls[0][0].personaId).toBe(reviewer.id);
    expect(scans.mock.calls[0][0].messages_analyze.map((m) => m.content)).toEqual(["spelled lower", "spelled title", "spelled upper"]);
    drain(sm);

    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect((await run(PLAN + 3_600_000)).blocksQueued).toBe(1);
    const current = sm.getHuman().settings?.omp?.current_tree;
    expect(current?.planned_at).toBe(iso(PLAN));
    expect(current?.done).toEqual([`${base}|Reviewer`, `${base}|REVIEWER`, `${base}|Worker`]);
    const worker = sm.persona_getByName("Worker")!;
    expect(worker).not.toBeNull();
    expect(remove.mock.calls.some(([id]) => id === reviewer.id)).toBe(false);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["worker only"]);
    expect(scans).toHaveBeenCalledTimes(2);
    expect(scans.mock.calls[1][0].personaId).toBe(worker.id);
    expect(externalText(sm, reviewer.id)).toEqual(["spelled lower", "spelled title", "spelled upper"]);

    drain(sm);
    expect((await run(PLAN + 3_600_000)).treesCompleted).toBe(1);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["worker only", "child work"]);
    expect(scans).toHaveBeenCalledTimes(3);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
  });

  it("files one block for names made aliases by creating the persona and does not redo it after a restart", async () => {
    await writeOmpTree(root, {
      stem: `creation-alias_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "plain sisyphus words", { agent: "sisyphus", id: "s1", timestamp: iso(PLAN - 2 * 86_400_000 + 60_000) }),
        ompMessage("assistant", "ultraworker words", { agent: "sisyphus-ultraworker", id: "s2", timestamp: iso(PLAN - 2 * 86_400_000 + 120_000) })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const findSisyphus = (manager: StateManager) => manager.persona_getAll().find((p) => p.display_name === "Sisyphus");
    expect(findSisyphus(sm)).toBeUndefined();
    const personasBefore = sm.persona_getAll().map((p) => p.id);
    const scans = vi.spyOn(extraction, "queueAllScans");

    const first = await run();
    expect(first.blocksQueued).toBe(1);
    expect(first.treesCompleted).toBe(1);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    expect(sm.queue_length()).toBeGreaterThan(0);
    const sisyphus = findSisyphus(sm);
    expect(sisyphus).toBeDefined();
    expect(sm.persona_getAll().map((p) => p.id).filter((id) => !personasBefore.includes(id))).toEqual([sisyphus!.id]);
    expect(sisyphus!.aliases).toContain("Sisyphus Ultraworker");
    expect(externalText(sm, sisyphus!.id)).toEqual(["plain sisyphus words", "ultraworker words"]);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(scans.mock.calls[0][0].personaId).toBe(sisyphus!.id);
    expect(scans.mock.calls[0][0].messages_analyze.map((m) => m.content)).toEqual(["plain sisyphus words", "ultraworker words"]);
    drain(sm);

    const snapshot = structuredClone(sm.getStorageState());
    const storage = createMockStorage();
    storage.load = vi.fn(async () => structuredClone(snapshot));
    const restarted = new StateManager();
    await restarted.initialize(storage);
    const remove = vi.spyOn(restarted, "messages_remove");
    const append = vi.spyOn(restarted, "messages_append");
    const second = await importOmpSessions({ stateManager: restarted, reader, now: () => PLAN + 3_600_000 });
    expect(second.blocksQueued).toBe(0);
    expect(second.scansQueued).toBe(0);
    expect(restarted.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    const restored = findSisyphus(restarted);
    expect(restored).toBeDefined();
    expect(restored!.id).toBe(sisyphus!.id);
    expect(externalText(restarted, restored!.id)).toEqual(["plain sisyphus words", "ultraworker words"]);
    expect(append).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(scans).toHaveBeenCalledTimes(1);
    expect(scans.mock.calls.flatMap(([args]) => args.messages_analyze.map((m) => m.content))).toEqual(["plain sisyphus words", "ultraworker words"]);
  });

  it("creates a separate persona for a main-session name that only partially matches an existing one", async () => {
    const codeReviewer = await ensureAgentPersona("code-reviewer", { stateManager: sm });
    expect(codeReviewer.display_name).toBe("Code Reviewer");
    const aliasesBefore = [...(sm.persona_getById(codeReviewer.id)!.aliases ?? [])];
    const messagesBefore = structuredClone(sm.messages_get(codeReviewer.id));
    const countBefore = sm.persona_getAll().length;
    expect(sm.persona_getAll().some((p) => p.display_name === "Reviewer")).toBe(false);
    await writeOmpTree(root, {
      stem: `partial_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "review one", { agent: "reviewer", id: "p1", timestamp: iso(PLAN - 2 * 86_400_000 + 60_000) }),
        ompMessage("assistant", "review two", { agent: "reviewer", id: "p2", timestamp: iso(PLAN - 2 * 86_400_000 + 120_000) })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const scans = vi.spyOn(extraction, "queueAllScans");

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getAll().find((p) => p.display_name === "Reviewer")!;
    expect(reviewer).toBeDefined();
    expect(reviewer.id).not.toBe(codeReviewer.id);
    expect(sm.persona_getAll()).toHaveLength(countBefore + 1);
    expect(sm.persona_getById(codeReviewer.id)!.display_name).toBe("Code Reviewer");
    expect(sm.persona_getById(codeReviewer.id)!.aliases).toEqual(aliasesBefore);
    expect(sm.messages_get(codeReviewer.id)).toEqual(messagesBefore);
    expect(externalText(sm, reviewer.id)).toEqual(["review one", "review two"]);
    expect(scans).toHaveBeenCalledTimes(1);
    expect(scans.mock.calls[0][0].personaId).toBe(reviewer.id);
  });

  it("creates no persona while planning main-session blocks that are all skipped", async () => {
    setPrevious();
    await writeOmpTree(root, {
      stem: `skipped-main_${TREE}`,
      main: [ompHeader({ id: TREE }), ompMessage("assistant", "old reviewer work", { agent: "reviewer", id: "old", timestamp: OLD })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    expect(sm.persona_getByName("Reviewer")).toBeNull();
    const personasBefore = sm.persona_getAll().map((p) => p.id);
    const add = vi.spyOn(sm, "persona_add");
    const append = vi.spyOn(sm, "messages_append");
    const remove = vi.spyOn(sm, "messages_remove");
    const scans = vi.spyOn(extraction, "queueAllScans");

    expect(await run()).toEqual({ blocksQueued: 0, treesCompleted: 1, scansQueued: 0 });
    expect(add).not.toHaveBeenCalled();
    expect(sm.persona_getByName("Reviewer")).toBeNull();
    expect(sm.persona_getAll().map((p) => p.id)).toEqual(personasBefore);
    expect(append).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(scans).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
  });

  // Tested by `Beta` — 2026-10-22
  function spyScans(): ExtractionContext[] {
    const real = extraction.queueAllScans;
    const contexts: ExtractionContext[] = [];
    vi.spyOn(extraction, "queueAllScans").mockImplementation((context, state, options) => {
      contexts.push(structuredClone(context));
      real(context, state, options);
    });
    return contexts;
  }

  const contents = (messages: Message[]) => messages.map((m) => m.content);
  const marks = (m: Message) => [m.f, m.t, m.p, m.e];
  const EARLY = PLAN - 2 * 86_400_000;

  async function reviewerThenAuditor(): Promise<string> {
    const written = await writeOmpTree(root, {
      stem: `members_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "reviewer words", { agent: "reviewer", id: "r1", timestamp: iso(EARLY + 60_000) }),
        ompMessage("assistant", "auditor words", { agent: "auditor", id: "a1", timestamp: iso(EARLY + 120_000) })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    return path.basename(written.rootFile);
  }

  it("analyzes a member made an alias of a handled persona once, keeping the handled member as premarked context", async () => {
    const base = await reviewerThenAuditor();
    expect(sm.persona_getByName("Reviewer")).toBeNull();
    expect(sm.persona_getByName("Auditor")).toBeNull();
    const contexts = spyScans();

    expect(await run()).toEqual({ blocksQueued: 1, treesCompleted: 0, scansQueued: expect.any(Number) });
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(reviewer).not.toBeNull();
    expect(sm.persona_getByName("Auditor")).toBeNull();
    expect(contexts).toHaveLength(1);
    expect(contexts[0].personaId).toBe(reviewer.id);
    expect(contents(contexts[0].messages_analyze)).toEqual(["reviewer words"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`]);
    expect(sm.getHuman().settings?.omp?.current_tree?.planned_at).toBe(iso(PLAN));
    drain(sm);

    expect(reviewer.aliases).toEqual(["reviewer"]);
    expect(sm.persona_update(reviewer.id, { aliases: ["reviewer", "auditor"] })).toBe(true);
    const personasBefore = sm.persona_getAll().map((p) => p.id);
    const append = vi.spyOn(sm, "messages_append");
    expect(await run(PLAN + 3_600_000)).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });

    expect(sm.persona_getAll().map((p) => p.id)).toEqual(personasBefore);
    expect(sm.persona_getByName("Auditor")!.id).toBe(reviewer.id);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].personaId).toBe(reviewer.id);
    expect(contents(contexts[1].messages_analyze)).toEqual(["auditor words"]);
    expect(contexts[1].messages_analyze.map(marks)).toEqual([[undefined, undefined, undefined, undefined]]);
    expect(contents(contexts[1].messages_context)).toEqual(["reviewer words"]);
    expect(contexts[1].messages_context.map(marks)).toEqual([[true, true, true, true]]);
    expect(contexts.flatMap((c) => contents(c.messages_analyze))).toEqual(["reviewer words", "auditor words"]);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["reviewer words", "auditor words"]);
    expect(externalText(sm, reviewer.id)).toEqual(["reviewer words", "auditor words"]);
    // queueAllScans pre-marks the analyzed message's f/t/p flags when it queues (the queued handlers are not run here).
    const auditor = sm.messages_get(reviewer.id).find((m) => m.content === "auditor words")!;
    expect([auditor.f, auditor.t, auditor.p]).toEqual([true, true, true]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    drain(sm);

    const writes = vi.spyOn(sm, "setHuman");
    const remove = vi.spyOn(sm, "messages_remove");
    const appended = append.mock.calls.length;
    expect(await run(PLAN + 7_200_000)).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(contexts).toHaveLength(2);
    expect(append).toHaveBeenCalledTimes(appended);
    expect(remove).not.toHaveBeenCalled();
    expect(writes).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
  });

  it("queues a separate member as its own block when no alias is added", async () => {
    const base = await reviewerThenAuditor();
    const contexts = spyScans();

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`]);
    drain(sm);

    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect(await run(PLAN + 3_600_000)).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });
    const auditor = sm.persona_getByName("Auditor")!;
    expect(auditor).not.toBeNull();
    expect(auditor.id).not.toBe(reviewer.id);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].personaId).toBe(auditor.id);
    expect(contents(contexts[1].messages_analyze)).toEqual(["auditor words"]);
    expect(contexts[1].messages_context).toEqual([]);
    expect(contexts.flatMap((c) => contents(c.messages_analyze))).toEqual(["reviewer words", "auditor words"]);
    expect(externalText(sm, reviewer.id)).toEqual(["reviewer words"]);
    expect(externalText(sm, auditor.id)).toEqual(["auditor words"]);
    expect(remove.mock.calls.some(([id]) => id === reviewer.id)).toBe(false);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["auditor words"]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    drain(sm);

    const writes = vi.spyOn(sm, "setHuman");
    expect(await run(PLAN + 7_200_000)).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(contexts).toHaveLength(2);
    expect(append).toHaveBeenCalledTimes(1);
    expect(writes).not.toHaveBeenCalled();
    expect(sm.queue_length()).toBe(0);
  });

  it("records only pending members of an enlarged group and keeps handled and out-of-window messages out of analysis", async () => {
    setPrevious();
    const written = await writeOmpTree(root, {
      stem: `enlarged_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "tester before", { agent: "tester", id: "t0", timestamp: OLD }),
        ompMessage("assistant", "reviewer in window", { agent: "reviewer", id: "r1", timestamp: iso(EARLY + 60_000) }),
        ompMessage("assistant", "auditor in window", { agent: "auditor", id: "a1", timestamp: iso(EARLY + 120_000) }),
        ompMessage("assistant", "inspector in window", { agent: "inspector", id: "i1", timestamp: iso(EARLY + 180_000) }),
        ompMessage("assistant", "tester after plan", { agent: "tester", id: "t1", timestamp: iso(PLAN + 30 * 60_000) })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const base = path.basename(written.rootFile);
    const contexts = spyScans();

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(contents(contexts[0].messages_analyze)).toEqual(["reviewer in window"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`]);
    drain(sm);

    expect(sm.persona_update(reviewer.id, { aliases: ["reviewer", "auditor", "inspector", "tester"] })).toBe(true);
    const writes = vi.spyOn(sm, "setHuman");
    const append = vi.spyOn(sm, "messages_append");
    expect(await run(PLAN + 3_600_000)).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });

    expect(contexts).toHaveLength(2);
    expect(contexts[1].personaId).toBe(reviewer.id);
    expect(contents(contexts[1].messages_context)).toEqual(["tester before", "reviewer in window"]);
    expect(contexts[1].messages_context.map(marks)).toEqual([[true, true, true, true], [true, true, true, true]]);
    expect(contents(contexts[1].messages_analyze)).toEqual(["auditor in window", "inspector in window"]);
    expect(contexts[1].messages_analyze.map(marks)).toEqual([[undefined, undefined, undefined, undefined], [undefined, undefined, undefined, undefined]]);
    expect(contexts.flatMap((c) => contents(c.messages_analyze))).toEqual(["reviewer in window", "auditor in window", "inspector in window"]);
    expect(append.mock.calls.map(([, m]) => m.content).sort()).toEqual(["auditor in window", "inspector in window", "reviewer in window", "tester before"]);
    expect(externalText(sm, reviewer.id)).toEqual(["tester before", "reviewer in window", "auditor in window", "inspector in window"]);
    const checkpoints = writes.mock.calls.map(([h]) => h.settings?.omp?.current_tree?.done).filter((d) => d !== undefined);
    expect(checkpoints).toEqual([[`${base}|Reviewer`, `${base}|Auditor`, `${base}|Inspector`]]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    drain(sm);

    expect(await run(PLAN + 7_200_000)).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(contexts).toHaveLength(2);
    expect(sm.queue_length()).toBe(0);
  });

  it("does not redo a handled member whose persona display name changes between ticks", async () => {
    const base = await reviewerThenAuditor();
    const contexts = spyScans();

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`]);
    drain(sm);

    expect(sm.persona_update(reviewer.id, { display_name: "Reviewer Prime" })).toBe(true);
    expect(sm.persona_getById(reviewer.id)!.aliases).toEqual(["reviewer"]);
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect(await run(PLAN + 3_600_000)).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });

    const auditor = sm.persona_getByName("Auditor")!;
    expect(auditor).not.toBeNull();
    expect(auditor.id).not.toBe(reviewer.id);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].personaId).toBe(auditor.id);
    expect(contexts.flatMap((c) => contents(c.messages_analyze))).toEqual(["reviewer words", "auditor words"]);
    expect(remove.mock.calls.some(([id]) => id === reviewer.id)).toBe(false);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["auditor words"]);
    expect(externalText(sm, reviewer.id)).toEqual(["reviewer words"]);
    expect(externalText(sm, auditor.id)).toEqual(["auditor words"]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    drain(sm);

    expect(await run(PLAN + 7_200_000)).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(contexts).toHaveLength(2);
  });

  it("skips an enlarged group with no pending member and runs the next block", async () => {
    const written = await writeOmpTree(root, {
      stem: `no-pending_${TREE}`,
      main: [ompHeader({ id: TREE }),
        ompMessage("assistant", "reviewer in window", { agent: "reviewer", id: "r1", timestamp: iso(EARLY + 60_000) }),
        ompMessage("assistant", "tester after plan", { agent: "tester", id: "t1", timestamp: iso(PLAN + 30 * 60_000) }),
        ompMessage("assistant", "worker in window", { agent: "worker", id: "w1", timestamp: iso(EARLY + 120_000) })],
      mtime: new Date("2026-08-02T00:00:00.000Z"),
    });
    const base = path.basename(written.rootFile);
    const contexts = spyScans();

    expect((await run()).blocksQueued).toBe(1);
    const reviewer = sm.persona_getByName("Reviewer")!;
    expect(sm.persona_getByName("Worker")).toBeNull();
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Reviewer`]);
    drain(sm);

    expect(sm.persona_update(reviewer.id, { aliases: ["reviewer", "tester"] })).toBe(true);
    const writes = vi.spyOn(sm, "setHuman");
    const remove = vi.spyOn(sm, "messages_remove");
    const append = vi.spyOn(sm, "messages_append");
    expect(await run(PLAN + 3_600_000)).toEqual({ blocksQueued: 1, treesCompleted: 1, scansQueued: expect.any(Number) });

    const worker = sm.persona_getByName("Worker");
    expect(worker).not.toBeNull();
    expect(worker!.id).not.toBe(reviewer.id);
    expect(contexts).toHaveLength(2);
    expect(contexts[1].personaId).toBe(worker!.id);
    expect(contexts.flatMap((c) => contents(c.messages_analyze))).toEqual(["reviewer in window", "worker in window"]);
    expect(remove.mock.calls.some(([id]) => id === reviewer.id)).toBe(false);
    expect(append.mock.calls.some(([id]) => id === reviewer.id)).toBe(false);
    expect(append.mock.calls.map(([, m]) => m.content)).toEqual(["worker in window"]);
    expect(externalText(sm, reviewer.id)).toEqual(["reviewer in window"]);
    expect(externalText(sm, worker!.id)).toEqual(["worker in window"]);
    const checkpoints = writes.mock.calls.map(([h]) => h.settings?.omp?.current_tree?.done).filter((d) => d !== undefined);
    expect(checkpoints).toEqual([[`${base}|Reviewer`, `${base}|Worker`]]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBe(iso(PLAN));
    expect(sm.getHuman().settings?.omp?.current_tree).toBeUndefined();
    drain(sm);

    expect(await run(PLAN + 7_200_000)).toEqual({ blocksQueued: 0, treesCompleted: 0, scansQueued: 0 });
    expect(contexts).toHaveLength(2);
    expect(sm.queue_length()).toBe(0);
  });

  it("does not record a block as done if its scan enqueue crashes", async () => {
    const written = await threeBlocks();
    const base = path.basename(written.rootFile);
    const cursors: unknown[] = [];
    const writes = vi.spyOn(sm, "setHuman");
    const enqueue = vi.spyOn(sm, "queue_enqueue").mockImplementationOnce(() => {
      cursors.push(structuredClone(sm.getHuman().settings?.omp?.current_tree));
      throw new Error("scan queue unavailable");
    });
    await expect(run()).rejects.toThrow("scan queue unavailable");
    expect(cursors).toEqual([undefined]);
    expect(writes.mock.calls.every(([h]) => (h.settings?.omp?.current_tree?.done ?? []).length === 0)).toBe(true);
    expect(sm.getHuman().settings?.omp?.current_tree?.done ?? []).toEqual([]);
    expect(sm.getHuman().settings?.omp?.processed_sessions?.[TREE]).toBeUndefined();
    expect(sm.queue_length()).toBe(0);
    enqueue.mockRestore();
    expect((await run()).blocksQueued).toBe(1);
    expect(sm.queue_length()).toBeGreaterThan(0);
    const worker = sm.persona_getByName("Worker")!;
    expect(externalText(sm, worker.id)).toEqual(["main block"]);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toHaveLength(1);
    expect(sm.getHuman().settings?.omp?.current_tree?.done).toEqual([`${base}|Worker`]);
  });
});

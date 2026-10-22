// Tested by Beta — 2026-10-22
import { assert, describe, it, expect, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { importOmpSessions } from "../../../../src/integrations/omp/importer.js";
import { OmpReader } from "../../../../src/integrations/omp/reader.js";
import type { OmpSession, OmpTree } from "../../../../src/integrations/omp/types.js";
import { StateManager } from "../../../../src/core/state-manager.js";
import type { Message } from "../../../../src/core/types.js";
import { parseMessageId } from "../../../../src/core/utils/message-id.js";
import { createMockStorage } from "../../../helpers/mock-storage.js";
import {
  ompMainSession,
  ompMessage,
  ompSubAgent,
  ompTranscriptText,
  writeOmpTree,
  type OmpLine,
} from "../shared/omp-transcript-fixtures.js";

// Preserve Zod's namespace export under Vitest's bare-specifier interop —
// same workaround as the other OMP importer tests.
vi.mock("zod", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    z: (actual.z ?? actual.default ?? actual) as Record<string, unknown>,
  };
});

// External boundary for the process-based guard mutant: model a stopped OMP
// process without invoking pgrep. The real quiet-tree guard uses only file mtimes.
vi.mock("../../../../src/integrations/process-check.js", () => ({
  isProcessRunning: vi.fn(async () => false),
}));

const MIN = 60_000;
const HOUR = 60 * MIN;
const OLD = Date.parse("2026-03-01T00:00:00.000Z");
const W = Date.parse("2026-06-01T00:00:00.000Z");
const NOW = Date.parse("2026-10-01T00:00:00.000Z");

const iso = (ms: number) => new Date(ms).toISOString();
const day = (s: string) => Date.parse(`${s}T00:00:00.000Z`);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stemOf = (n: number, start = "2026-01-01T00-00-00-000Z") => `${start}_${uuid(n)}`;
const msg = (text: string, ts: number, o: { agent?: string } = {}): OmpLine =>
  ompMessage("user", text, { timestamp: iso(ts), ...o });

interface Env {
  sm: StateManager;
  root: string;
  /** Every transcript the importer opened through its reader. */
  opens: string[];
  reader: { listTrees: () => Promise<OmpTree[]>; readTranscript: (p: string) => Promise<OmpSession | null> };
  /** The real reader, unwrapped: nothing it does is counted in `opens`. */
  real: OmpReader;
}

async function withEnv(fn: (env: Env) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "omp-tree-"));
  try {
    const sm = new StateManager();
    await sm.initialize(createMockStorage());
    const human = sm.getHuman();
    sm.setHuman({ ...human, settings: { ...human.settings, omp: { ...human.settings?.omp, integration: true } } });
    const real = new OmpReader();
    const opens: string[] = [];
    const reader = {
      listTrees: () => real.listTrees(root),
      readTranscript: (p: string) => {
        opens.push(p);
        return real.readTranscript(p);
      },
    };
    await fn({ sm, root, opens, reader, real });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function pass(env: Env, now: number | (() => number)) {
  return importOmpSessions({
    stateManager: env.sm,
    reader: env.reader,
    now: typeof now === "number" ? () => now : now,
  });
}

function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

function storedMessages(sm: StateManager): Message[] {
  return sm.persona_getAll().flatMap((p) => sm.messages_get(p.id));
}

function stored(sm: StateManager, text: string): Message | undefined {
  return storedMessages(sm).find((m) => m.content === text);
}

/** Texts of the stored messages that the queued extraction requests are asked to mark. */
function analyzedTexts(sm: StateManager): string[] {
  const ids = new Set<string>();
  for (const request of sm.queue_getAllActiveItems()) {
    const marked = request.data.message_ids_to_mark;
    if (!Array.isArray(marked)) continue;
    for (const id of marked) ids.add(id);
  }
  return [...new Set(storedMessages(sm).filter((m) => ids.has(m.id)).map((m) => {
    assert(typeof m.content === "string", `Expected analyzed message ${m.id} to contain text`);
    return m.content;
  }))].sort();
}

/** Runs passes, draining the queue after each, until one does nothing; returns each pass's analyzed texts. */
async function settle(env: Env, now: number | (() => number)): Promise<string[][]> {
  const calls: string[][] = [];
  for (let i = 0; i < 60; i++) {
    const result = await pass(env, now);
    calls.push(analyzedTexts(env.sm));
    env.sm.queue_clear();
    if (result.blocksQueued === 0 && result.treesCompleted === 0) return calls;
  }
  throw new Error("importer did not settle");
}

const omp = (sm: StateManager) => sm.getHuman().settings?.omp;
const processed = (sm: StateManager) => omp(sm)?.processed_sessions ?? {};
const stamp = (file: string, ms: number) => fs.utimes(file, new Date(ms), new Date(ms));
/** The file `rel` inside a tree's sibling directory. */
const siblingFile = (rootFile: string, rel: string) => path.join(rootFile.slice(0, -".jsonl".length), rel);

async function writeAt(file: string, content: string, mtimeMs: number): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, content);
  await stamp(file, mtimeMs);
}
const rewrite = (file: string, lines: OmpLine[], mtimeMs: number) => writeAt(file, ompTranscriptText(lines), mtimeMs);

/** Calls each test makes from a settled tree: texts in first-appearance order of their `label:` prefix. */
function labelOrder(calls: string[][]): string[] {
  const order: string[] = [];
  for (const text of calls.flat()) {
    const label = text.split(":")[0];
    if (!order.includes(label)) order.push(label);
  }
  return order;
}

function setIntegration(sm: StateManager, on: boolean): void {
  const human = sm.getHuman();
  sm.setHuman({ ...human, settings: { ...human.settings, omp: { ...human.settings?.omp, integration: on } } });
}

describe("watermark oracle", () => {
  it("imports exactly the half-open window and classifies later appends by message timestamp, completing with the original plan time", async () => {
    await withEnv(async (env) => {
      const T = W + 2 * HOUR;
      const stem = stemOf(1);
      const { rootFile } = await writeOmpTree(env.root, { stem, main: ompMainSession({ messages: [msg("old", W - 10 * MIN)] }) });
      const legacyWatermark = iso(NOW + HOUR);
      const human = env.sm.getHuman();
      env.sm.setHuman({ ...human, settings: { ...human.settings, omp: { ...human.settings?.omp, processed_sessions: { [rootFile]: legacyWatermark } } } });
      const firstPass = await settle(env, W);
      expect(firstPass.flat()).toEqual(["old"]);
      expect(processed(env.sm)[rootFile]).toBe(legacyWatermark);
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W));

      const mainLines = [
        msg("old", W - 10 * MIN),
        msg("atW", W),
        msg("inside", W + 30 * MIN),
        msg("atT", T),
        msg("late", T + 5 * MIN),
      ];
      const childFile = siblingFile(rootFile, "0-Explore.jsonl");
      await rewrite(rootFile, ompMainSession({ messages: mainLines }), W + HOUR);
      await rewrite(childFile, ompSubAgent({ agent: "Explore", messages: [msg("d1", W + 30 * MIN)] }), W + HOUR);

      // Successive clock readings: the plan time is the first one; later ones must not leak into the stored watermark.
      const clock = sequence([T, T + 3 * HOUR, T + 6 * HOUR]);
      // Flags as the importer appends each message, before any scan can mark it.
      const appended: Array<{ content: Message["content"]; flags: Array<boolean | undefined> }> = [];
      const append = env.sm.messages_append.bind(env.sm);
      vi.spyOn(env.sm, "messages_append").mockImplementation((personaId, message) => {
        appended.push({ content: message.content, flags: [message.f, message.t, message.p, message.e] });
        return append(personaId, message);
      });
      const flagsAtAppend = (list: typeof appended, text: string) => list.filter((a) => a.content === text).at(-1)?.flags;
      const first = await pass(env, clock);
      expect(first.blocksQueued).toBe(1);
      expect(analyzedTexts(env.sm)).toEqual(["atT", "inside"]);
      for (const text of ["old", "atW"]) {
        const m = stored(env.sm, text);
        assert(m, `Expected premarked message "${text}" to be stored`);
        expect([m.f, m.t, m.p, m.e]).toEqual([true, true, true, true]);
      }
      for (const text of ["inside", "atT"]) {
        expect(flagsAtAppend(appended, text)).toEqual([undefined, undefined, undefined, undefined]);
      }
      for (const text of ["old", "atW"]) expect(flagsAtAppend(appended, text)).toEqual([true, true, true, true]);
      expect(stored(env.sm, "late")).toBeUndefined();
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W));
      expect(omp(env.sm)?.current_tree?.planned_at).toBe(iso(T));
      env.sm.queue_clear();

      // Entries appended after the plan: one before W, one at T, one after T.
      await rewrite(
        childFile,
        ompSubAgent({
          agent: "Explore",
          messages: [
            msg("d1", W + 30 * MIN), msg("dOld", W - 10 * MIN),
            ompMessage("user", "dAgent", { attribution: "agent", timestamp: iso(W - 10 * MIN) }),
            ompMessage("user", "dHuman", { attribution: "user", timestamp: iso(W - 10 * MIN) }),
            msg("dAtT", T), msg("dLate", T + 5 * MIN),
          ],
        }),
        W + HOUR
      );
      const second = await pass(env, clock);
      expect(second.treesCompleted).toBe(1);
      expect(analyzedTexts(env.sm)).toEqual(["d1", "dAtT"]);
      const dOld = stored(env.sm, "dOld");
      assert(dOld, 'Expected premarked message "dOld" to be stored');
      expect([dOld.f, dOld.t, dOld.p, dOld.e]).toEqual([true, true, true, true]);
      for (const text of ["d1", "dAtT"]) {
        expect(flagsAtAppend(appended, text)).toEqual([undefined, undefined, undefined, undefined]);
      }
      expect(flagsAtAppend(appended, "dOld")).toEqual([true, true, true, true]);
      for (const [text, role, speaker] of [
        ["dOld", "system", "Parent agent"],
        ["dAgent", "system", "Parent agent"],
        ["dHuman", "human", undefined],
      ] as const) {
        const message = stored(env.sm, text);
        assert(message, `Expected premarked message "${text}" to be stored`);
        expect([message.f, message.t, message.p, message.e]).toEqual([true, true, true, true]);
        expect(flagsAtAppend(appended, text)).toEqual([true, true, true, true]);
        expect(message.role).toBe(role);
        expect(message.speaker_name).toBe(speaker);
        expect(parseMessageId(message.id).session).toBe(childFile);
      }
      expect(processed(env.sm)[rootFile]).toBe(legacyWatermark);
      expect(stored(env.sm, "dLate")).toBeUndefined();
      expect(processed(env.sm)[uuid(1)]).toBe(iso(T));
      expect(omp(env.sm)?.current_tree).toBeUndefined();
      env.sm.queue_clear();

      // A second pass imports exactly the late messages, again with the original plan time.
      const T3 = T + 3 * HOUR;
      await stamp(rootFile, T + HOUR);
      await stamp(childFile, T + HOUR);
      const calls = await settle(env, sequence([T3, T3 + HOUR]));
      expect(calls[0]).toEqual(["late"]);
      expect(calls[1]).toEqual(["dLate"]);
      expect(processed(env.sm)[uuid(1)]).toBe(iso(T3));
      expect(processed(env.sm)[rootFile]).toBe(legacyWatermark);

      // Unchanged since: nothing is opened.
      env.opens.length = 0;
      const again = await pass(env, T3 + 2 * HOUR);
      expect(env.opens).toEqual([]);
      expect(again).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      expect(env.sm.queue_length()).toBe(0);
    });
  });

  it("records one key per tree and a single cursor, and only after the tree's last block", async () => {
    await withEnv(async (env) => {
      const ids = [uuid(1), uuid(2), uuid(3)];
      for (const n of [1, 2, 3]) {
        await writeOmpTree(env.root, {
          stem: stemOf(n),
          main: ompMainSession({ messages: [msg(`t${n} main`, OLD)] }),
          children: {
            "0-A": ompSubAgent({ agent: "Alpha", messages: [msg(`t${n} a`, OLD + MIN)] }),
            "1-B": ompSubAgent({ agent: "Bravo", messages: [msg(`t${n} b`, OLD + 2 * MIN)] }),
            "2-C": ompSubAgent({ agent: "Charlie", messages: [msg(`t${n} c`, OLD + 3 * MIN)] }),
          },
          mtime: new Date(day("2026-01-01") + n * 24 * HOUR),
        });
      }

      // Four blocks per tree: one call each; the key appears with the fourth.
      for (let i = 0; i < 12; i++) {
        const t = Math.floor(i / 4);
        const last = i % 4 === 3;
        await pass(env, NOW);
        env.sm.queue_clear();
        const settings = omp(env.sm);
        expect(Array.isArray(settings?.current_tree)).toBe(false);
        expect(Object.keys(processed(env.sm)).sort()).toEqual(ids.slice(0, t + (last ? 1 : 0)).sort());
        if (last) expect(settings?.current_tree).toBeUndefined();
        else expect(settings?.current_tree?.tree).toBe(ids[t]);
      }
      expect(Object.keys(processed(env.sm)).sort()).toEqual(ids);
      for (const value of Object.values(processed(env.sm))) expect(value).toBe(iso(NOW));
    });
  });

  it("skips a tree whose newest mtime equals its watermark without opening it, and opens trees that are strictly newer or changed", async () => {
    await withEnv(async (env) => {
      const e = await writeOmpTree(env.root, { stem: stemOf(1), main: ompMainSession({ messages: [msg("E first", OLD)] }) });
      const q = await writeOmpTree(env.root, { stem: stemOf(2), main: ompMainSession({ messages: [msg("Q first", OLD)] }) });
      const d = await writeOmpTree(env.root, {
        stem: stemOf(3),
        main: ompMainSession({ messages: [msg("D first", OLD)] }),
        children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("D child first", OLD)] }) },
      });
      await settle(env, W);
      expect(Object.keys(processed(env.sm))).toHaveLength(3);

      // E carries a late message but its newest mtime is exactly the watermark.
      await rewrite(e.rootFile, ompMainSession({ messages: [msg("E first", OLD), msg("E late", W + 30 * MIN)] }), W);
      // Q's newest mtime is one second past the watermark.
      await rewrite(q.rootFile, ompMainSession({ messages: [msg("Q first", OLD), msg("Q late", W + 30 * MIN)] }), W + 1000);
      // D: only a descendant changed.
      await rewrite(
        d.children["0-Explore"],
        ompSubAgent({ agent: "Explore", messages: [msg("D child first", OLD), msg("D late", W + 30 * MIN)] }),
        W + 1000
      );

      env.opens.length = 0;
      await settle(env, W + 2 * HOUR);
      expect(env.opens.filter((p) => p.includes(uuid(1)))).toEqual([]);
      expect(env.opens).toContain(q.rootFile);
      expect(env.opens).toContain(d.rootFile);
      expect(env.opens).toContain(d.children["0-Explore"]);
      expect(stored(env.sm, "Q late")).toBeDefined();
      expect(stored(env.sm, "D late")).toBeDefined();
      expect(stored(env.sm, "E late")).toBeUndefined();
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W));
    });
  });

  describe("tree order", () => {
    it("orders trees by their newest file mtime, not start time, path, root mtime or recency", async () => {
      await withEnv(async (env) => {
        const x = await writeOmpTree(env.root, {
          projectDir: "a",
          stem: stemOf(1, "2026-01-01T00-00-00-000Z"),
          main: ompMainSession({ messages: [msg("X: main", OLD)] }),
          children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("X: child", OLD + MIN)] }) },
          mtime: new Date(day("2026-01-01")),
        });
        await stamp(x.children["0-Explore"], day("2026-05-01"));
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2, "2026-02-01T00-00-00-000Z"),
          main: ompMainSession({ messages: [msg("Y: main", OLD)] }),
          children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("Y: child", OLD + MIN)] }) },
          mtime: new Date(day("2026-03-01")),
        });

        const calls = await settle(env, NOW);
        expect(calls[0].every((t) => t.startsWith("Y:"))).toBe(true);
        expect(labelOrder(calls)).toEqual(["Y", "X"]);
      });
    });

    it("lets a quiet Markdown sibling decide the order", async () => {
      await withEnv(async (env) => {
        const a = await writeOmpTree(env.root, {
          projectDir: "a",
          stem: stemOf(1),
          main: ompMainSession({ messages: [msg("A: main", OLD)] }),
          children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("A: child", OLD + MIN)] }) },
          extraFiles: { "0.bash.log": "log", "notes.md": "# notes" },
          mtime: new Date(day("2026-02-01")),
        });
        await stamp(a.extraFiles["notes.md"], day("2026-06-01"));
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [msg("B: main", OLD)] }),
          children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("B: child", OLD + MIN)] }) },
          mtime: new Date(day("2026-04-01")),
        });

        const calls = await settle(env, NOW);
        expect(calls[0].every((t) => t.startsWith("B:"))).toBe(true);
        expect(labelOrder(calls)).toEqual(["B", "A"]);
      });
    });

    it("lets a tool-output log decide the order", async () => {
      await withEnv(async (env) => {
        const l = await writeOmpTree(env.root, {
          projectDir: "a",
          stem: stemOf(1),
          main: ompMainSession({ messages: [msg("L: main", OLD)] }),
          extraFiles: { "0.bash.log": "log" },
          mtime: new Date(day("2026-01-01")),
        });
        await stamp(l.extraFiles["0.bash.log"], day("2026-06-01"));
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [msg("M: main", OLD)] }),
          mtime: new Date(day("2026-04-01")),
        });

        const calls = await settle(env, NOW);
        expect(calls[0].every((t) => t.startsWith("M:"))).toBe(true);
        expect(labelOrder(calls)).toEqual(["M", "L"]);
      });
    });
  });

  describe("one pass over several trees", () => {
    it("completes an older tree whose blocks are all skipped and imports the newer tree in the same call", async () => {
      await withEnv(async (env) => {
        const s = await writeOmpTree(env.root, { projectDir: "a", stem: stemOf(1), main: ompMainSession({ messages: [msg("S first", OLD)] }) });
        await settle(env, W);
        // Only a tool-output log is newer than S's watermark.
        await writeAt(siblingFile(s.rootFile, "0.bash.log"), "log", W + HOUR);
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [msg("N first", OLD)] }),
          mtime: new Date(W + 2 * HOUR),
        });

        const T2 = W + 4 * HOUR;
        const result = await pass(env, T2);
        expect(result.treesCompleted).toBe(2);
        expect(result.blocksQueued).toBe(1);
        expect(processed(env.sm)[uuid(1)]).toBe(iso(T2));
        expect(processed(env.sm)[uuid(2)]).toBe(iso(T2));
        expect(analyzedTexts(env.sm)).toEqual(["N first"]);
      });
    });

    it("completes every tree that has nothing to queue and then ends", async () => {
      await withEnv(async (env) => {
        await writeOmpTree(env.root, { projectDir: "a", stem: stemOf(1), main: ompMainSession({ messages: [] }) });
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [] }),
          children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [] }) },
        });

        const result = await pass(env, NOW);
        expect(result.treesCompleted).toBe(2);
        expect(result.blocksQueued).toBe(0);
        expect(env.sm.queue_length()).toBe(0);
        expect(env.sm.persona_getAll()).toHaveLength(0);
        expect(processed(env.sm)).toEqual({ [uuid(1)]: iso(NOW), [uuid(2)]: iso(NOW) });
        expect(omp(env.sm)?.current_tree).toBeUndefined();

        env.opens.length = 0;
        const again = await pass(env, NOW + HOUR);
        expect(again.treesCompleted).toBe(0);
        expect(env.opens).toEqual([]);
      });
    });

    it("completes a tree whose only transcript is unreadable and continues with the next tree", async () => {
      await withEnv(async (env) => {
        const u = await writeOmpTree(env.root, { projectDir: "a", stem: stemOf(1), main: ompMainSession({ messages: [msg("U first", OLD)] }) });
        await settle(env, W);
        await writeAt(u.rootFile, "this is not json\n", W + HOUR);
        expect(await env.real.readTranscript(u.rootFile)).toBeNull();
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [msg("N first", OLD)] }),
          mtime: new Date(W + 2 * HOUR),
        });

        const T2 = W + 4 * HOUR;
        const result = await pass(env, T2);
        expect(result.treesCompleted).toBe(2);
        expect(processed(env.sm)[uuid(1)]).toBe(iso(T2));
        expect(omp(env.sm)?.current_tree).toBeUndefined();
        expect(analyzedTexts(env.sm)).toEqual(["N first"]);
      });
    });

    it("stops after the first tree with work and leaves the next one untouched while its scans are held", async () => {
      await withEnv(async (env) => {
        const a = await writeOmpTree(env.root, { projectDir: "a", stem: stemOf(1), main: ompMainSession({ messages: [msg("A first", OLD)] }) });
        await settle(env, W);
        await writeAt(siblingFile(a.rootFile, "0.bash.log"), "log", W + HOUR);
        await writeOmpTree(env.root, {
          projectDir: "b",
          stem: stemOf(2),
          main: ompMainSession({ messages: [msg("B first", OLD, { agent: "Bee" })] }),
          mtime: new Date(W + 2 * HOUR),
        });
        const c = await writeOmpTree(env.root, {
          projectDir: "c",
          stem: stemOf(3),
          main: ompMainSession({ messages: [msg("C first", OLD, { agent: "Cee" })] }),
          mtime: new Date(W + 3 * HOUR),
        });

        const T2 = W + 5 * HOUR;
        env.opens.length = 0;
        await pass(env, T2);
        expect(analyzedTexts(env.sm)).toEqual(["B first"]);
        expect(env.opens).not.toContain(c.rootFile);
        expect(Object.keys(processed(env.sm)).sort()).toEqual([uuid(1), uuid(2)]);
        expect(env.sm.queue_length()).toBeGreaterThan(0);

        // Queue still held: the next pass must not admit, wipe, append, queue or checkpoint C.
        const queued = env.sm.queue_getAllActiveItems().map((r) => r.id);
        const messages = JSON.stringify(storedMessages(env.sm));
        const settings = JSON.stringify(env.sm.getHuman().settings);
        const held = await pass(env, T2);
        expect(held.blocksQueued).toBe(0);
        expect(env.sm.queue_getAllActiveItems().map((r) => r.id)).toEqual(queued);
        expect(JSON.stringify(storedMessages(env.sm))).toBe(messages);
        expect(JSON.stringify(env.sm.getHuman().settings)).toBe(settings);
        expect(env.sm.persona_getAll().map((p) => p.display_name)).not.toContain("Cee");

        env.sm.queue_clear();
        await pass(env, T2);
        expect(analyzedTexts(env.sm)).toEqual(["C first"]);
        expect(processed(env.sm)[uuid(3)]).toBe(iso(T2));
      });
    });
  });
});

describe("quiet-tree guard", () => {
  const FRESH_NOW = Date.parse("2026-10-01T12:00:00.000Z");
  interface WrittenTree {
    rootFile: string;
    children: Record<string, string>;
    extraFiles: Record<string, string>;
  }
  const kinds: Array<[string, (t: WrittenTree) => string]> = [
    ["root file", (t) => t.rootFile],
    ["descendant transcript", (t) => t.children["0-Explore"]],
    ["tool-output log", (t) => t.extraFiles["0.bash.log"]],
    ["other file", (t) => t.extraFiles["notes.md"]],
  ];

  it.each(kinds)("defers the whole tree while only its %s is fresh, and imports once it is exactly 20 minutes old", async (_name, pick) => {
    await withEnv(async (env) => {
      const t = await writeOmpTree(env.root, {
        stem: stemOf(1),
        main: ompMainSession({ messages: [msg("g main", OLD)] }),
        children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("g child", OLD + MIN)] }) },
        extraFiles: { "0.bash.log": "log", "notes.md": "# notes" },
      });
      const fresh = pick(t);
      await stamp(fresh, FRESH_NOW - MIN);

      const settings = JSON.stringify(env.sm.getHuman().settings);
      const deferred = await pass(env, FRESH_NOW);
      expect(deferred).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      expect(env.opens).toEqual([]);
      expect(JSON.stringify(env.sm.getHuman().settings)).toBe(settings);
      expect(env.sm.persona_getAll()).toHaveLength(0);
      expect(env.sm.queue_length()).toBe(0);

      await stamp(fresh, FRESH_NOW - 20 * MIN);
      const calls = await settle(env, FRESH_NOW);
      expect(calls.flat()).toEqual(expect.arrayContaining(["g main", "g child"]));
      expect(processed(env.sm)[uuid(1)]).toBe(iso(FRESH_NOW));
    });
  });

  it("defers a resumed tree while a descendant is fresh and then resumes with its original planning time", async () => {
    await withEnv(async (env) => {
      const t = await writeOmpTree(env.root, {
        stem: stemOf(1),
        main: ompMainSession({ messages: [msg("r main", OLD)] }),
        children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("r child", OLD + MIN)] }) },
      });
      const first = await pass(env, W);
      expect(first.blocksQueued).toBe(1);
      expect(omp(env.sm)?.current_tree?.planned_at).toBe(iso(W));
      env.sm.queue_clear();

      const T2 = W + HOUR;
      await stamp(t.children["0-Explore"], T2 - MIN);
      env.opens.length = 0;
      const settings = JSON.stringify(env.sm.getHuman().settings);
      const messages = JSON.stringify(storedMessages(env.sm));
      const deferred = await pass(env, T2);
      expect(deferred).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      expect(env.opens).toEqual([]);
      expect(JSON.stringify(env.sm.getHuman().settings)).toBe(settings);
      expect(JSON.stringify(storedMessages(env.sm))).toBe(messages);
      expect(env.sm.queue_length()).toBe(0);

      const resumed = await pass(env, W + 2 * HOUR);
      expect(resumed.treesCompleted).toBe(1);
      expect(analyzedTexts(env.sm)).toEqual(["r child"]);
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W));
      expect(omp(env.sm)?.current_tree).toBeUndefined();
    });
  });
});

describe("copied trees", () => {
  async function listFiles(dir: string): Promise<string[]> {
    const out: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...(await listFiles(full)));
      else out.push(full);
    }
    return out;
  }

  /** Copies the imported project directory to `copy-project`, giving each copied file the mtime `mtimeFor` returns. */
  async function copyProject(env: Env, mtimeFor: (sourceMtime: Date) => Date): Promise<void> {
    const from = path.join(env.root, "-project");
    const to = path.join(env.root, "copy-project");
    await fs.cp(from, to, { recursive: true });
    for (const file of await listFiles(from)) {
      const target = path.join(to, path.relative(from, file));
      const when = mtimeFor((await fs.stat(file)).mtime);
      await fs.utimes(target, when, when);
    }
  }

  async function importOriginal(env: Env): Promise<void> {
    await writeOmpTree(env.root, {
      stem: stemOf(1),
      main: ompMainSession({ messages: [msg("c main", OLD)] }),
      children: { "0-Explore": ompSubAgent({ agent: "Explore", messages: [msg("c child", OLD + MIN)] }) },
    });
    await settle(env, W);
    expect(Object.keys(processed(env.sm))).toHaveLength(1);
  }

  async function expectNothingNew(env: Env, idsBefore: string[]): Promise<void> {
    expect(env.opens).toEqual([]);
    expect(env.sm.queue_length()).toBe(0);
    expect(storedMessages(env.sm).map((m) => m.id).sort()).toEqual(idsBefore);
    expect(storedMessages(env.sm).some((m) => m.id.includes("copy-project"))).toBe(false);
    expect(Object.keys(processed(env.sm))).toEqual([uuid(1)]);
  }

  it("does not import a copy whose files keep the original mtimes", async () => {
    await withEnv(async (env) => {
      await importOriginal(env);
      const idsBefore = storedMessages(env.sm).map((m) => m.id).sort();
      await copyProject(env, (mtime) => mtime);

      env.opens.length = 0;
      const result = await pass(env, W + 2 * HOUR);
      expect(result).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      await expectNothingNew(env, idsBefore);
    });
  });

  it("defers a copy whose files carry fresh mtimes newer than the stored time", async () => {
    await withEnv(async (env) => {
      await importOriginal(env);
      const idsBefore = storedMessages(env.sm).map((m) => m.id).sort();
      const T2 = W + 2 * HOUR;
      await copyProject(env, () => new Date(T2 - MIN));

      // The copy is newer than the stored time, so only the quiet-tree guard can be holding it back.
      const copy = (await env.real.listTrees(env.root)).find((t) => t.rootPath.includes("copy-project"));
      expect(copy!.newestMtimeMs).toBeGreaterThan(W);

      env.opens.length = 0;
      const result = await pass(env, T2);
      expect(result).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      await expectNothingNew(env, idsBefore);
    });
  });
});

describe("integration flag", () => {
  it("imports nothing while off and catches up late messages and new trees when turned back on", async () => {
    await withEnv(async (env) => {
      const o = await writeOmpTree(env.root, { projectDir: "a", stem: stemOf(1), main: ompMainSession({ messages: [msg("o first", OLD)] }) });
      await settle(env, W);
      const seeded = omp(env.sm)!;
      const seededKeys = Object.keys(seeded).sort();

      // Work that exists while the flag is off: a tree never imported before.
      await writeOmpTree(env.root, {
        projectDir: "c",
        stem: stemOf(3),
        main: ompMainSession({ messages: [msg("pending first", OLD)] }),
        mtime: new Date(W + HOUR),
      });

      setIntegration(env.sm, false);
      const settings = JSON.stringify(env.sm.getHuman().settings);
      const idsBefore = storedMessages(env.sm).map((m) => m.id).sort();
      env.opens.length = 0;
      const off = await pass(env, W + 3 * HOUR);
      expect(off).toEqual({ treesCompleted: 0, blocksQueued: 0, scansQueued: 0 });
      expect(env.opens).toEqual([]);
      expect(env.sm.queue_length()).toBe(0);
      expect(JSON.stringify(env.sm.getHuman().settings)).toBe(settings);
      expect(storedMessages(env.sm).map((m) => m.id).sort()).toEqual(idsBefore);
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W));

      // A late message and a new tree, both quiet and newer than the stored time.
      await rewrite(o.rootFile, ompMainSession({ messages: [msg("o first", OLD), msg("o late", W + 30 * MIN)] }), W + HOUR);
      await writeOmpTree(env.root, {
        projectDir: "b",
        stem: stemOf(2),
        main: ompMainSession({ messages: [msg("new first", OLD)] }),
        mtime: new Date(W + HOUR),
      });

      setIntegration(env.sm, true);
      const calls = await settle(env, W + 3 * HOUR);
      const analyzed = calls.flat();
      expect(analyzed).toContain("o late");
      expect(analyzed).toContain("new first");
      expect(analyzed).not.toContain("o first");
      expect(processed(env.sm)[uuid(1)]).toBe(iso(W + 3 * HOUR));
      expect(processed(env.sm)[uuid(2)]).toBe(iso(W + 3 * HOUR));
      expect(Object.keys(omp(env.sm)!).sort()).toEqual(seededKeys);
    });
  });
});

describe("malformed transcript in a tree", () => {
  it("imports the readable transcripts on both sides of a rejected one and completes the tree", async () => {
    await withEnv(async (env) => {
      const t = await writeOmpTree(env.root, {
        stem: stemOf(1),
        main: ompMainSession({ messages: [msg("m main", OLD)] }),
        children: {
          "0-A": ompSubAgent({ agent: "Alpha", messages: [msg("A ok", OLD + MIN)] }),
          "1-Bad": [
            ...ompSubAgent({ agent: "Bravo", messages: [msg("bad text", OLD + 2 * MIN)] }),
            '{"type":"message","id":"truncated',
          ],
          "2-C": ompSubAgent({ agent: "Charlie", messages: [msg("C ok", OLD + 3 * MIN)] }),
        },
      });
      expect(await env.real.readTranscript(t.children["1-Bad"])).toBeNull();

      const calls = await settle(env, NOW);
      expect(calls.flat()).toEqual(expect.arrayContaining(["m main", "A ok", "C ok"]));
      expect(storedMessages(env.sm).some((m) => m.content === "bad text")).toBe(false);
      expect(processed(env.sm)[uuid(1)]).toBe(iso(NOW));
      expect(omp(env.sm)?.current_tree).toBeUndefined();
    });
  });
});

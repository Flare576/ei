import { describe, expect, it } from "vitest";
import { OmpReader, slugifyProjectPath } from "../../../../src/integrations/omp/reader.js";
import { qualifyOmpMessage } from "../../../../src/core/utils/message-id.js";
import {
  ompHeader,
  ompIrcIncoming,
  ompMessage,
  ompSessionInit,
  ompTranscriptText,
} from "../shared/omp-transcript-fixtures.js";
import type { OmpSession } from "../../../../src/integrations/omp/types.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync } from "node:child_process";

function sessionInitLine(overrides: Record<string, unknown> = {}): string {
  // A raw session_init entry (no defaulted systemPrompt/agent), so tests can omit either field.
  return ompTranscriptText([{ type: "session_init", ...overrides }], { trailingNewline: false });
}

function messageLine(id: string, role: "user" | "assistant", text: string, timestamp: string): string {
  return ompTranscriptText([ompMessage(role, text, { id, timestamp })], { trailingNewline: false });
}

async function mkTmp(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "omp-test-"));
}

describe("OmpReader", () => {
  it("returns empty when sessionRoot does not exist", async () => {
    const reader = new OmpReader();
    expect(await reader.listTranscripts("/nonexistent/omp/root")).toEqual([]);
  });

  it("returns empty when sessionRoot is an empty directory", async () => {
    const tmp = await mkTmp();
    try {
      const reader = new OmpReader();
      expect(await reader.listTranscripts(tmp)).toEqual([]);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });

  describe("R1/AT1 — CD computation is depth-based, correctly excludes CD1", () => {
    it("excludes the CD1 root session file; includes the flat zero-dot CD2 file and the nested one-dot CD3 file with correct computed CD and label", async () => {
      const tmp = await mkTmp();
      try {
        // CD1: root session .jsonl, directly in sessionRoot — excluded.
        await fs.writeFile(
          path.join(tmp, "2026-08-01T00-00-00-000Z_uuid1.jsonl"),
          `${messageLine("m1", "user", "root session content", "2026-08-01T00:00:00.000Z")}\n`
        );

        const sessionDir = path.join(tmp, "2026-08-01T00-00-00-000Z_uuid1");
        await fs.mkdir(sessionDir, { recursive: true });

        // CD2: flat, zero dots in filename.
        await fs.writeFile(
          path.join(sessionDir, "AgentInventory.jsonl"),
          `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "You are backend-engineer." })}\n` +
            `${messageLine("m2", "assistant", "cd2 content", "2026-08-01T00:01:00.000Z")}\n`
        );

        // CD3: reached by descending into a same-named subdirectory, one dot in filename.
        const nestedDir = path.join(sessionDir, "SisyphusFolderSweep");
        await fs.mkdir(nestedDir, { recursive: true });
        await fs.writeFile(
          path.join(nestedDir, "SisyphusFolderSweep.OhMyPiPiSweep.jsonl"),
          `${sessionInitLine({ agent: "Beta", systemPrompt: "You are Beta." })}\n` +
            `${messageLine("m3", "assistant", "cd3 content", "2026-08-01T00:02:00.000Z")}\n`
        );

        const reader = new OmpReader();
        const records = await reader.listTranscripts(tmp);

        expect(records).toHaveLength(2);
        expect(records.some((r) => r.path.endsWith("uuid1.jsonl"))).toBe(false);

        const cd2 = records.find((r) => r.cd === 2);
        const cd3 = records.find((r) => r.cd === 3);
        expect(cd2).toBeDefined();
        expect(cd3).toBeDefined();
        expect(cd2!.label).toBe("AgentInventory");
        expect(cd3!.label).toBe("OhMyPiPiSweep");

        const cd2Session = await reader.readTranscript(cd2!.path);
        const cd3Session = await reader.readTranscript(cd3!.path);
        expect(cd2Session?.messages.map((m) => m.content)).toEqual(["cd2 content"]);
        expect(cd3Session?.messages.map((m) => m.content)).toEqual(["cd3 content"]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("R1/AT1 — slugifyProjectPath, D1's verified algorithm", () => {
    it("home-relative path: strips the home prefix, replaces every remaining / with -", () => {
      expect(slugifyProjectPath("/Users/flare576/Projects/Personal/ei", "/Users/flare576")).toBe(
        "-Projects-Personal-ei"
      );
    });

    it("exact home path collapses to an empty slug without crashing", () => {
      expect(() => slugifyProjectPath("/Users/flare576", "/Users/flare576")).not.toThrow();
      expect(slugifyProjectPath("/Users/flare576", "/Users/flare576")).toBe("");
    });

    it("non-home-relative path exercises the fallback without crashing (fallback exercised, not asserted against a second live example)", () => {
      expect(() => slugifyProjectPath("/private/tmp", "/Users/flare576")).not.toThrow();
      const slug = slugifyProjectPath("/private/tmp", "/Users/flare576");
      expect(typeof slug).toBe("string");
      expect(slug.length).toBeGreaterThan(0);
    });
  });

  describe("R2/AT2 — malformed and irrelevant files never crash enumeration", () => {
    it("readTranscript returns null for a malformed transcript without throwing, and the .md sibling is never attempted", async () => {
      const tmp = await mkTmp();
      try {
        await fs.writeFile(
          path.join(tmp, "2026-08-01T00-00-00-000Z_uuid2.jsonl"),
          `${messageLine("m1", "user", "root", "2026-08-01T00:00:00.000Z")}\n`
        );

        const sessionDir = path.join(tmp, "2026-08-01T00-00-00-000Z_uuid2");
        await fs.mkdir(sessionDir, { recursive: true });
        await fs.writeFile(path.join(sessionDir, "Broken.jsonl"), "not json at all\n{{{garbage\n");
        await fs.writeFile(path.join(sessionDir, "Broken.md"), "# some notes, not a transcript\n");

        const reader = new OmpReader();
        const records = await reader.listTranscripts(tmp);

        expect(records).toHaveLength(1);
        expect(records[0].path.endsWith("Broken.jsonl")).toBe(true);
        expect(records.some((r) => r.path.endsWith(".md"))).toBe(false);

        await expect(reader.readTranscript(records[0].path)).resolves.toBeNull();
        await expect(reader.readTranscript(path.join(sessionDir, "Broken.md"))).resolves.toBeNull();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it("readTranscript returns null for a nonexistent file without throwing", async () => {
      const reader = new OmpReader();
      await expect(reader.readTranscript("/nonexistent/transcript.jsonl")).resolves.toBeNull();
    });

    it("a transcript with valid messages before and after an invalid middle line is rejected whole", async () => {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "PartiallyBroken.jsonl");
        await fs.writeFile(
          filePath,
          ompTranscriptText([
            ompHeader(),
            ompSessionInit({ agent: "backend-engineer", systemPrompt: "sys" }),
            ompMessage("assistant", "valid before", { id: "m1" }),
            "not valid json at all",
            ompMessage("assistant", "valid after", { id: "m2" }),
          ])
        );

        await expect(new OmpReader().readTranscript(filePath)).resolves.toBeNull();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it("a transcript ending in a malformed unterminated fragment is rejected whole", async () => {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "TruncatedTail.jsonl");
        await fs.writeFile(
          filePath,
          ompTranscriptText(
            [
              ompHeader(),
              ompSessionInit({ agent: "backend-engineer", systemPrompt: "sys" }),
              ompMessage("assistant", "valid content", { id: "m1" }),
              '{"type":"message"',
            ],
            { trailingNewline: false }
          )
        );

        await expect(new OmpReader().readTranscript(filePath)).resolves.toBeNull();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("D3/R3 — provenance is sourced from session_init, missing fields fail closed", () => {
    async function writeAndRead(sessionInitOverrides: Record<string, unknown>): Promise<OmpSession | null> {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "Transcript.jsonl");
        await fs.writeFile(
          filePath,
          `${sessionInitLine(sessionInitOverrides)}\n` +
            `${messageLine("m1", "assistant", "did some work", "2026-08-01T00:01:00.000Z")}\n`
        );
        const reader = new OmpReader();
        return reader.readTranscript(filePath);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    }

    it("complete session_init produces complete provenance", async () => {
      const session = await writeAndRead({ agent: "backend-engineer", systemPrompt: "You are backend-engineer." });
      expect(session?.provenance.harness).toBe("omp");
      expect(session?.provenance.mode).toBe("delegated");
      expect(session?.provenance.agent_id).toBe("backend-engineer");
      expect(session?.provenance.agent_definition_ref).toBe("omp:backend-engineer");
      expect(session?.provenance.definition_revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("missing agent -> agent_id/agent_definition_ref stay undefined, never inferred", async () => {
      const session = await writeAndRead({ systemPrompt: "You are someone." });
      expect(session?.provenance.agent_id).toBeUndefined();
      expect(session?.provenance.agent_definition_ref).toBeUndefined();
      expect(session?.provenance.definition_revision).toMatch(/^sha256:[0-9a-f]{64}$/);
    });

    it("missing systemPrompt -> definition_revision stays undefined, never inferred", async () => {
      const session = await writeAndRead({ agent: "backend-engineer" });
      expect(session?.provenance.agent_id).toBe("backend-engineer");
      expect(session?.provenance.definition_revision).toBeUndefined();
    });

    it("missing session_init entirely -> provenance is entirely absent beyond the constants", async () => {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "NoInit.jsonl");
        await fs.writeFile(filePath, `${messageLine("m1", "assistant", "did some work", "2026-08-01T00:01:00.000Z")}\n`);
        const reader = new OmpReader();
        const session = await reader.readTranscript(filePath);
        expect(session?.provenance).toEqual({ harness: "omp", mode: "delegated", agent_id: undefined, agent_definition_ref: undefined, definition_revision: undefined });
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("D9/R8/AT8(a) — non-regular filesystem entries are rejected before being opened", () => {
    it("a symlink named *.jsonl is excluded from listTranscripts, and readTranscript is never even attempted against it", async () => {
      const tmp = await mkTmp();
      try {
        const sessionDir = path.join(tmp, "session");
        await fs.mkdir(sessionDir, { recursive: true });

        const realPath = path.join(sessionDir, "RealTranscript.jsonl");
        await fs.writeFile(
          realPath,
          `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "You are backend-engineer." })}\n` +
            `${messageLine("m1", "assistant", "real content", "2026-08-01T00:01:00.000Z")}\n`
        );

        const linkPath = path.join(sessionDir, "LinkedTranscript.jsonl");
        await fs.symlink(realPath, linkPath);

        const reader = new OmpReader();
        const records = await reader.listTranscripts(tmp);

        // The symlink is never listed at all (D9's isFile() gate), which is
        // itself the proof it's never opened — listTranscripts never calls
        // readTranscript on anything, so an entry excluded from the returned
        // records can never reach a read attempt downstream.
        expect(records).toHaveLength(1);
        expect(records[0].path).toBe(realPath);
        expect(records.some((r) => r.path === linkPath)).toBe(false);

        // The scheduler remains usable immediately afterward — a second
        // enumeration against the same tree still succeeds promptly.
        await expect(reader.listTranscripts(tmp)).resolves.toHaveLength(1);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("I6 (Stint holistic review Bucket 1, 2026-08-11) — regular-file identity is re-checked immediately before the read, not only at enumeration", () => {
    it("a file enumerated as regular then swapped to a FIFO before the read is rejected without blocking", async () => {
      const tmp = await mkTmp();
      try {
        const sessionDir = path.join(tmp, "session");
        await fs.mkdir(sessionDir, { recursive: true });

        const filePath = path.join(sessionDir, "Transcript.jsonl");
        await fs.writeFile(
          filePath,
          `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "sys" })}\n` +
            `${messageLine("m1", "assistant", "real content", "2026-08-01T00:01:00.000Z")}\n`
        );

        const reader = new OmpReader();
        const records = await reader.listTranscripts(tmp);
        expect(records).toHaveLength(1);
        expect(records[0].path).toBe(filePath);

        // Simulate the TOCTOU gap: the enumerated regular file is removed
        // and a FIFO takes its exact place before readTranscript() runs.
        // Opening a FIFO for read blocks indefinitely with no writer on
        // the other end — if the re-check inside readTranscript() didn't
        // fire, this test itself would hang until the suite's timeout
        // killed it, rather than resolving to null promptly.
        await fs.rm(filePath);
        execFileSync("mkfifo", [filePath]);

        await expect(reader.readTranscript(filePath)).resolves.toBeNull();

        // The reader remains usable immediately afterward — enumeration
        // (D9's own isFile() gate) also never lists the FIFO.
        await expect(reader.listTranscripts(tmp)).resolves.toHaveLength(0);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    it("a file enumerated as regular then swapped to a symlink before the read is rejected, even when the symlink's target is itself a regular file", async () => {
      const tmp = await mkTmp();
      try {
        const sessionDir = path.join(tmp, "session");
        await fs.mkdir(sessionDir, { recursive: true });

        const filePath = path.join(sessionDir, "Transcript.jsonl");
        await fs.writeFile(
          filePath,
          `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "sys" })}\n` +
            `${messageLine("m1", "assistant", "real content", "2026-08-01T00:01:00.000Z")}\n`
        );

        const reader = new OmpReader();
        expect(await reader.listTranscripts(tmp)).toHaveLength(1);

        const elsewhere = path.join(tmp, "elsewhere.jsonl");
        await fs.writeFile(
          elsewhere,
          `${sessionInitLine({ agent: "backend-engineer", systemPrompt: "sys" })}\n` +
            `${messageLine("m1", "assistant", "other content", "2026-08-01T00:01:00.000Z")}\n`
        );
        await fs.rm(filePath);
        await fs.symlink(elsewhere, filePath);

        // lstat() (never follows the symlink) rejects it outright — the
        // SAME identity check `walk()` applies at enumeration time
        // (Dirent.isFile() also never follows a symlink), so a regular
        // file swapped for a symlink is rejected here regardless of what
        // the symlink points to.
        await expect(reader.readTranscript(filePath)).resolves.toBeNull();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("large transcripts are read in full", () => {
    it("returns all 5001 messages of a generated transcript over 8 MiB and 5000 entries", async () => {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "Huge.jsonl");
        const total = 5001;
        const body = (n: number) => String(n).padStart(4, "0").padEnd(1800, "x");
        const finalContent = "FINAL".padEnd(1800, "z");
        const messages = Array.from({ length: total - 1 }, (_, i) =>
          ompMessage(i % 2 === 0 ? "user" : "assistant", body(i), i === 0 ? { id: "first-entry" } : {})
        );
        messages.push(ompMessage("assistant", finalContent, { id: "last-entry" }));
        await fs.writeFile(
          filePath,
          ompTranscriptText([ompHeader(), ompSessionInit({ agent: "backend-engineer", systemPrompt: "sys" }), ...messages])
        );

        expect((await fs.stat(filePath)).size).toBeGreaterThan(8 * 1024 * 1024);
        expect(messages.length).toBeGreaterThan(5000);

        const session = await new OmpReader().readTranscript(filePath);
        expect(session).not.toBeNull();
        expect(session!.messages).toHaveLength(total);
        expect(session!.messages).toContainEqual(expect.objectContaining({ id: "first-entry", role: "user", content: body(0) }));
        expect(session!.messages).toContainEqual(expect.objectContaining({ id: "last-entry", role: "assistant", content: finalContent }));
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("physical-line native IDs and unterminated final lines", () => {
    it("derives stable physical-line IDs across reads and same-named transcripts", async () => {
      const root = await mkTmp();
      try {
        const duplicateTimestamp = "2026-08-01T00:05:00.000Z";
        const text = ompTranscriptText([
          ompHeader(),
          "",
          ompSessionInit({ agent: "backend-engineer", systemPrompt: "sys" }),
          ompIrcIncoming("woken by parent"),
          ompMessage("assistant", "same content", { id: null, timestamp: duplicateTimestamp }),
          "",
          ompMessage("assistant", "same content", { id: null, timestamp: duplicateTimestamp }),
        ]);

        const reader = new OmpReader();
        const qualified: Record<string, string[]> = {};
        for (const dir of ["one", "two"]) {
          await fs.mkdir(path.join(root, dir));
          const filePath = path.join(root, dir, "Transcript.jsonl");
          await fs.writeFile(filePath, text);

          const natives: string[][] = [];
          for (let pass = 0; pass < 2; pass++) {
            const session = await reader.readTranscript(filePath);
            expect(session).not.toBeNull();
            const ids = session!.messages.map((m) => m.id);
            expect(ids).toEqual(["line-5", "line-7"]);
            expect(ids[0]).not.toBe(ids[1]);
            natives.push(ids);
            qualified[dir] = ids.map((id) => qualifyOmpMessage("test-machine", session!.path, id));
          }
          expect(natives[0]).toEqual(natives[1]);
        }

        const prefix = `omp:test-machine:${encodeURIComponent(root)}`;
        expect(qualified.one).toEqual([`${prefix}%2Fone%2FTranscript.jsonl:line-5`, `${prefix}%2Fone%2FTranscript.jsonl:line-7`]);
        expect(qualified.two).toEqual([`${prefix}%2Ftwo%2FTranscript.jsonl:line-5`, `${prefix}%2Ftwo%2FTranscript.jsonl:line-7`]);
        expect(qualified.one[0]).not.toBe(qualified.two[0]);
        expect(qualified.one[1]).not.toBe(qualified.two[1]);
      } finally {
        await fs.rm(root, { recursive: true, force: true });
      }
    });

    it("accepts a valid final line without a trailing newline", async () => {
      const tmp = await mkTmp();
      try {
        const filePath = path.join(tmp, "Unterminated.jsonl");
        await fs.writeFile(
          filePath,
          ompTranscriptText(
            [
              ompHeader(),
              ompSessionInit({ agent: "backend-engineer", systemPrompt: "sys" }),
              ompMessage("user", "first message", { id: "m1", timestamp: "2026-08-01T00:02:00.000Z" }),
              ompMessage("assistant", "final unterminated message", { id: null, timestamp: "2026-08-01T00:03:00.000Z" }),
            ],
            { trailingNewline: false }
          )
        );

        const session = await new OmpReader().readTranscript(filePath);
        expect(session?.messages).toEqual([
          { id: "m1", role: "user", content: "first message", timestamp: "2026-08-01T00:02:00.000Z" },
          { id: "line-4", role: "assistant", content: "final unterminated message", timestamp: "2026-08-01T00:03:00.000Z" },
        ]);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });
});

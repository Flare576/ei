import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  ompIrcIncoming,
  ompMainSession,
  ompMessage,
  ompSubAgent,
  ompTranscriptText,
  writeOmpTree,
} from "./omp-transcript-fixtures.js";

function parse(text: string): Array<Record<string, any>> {
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

describe("OMP transcript generator", () => {
  it("sub-agent transcript: attribution sits at entry.message.attribution, session_init follows the header", () => {
    const entries = parse(
      ompTranscriptText(
        ompSubAgent({
          agent: "reviewer",
          systemPrompt: ["first part", "second part"],
          parentSession: "/x/root.jsonl",
          messages: [
            ompMessage("user", "assignment", { attribution: "agent" }),
            ompMessage("assistant", "done"),
            ompMessage("user", "typed by a human", { attribution: "user", steering: true }),
            ompMessage("user", "no attribution"),
          ],
        })
      )
    );

    expect(entries.map((e) => e.type)).toEqual(["session", "session_init", "message", "message", "message", "message"]);
    expect(entries[0]).toMatchObject({ type: "session", version: 3, parentSession: "/x/root.jsonl" });
    expect(entries[1]).toMatchObject({
      agent: "reviewer",
      systemPrompt: ["first part", "second part"],
      task: expect.any(String),
      tools: expect.any(Array),
    });

    const [assignment, , human, bare] = entries.slice(2);
    expect(assignment.message.attribution).toBe("agent");
    expect(human.message.attribution).toBe("user");
    expect(human.message.steering).toBe(true);
    expect("attribution" in bare.message).toBe(false);
    for (const e of entries) expect("attribution" in e).toBe(false);
    expect(assignment.message.content).toEqual([{ type: "text", text: "assignment" }]);
    expect(assignment.message.timestamp).toBe(Date.parse(assignment.timestamp));
  });

  it("main-session transcript: the persona agent sits at the outer entry.agent, never inside the message", () => {
    const entries = parse(
      ompTranscriptText(
        ompMainSession({
          cwd: "/does/not/exist",
          messages: [
            ompMessage("user", "hello", { agent: "sisyphus", attribution: "user" }),
            ompMessage("assistant", "hi", { agent: "reviewer" }),
            ompMessage("user", "no persona"),
          ],
        })
      )
    );

    expect(entries[0]).toMatchObject({ type: "session", cwd: "/does/not/exist" });
    expect(entries.map((e) => e.type)).toEqual(["session", "message", "message", "message"]);
    expect("parentSession" in entries[0]).toBe(false);
    expect(entries[1].agent).toBe("sisyphus");
    expect(entries[2].agent).toBe("reviewer");
    expect("agent" in entries[3]).toBe(false);
    for (const e of entries.slice(1)) expect("agent" in e.message).toBe(false);
    expect(entries[1].message.attribution).toBe("user");
    expect("attribution" in entries[3].message).toBe(false);
  });

  it("fills id, parentId and timestamp by position; id: null leaves the entry id-less", () => {
    const entries = parse(
      ompTranscriptText([
        ...ompMainSession({ messages: [] }),
        ompMessage("user", "one"),
        ompIrcIncoming("ping"),
        ompMessage("assistant", "two", { id: null }),
        ompMessage("user", "three", { id: "custom", timestamp: "2026-08-02T00:00:00.000Z" }),
      ])
    );

    const [, one, irc, idless, custom] = entries;
    expect(one.id).toEqual(expect.any(String));
    expect(one.parentId).toBeNull();
    expect(irc.parentId).toBe(one.id);
    expect("id" in idless).toBe(false);
    expect(custom).toMatchObject({ id: "custom", parentId: irc.id, timestamp: "2026-08-02T00:00:00.000Z" });
    expect(new Date(one.timestamp).getTime()).toBeLessThan(new Date(irc.timestamp).getTime());
  });

  it("writes strings verbatim and honours a missing trailing newline", () => {
    const text = ompTranscriptText([ompMessage("user", "ok"), "", "{not json"], { trailingNewline: false });
    const lines = text.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toBe("");
    expect(lines[2]).toBe("{not json");
    expect(ompTranscriptText([ompMessage("user", "ok")]).endsWith("\n")).toBe(true);
  });

  describe("writeOmpTree", () => {
    let tmp: string;
    beforeEach(async () => {
      tmp = await fs.mkdtemp(path.join(os.tmpdir(), "omp-fixture-"));
    });
    afterEach(async () => {
      await fs.rm(tmp, { recursive: true, force: true });
    });

    it("lays files out as the producer does and stamps every file's mtime", async () => {
      const mtime = new Date("2026-03-04T05:06:07.000Z");
      const sub = ompSubAgent({ agent: "scout", messages: [ompMessage("user", "go", { attribution: "agent" })] });
      const written = await writeOmpTree(tmp, {
        projectDir: "-any-dir",
        stem: "2026-08-01T00-00-00-000Z_abc",
        main: ompMainSession({ messages: [ompMessage("user", "hi")] }),
        children: { P: sub, "P.C": sub, "P.C.D": "{truncated" },
        extraFiles: { "P.md": "output", "1.bash.log": "log" },
        mtime,
      });

      const dir = path.join(tmp, "-any-dir");
      const stem = "2026-08-01T00-00-00-000Z_abc";
      expect(written.rootFile).toBe(path.join(dir, `${stem}.jsonl`));
      expect(written.children.P).toBe(path.join(dir, stem, "P.jsonl"));
      expect(written.children["P.C"]).toBe(path.join(dir, stem, "P", "P.C.jsonl"));
      expect(written.children["P.C.D"]).toBe(path.join(dir, stem, "P", "P.C", "P.C.D.jsonl"));
      expect(written.extraFiles["P.md"]).toBe(path.join(dir, stem, "P.md"));
      expect(await fs.readFile(written.children["P.C.D"], "utf-8")).toBe("{truncated");
      expect(parse(await fs.readFile(written.children.P, "utf-8"))[1].agent).toBe("scout");

      const files = [written.rootFile, ...Object.values(written.children), ...Object.values(written.extraFiles)];
      for (const file of files) expect((await fs.stat(file)).mtime.getTime()).toBe(mtime.getTime());
    });
  });
});

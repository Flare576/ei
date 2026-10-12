import { afterEach, describe, expect, test } from "bun:test";
import {
  createEiStub,
  makeMessage,
  makePersona,
  makeToolCall,
  mountConversation,
  overlayContentLines,
  releaseStub,
  runCommand,
  settle,
  type Mounted,
} from "./tool-thinking-harness";
import type { Message } from "../../../src/core/types";

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.renderer.destroy();
  mounted = undefined;
  releaseStub();
});

function messageRow(frame: string, index: number, nextIndex: number | null): { header: string; body: string[] } {
  const lines = frame.split("\n");
  const start = lines.findIndex(line => line.includes(`[✂️  ${index}]`));
  if (start < 0) throw new Error(`Missing message ${index}:\n${frame}`);
  const end = nextIndex === null
    ? lines.findIndex((line, position) => position > start && line.trimStart().startsWith("└"))
    : lines.findIndex((line, position) => position > start && line.includes(`[✂️  ${nextIndex}]`));
  if (end < 0) throw new Error(`Missing message boundary after ${index}:\n${frame}`);
  const body = lines.slice(start + 1, end)
    .map(line => line.replace(/^\s*│/, "").replace(/│\s*$/, "").trim())
    .filter(Boolean);
  return { header: lines[start], body };
}

function headerContent(header: string): string {
  const separator = header.indexOf("]:");
  if (separator < 0) throw new Error(`Missing message header separator: ${header}`);
  return header.slice(separator + 2).replace(/│\s*$/, "").trim();
}

const SECRET = "sk-live_AbC*dEf**gh**`ij`_k_ [x](http://a)";

function messages(): Message[] {
  return [
    makeMessage("system", { content: "reply from P", thinking: "P considers the complete answer" }),
    makeMessage("system", { content: "reply from Q" }),
    makeMessage("system", { content: "reply from S", thinking: "" }),
  ];
}

function assertThinkingCases(frame: string, visible: boolean): void {
  const p = messageRow(frame, 1, 2);
  const q = messageRow(frame, 2, 3);
  const s = messageRow(frame, 3, null);
  expect(headerContent(p.header)).toBe("💭");
  expect(p.body).toEqual(visible
    ? ["P considers the complete answer", "reply from P"]
    : ["reply from P"]);
  for (const [other, reply] of [[q, "reply from Q"], [s, "reply from S"]] as const) {
    expect(headerContent(other.header)).toBe("");
    expect(other.body).toEqual([reply]);
  }
}

describe("thinking is present only on messages that contain it", () => {
  for (const visible of [true, false]) {
    test(`mixed non-empty, absent and empty messages under show_thinking ${visible}`, async () => {
      const stub = createEiStub({
        personas: [makePersona("p", { show_thinking: visible })],
        activePersonaId: "p",
        messages: messages(),
      });
      mounted = await mountConversation(stub);
      const frame = await settle(mounted);
      assertThinkingCases(frame, visible);

      // These controls deliberately invalidate one fixture row at a time;
      // the same frame oracle must reject each plausible broken renderer.
      if (visible) {
        expect(() => assertThinkingCases(frame.replace("P considers the complete answer", ""), visible)).toThrow();
      }
      expect(() => assertThinkingCases(frame.replace("reply from Q", "💭 reply from Q"), visible)).toThrow();
      expect(() => assertThinkingCases(frame.replace("reply from S", "💭 reply from S"), visible)).toThrow();
      expect(() => assertThinkingCases(frame.replace("[✂️  2]:", "[✂️  2]: n/a"), visible)).toThrow();
      expect(() => assertThinkingCases(frame.replace("[✂️  3]:", "[✂️  3]: (no thinking)"), visible)).toThrow();
      expect(() => assertThinkingCases(frame.replace("[✂️  2]:", "[✂️  2]: 💤"), visible)).toThrow();
      for (const placeholder of ["n/a", "(no thinking)", "none", "—"]) {
        expect(() => assertThinkingCases(frame.replace("reply from Q", `${placeholder} reply from Q`), visible)).toThrow();
        expect(() => assertThinkingCases(frame.replace("reply from S", `${placeholder} reply from S`), visible)).toThrow();
      }
    });
  }
});

test("tool arguments and inline thinking preserve markdown-significant key-shaped text verbatim", async () => {
  const stub = createEiStub({
    personas: [makePersona("p", { show_thinking: true })],
    activePersonaId: "p",
    messages: [makeMessage("system", {
      content: "ordinary reply",
      thinking: SECRET,
      tool_calls: [makeToolCall({ arguments: { key: SECRET } })],
    })],
  });
  mounted = await mountConversation(stub);
  const conversation = await settle(mounted);
  expect(conversation).toContain(SECRET);
  expect(conversation).not.toContain("key: " + SECRET);
  const overlay = await runCommand(mounted, "/toolcalls 1");
  expect(overlay).toContain(SECRET);
  expect(overlayContentLines(overlay).join("\n")).toContain("key: " + SECRET);
  expect(() => expect(conversation.replace(SECRET, "[redacted]")).toContain(SECRET)).toThrow();
  expect(() => expect(overlay.replace(SECRET, "[redacted]")).toContain(SECRET)).toThrow();
});

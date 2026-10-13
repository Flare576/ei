import { ScrollBoxRenderable, type Renderable } from "@opentui/core";
import { afterEach, describe, expect, test } from "bun:test";
import {
  createEiStub,
  getAllCommands,
  makeMessage,
  makePersona,
  makeToolCall,
  mountConversation,
  overlayActiveCalls,
  overlayContentLines,
  pressEscapeAndWait,
  releaseStub,
  runCommand,
  settle,
  type EiStub,
  type Mounted,
} from "./tool-thinking-harness";
import { TOOLS_RAN_NO_REPLY_SILENCE_REASON } from "../../../src/core/types";
import type { Message, ToolCallRecord } from "../../../src/core/types";
import { PersonaState } from "../../../src/core/state/personas";

const OVERLAY_TITLE = "Tool calls - message";

let mounted: Mounted | undefined;

afterEach(() => {
  mounted?.renderer.destroy();
  releaseStub();
  mounted = undefined;
});

function stubWith(messages: Message[], extra: { activeRoomId?: string | null } = {}): EiStub {
  return createEiStub({
    personas: [makePersona("p1", { display_name: "Pia" })],
    activePersonaId: "p1",
    messages,
    ...extra,
  });
}

async function mountSettled(stub: EiStub): Promise<{ m: Mounted; frame: string }> {
  const m = await mountConversation(stub);
  mounted = m;
  const frame = await settle(m);
  return { m, frame };
}

/** The frame row carrying message N's header (`[✂️  N]`). */
function headerLine(frame: string, index: number): string {
  const line = frame.split("\n").find(row => row.includes(`[✂️  ${index}]`));
  if (line === undefined) throw new Error(`no header for message ${index} in frame:\n${frame}`);
  return line;
}

/** Everything rendered for message N: its header row up to the next header row. */
function rowText(frame: string, index: number): string {
  const lines = frame.split("\n");
  const start = lines.findIndex(row => row.includes(`[✂️  ${index}]`));
  if (start === -1) throw new Error(`no header for message ${index} in frame:\n${frame}`);
  let end = lines.findIndex((row, i) => i > start && row.includes(`[✂️  ${index + 1}]`));
  if (end === -1) end = lines.length;
  return lines.slice(start, end).join("\n");
}

/** Overlay body split into one block per call, using the `[i/n]` title rows. */
function overlaySections(frame: string): string[] {
  const sections: string[] = [];
  for (const line of overlayContentLines(frame)) {
    if (/^\[\d+\/\d+\] /.test(line)) sections.push(line);
    else if (sections.length > 0) sections[sections.length - 1] += `\n${line}`;
  }
  return sections;
}

describe("tool-call icon in the 1:1 message header", () => {
  test("renders for a message with tool_calls and never for omitted or empty tool_calls", async () => {
    const { frame } = await mountSettled(
      stubWith([
        makeMessage("system", { content: "with calls", tool_calls: [makeToolCall()] }),
        makeMessage("system", { content: "omitted" }),
        makeMessage("system", { content: "empty", tool_calls: [] }),
      ]),
    );

    expect(headerLine(frame, 1)).toContain("🔧");
    for (const index of [2, 3]) {
      expect(headerLine(frame, index)).not.toContain("🔧");
      expect(headerLine(frame, index)).not.toContain("🧧");
    }
  });

  test("is 🔧 when every call is read and 🧧 as soon as any call is write, before any detail is opened", async () => {
    const reads = [makeToolCall({ kind: "read" }), makeToolCall({ name: "recall", kind: "read" })];
    const stub = stubWith([
      makeMessage("system", { content: "reads only", tool_calls: reads }),
      makeMessage("system", { content: "has a write", tool_calls: [...reads, makeToolCall({ name: "edit_trait", kind: "write" })] }),
      makeMessage("system", { content: "write first", tool_calls: [makeToolCall({ name: "edit_topic", kind: "write" }), ...reads] }),
    ]);
    const { frame } = await mountSettled(stub);

    expect(headerLine(frame, 1)).toContain("🔧");
    expect(headerLine(frame, 1)).not.toContain("🧧");
    for (const index of [2, 3]) {
      expect(headerLine(frame, index)).toContain("🧧");
      expect(headerLine(frame, index)).not.toContain("🔧");
    }
    expect(frame).not.toContain(OVERLAY_TITLE);
  });

  test("a read-only message becomes 🧧 when a write call is added, without remounting", async () => {
    const reads = [makeToolCall({ kind: "read" })];
    const stub = stubWith([makeMessage("system", { content: "x", tool_calls: reads })]);
    const { m, frame } = await mountSettled(stub);
    expect(headerLine(frame, 1)).toContain("🔧");

    stub.setMessages([makeMessage("system", { content: "x", tool_calls: [...reads, makeToolCall({ kind: "write" })] })]);
    const after = await settle(m);
    expect(headerLine(after, 1)).toContain("🧧");
    expect(headerLine(after, 1)).not.toContain("🔧");
  });

  test("a call whose kind is missing or unrecognised counts as write, so the icon is 🧧 unless every call is read", async () => {
    const unclassified = (extra: Record<string, unknown>) =>
      ({ name: "legacy_tool", arguments: {}, result: "ok", error: false, ...extra }) as unknown as ToolCallRecord;
    const read = makeToolCall({ kind: "read" });
    const { frame } = await mountSettled(
      stubWith([
        makeMessage("system", { content: "missing kind", tool_calls: [unclassified({})] }),
        makeMessage("system", { content: "odd kind", tool_calls: [unclassified({ kind: "bogus" })] }),
        makeMessage("system", { content: "read plus missing", tool_calls: [read, unclassified({})] }),
        makeMessage("system", { content: "all read", tool_calls: [read, read] }),
      ]),
    );

    for (const index of [1, 2, 3]) {
      expect(headerLine(frame, index)).toContain("🧧");
      expect(headerLine(frame, index)).not.toContain("🔧");
    }
    expect(headerLine(frame, 4)).toContain("🔧");
    expect(headerLine(frame, 4)).not.toContain("🧧");
  });
});

describe("tool-call/no-reply fallback row", () => {
  test("renders the tools-ran text, distinct from a genuine NoResponse row, and both rows keep the icon", async () => {
    const calls = [makeToolCall({ name: "edit_topic", arguments: { action: "update" }, kind: "write" })];
    const { frame } = await mountSettled(
      stubWith([
        makeMessage("system", { content: "", silence_reason: TOOLS_RAN_NO_REPLY_SILENCE_REASON, tool_calls: calls }),
        makeMessage("system", { content: "", silence_reason: "nothing to add", tool_calls: calls }),
      ]),
    );

    const fallbackRow = rowText(frame, 1);
    expect(fallbackRow).toContain("[Persona ran tools but sent no reply]");
    expect(fallbackRow).not.toContain("chose not to respond");
    expect(frame).not.toContain(TOOLS_RAN_NO_REPLY_SILENCE_REASON);

    const silentRow = rowText(frame, 2);
    expect(silentRow).toContain("chose not to respond");
    expect(silentRow).toContain("nothing to add");
    expect(silentRow).not.toContain("ran tools but sent no reply");

    expect(headerLine(frame, 1)).toContain("🧧");
    expect(headerLine(frame, 2)).toContain("🧧");
  });
});

describe("/toolcalls", () => {
  test("is registered by PromptInput", async () => {
    const m = await mountConversation(stubWith([]));
    mounted = m;
    await m.renderOnce();
    expect(getAllCommands().map(command => command.name)).toContain("toolcalls");
  });

  test("shows no tool-call content inline, and name, action, argument and result in the overlay", async () => {
    const call = makeToolCall({
      name: "edit_topic_zz",
      arguments: { action: "remove", note: "ARG_SENTINEL_1" },
      result: "RESULT_SENTINEL_2",
      kind: "write",
    });
    const { m, frame } = await mountSettled(stubWith([makeMessage("system", { content: "done", tool_calls: [call] })]));
    for (const hidden of ["edit_topic_zz", "remove", "ARG_SENTINEL_1", "RESULT_SENTINEL_2"]) {
      expect(frame).not.toContain(hidden);
    }

    const overlay = await runCommand(m, "/toolcalls 1");
    for (const shown of [OVERLAY_TITLE, "edit_topic_zz", "remove", "ARG_SENTINEL_1", "RESULT_SENTINEL_2"]) {
      expect(overlay).toContain(shown);
    }
  });

  test("shows each call's own error flag, action and name-alone for a tool without an action", async () => {
    const shared = { name: "edit_trait", arguments: { name: "kind", action: "remove" }, result: "same", kind: "write" as const };
    const calls = [
      makeToolCall({ ...shared, error: true }),
      makeToolCall({ ...shared, error: false }),
      makeToolCall({ ...shared, arguments: { name: "kind", action: "update" }, error: false }),
      makeToolCall({ name: "find_memory", arguments: { query: "q" }, kind: "read" }),
    ];
    const { m } = await mountSettled(stubWith([makeMessage("system", { content: "x", tool_calls: calls })]));

    const sections = overlaySections(await runCommand(m, "/toolcalls"));
    expect(sections).toHaveLength(4);
    expect(sections[0]).toContain("edit_trait (remove)");
    expect(sections[0]).toContain("error: true");
    expect(sections[0]).not.toContain("error: false");
    expect(sections[1]).toContain("edit_trait (remove)");
    expect(sections[1]).toContain("error: false");
    expect(sections[1]).not.toContain("error: true");
    expect(sections[2]).toContain("edit_trait (update)");
    expect(sections[2]).not.toContain("remove)");
    expect(sections[3].split("\n")[0]).toBe("[4/4] find_memory");
  });

  test("shows a whitespace-free argument value longer than the overlay in full, including its tail", async () => {
    const longValue = `${"0123456789".repeat(22)}END_OF_VALUE`;
    const call = makeToolCall({ arguments: { token: longValue }, kind: "read" });
    const { m } = await mountSettled(stubWith([makeMessage("system", { content: "x", tool_calls: [call] })]));

    const overlay = await runCommand(m, "/toolcalls");
    const joined = overlayContentLines(overlay).join("");
    expect(joined).toContain(`token: ${longValue}`);
    expect(joined).not.toContain("…");
  });

  test("every call of a long round is reachable through keyboard navigation", async () => {
    const calls = Array.from({ length: 30 }, (_, i) =>
      makeToolCall({ name: `tool_${String(i).padStart(2, "0")}`, arguments: { n: i }, result: `result ${i}` }),
    );
    const { m } = await mountSettled(stubWith([makeMessage("system", { content: "x", tool_calls: calls })]));

    const first = await runCommand(m, "/toolcalls");
    expect(first).toContain("tool_00");
    expect(first).not.toContain("tool_29");

    const seen = new Set<string>();
    const collect = (frame: string) => {
      for (const match of frame.matchAll(/tool_\d\d/g)) seen.add(match[0]);
    };
    collect(first);
    for (let step = 0; step < 400 && seen.size < calls.length; step++) {
      m.mockInput.pressKey("j");
      await m.renderOnce();
      await m.renderOnce();
      collect(m.captureCharFrame());
    }
    expect([...seen].sort()).toEqual(calls.map(call => call.name).sort());
  });

  test("bare /toolcalls shows the most recent Persona message, not an older Persona message nor the human message", async () => {
    const stub = stubWith([
      makeMessage("system", { content: "old", tool_calls: [makeToolCall({ name: "older_tool_aa" })] }),
      makeMessage("system", { content: "new", tool_calls: [makeToolCall({ name: "newer_tool_bb" })] }),
      makeMessage("human", { content: "thanks" }),
    ]);
    const { m } = await mountSettled(stub);

    const overlay = await runCommand(m, "/toolcalls");
    expect(overlay).toContain("newer_tool_bb");
    expect(overlay).not.toContain("older_tool_aa");
    expect(overlay).toContain(`${OVERLAY_TITLE} [2]`);
    expect(stub.notifications).toEqual([]);
  });

  test("bare /toolcalls on a Persona message without tool_calls reports a notice instead of searching backward", async () => {
    const stub = stubWith([
      makeMessage("system", { content: "old", tool_calls: [makeToolCall({ name: "older_tool_aa" })] }),
      makeMessage("system", { content: "latest, no calls" }),
    ]);
    const { m } = await mountSettled(stub);

    const frame = await runCommand(m, "/toolcalls");
    expect(frame).not.toContain(OVERLAY_TITLE);
    expect(frame).not.toContain("older_tool_aa");
    expect(stub.notifications.map(n => n.message)).toEqual([expect.stringContaining("no tool calls on this message")]);
    expect(overlayActiveCalls).not.toContain(true);
  });

  test("/toolcalls N: the no-tool-calls notice for a human message and a call-less Persona message, the overlay for the right Persona index", async () => {
    const stub = stubWith([
      makeMessage("human", { content: "human with calls", tool_calls: [makeToolCall({ name: "human_tool_cc" })] }),
      makeMessage("system", { content: "persona with calls", tool_calls: [makeToolCall({ name: "persona_tool_dd" })] }),
      makeMessage("system", { content: "persona without calls" }),
    ]);
    const { m } = await mountSettled(stub);

    for (const index of [1, 3]) {
      stub.notifications.length = 0;
      const frame = await runCommand(m, `/toolcalls ${index}`);
      expect(frame).not.toContain(OVERLAY_TITLE);
      expect(stub.notifications.map(n => n.message)).toEqual([expect.stringContaining("no tool calls on this message")]);
    }
    expect(overlayActiveCalls).not.toContain(true);

    const overlay = await runCommand(m, "/toolcalls 2");
    expect(overlay).toContain("persona_tool_dd");
    expect(overlay).not.toContain("human_tool_cc");
  });

  test("an out-of-range or non-numeric index reports 'No message at index' and opens nothing", async () => {
    const stub = stubWith([makeMessage("system", { content: "x", tool_calls: [makeToolCall()] })]);
    const { m } = await mountSettled(stub);

    for (const arg of ["0", "-1", "99", "abc"]) {
      stub.notifications.length = 0;
      const frame = await runCommand(m, `/toolcalls ${arg}`);
      expect(frame).not.toContain(OVERLAY_TITLE);
      expect(stub.notifications.map(n => n.message)).toEqual([`No message at index [${arg}]`]);
    }
    expect(overlayActiveCalls).not.toContain(true);
  });

  test("bare /toolcalls on an empty list, or one with no Persona message, reports a notice and opens nothing", async () => {
    for (const messages of [[], [makeMessage("human", { content: "alone" })]]) {
      const stub = stubWith(messages);
      const { m } = await mountSettled(stub);

      const frame = await runCommand(m, "/toolcalls");
      expect(frame).not.toContain(OVERLAY_TITLE);
      expect(stub.notifications).toHaveLength(1);
      expect(overlayActiveCalls).not.toContain(true);

      m.renderer.destroy();
      mounted = undefined;
    }
  });

  test("reports a notice and opens nothing while a Room is active, and works once it is not", async () => {
    const stub = stubWith([makeMessage("system", { content: "x", tool_calls: [makeToolCall({ name: "room_tool_ee" })] })], {
      activeRoomId: "room-1",
    });
    const { m } = await mountSettled(stub);

    for (const text of ["/toolcalls", "/toolcalls 1"]) {
      stub.notifications.length = 0;
      const frame = await runCommand(m, text);
      expect(frame).not.toContain(OVERLAY_TITLE);
      expect(stub.notifications).toHaveLength(1);
    }
    expect(overlayActiveCalls).not.toContain(true);

    stub.setActiveRoomId(null);
    const overlay = await runCommand(m, "/toolcalls");
    expect(overlay).toContain("room_tool_ee");
  });

  test("dispatched through the registry, the overlay appears via the outlet and Escape closes it", async () => {
    const { m } = await mountSettled(
      stubWith([
        makeMessage("human", { content: "hi" }),
        makeMessage("system", { content: "x", tool_calls: [makeToolCall({ name: "outlet_tool_ff" })] }),
      ]),
    );

    const open = await runCommand(m, "/toolcalls 2");
    expect(open).toContain("outlet_tool_ff");
    expect(overlayActiveCalls.at(-1)).toBe(true);

    const closed = await pressEscapeAndWait(m);
    expect(closed).not.toContain("outlet_tool_ff");
    expect(closed).not.toContain(OVERLAY_TITLE);
    expect(overlayActiveCalls.at(-1)).toBe(false);
  });

  // An imported backup can carry a `result` that is not a string. It must render
  // (objects as JSON, the same way arguments do) rather than make the overlay
  // throw and /toolcalls open nothing.
  const VALID_RESULT = 'plain "result" with _markdown_ *chars* and trailing text';

  async function expectObjectResultOverlay(messages: Message[], stub: EiStub): Promise<void> {
    const { m } = await mountSettled(stub);
    expect(messages).toHaveLength(1);

    const overlay = await runCommand(m, "/toolcalls");
    expect(stub.notifications).toEqual([]);
    expect(overlay).toContain(OVERLAY_TITLE);
    expect(overlayActiveCalls.at(-1)).toBe(true);

    const sections = overlaySections(overlay);
    expect(sections).toHaveLength(2);

    expect(sections[0].split("\n")[0]).toBe("[1/2] edit_trait (update)");
    expect(sections[0]).toContain("error: true");
    expect(sections[0]).toContain("action: update");
    expect(sections[0]).toContain("name: kind");
    expect(sections[0]).toContain('"nested": "answer"');
    expect(sections[0]).toContain('"count": 3');

    expect(sections[1].split("\n")[0]).toBe("[2/2] find_memory");
    expect(sections[1]).toContain("error: false");
    expect(sections[1]).toContain("query: anything");
    expect(sections[1]).toContain(`result:\n${VALID_RESULT}`);

    const closed = await pressEscapeAndWait(m);
    expect(closed).not.toContain(OVERLAY_TITLE);
    expect(overlayActiveCalls.at(-1)).toBe(false);
  }

  function objectResultCalls(): ToolCallRecord[] {
    return [
      makeToolCall({
        name: "edit_trait",
        arguments: { action: "update", name: "kind" },
        result: { nested: "answer", count: 3 } as unknown as string,
        error: true,
        kind: "write",
      }),
      makeToolCall({ name: "find_memory", arguments: { query: "anything" }, result: VALID_RESULT, error: false, kind: "read" }),
    ];
  }

  test("a stored object-valued result renders as JSON beside a valid call, without a failed-command notice", async () => {
    const messages = [makeMessage("system", { content: "x", tool_calls: objectResultCalls() })];
    await expectObjectResultOverlay(messages, stubWith(messages));
  });

  test("an object-valued result loaded from a persisted backup through the core persona state renders in the overlay", async () => {
    // Round-trip through JSON text exactly as an imported backup file would arrive.
    const backup = JSON.stringify({
      p1: {
        entity: makePersona("p1", { display_name: "Pia" }),
        messages: [makeMessage("system", { content: "x", tool_calls: objectResultCalls() })],
      },
    });
    const state = new PersonaState();
    state.load(JSON.parse(backup));
    const messages = state.messages_get("p1");
    await expectObjectResultOverlay(messages, stubWith(messages));
  });

  // The overlay's scrollbox is the last one in the tree (the conversation's own
  // scrollbox is mounted before the outlet).
  function overlayScrollbox(m: Mounted): ScrollBoxRenderable {
    const found: ScrollBoxRenderable[] = [];
    const visit = (node: Renderable) => {
      if (node instanceof ScrollBoxRenderable) found.push(node);
      for (const child of node.getChildren()) visit(child);
    };
    visit(m.renderer.root);
    const scrollbox = found.at(-1);
    if (!scrollbox) throw new Error("overlay scrollbox not found");
    return scrollbox;
  }

  // Reads the whole overlay body by scrolling it with its own j key one row at a
  // time, from the top until the scrollbox reports it is at its real maximum
  // offset. Every viewport row at every offset is collected, keyed by actual
  // offset + row. `exact` keeps the viewport cells verbatim (internal spaces
  // included); otherwise whitespace and scrollbar glyphs are dropped, which is
  // the only safe comparison for wide glyphs. A wrapped row that loses its last
  // cell to the scrollbar column shows up as a missing character.
  async function readWholeOverlay(m: Mounted, exact: boolean): Promise<string> {
    const scrollbox = overlayScrollbox(m);
    const viewportHeight = scrollbox.viewport.height;
    const maxOffset = scrollbox.scrollHeight - viewportHeight;
    expect(maxOffset).toBeGreaterThan(0);
    scrollbox.scrollTo(0);
    await m.renderOnce();
    await m.renderOnce();

    const rows = new Map<number, string>();
    for (let presses = 0; ; presses++) {
      const offset = scrollbox.scrollTop;
      const lines = m.captureCharFrame().split("\n");
      for (let row = 0; row < viewportHeight; row++) {
        const line = lines[scrollbox.y + row] ?? "";
        rows.set(
          offset + row,
          exact
            ? line.slice(scrollbox.x, scrollbox.x + scrollbox.viewport.width)
            : line.replace(/^\s*│/, "").replace(/│\s*$/, ""),
        );
      }
      if (offset >= maxOffset) break;
      expect(presses).toBeLessThan(maxOffset + 5);
      m.mockInput.pressKey("j");
      await m.renderOnce();
      await m.renderOnce();
      expect(scrollbox.scrollTop).toBeGreaterThan(offset);
    }
    expect(rows.size).toBe(maxOffset + viewportHeight);

    const joined = [...rows.keys()]
      .sort((a, b) => a - b)
      .map(key => rows.get(key)!)
      .join("");
    return exact ? joined : joined.replace(/[\s█▀▄]/g, "");
  }

  async function openTall(call: ToolCallRecord, height: number): Promise<Mounted> {
    const m = await mountConversation(stubWith([makeMessage("system", { content: "x", tool_calls: [call] })]), { height });
    mounted = m;
    await settle(m);
    await runCommand(m, "/toolcalls");
    return m;
  }

  for (const length of [1000, 1001, 1002, 1500]) {
    test(`a ${length}-character whitespace-free string argument is shown in full across every scroll offset`, async () => {
      const value = `${"abcdefghij".repeat(Math.ceil(length / 10)).slice(0, length)}ARG_TAIL_END`;
      const m = await openTall(makeToolCall({ arguments: { token: value } }), 24);

      expect(await readWholeOverlay(m, false)).toContain(`token:${value}`);
    });
  }

  test("a long string argument with internal spaces is shown in full, spaces included, across every scroll offset", async () => {
    const value = `${"word and another word, ".repeat(70)}SPACED_TAIL_END`;
    const m = await openTall(makeToolCall({ arguments: { note: value } }), 24);

    expect(await readWholeOverlay(m, true)).toContain(`note: ${value}`);
  });

  for (const height of [24, 50]) {
    test(`a long JSON-object result with wide characters is shown in full across every scroll offset at height ${height}`, async () => {
      const result = { value: `${"こ🌸".repeat(1500)}LONG_RESULT_END` } as unknown as string;
      const m = await openTall(makeToolCall({ result }), height);

      expect(await readWholeOverlay(m, false)).toContain(JSON.stringify(result, null, 2).replace(/\s/g, ""));
    });
  }
});

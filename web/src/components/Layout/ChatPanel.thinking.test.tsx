import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, within, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";
import { ContextStatus, TOOLS_RAN_NO_REPLY_SILENCE_REASON, type Message, type ToolCallRecord } from "../../../../src/core/types";
import { installVirtualListStubs } from "../../test/virtualListStubs";

const call: ToolCallRecord = {
  name: "edit_trait",
  arguments: { action: "update", id: "T1" },
  result: "updated",
  error: false,
  kind: "write",
};

function reply(id: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: "system",
    content: `reply ${id}`,
    timestamp: "2026-01-01T10:00:00.000Z",
    read: true,
    context_status: ContextStatus.Default,
    ...extra,
  };
}

function renderPanel(messages: Message[], props: { showThinking?: boolean; onToggleThinking?: () => void } = {}) {
  return render(
    <ChatPanel
      activePersonaId="persona-1"
      activePersonaDisplayName="Ada"
      messages={messages}
      inputValue=""
      onInputChange={() => {}}
      onSendMessage={() => {}}
      onToolCallsClick={() => {}}
      {...props}
    />,
  );
}

function row(messageId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!el) throw new Error(`message row ${messageId} not rendered`);
  return el;
}

describe("ChatPanel thinking", () => {
  let restoreStubs: () => void;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
  });

  afterEach(() => {
    restoreStubs();
  });

  it("renders the thinking icon whether the setting is on or off, but the thinking text only when on", () => {
    const messages = [reply("p", { thinking: "deep thought" })];
    const { rerender } = renderPanel(messages, { showThinking: true, onToggleThinking: () => {} });

    expect(within(row("p")).getByRole("button", { name: "💭" })).toBeInTheDocument();
    expect(within(row("p")).getByText("deep thought")).toBeInTheDocument();

    rerender(
      <ChatPanel
        activePersonaId="persona-1"
        activePersonaDisplayName="Ada"
        messages={messages}
        inputValue=""
        onInputChange={() => {}}
        onSendMessage={() => {}}
        showThinking={false}
        onToggleThinking={() => {}}
      />,
    );

    expect(within(row("p")).getByRole("button", { name: "💭" })).toBeInTheDocument();
    expect(within(row("p")).queryByText("deep thought")).toBeNull();
    expect(within(row("p")).getByText("reply p")).toBeInTheDocument();
  });

  it("defaults to showing thinking when the setting is not supplied, and omits the icon for a message with no thinking", () => {
    renderPanel([reply("p", { thinking: "deep thought" }), reply("q"), reply("s", { thinking: "" })], {
      onToggleThinking: () => {},
    });

    expect(within(row("p")).getByText("deep thought")).toBeInTheDocument();
    expect(within(row("q")).queryByRole("button", { name: "💭" })).toBeNull();
    expect(within(row("s")).queryByRole("button", { name: "💭" })).toBeNull();
  });

  it("calls the toggle callback once per icon click", () => {
    const onToggleThinking = vi.fn();
    renderPanel([reply("p", { thinking: "deep thought" })], { onToggleThinking });

    fireEvent.click(within(row("p")).getByRole("button", { name: "💭" }));
    expect(onToggleThinking).toHaveBeenCalledTimes(1);
  });

  it("renders thinking above the reply inside the same message", () => {
    renderPanel([reply("p", { thinking: "deep thought" })], { onToggleThinking: () => {} });

    const thinking = within(row("p")).getByText("deep thought");
    const content = within(row("p")).getByText("reply p");
    expect(thinking.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe("ChatPanel tools-ran-no-reply row", () => {
  let restoreStubs: () => void;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
  });

  afterEach(() => {
    restoreStubs();
  });

  it("tells a tools-ran-no-reply row apart from a chose-not-to-respond row, both keeping the tool-call icon", () => {
    renderPanel([
      reply("tools-only", { content: "", silence_reason: TOOLS_RAN_NO_REPLY_SILENCE_REASON, tool_calls: [call] }),
      reply("declined", { content: "", silence_reason: "nothing to add", tool_calls: [call] }),
    ]);

    const toolsOnly = row("tools-only");
    expect(toolsOnly).toHaveTextContent("[Ada ran tools but sent no reply]");
    expect(toolsOnly.textContent).not.toContain("chose not to respond");
    expect(toolsOnly.textContent).not.toContain(TOOLS_RAN_NO_REPLY_SILENCE_REASON);
    expect(within(toolsOnly).getByRole("button", { name: /Show tool calls/ })).toBeInTheDocument();

    const declined = row("declined");
    expect(declined).toHaveTextContent("[Ada chose not to respond because: nothing to add]");
    expect(within(declined).getByRole("button", { name: /Show tool calls/ })).toBeInTheDocument();
  });
});

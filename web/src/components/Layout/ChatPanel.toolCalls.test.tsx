import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ChatPanel } from "./ChatPanel";
import { ContextStatus, type Message, type ToolCallRecord } from "../../../../src/core/types";
import { installVirtualListStubs } from "../../test/virtualListStubs";

const READ_NAME = "Show tool calls (read only)";
const WRITE_NAME = "Show tool calls (includes write)";

const readCall = (id: string): ToolCallRecord => ({
  name: "find_memory",
  arguments: { query: `query ${id}` },
  result: `result ${id}`,
  error: false,
  kind: "read",
});

const writeCall: ToolCallRecord = {
  name: "edit_trait",
  arguments: { action: "update", id: "T1", name: "Curious" },
  result: "updated",
  error: false,
  kind: "write",
};

function personaReply(id: string, extra: Partial<Message> = {}): Message {
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

function renderPanel(messages: Message[], onToolCallsClick = vi.fn()) {
  const view = render(
    <ChatPanel
      activePersonaId="persona-1"
      activePersonaDisplayName="Ada"
      messages={messages}
      inputValue=""
      onInputChange={() => {}}
      onSendMessage={() => {}}
      onToolCallsClick={onToolCallsClick}
    />,
  );
  return { ...view, onToolCallsClick };
}

function row(messageId: string): HTMLElement {
  const el = document.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
  if (!el) throw new Error(`message row ${messageId} not rendered`);
  return el;
}

describe("ChatPanel tool-call icon", () => {
  let restoreStubs: () => void;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
  });

  afterEach(() => {
    restoreStubs();
  });

  it("renders the icon only for a reply whose tool_calls is non-empty, not for an omitted field or an empty array", () => {
    const withCalls = personaReply("with-calls", { tool_calls: [readCall("a")] });
    const omitted = personaReply("omitted");
    const empty = personaReply("empty", { tool_calls: [] });
    const { onToolCallsClick } = renderPanel([withCalls, omitted, empty]);

    expect(within(row("with-calls")).getByRole("button", { name: READ_NAME })).toBeInTheDocument();
    expect(within(row("omitted")).queryByRole("button", { name: /Show tool calls/ })).toBeNull();
    expect(within(row("empty")).queryByRole("button", { name: /Show tool calls/ })).toBeNull();
    expect(screen.getAllByRole("button", { name: /Show tool calls/ })).toHaveLength(1);

    fireEvent.click(within(row("with-calls")).getByRole("button", { name: READ_NAME }));
    expect(onToolCallsClick).toHaveBeenCalledTimes(1);
    expect(onToolCallsClick).toHaveBeenCalledWith(withCalls);
  });

  it("shows the write icon when a write call sits between two reads, and the read icon once the write is removed", () => {
    const mixed = personaReply("mixed", { tool_calls: [readCall("a"), writeCall, readCall("b")] });
    const { rerender, onToolCallsClick } = renderPanel([mixed]);

    const writeButton = within(row("mixed")).getByRole("button", { name: WRITE_NAME });
    expect(writeButton).toHaveTextContent("🧧");
    expect(within(row("mixed")).queryByRole("button", { name: READ_NAME })).toBeNull();
    expect(row("mixed")).not.toHaveTextContent("🔧");

    const readOnly = personaReply("mixed", { tool_calls: [readCall("a"), readCall("b")] });
    rerender(
      <ChatPanel
        activePersonaId="persona-1"
        activePersonaDisplayName="Ada"
        messages={[readOnly]}
        inputValue=""
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onToolCallsClick={onToolCallsClick}
      />,
    );

    const readButton = within(row("mixed")).getByRole("button", { name: READ_NAME });
    expect(readButton).toHaveTextContent("🔧");
    expect(within(row("mixed")).queryByRole("button", { name: WRITE_NAME })).toBeNull();
    expect(row("mixed")).not.toHaveTextContent("🧧");
  });

  it("treats a write call in first or last position as a write batch", () => {
    renderPanel([
      personaReply("write-first", { tool_calls: [writeCall, readCall("a")] }),
      personaReply("write-last", { tool_calls: [readCall("a"), writeCall] }),
    ]);

    expect(within(row("write-first")).getByRole("button", { name: WRITE_NAME })).toBeInTheDocument();
    expect(within(row("write-last")).getByRole("button", { name: WRITE_NAME })).toBeInTheDocument();
  });

  it("shows no tool-call content inline", () => {
    renderPanel([personaReply("quiet", { tool_calls: [readCall("a"), writeCall] })]);

    const text = row("quiet").textContent ?? "";
    expect(text).not.toContain("find_memory");
    expect(text).not.toContain("edit_trait");
    expect(text).not.toContain("query a");
    expect(text).not.toContain("updated");
    expect(text).toContain("reply quiet");
  });

  it("exposes the icon as a native button whose accessible name is a kind-specific phrase, not its glyph", () => {
    renderPanel([
      personaReply("read-only", { tool_calls: [readCall("a")] }),
      personaReply("has-write", { tool_calls: [writeCall] }),
    ]);

    const readButton = screen.getByRole("button", { name: READ_NAME });
    const writeButton = screen.getByRole("button", { name: WRITE_NAME });

    expect(readButton.tagName).toBe("BUTTON");
    expect(writeButton.tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: "🔧" })).toBeNull();
    expect(screen.queryByRole("button", { name: "🧧" })).toBeNull();
    expect(row("read-only")).toContainElement(readButton);
    expect(row("has-write")).toContainElement(writeButton);
  });
});

import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ContextStatus, type Message, type ToolCallRecord } from "../../../../src/core/types";
import { ToolCallsModal } from "../Modals/ToolCallsModal";
import { installVirtualListStubs } from "../../test/virtualListStubs";
import { ChatPanel } from "./ChatPanel";

const secret = "sk-live_AbC*dEf**gh**`ij`_k_ [x](http://a)";

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

function messageRow(id: string): HTMLElement {
  const row = document.querySelector<HTMLElement>(`[data-message-id="${id}"]`);
  if (!row) throw new Error(`message row ${id} not rendered`);
  return row;
}

function Display({ messages, showThinking = true }: { messages: Message[]; showThinking?: boolean }) {
  const [selectedMessage, setSelectedMessage] = useState<Message | null>(null);
  return (
    <>
      <ChatPanel
        activePersonaId="persona-1"
        activePersonaDisplayName="Ada"
        messages={messages}
        inputValue=""
        onInputChange={() => {}}
        onSendMessage={() => {}}
        onToggleThinking={async () => true}
        showThinking={showThinking}
        onToolCallsClick={setSelectedMessage}
      />
      <ToolCallsModal message={selectedMessage} onClose={() => setSelectedMessage(null)} />
    </>
  );
}

function thinkingText(id: string): HTMLElement | null {
  return messageRow(id).querySelector<HTMLElement>(".ei-message__thinking");
}

function thinkingIcon(id: string): HTMLElement | null {
  return within(messageRow(id)).queryByRole("button", { name: "💭" });
}

const call: ToolCallRecord = {
  name: "edit_trait",
  arguments: { action: "update", id: "T-1", name: secret },
  result: "saved all fields",
  error: false,
  kind: "write",
};

describe("1:1 message display contract", () => {
  let restoreStubs: () => void;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreStubs();
  });

  it("pairs a present thought with both absent and empty thoughts while visibility is on and off", () => {
    const messages = [
      reply("present", { thinking: "exact private reasoning" }),
      reply("absent"),
      reply("empty", { thinking: "" }),
    ];
    const { rerender } = render(<Display messages={messages} showThinking />);

    expect(thinkingText("present")).toHaveTextContent("exact private reasoning");
    expect(thinkingText("present")?.textContent).toBe("exact private reasoning");
    expect(thinkingIcon("present")).toBeInTheDocument();
    for (const id of ["absent", "empty"]) {
      expect(thinkingText(id)).toBeNull();
      expect(thinkingIcon(id)).toBeNull();
      expect(messageRow(id)).toHaveTextContent(`reply ${id}`);
    }

    rerender(<Display messages={messages} showThinking={false} />);
    expect(thinkingText("present")).toBeNull();
    expect(messageRow("present")).not.toHaveTextContent("exact private reasoning");
    expect(thinkingIcon("present")).toBeInTheDocument();
    for (const id of ["absent", "empty"]) {
      expect(thinkingText(id)).toBeNull();
      expect(thinkingIcon(id)).toBeNull();
      expect(messageRow(id)).toHaveTextContent(`reply ${id}`);
    }
  });

  it("displays sensitive-shaped arguments and inline thinking verbatim without markdown conversion or masking", () => {
    render(<Display messages={[reply("sensitive", { thinking: secret, tool_calls: [call] })]} />);

    const inlineThinking = thinkingText("sensitive");
    expect(inlineThinking?.textContent).toBe(secret);
    expect(within(messageRow("sensitive")).getByRole("button", { name: "💭" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(within(messageRow("sensitive")).getByRole("button", { name: "Show tool calls (includes write)" }));
    const dialog = screen.getByRole("dialog", { name: /tool calls/i });
    const nameLabel = within(dialog).getByText("name");
    expect(nameLabel.nextElementSibling?.textContent).toBe(secret);
  });

  it("reveals complete persisted thinking and tool details immediately, with no later additions", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame", "cancelAnimationFrame"] });
    const thought = "First complete thought, then the final reason.";
    const result = "The persisted result is already complete.";
    const persistedCall: ToolCallRecord = { ...call, result };
    render(<Display messages={[reply("complete", { thinking: thought, tool_calls: [persistedCall] })]} />);

    expect(thinkingText("complete")?.textContent).toBe(thought);
    const icon = within(messageRow("complete")).getByRole("button", { name: "Show tool calls (includes write)" });
    expect(icon).toHaveTextContent("🧧");
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(icon);
    const dialog = screen.getByRole("dialog", { name: /tool calls/i });
    const list = dialog.querySelector<HTMLElement>(".ei-tool-calls-modal__list");
    if (!list) throw new Error("tool-call list not rendered");
    const completeContent = list.textContent;
    expect(within(list).getByText("edit_trait")).toBeInTheDocument();
    expect(within(list).getByText(secret).textContent).toBe(secret);
    expect(within(list).getByText(result).textContent).toBe(result);
    expect(list).toHaveTextContent("error: false");

    act(() => {
      vi.advanceTimersByTime(3_000);
    });
    expect(thinkingText("complete")?.textContent).toBe(thought);
    expect(screen.getByRole("dialog", { name: /tool calls/i }).querySelector(".ei-tool-calls-modal__list")?.textContent).toBe(completeContent);
  });
});

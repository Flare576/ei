import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, within, fireEvent } from "@testing-library/react";
import { ToolCallsModal } from "./ToolCallsModal";
import { ContextStatus, type Message, type ToolCallRecord } from "../../../../src/core/types";

const RAW_OUTPUT = "0123456789".repeat(20);
const PERSISTED_OUTPUT = `${RAW_OUTPUT.slice(0, 150)}... (truncated)`;

const removeCall: ToolCallRecord = {
  name: "edit_trait",
  arguments: { action: "remove", id: "X" },
  result: "trait not found",
  error: true,
  kind: "write",
};

const updateCall: ToolCallRecord = {
  name: "edit_trait",
  arguments: { action: "update", id: "Y", name: "New name", sentiment: 0.5 },
  result: PERSISTED_OUTPUT,
  error: false,
  kind: "write",
};

const searchCall: ToolCallRecord = {
  name: "find_memory",
  arguments: { query: "birthday" },
  result: "nothing",
  error: false,
  kind: "read",
};

function message(toolCalls: ToolCallRecord[]): Message {
  return {
    id: "m1",
    role: "system",
    content: "done",
    timestamp: "2026-01-01T10:00:00.000Z",
    read: true,
    context_status: ContextStatus.Default,
    tool_calls: toolCalls,
  };
}

function callSection(index: number): HTMLElement {
  return screen.getAllByRole("listitem")[index];
}

describe("ToolCallsModal", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows each call's name, action, every argument, persisted result and its own error flag", () => {
    render(<ToolCallsModal message={message([removeCall, updateCall])} onClose={() => {}} />);

    const first = callSection(0);
    expect(within(first).getByRole("heading", { name: "edit_trait" })).toBeInTheDocument();
    expect(within(first).getByText("action: remove")).toBeInTheDocument();
    expect(within(first).getByText("id")).toBeInTheDocument();
    expect(within(first).getByText("X")).toBeInTheDocument();
    expect(within(first).getByText("error: true")).toBeInTheDocument();
    expect(within(first).queryByText("error: false")).toBeNull();

    const second = callSection(1);
    expect(within(second).getByText("action: update")).toBeInTheDocument();
    expect(within(second).getByText("Y")).toBeInTheDocument();
    expect(within(second).getByText("name")).toBeInTheDocument();
    expect(within(second).getByText("New name")).toBeInTheDocument();
    expect(within(second).getByText("sentiment")).toBeInTheDocument();
    expect(within(second).getByText("0.5")).toBeInTheDocument();
    expect(within(second).getByText("error: false")).toBeInTheDocument();
    expect(within(second).queryByText("error: true")).toBeNull();

    const persisted = within(second).getByText(PERSISTED_OUTPUT);
    expect(persisted.textContent).toBe(PERSISTED_OUTPUT);
    expect(second.textContent).not.toContain(RAW_OUTPUT);
  });

  it("shows the name alone for a tool whose arguments carry no action", () => {
    render(<ToolCallsModal message={message([searchCall])} onClose={() => {}} />);

    const call = callSection(0);
    expect(within(call).getByRole("heading", { name: "find_memory" })).toBeInTheDocument();
    expect(within(call).queryByText(/^action:/)).toBeNull();
    expect(within(call).getByText("birthday")).toBeInTheDocument();
  });

  it("opens for a call whose persisted arguments are null, showing name, result, error and a visible null marker", () => {
    const nullArgsCall = {
      name: "get_my_identity",
      arguments: null,
      result: "{}",
      error: true,
      kind: "write",
    } as unknown as ToolCallRecord;
    render(<ToolCallsModal message={message([nullArgsCall])} onClose={() => {}} />);

    expect(screen.getByRole("dialog", { name: "Tool calls (1)" })).toBeInTheDocument();
    const call = callSection(0);
    expect(within(call).getByRole("heading", { name: "get_my_identity" })).toBeInTheDocument();
    expect(within(call).getByText("Arguments")).toBeInTheDocument();
    expect(within(call).getByText("(none: arguments were null)")).toBeInTheDocument();
    expect(within(call).queryByText(/^action:/)).toBeNull();
    expect(within(call).getByText("{}")).toBeInTheDocument();
    expect(within(call).getByText("error: true")).toBeInTheDocument();
  });

  it("opens for a call whose arguments field is absent, marking it as absent", () => {
    const absentArgsCall = { name: "get_my_identity", result: "ok", error: false, kind: "read" } as unknown as ToolCallRecord;
    render(<ToolCallsModal message={message([absentArgsCall])} onClose={() => {}} />);

    const call = callSection(0);
    expect(within(call).getByRole("heading", { name: "get_my_identity" })).toBeInTheDocument();
    expect(within(call).getByText("(none: arguments were absent)")).toBeInTheDocument();
    expect(within(call).getByText("error: false")).toBeInTheDocument();
  });

  it("renders nothing without a selected message", () => {
    render(<ToolCallsModal message={null} onClose={() => {}} />);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a modal dialog named by its visible title", () => {
    render(<ToolCallsModal message={message([searchCall, updateCall])} onClose={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Tool calls (2)" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(document.getElementById(dialog.getAttribute("aria-labelledby") ?? "")).toHaveTextContent("Tool calls (2)");
  });

  it("moves focus into the dialog on open and restores it to the previously focused element on close", () => {
    const toolCalls = message([searchCall]);
    const { rerender } = render(
      <>
        <button>opener</button>
        <ToolCallsModal message={null} onClose={() => {}} />
      </>,
    );
    const opener = screen.getByRole("button", { name: "opener" });
    opener.focus();

    rerender(
      <>
        <button>opener</button>
        <ToolCallsModal message={toolCalls} onClose={() => {}} />
      </>,
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    rerender(
      <>
        <button>opener</button>
        <ToolCallsModal message={null} onClose={() => {}} />
      </>,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("closes from its named Close button", () => {
    const onClose = vi.fn();
    render(<ToolCallsModal message={message([searchCall])} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close tool calls" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes on a backdrop click but not on a click inside the dialog", () => {
    const onClose = vi.fn();
    render(<ToolCallsModal message={message([searchCall])} onClose={onClose} />);
    const dialog = screen.getByRole("dialog");
    const overlay = dialog.parentElement as HTMLElement;

    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.mouseDown(overlay);
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("consumes Escape itself: closes, and the event never reaches a document-level listener", () => {
    const onClose = vi.fn();
    const documentListener = vi.fn();
    document.addEventListener("keydown", documentListener);
    try {
      render(<ToolCallsModal message={message([searchCall])} onClose={onClose} />);

      fireEvent.keyDown(screen.getByRole("button", { name: "Close tool calls" }), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(2);

      expect(documentListener).not.toHaveBeenCalled();
    } finally {
      document.removeEventListener("keydown", documentListener);
    }
  });

  it("traps Tab and Shift+Tab on its only focusable element, Close", () => {
    render(<ToolCallsModal message={message([searchCall])} onClose={() => {}} />);
    const close = screen.getByRole("button", { name: "Close tool calls" });

    expect(fireEvent.keyDown(close, { key: "Tab" })).toBe(false);
    expect(document.activeElement).toBe(close);

    (screen.getByRole("dialog") as HTMLElement).focus();
    expect(fireEvent.keyDown(close, { key: "Tab", shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(close);
  });

  it("leaves other keys alone", () => {
    const onClose = vi.fn();
    render(<ToolCallsModal message={message([searchCall])} onClose={onClose} />);

    expect(fireEvent.keyDown(screen.getByRole("dialog"), { key: "a" })).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

// Drives the real <App> (real ControlArea, real ChatPanel, real queue handlers) against a
// Processor whose prototype methods are replaced by in-memory stubs, so the tool-call modal is
// exercised in the same component tree and global-key environment a user gets in the browser.
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";
import App from "./App";
import { Processor } from "../../src/core/processor";
import { IndexedDBStorage } from "../../src/storage/indexed";
import type { HumanEntity, Message, PersonaSummary, QueueStatus, StorageState } from "../../src/core/types";
import { installVirtualListStubs } from "./test/virtualListStubs";

const WRITE_ICON_NAME = "Show tool calls (includes write)";

const persona: PersonaSummary = {
  id: "persona-1",
  display_name: "Ada",
  aliases: [],
  is_paused: false,
  is_archived: false,
  unread_count: 0,
};

const reply: Message = {
  id: "m1",
  role: "system",
  content: "I updated your traits.",
  timestamp: "2026-01-01T10:00:00.000Z",
  read: true,
  context_status: "default",
  tool_calls: [
    {
      name: "edit_trait",
      arguments: { action: "update", id: "T1", name: "Curious" },
      result: "ok",
      error: false,
      kind: "write",
    },
  ],
} as Message;

const human = {
  entity: "human",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  last_updated: "2026-01-01T00:00:00.000Z",
  settings: {},
} as unknown as HumanEntity;

const storedState = { version: 1, timestamp: "t", human, personas: {}, queue: [], providers: [], tools: [] } as unknown as StorageState;

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe("tool-call modal in the real App", () => {
  let restoreStubs: () => void;
  let queueState: QueueStatus["state"];
  let resumeQueue: MockInstance;
  let abortCurrentOperation: MockInstance;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
    queueState = "idle";

    vi.spyOn(IndexedDBStorage.prototype, "isAvailable").mockResolvedValue(true);
    vi.spyOn(IndexedDBStorage.prototype, "load").mockResolvedValue(storedState);
    vi.spyOn(IndexedDBStorage.prototype, "save").mockResolvedValue(undefined);

    vi.spyOn(Processor.prototype, "start").mockResolvedValue(undefined);
    vi.spyOn(Processor.prototype, "stop").mockResolvedValue(undefined);
    vi.spyOn(Processor.prototype, "getPersonaList").mockResolvedValue([persona]);
    vi.spyOn(Processor.prototype, "getQueueStatus").mockImplementation(async () => ({
      state: queueState,
      pending_count: 0,
      dlq_count: 0,
    }));
    vi.spyOn(Processor.prototype, "getHuman").mockResolvedValue(human);
    vi.spyOn(Processor.prototype, "getGroupList").mockResolvedValue([]);
    vi.spyOn(Processor.prototype, "getQuotes").mockResolvedValue([]);
    vi.spyOn(Processor.prototype, "getToolProviderList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getToolList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getRoomList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getMessages").mockResolvedValue([reply]);
    vi.spyOn(Processor.prototype, "getPersona").mockResolvedValue(null);
    resumeQueue = vi.spyOn(Processor.prototype, "resumeQueue").mockResolvedValue(undefined);
    abortCurrentOperation = vi.spyOn(Processor.prototype, "abortCurrentOperation").mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreStubs();
  });

  async function openModal() {
    render(<App />);
    const icon = await screen.findByRole("button", { name: WRITE_ICON_NAME });
    icon.focus();
    fireEvent.click(icon);
    const dialog = await screen.findByRole("dialog", { name: /tool calls/i });
    return { icon, dialog };
  }

  it("renders the modal outside the virtualized rows and moves focus into it", async () => {
    const { dialog } = await openModal();

    expect(dialog.closest("[data-index]")).toBeNull();
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(dialog).toHaveTextContent("edit_trait");
    expect(dialog).toHaveTextContent("action: update");
  });

  it.each<QueueStatus["state"]>(["idle", "paused"])(
    "Escape inside the modal closes it and restores focus without pausing, resuming or aborting (queue %s), while a no-modal Escape still toggles the queue",
    async (startingState) => {
      queueState = startingState;
      const { icon, dialog } = await openModal();

      resumeQueue.mockClear();
      abortCurrentOperation.mockClear();
      fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Escape" });
      await settle();

      expect(screen.queryByRole("dialog")).toBeNull();
      expect(dialog.isConnected).toBe(false);
      expect(document.activeElement).toBe(icon);
      expect(resumeQueue).toHaveBeenCalledTimes(0);
      expect(abortCurrentOperation).toHaveBeenCalledTimes(0);

      resumeQueue.mockClear();
      abortCurrentOperation.mockClear();
      fireEvent.keyDown(document.body, { key: "Escape" });
      await settle();

      if (startingState === "idle") {
        expect(abortCurrentOperation).toHaveBeenCalledTimes(1);
        expect(resumeQueue).toHaveBeenCalledTimes(0);
      } else {
        expect(resumeQueue).toHaveBeenCalledTimes(1);
        expect(abortCurrentOperation).toHaveBeenCalledTimes(0);
      }
    },
  );

  it("closes from the Close button without touching the queue", async () => {
    await openModal();
    resumeQueue.mockClear();
    abortCurrentOperation.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Close tool calls" }));
    await settle();

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(resumeQueue).toHaveBeenCalledTimes(0);
    expect(abortCurrentOperation).toHaveBeenCalledTimes(0);
  });
});

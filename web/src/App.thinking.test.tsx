// Drives the real <App> (real ChatPanel, real PersonaEditor) against a Processor whose prototype
// methods are replaced by an in-memory persona store, so the thinking toggle is exercised through
// the same click -> handler -> persisted setting -> re-render path a user gets in the browser.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor, within } from "@testing-library/react";
import App from "./App";
import { Processor } from "../../src/core/processor";
import { StateManager } from "../../src/core/state-manager";
import { IndexedDBStorage } from "../../src/storage/indexed";
import { ContextStatus, type HumanEntity, type Message, type PersonaEntity, type StorageState } from "../../src/core/types";
import { installVirtualListStubs } from "./test/virtualListStubs";

const THINKING_ICON = "💭";

function makePersona(id: string, displayName: string): PersonaEntity {
  return {
    id,
    display_name: displayName,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "2026-01-01T00:00:00.000Z",
  };
}

function makeMessage(id: string, content: string, thinking?: string): Message {
  return {
    id,
    role: "system",
    content,
    timestamp: "2026-01-01T10:00:00.000Z",
    read: true,
    context_status: ContextStatus.Default,
    thinking,
  };
}

const human: HumanEntity = {
  entity: "human",
  facts: [],
  topics: [],
  people: [],
  quotes: [],
  last_updated: "2026-01-01T00:00:00.000Z",
  settings: {},
};

const storedState: StorageState = {
  version: 1,
  timestamp: "t",
  human,
  personas: {},
  queue: [],
  providers: [],
  tools: [],
};

async function settle() {
  await act(async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  });
}

describe("thinking display in the real App", () => {
  let restoreStubs: () => void;
  let store: Map<string, PersonaEntity>;
  let messagesByPersona: Map<string, Message[]>;
  let startedProcessor: Processor | undefined;

  beforeEach(() => {
    restoreStubs = installVirtualListStubs();
    store = new Map([
      ["ada", makePersona("ada", "Ada")],
      ["bea", makePersona("bea", "Bea")],
    ]);
    messagesByPersona = new Map([
      ["ada", [makeMessage("a1", "Ada reply one", "Ada thinks one"), makeMessage("a2", "Ada reply two", "Ada thinks two")]],
      ["bea", [makeMessage("b1", "Bea reply", "Bea thinks")]],
    ]);

    vi.spyOn(IndexedDBStorage.prototype, "isAvailable").mockResolvedValue(true);
    vi.spyOn(IndexedDBStorage.prototype, "load").mockResolvedValue(storedState);
    vi.spyOn(IndexedDBStorage.prototype, "save").mockResolvedValue(undefined);

    startedProcessor = undefined;
    vi.spyOn(Processor.prototype, "start").mockImplementation(async function (this: Processor) {
      startedProcessor = this;
    });
    vi.spyOn(Processor.prototype, "stop").mockResolvedValue(undefined);
    vi.spyOn(Processor.prototype, "getPersonaList").mockImplementation(async () =>
      [...store.values()].map((p) => ({
        id: p.id,
        display_name: p.display_name,
        aliases: [],
        is_paused: false,
        is_archived: false,
        unread_count: 0,
      })),
    );
    vi.spyOn(Processor.prototype, "getQueueStatus").mockResolvedValue({ state: "idle", pending_count: 0, dlq_count: 0 });
    vi.spyOn(Processor.prototype, "getHuman").mockResolvedValue(human);
    vi.spyOn(Processor.prototype, "getGroupList").mockResolvedValue([]);
    vi.spyOn(Processor.prototype, "getQuotes").mockResolvedValue([]);
    vi.spyOn(Processor.prototype, "getToolProviderList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getToolList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getRoomList").mockReturnValue([]);
    vi.spyOn(Processor.prototype, "getMessages").mockImplementation(async (id: string) => messagesByPersona.get(id) ?? []);
    vi.spyOn(Processor.prototype, "getPersona").mockImplementation(async (id: string) => {
      const record = store.get(id);
      return record ? structuredClone(record) : null;
    });
    vi.spyOn(Processor.prototype, "updatePersona").mockImplementation(async (id: string, updates: Partial<PersonaEntity>) => {
      const record = store.get(id);
      if (record) store.set(id, { ...record, ...updates });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreStubs();
  });

  const storedShowThinking = async (id: string) => (await startedProcessor!.getPersona(id))?.show_thinking;

  // The persona name also appears in the panel toggle and the chat header, so target the pill itself.
  const pillName = (name: string) => {
    const el = screen.getAllByText(name).find((candidate) => candidate.classList.contains("ei-persona-pill__name"));
    if (!el) throw new Error(`persona pill ${name} not rendered`);
    return el;
  };

  async function openChat(name: string) {
    render(<App />);
    await waitFor(() => expect(pillName(name)).toBeDefined());
    fireEvent.click(pillName(name));
    await screen.findByText(`Chat with ${name}`);
  }

  async function openEditor(name: string) {
    const pill = pillName(name).closest<HTMLElement>("[role='button']");
    if (!pill) throw new Error(`persona pill ${name} has no button ancestor`);
    fireEvent.mouseEnter(pill);
    fireEvent.click(within(pill).getByTitle("Edit"));
    const dialog = await screen.findByRole("dialog", { name: `Edit Persona: ${name}` });
    return {
      dialog,
      checkbox: within(dialog).getByRole<HTMLInputElement>("checkbox", { name: /Show Thinking/ }),
    };
  }

  async function closeEditor() {
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /Edit Persona/ })).toBeNull());
  }

  it("shows thinking by default and the icon click hides then restores it for every message, persisting the setting each time", async () => {
    await openChat("Ada");
    expect(await screen.findByText("Ada thinks one")).toBeInTheDocument();
    expect(screen.getByText("Ada thinks two")).toBeInTheDocument();
    expect(await storedShowThinking("ada")).toBeUndefined();
    expect(screen.getAllByRole("button", { name: THINKING_ICON })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole("button", { name: THINKING_ICON })[0]);
    await waitFor(() => expect(screen.queryByText("Ada thinks one")).toBeNull());
    expect(screen.queryByText("Ada thinks two")).toBeNull();
    expect(await storedShowThinking("ada")).toBe(false);
    expect(screen.getAllByRole("button", { name: THINKING_ICON })).toHaveLength(2);
    expect(screen.getByText("Ada reply one")).toBeInTheDocument();

    const hidden = await openEditor("Ada");
    expect(hidden.checkbox.checked).toBe(false);
    await closeEditor();

    fireEvent.click(screen.getAllByRole("button", { name: THINKING_ICON })[1]);
    expect(await screen.findByText("Ada thinks one")).toBeInTheDocument();
    expect(screen.getByText("Ada thinks two")).toBeInTheDocument();
    expect(await storedShowThinking("ada")).toBe(true);

    const shown = await openEditor("Ada");
    expect(shown.checkbox.checked).toBe(true);
  });

  it("toggling one persona leaves another persona's thinking and stored setting untouched", async () => {
    await openChat("Ada");
    await screen.findByText("Ada thinks one");
    fireEvent.click(screen.getAllByRole("button", { name: THINKING_ICON })[0]);
    await waitFor(() => expect(screen.queryByText("Ada thinks one")).toBeNull());

    fireEvent.click(pillName("Bea"));
    expect(await screen.findByText("Bea thinks")).toBeInTheDocument();
    expect(await storedShowThinking("bea")).toBeUndefined();
    expect(await storedShowThinking("ada")).toBe(false);
  });

  it("applies a change made in the persona editor to the open chat without a reload", async () => {
    await openChat("Ada");
    await screen.findByText("Ada thinks one");

    const { checkbox } = await openEditor("Ada");
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    await closeEditor();

    await waitFor(() => expect(screen.queryByText("Ada thinks one")).toBeNull());
    expect(screen.queryByText("Ada thinks two")).toBeNull();
    expect(await storedShowThinking("ada")).toBe(false);
    expect(screen.getAllByRole("button", { name: THINKING_ICON })).toHaveLength(2);

    await settle();
    const reopened = await openEditor("Ada");
    expect(reopened.checkbox.checked).toBe(false);
  });

  it("renders thinking above the reply, with the reply still visible beneath it", async () => {
    await openChat("Bea");
    const thinking = await screen.findByText("Bea thinks");
    const reply = screen.getByText("Bea reply");

    expect(thinking.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(thinking.closest("[role='dialog']")).toBeNull();
    expect(reply).toBeVisible();
  });

  it("flips the setting once per click when clicks arrive before the first update finishes", async () => {
    await openChat("Ada");
    await screen.findByText("Ada thinks one");
    const icon = screen.getAllByRole("button", { name: THINKING_ICON })[0];

    fireEvent.click(icon);
    fireEvent.click(icon);
    await settle();

    expect(await storedShowThinking("ada")).toBe(true);
    expect(await screen.findByText("Ada thinks one")).toBeInTheDocument();
    expect(screen.getByText("Ada thinks two")).toBeInTheDocument();
    const editor = await openEditor("Ada");
    expect(editor.checkbox.checked).toBe(true);
    await closeEditor();

    fireEvent.click(icon);
    fireEvent.click(icon);
    fireEvent.click(icon);
    await settle();

    expect(await storedShowThinking("ada")).toBe(false);
    await waitFor(() => expect(screen.queryByText("Ada thinks one")).toBeNull());
    expect(screen.queryByText("Ada thinks two")).toBeNull();
  });

  it("applies the restored setting to the active persona's refreshed messages after a state import", async () => {
    await openChat("Ada");
    await screen.findByText("Ada thinks one");

    // The backup's persona record is already in the in-memory store; skip the real StateManager restore.
    vi.spyOn(StateManager.prototype, "restoreFromState").mockImplementation(() => {});
    store.set("ada", { ...store.get("ada")!, show_thinking: false });
    await act(async () => {
      await startedProcessor!.importState(JSON.stringify(storedState));
    });
    await settle();

    await waitFor(() => expect(screen.queryByText("Ada thinks one")).toBeNull());
    expect(screen.queryByText("Ada thinks two")).toBeNull();
    expect(screen.getByText("Ada reply one")).toBeInTheDocument();
    const editor = await openEditor("Ada");
    expect(editor.checkbox.checked).toBe(false);
  });

  // Switch from Ada to Bea while Bea's persona record is still loading: her messages arrive first,
  // so what the chat shows in that window must already follow Bea's own preference, not Ada's.
  async function switchToBeaWhileRecordLoads(): Promise<() => void> {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(Processor.prototype.getPersona).mockImplementation(async (id: string) => {
      if (id === "bea") await gate;
      const record = store.get(id);
      return record ? structuredClone(record) : null;
    });
    fireEvent.click(pillName("Bea"));
    await screen.findByText("Bea reply");
    return release;
  }

  it("never shows a persona's hidden thinking while its record is still loading after a persona switch", async () => {
    store.set("bea", { ...store.get("bea")!, show_thinking: false });
    await openChat("Ada");
    await screen.findByText("Ada thinks one");

    let beaThinkingEverShown = false;
    const observer = new MutationObserver(() => {
      if (document.body.textContent?.includes("Bea thinks")) beaThinkingEverShown = true;
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });

    const release = await switchToBeaWhileRecordLoads();
    expect(screen.queryByText("Bea thinks")).toBeNull();
    expect(screen.getAllByRole("button", { name: THINKING_ICON })).toHaveLength(1);

    release();
    await settle();
    observer.disconnect();

    expect(screen.queryByText("Bea thinks")).toBeNull();
    expect(screen.getByText("Bea reply")).toBeInTheDocument();
    expect(beaThinkingEverShown).toBe(false);
  });

  it("does not carry the previous persona's hidden setting onto a persona that omits it", async () => {
    store.set("ada", { ...store.get("ada")!, show_thinking: false });
    await openChat("Ada");
    await screen.findByText("Ada reply one");
    expect(screen.queryByText("Ada thinks one")).toBeNull();

    const release = await switchToBeaWhileRecordLoads();
    expect(screen.queryByText("Bea thinks")).toBeNull();

    release();
    expect(await screen.findByText("Bea thinks")).toBeInTheDocument();
  });

  it("ignores a late response for a persona that is no longer selected", async () => {
    await openChat("Bea");
    await screen.findByText("Bea thinks");

    // Ada's record and history are slow; the user moves on to Bea again before they arrive.
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.mocked(Processor.prototype.getPersona).mockImplementation(async (id: string) => {
      if (id === "ada") await gate;
      const record = store.get(id);
      return record ? structuredClone(record) : null;
    });
    vi.mocked(Processor.prototype.getMessages).mockImplementation(async (id: string) => {
      if (id === "ada") await gate;
      return messagesByPersona.get(id) ?? [];
    });
    fireEvent.click(pillName("Ada"));
    await screen.findByText("Chat with Ada");
    fireEvent.click(pillName("Bea"));
    await screen.findByText("Chat with Bea");
    expect(await screen.findByText("Bea thinks")).toBeInTheDocument();

    release();
    await settle();

    expect(screen.getByText("Bea thinks")).toBeInTheDocument();
    expect(screen.getByText("Bea reply")).toBeInTheDocument();
    expect(screen.queryByText("Ada reply one")).toBeNull();
  });
});

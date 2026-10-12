// Shared harness for the 1:1 tool-call / thinking display tests.
//
// Importing this module installs process-wide mock.module() replacements for
// the ei / keyboard contexts BEFORE the components under test
// are imported, so test files must import it before anything else that pulls
// in a component. The replacements delegate to the real modules whenever no
// stub is active (see useStub / releaseStub), so call releaseStub() in
// afterEach and no other test file in the same `bun test` run is affected.
// It mounts the REAL MessageList, PromptInput and OverlayProvider, with an
// outlet that copies the overlay outlet in tui/src/app.tsx, against a
// stateful ei stub.
import { mock } from "bun:test";
import { createSignal, Show } from "solid-js";
import type { JSX } from "solid-js";
import { testRender } from "@opentui/solid";
import type { MockInput, TestRenderer } from "@opentui/core/testing";
import type { EiContextValue } from "../../src/context/ei";
import type { Message, PersonaEntity, PersonaSummary, ToolCallRecord } from "../../../src/core/types";
import { ContextStatus } from "../../../src/core/types";

// ---------------------------------------------------------------------------
// Keyboard stub (module mock) — records every setOverlayActive call.
// ---------------------------------------------------------------------------

export const overlayActiveCalls: boolean[] = [];

const noop = () => {};

// ---------------------------------------------------------------------------
// Stateful ei stub (module mock)
// ---------------------------------------------------------------------------

export interface PendingLookup {
  personaId: string;
  /** Resolve with the stored record as it is right now, or with an override. */
  resolve: (record?: PersonaEntity | null) => void;
}

export interface EiStubInit {
  personas: PersonaEntity[];
  activePersonaId: string | null;
  messages?: Message[];
  humanName?: string;
  activeRoomId?: string | null;
  /** When true, getPersona returns promises that only settle via pendingLookups. */
  deferLookups?: boolean;
}

export interface EiStub {
  value: EiContextValue;
  /** Stored full persona records, keyed by id. */
  records: Map<string, PersonaEntity>;
  /** Every getPersona(id) call, in order. */
  getPersonaCalls: string[];
  /** Every updatePersona(id, updates) call, in order. */
  updatePersonaCalls: Array<{ personaId: string; updates: Partial<PersonaEntity> }>;
  notifications: Array<{ message: string; level: string }>;
  /** Lookups waiting for resolve(), in call order (only filled while deferLookups is true). */
  pendingLookups: PendingLookup[];
  deferLookups: boolean;
  setMessages: (messages: Message[]) => void;
  setActivePersonaId: (personaId: string | null) => void;
  setActiveRoomId: (roomId: string | null) => void;
}

function summarize(record: PersonaEntity): PersonaSummary {
  return {
    id: record.id,
    display_name: record.display_name,
    aliases: record.aliases ?? [],
    is_paused: record.is_paused,
    is_archived: record.is_archived,
    unread_count: 0,
  };
}

export function createEiStub(init: EiStubInit): EiStub {
  const records = new Map<string, PersonaEntity>(init.personas.map(p => [p.id, { ...p }]));
  const [messages, setMessages] = createSignal<Message[]>(init.messages ?? []);
  const [activePersonaId, setActivePersonaId] = createSignal<string | null>(init.activePersonaId);
  const [activeRoomId, setActiveRoomId] = createSignal<string | null>(init.activeRoomId ?? null);
  const [personas, setPersonas] = createSignal<PersonaSummary[]>([...records.values()].map(summarize));

  const stub: EiStub = {
    value: undefined as unknown as EiContextValue,
    records,
    getPersonaCalls: [],
    updatePersonaCalls: [],
    notifications: [],
    pendingLookups: [],
    deferLookups: init.deferLookups ?? false,
    setMessages: next => setMessages(next),
    setActivePersonaId: next => setActivePersonaId(next),
    setActiveRoomId: next => setActiveRoomId(next),
  };

  const humanName = init.humanName ?? "Tester";

  const value = {
    messages,
    activePersonaId,
    activeRoomId,
    personas,
    activeContextBoundary: () => null,
    quotesVersion: () => 0,
    getQuotes: async () => [],
    getHuman: async () => ({
      entity: "human",
      facts: [],
      topics: [],
      people: [],
      quotes: [],
      last_updated: "2024-01-01T00:00:00.000Z",
      settings: { name_display: humanName },
    }),
    getPersona: (personaId: string): Promise<PersonaEntity | null> => {
      stub.getPersonaCalls.push(personaId);
      if (!stub.deferLookups) {
        const record = records.get(personaId);
        return Promise.resolve(record ? { ...record } : null);
      }
      return new Promise<PersonaEntity | null>(resolve => {
        stub.pendingLookups.push({
          personaId,
          resolve: override => {
            if (override !== undefined) {
              resolve(override);
              return;
            }
            const record = records.get(personaId);
            resolve(record ? { ...record } : null);
          },
        });
      });
    },
    // Mirrors the real updatePersona: merge into the stored record, then emit
    // a NEW personas() array (refreshPersonas()).
    updatePersona: async (personaId: string, updates: Partial<PersonaEntity>) => {
      stub.updatePersonaCalls.push({ personaId, updates });
      const record = records.get(personaId);
      if (!record) return;
      records.set(personaId, { ...record, ...updates });
      setPersonas([...records.values()].map(summarize));
    },
    showNotification: (message: string, level: string) => {
      stub.notifications.push({ message, level });
    },
    sendMessage: async () => {},
    stopProcessor: async () => {},
    getRoom: () => undefined,
    roomMessages: () => [],
    roomActivePath: () => [],
    sendFfaMessage: async () => {},
    submitHumanRoomMessage: () => null,
    recallHumanRoomMessage: () => null,
    activateRoom: async () => {},
    selectCYPBranch: async () => {},
    humanRoomMessagePending: () => false,
  };

  stub.value = value as unknown as EiContextValue;
  return stub;
}

let activeStub: EiStub | null = null;

/** Make useEi() / useKeyboardNav() return this stub. Call before mounting. */
export function useStub(stub: EiStub): void {
  activeStub = stub;
}

/** Call from afterEach: the mocked modules then behave exactly like the real ones. */
export function releaseStub(): void {
  activeStub = null;
}

// Keyboard stub: records every setOverlayActive call.
const keyboardStub = {
  focusedPanel: () => "input",
  setFocusedPanel: noop,
  registerMessageScroll: noop,
  registerTextarea: noop,
  registerEditorHandler: noop,
  sidebarVisible: () => true,
  toggleSidebar: noop,
  exitApp: async () => {},
  renderer: null,
  resetHistoryIndex: noop,
  overlayActive: () => false,
  setOverlayActive: (active: boolean) => {
    overlayActiveCalls.push(active);
  },
};

// Dynamic imports (here and below): a static import is not ordered against
// mock.module(), and the real modules must be captured before they are mocked.
// Copy their exports BY VALUE: mock.module() patches already-loaded modules in
// place, so reading `realEi.useEi` later would call the wrapper itself.
const realEiExports = { ...(await import("../../src/context/ei")) };
const realKeyboardExports = { ...(await import("../../src/context/keyboard")) };

mock.module("../../src/context/ei", () => ({
  ...realEiExports,
  useEi: () => (activeStub ? activeStub.value : realEiExports.useEi()),
}));

mock.module("../../src/context/keyboard", () => ({
  ...realKeyboardExports,
  useKeyboardNav: () => (activeStub ? keyboardStub : realKeyboardExports.useKeyboardNav()),
}));

// Dynamic imports: a static import would be hoisted above the mock.module()
// calls and bind the real ei / keyboard modules into these components.
const { MessageList } = await import("../../src/components/MessageList");
const { PromptInput } = await import("../../src/components/PromptInput");
const { OverlayProvider, useOverlay } = await import("../../src/context/overlay");
const { getAllCommands } = await import("../../src/commands/registry");

export { getAllCommands };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let idCounter = 0;

export function makePersona(id: string, overrides: Partial<PersonaEntity> = {}): PersonaEntity {
  return {
    id,
    display_name: `Persona ${id}`,
    entity: "system",
    traits: [],
    topics: [],
    is_paused: false,
    is_archived: false,
    is_static: false,
    last_updated: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

export function makeMessage(role: "human" | "system", overrides: Partial<Message> = {}): Message {
  idCounter += 1;
  return {
    id: `msg-${idCounter}`,
    role,
    content: `${role} message ${idCounter}`,
    timestamp: `2024-01-01T12:${String(idCounter % 60).padStart(2, "0")}:00.000Z`,
    read: true,
    context_status: ContextStatus.Default,
    ...overrides,
  };
}

export function makeToolCall(overrides: Partial<ToolCallRecord> = {}): ToolCallRecord {
  return {
    name: "find_memory",
    arguments: { query: "anything" },
    result: "ok",
    error: false,
    kind: "read",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Mounting
// ---------------------------------------------------------------------------

// Equivalent of the overlay outlet in tui/src/app.tsx (AppContent is not exported).
export function OverlayOutlet(): JSX.Element {
  const { overlayRenderer } = useOverlay();
  return <Show when={overlayRenderer()}>{overlayRenderer()!()}</Show>;
}

export interface Mounted {
  renderer: TestRenderer;
  mockInput: MockInput;
  renderOnce: () => Promise<void>;
  captureCharFrame: () => string;
  resize: (width: number, height: number) => void;
}

export interface MountOptions {
  width?: number;
  height?: number;
  /** Mount only the message list (no prompt, no outlet). */
  messageListOnly?: boolean;
}

export async function mountConversation(stub: EiStub, options: MountOptions = {}): Promise<Mounted> {
  useStub(stub);
  overlayActiveCalls.length = 0;
  const renderConfig = { width: options.width ?? 100, height: options.height ?? 40 };

  if (options.messageListOnly) {
    return testRender(() => <MessageList />, renderConfig);
  }

  return testRender(
    () => (
      <OverlayProvider>
        <box flexDirection="column" width="100%" height="100%">
          <box flexGrow={1}>
            <MessageList />
          </box>
          <PromptInput />
          <OverlayOutlet />
        </box>
      </OverlayProvider>
    ),
    renderConfig,
  );
}

// ---------------------------------------------------------------------------
// Timing helpers
// ---------------------------------------------------------------------------

/**
 * A real-clock wait. NEVER call this under jest.useFakeTimers(): it would
 * never resolve. Used for overlay open/close (the escape-disambiguation wait
 * and the async command bodies) under real timers.
 */
export function realWait(ms = 50): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/**
 * Call renderOnce() until two consecutive frames are identical, bounded at
 * `bound` renders. Throws if the frame never settles.
 */
export async function settle(mounted: Mounted, bound = 20): Promise<string> {
  let previous: string | undefined;
  for (let i = 0; i < bound; i++) {
    await mounted.renderOnce();
    const frame = mounted.captureCharFrame();
    if (frame === previous) return frame;
    previous = frame;
  }
  throw new Error(`frame did not settle within ${bound} renders`);
}

/** Type a slash command and press Enter. No waiting: safe under fake timers. */
export async function dispatchCommand(mounted: Mounted, text: string): Promise<void> {
  await mounted.mockInput.typeText(text);
  mounted.mockInput.pressEnter();
}

/** Dispatch a command under real timers, wait for it to finish, and re-render. */
export async function runCommand(mounted: Mounted, text: string): Promise<string> {
  await dispatchCommand(mounted, text);
  await realWait();
  await mounted.renderOnce();
  await mounted.renderOnce();
  return mounted.captureCharFrame();
}

/** Press Escape, wait out the escape-disambiguation delay, and re-render. */
export async function pressEscapeAndWait(mounted: Mounted): Promise<string> {
  mounted.mockInput.pressEscape();
  await realWait();
  await mounted.renderOnce();
  await mounted.renderOnce();
  return mounted.captureCharFrame();
}

// ---------------------------------------------------------------------------
// Frame helpers
// ---------------------------------------------------------------------------

/**
 * The text inside the single-line border of an overlay, one entry per frame
 * row that has the border on both sides, with only the border and padding
 * stripped. Rows outside the overlay box yield nothing.
 */
export function overlayContentLines(frame: string): string[] {
  const lines: string[] = [];
  for (const row of frame.split("\n")) {
    const match = row.match(/│(.*)│/);
    if (match) lines.push(match[1].trim());
  }
  return lines;
}

/** Number of frame lines containing `needle`. */
export function countOccurrences(frame: string, needle: string): number {
  return frame.split("\n").filter(line => line.includes(needle)).length;
}

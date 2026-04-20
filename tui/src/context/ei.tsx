import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  Match,
  Switch,
  createSignal,
  createMemo,
  type ParentComponent,
} from "solid-js";
import { createStore } from "solid-js/store";
import { Processor } from "../../../src/core/processor.js";
import { FileStorage } from "../storage/file.js";
import { remoteSync } from "../../../src/storage/remote.js";
import { logger, clearLog, interceptConsole } from "../util/logger.js";
import { E2E_SKIP_LOCAL_DETECT } from "../util/e2e-flags.js";
import { ConflictOverlay } from "../components/ConflictOverlay.js";
import type {
  Ei_Interface,
  PersonaSummary,
  PersonaEntity,
  Message,
  QueueStatus,
  HumanEntity,
  HumanSettings,
  Fact,
  Topic,
  Person,
  Quote,
  ProviderAccount,
  ProviderType,
  StateConflictData,
  StateConflictResolution,
  ContextStatus,
  LLMRequest,
} from "../../../src/core/types.js";
import type { ToolProvider, ToolDefinition } from "../../../src/core/types.js";
import type { RoomSummary, RoomEntity, RoomMessage, RoomCreationInput } from "../../../src/core/types.js";

interface EiStore {
  ready: boolean;
  personas: PersonaSummary[];
  activePersonaId: string | null;
  activeContextBoundary: string | undefined;
  messages: Message[];
  queueStatus: QueueStatus;
  notification: { message: string; level: "error" | "warn" | "info" } | null;
  rooms: RoomSummary[];
  activeRoomId: string | null;
  roomMessages: RoomMessage[];
  roomActivePath: RoomMessage[];
  isRoomProcessing: boolean;
}

export interface EiContextValue {
  personas: () => PersonaSummary[];
  activePersonaId: () => string | null;
  activeContextBoundary: () => string | undefined;
  messages: () => Message[];
  queueStatus: () => QueueStatus;
  notification: () => { message: string; level: "error" | "warn" | "info" } | null;
  selectPersona: (personaId: string) => void;
  sendMessage: (content: string) => Promise<void>;
  refreshPersonas: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  abortCurrentOperation: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  pauseQueue: () => void;
  getQueueActiveItems: () => LLMRequest[];
  getDLQItems: () => LLMRequest[];
  updateQueueItem: (id: string, updates: Partial<LLMRequest>) => Promise<boolean>;
  deleteQueueItems: (ids: string[]) => number;
  stopProcessor: () => Promise<void>;
  saveAndExit: () => Promise<{ success: boolean; error?: string }>;
  showNotification: (message: string, level: "error" | "warn" | "info") => void;
  createPersona: (input: { name: string }) => Promise<string>;
  archivePersona: (personaId: string) => Promise<void>;
  unarchivePersona: (personaId: string) => Promise<void>;
  deletePersona: (personaId: string) => Promise<void>;
  setContextBoundary: (personaId: string, timestamp: string | null) => Promise<void>;
  updatePersona: (personaId: string, updates: Partial<PersonaEntity>) => Promise<void>;
  getPersona: (personaId: string) => Promise<PersonaEntity | null>;
  resolvePersonaName: (nameOrAlias: string) => Promise<string | null>;
  getHuman: () => Promise<HumanEntity>;
  updateHuman: (updates: Partial<HumanEntity>) => Promise<void>;
  updateSettings: (updates: Partial<HumanSettings>) => Promise<void>;
  upsertFact: (fact: Fact) => Promise<void>;
  upsertTopic: (topic: Topic) => Promise<void>;
  upsertPerson: (person: Person) => Promise<void>;
  removeDataItem: (type: "fact" | "topic" | "person", id: string) => Promise<void>;
  syncStatus: () => { configured: boolean; envBased: boolean };
  triggerSync: () => Promise<{ success: boolean; error?: string }>;
  getGroupList: () => Promise<string[]>;
  getQuotes: (filter?: { message_id?: string; speaker?: string }) => Promise<Quote[]>;
  getQuotesForMessage: (messageId: string) => Promise<Quote[]>;
  updateQuote: (id: string, updates: Partial<Quote>) => Promise<void>;
  removeQuote: (id: string) => Promise<void>;
  quotesVersion: () => number;
  searchHumanData: (
    query: string,
    options?: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number }
  ) => Promise<{
    facts: Fact[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
  }>;
  showWelcomeOverlay: () => boolean;
  dismissWelcomeOverlay: () => void;
  deleteMessages: (personaId: string, messageIds: string[]) => Promise<void>;
  setMessageContextStatus: (personaId: string, messageId: string, status: ContextStatus) => Promise<void>;
  deleteRoomMessages: (roomId: string, messageIds: string[]) => Promise<void>;
  setRoomMessageContextStatus: (roomId: string, messageId: string, status: ContextStatus) => Promise<void>;
  recallPendingMessages: () => Promise<string>;
  getToolProviderList: () => ToolProvider[];
  getToolList: () => ToolDefinition[];
  updateToolProvider: (id: string, updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>>) => Promise<boolean>;
  updateTool: (id: string, updates: Partial<Omit<ToolDefinition, 'id' | 'created_at'>>) => Promise<boolean>;
  queueUserDedup: (itemType: "topic" | "person", entityIds: string[]) => void;
  cleanupTimers: () => void;
  rooms: () => RoomSummary[];
  activeRoomId: () => string | null;
  roomMessages: () => RoomMessage[];
  roomActivePath: () => RoomMessage[];
  isRoomProcessing: () => boolean;
  selectRoom: (roomId: string) => void;
  resolveRoomName: (nameOrAlias: string) => string | null;
  getRoom: (roomId: string) => RoomEntity | null;
  createRoom: (input: RoomCreationInput) => Promise<string>;
  updateRoom: (roomId: string, updates: Partial<RoomEntity>) => Promise<void>;
  archiveRoom: (roomId: string) => Promise<void>;
  deleteRoom: (roomId: string) => Promise<void>;
  sendFfaMessage: (content: string | null, silenceReason?: string) => Promise<void>;
  submitHumanRoomMessage: (content: string | null, silenceReason?: string) => string | null;
  recallHumanRoomMessage: () => boolean;
  activateRoom: () => Promise<void>;
  selectCYPBranch: (messageId: string) => Promise<void>;
  markAllRoomMessagesRead: () => Promise<number>;
  captureRoom: () => void;
  capturePersona: () => void;
  captureTargetedPerson: (personId: string) => number;
  captureTargetedTopic: (topicId: string) => number;
  sendSilenceMessage: (silenceReason?: string) => Promise<void>;
  humanRoomMessagePending: () => boolean;
  getArchivedRooms: () => RoomSummary[];
  generatePersonaPreview: (name: string, description: string, relationship?: string, personaId?: string) => Promise<import('../../../src/prompts/generation/types.js').PersonaGenerationResult>;
}
const EiContext = createContext<EiContextValue>();

export const EiProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<EiStore>({
    ready: false,
    personas: [],
    activePersonaId: null,
    activeContextBoundary: undefined,
    messages: [],
    queueStatus: { state: "idle", pending_count: 0, dlq_count: 0 },
    notification: null,
    rooms: [],
    activeRoomId: null,
    roomMessages: [],
    roomActivePath: [],
    isRoomProcessing: false,
  });

  const [contextBoundarySignal, setContextBoundarySignal] = createSignal<string | undefined>(undefined);
  const [quotesVersion, setQuotesVersion] = createSignal(0);
  const [showWelcomeOverlay, setShowWelcomeOverlay] = createSignal(false);
  const [conflictData, setConflictData] = createSignal<StateConflictData | null>(null);

  let processor: Processor | null = null;
  let notificationTimer: Timer | null = null;
  let readTimer: Timer | null = null;
  let dwelledPersona: string | null = null;
  let syncConfiguredFromEnv = false;

  const showNotification = (message: string, level: "error" | "warn" | "info") => {
    if (notificationTimer) clearTimeout(notificationTimer);
    setStore("notification", { message, level });
    notificationTimer = setTimeout(() => {
      setStore("notification", null);
      notificationTimer = null;
    }, 5000);
  };

  const queueUserDedup = (itemType: "topic" | "person", entityIds: string[]): void => {
    if (!processor) return;
    processor.queueUserDedup(itemType, entityIds);
  };

  const cleanupTimers = () => {
    if (notificationTimer) {
      clearTimeout(notificationTimer);
      notificationTimer = null;
    }
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
  };

  const refreshPersonas = async () => {
    if (!processor) return;
    const list = await processor.getPersonaList();
    setStore("personas", list);
  };

  const refreshMessages = async () => {
    if (!processor) return;
    const currentId = store.activePersonaId;
    if (!currentId) return;
    const msgs = await processor.getMessages(currentId);
    setStore("messages", [...msgs]);
  };

  const selectPersona = (personaId: string) => {
    setStore("activeRoomId", null);
    // Mark previous persona as read ONLY if we dwelled there 5+ seconds
    const previousId = store.activePersonaId;
    if (previousId && previousId === dwelledPersona && processor) {
      void processor.markAllMessagesRead(previousId);
      void refreshPersonas();
    }
    
    // Cancel any pending timer and reset dwell tracking
    if (readTimer) {
      clearTimeout(readTimer);
      readTimer = null;
    }
    dwelledPersona = null;
    
    // Set new persona
    setStore("activePersonaId", personaId);
    setStore("messages", []);
    const persona = store.personas.find(p => p.id === personaId);
    setStore("activeContextBoundary", persona?.context_boundary);
    setContextBoundarySignal(persona?.context_boundary);
    if (processor) {
      processor.getMessages(personaId).then((msgs) => {
        setStore("messages", [...msgs]);
      });
    }
    
    // Start 5-second dwell timer
    readTimer = setTimeout(async () => {
      if (store.activePersonaId === personaId && processor) {
        dwelledPersona = personaId;  // Mark that we've dwelled
        await processor.markAllMessagesRead(personaId);
        await refreshPersonas();
      }
      readTimer = null;
    }, 5000);
  };

  const sendMessage = async (content: string) => {
    const currentId = store.activePersonaId;
    if (!currentId || !processor) return;
    
    // Mark all read immediately - user is engaged
    await processor.markAllMessagesRead(currentId);
    dwelledPersona = currentId;
    
    await processor.sendMessage(currentId, content);
    await refreshPersonas();
  };

  const abortCurrentOperation = async () => {
    if (!processor) return;
    logger.info("Aborting current LLM operation");
    await processor.abortCurrentOperation();
  };

  const resumeQueue = async () => {
    if (!processor) return;
    logger.info("Resuming queue");
    await processor.resumeQueue();
  };

  const pauseQueue = () => {
    if (!processor) return;
    logger.info("Pausing queue");
    processor.pauseQueue();
  };

  const getQueueActiveItems = (): LLMRequest[] => {
    if (!processor) return [];
    return processor.getQueueActiveItems();
  };

  const getDLQItems = (): LLMRequest[] => {
    if (!processor) return [];
    return processor.getDLQItems();
  };

  const updateQueueItem = async (id: string, updates: Partial<LLMRequest>): Promise<boolean> => {
    if (!processor) return false;
    return processor.updateQueueItem(id, updates);
  };

  const deleteQueueItems = (ids: string[]): number => {
    if (!processor) return 0;
    return processor.deleteQueueItems(ids);
  };

  const stopProcessor = async () => {
    if (processor) {
      await processor.stop();
    }
  };

  const createPersona = async (input: { name: string }): Promise<string> => {
    if (!processor) return "";
    return await processor.createPersona(input);
  };

  const generatePersonaPreview = async (name: string, description: string, relationship?: string, personaId?: string) => {
    if (!processor) throw new Error("Processor not ready");
    return processor.generatePersonaPreview(name, description, relationship, personaId);
  };

  const archivePersona = async (personaId: string) => {
    if (!processor) return;
    await processor.archivePersona(personaId);
    await refreshPersonas();
  };

  const unarchivePersona = async (personaId: string) => {
    if (!processor) return;
    await processor.unarchivePersona(personaId);
    await refreshPersonas();
  };

  const deletePersona = async (personaId: string) => {
    if (!processor) return;
    await processor.deletePersona(personaId, false);
    await refreshPersonas();
  };

  const setContextBoundary = async (personaId: string, timestamp: string | null) => {
    if (!processor) return;
    // Set signal BEFORE processor call - processor fires callback synchronously
    // which triggers refreshMessages() that needs the NEW boundary value
    const newValue = timestamp ?? undefined;
    logger.debug(`setContextBoundary: ${personaId}, timestamp=${timestamp}, newValue=${newValue}`);
    if (personaId === store.activePersonaId) {
      logger.debug(`setContextBoundary: updating signal to ${newValue}`);
      setContextBoundarySignal(newValue);
    }
    await processor.setContextBoundary(personaId, timestamp);
    await refreshPersonas();
    if (personaId === store.activePersonaId) {
      await refreshMessages();
    }
  };

  const updatePersona = async (personaId: string, updates: Partial<PersonaEntity>) => {
    if (!processor) return;
    await processor.updatePersona(personaId, updates);
    await refreshPersonas();
  };

  const getPersona = async (personaId: string) => {
    if (!processor) return null;
    return processor.getPersona(personaId);
  };

  const resolvePersonaName = async (nameOrAlias: string) => {
    if (!processor) return null;
    return processor.resolvePersonaName(nameOrAlias);
  };

  const getHuman = async () => {
    if (!processor) throw new Error("Processor not initialized");
    return processor.getHuman();
  };

  const updateHuman = async (updates: Partial<HumanEntity>) => {
    if (!processor) return;
    await processor.updateHuman(updates);
  };

  const upsertFact = async (fact: Fact) => {
    if (!processor) return;
    await processor.upsertFact(fact);
  };

  const upsertTopic = async (topic: Topic) => {
    if (!processor) return;
    await processor.upsertTopic(topic);
  };

  const upsertPerson = async (person: Person) => {
    if (!processor) return;
    await processor.upsertPerson(person);
  };

  const removeDataItem = async (type: "fact" | "topic" | "person", id: string) => {
    if (!processor) return;
    await processor.removeDataItem(type, id);
  };

  const saveAndExit = async (): Promise<{ success: boolean; error?: string }> => {
    if (!processor) return { success: false, error: "Processor not initialized" };
    return processor.saveAndExit();
  };

  const updateSettings = async (updates: Partial<HumanSettings>): Promise<void> => {
    if (!processor) return;
    const human = await processor.getHuman();
    const newSettings = { ...human.settings, ...updates };
    await processor.updateHuman({ settings: newSettings });
  };

  const syncStatus = (): { configured: boolean; envBased: boolean } => {
    return {
      configured: remoteSync.isConfigured(),
      envBased: syncConfiguredFromEnv,
    };
  };

  const triggerSync = async (): Promise<{ success: boolean; error?: string }> => {
    if (!processor) return { success: false, error: "Processor not initialized" };
    if (!remoteSync.isConfigured()) {
      return { success: false, error: "Sync not configured" };
    }
    const human = await processor.getHuman();
    const hasSyncCreds = !!human.settings?.sync?.username && !!human.settings?.sync?.passphrase;
    if (!hasSyncCreds) {
      return { success: false, error: "No sync credentials in settings" };
    }
    const state = await processor.getStorageState();
    return remoteSync.sync(state);
  };

  const getGroupList = async (): Promise<string[]> => {
    if (!processor) return [];
    return processor.getGroupList();
  };

  const getQuotes = async (filter?: { message_id?: string; speaker?: string }): Promise<Quote[]> => {
    if (!processor) return [];
    const all = await processor.getQuotes(filter?.message_id ? { message_id: filter.message_id } : undefined);
    if (filter?.speaker) {
      return all.filter(q => q.speaker.toLowerCase() === filter.speaker!.toLowerCase());
    }
    return all;
  };

  const getQuotesForMessage = async (messageId: string): Promise<Quote[]> => {
    if (!processor) return [];
    return processor.getQuotesForMessage(messageId);
  };

  const updateQuote = async (id: string, updates: Partial<Quote>): Promise<void> => {
    if (!processor) return;
    await processor.updateQuote(id, updates);
  };

  const removeQuote = async (id: string): Promise<void> => {
    if (!processor) return;
    await processor.removeQuote(id);
  };

  const deleteMessages = async (personaId: string, messageIds: string[]): Promise<void> => {
    if (!processor) return;
    await processor.deleteMessages(personaId, messageIds);
    setStore("messages", store.messages.filter(m => !messageIds.includes(m.id)));
  };

  const setMessageContextStatus = async (personaId: string, messageId: string, status: ContextStatus): Promise<void> => {
    if (!processor) return;
    await processor.setMessageContextStatus(personaId, messageId, status);
    setStore("messages", store.messages.map(m => m.id === messageId ? { ...m, context_status: status } : m));
  };

  const deleteRoomMessages = async (roomId: string, messageIds: string[]): Promise<void> => {
    if (!processor) return;
    processor.getStateManager().removeRoomMessages(roomId, messageIds);
    if (roomId === store.activeRoomId) {
      setStore("roomMessages", msgs => msgs.filter(m => !messageIds.includes(m.id)));
    }
  };

  const setRoomMessageContextStatus = async (roomId: string, messageId: string, status: ContextStatus): Promise<void> => {
    if (!processor) return;
    processor.getStateManager().updateRoomMessage(roomId, messageId, { context_status: status });
    if (roomId === store.activeRoomId) {
      setStore("roomMessages", msgs => msgs.map(m => m.id === messageId ? { ...m, context_status: status } : m));
    }
  };

  const recallPendingMessages = async (): Promise<string> => {
    if (!processor) return "";
    const personaId = store.activePersonaId;
    if (!personaId) return "";
    return processor.recallPendingMessages(personaId);
  };

  const getToolProviderList = (): ToolProvider[] => {
    if (!processor) return [];
    return processor.getToolProviderList();
  };

  const getToolList = (): ToolDefinition[] => {
    if (!processor) return [];
    return processor.getToolList();
  };

  const updateToolProvider = async (id: string, updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>>): Promise<boolean> => {
    if (!processor) return false;
    return processor.updateToolProvider(id, updates);
  };

  const updateTool = async (id: string, updates: Partial<Omit<ToolDefinition, 'id' | 'created_at'>>): Promise<boolean> => {
    if (!processor) return false;
    return processor.updateTool(id, updates);
  };

  const searchHumanData = async (
    query: string,
    options?: { types?: Array<"fact" | "topic" | "person" | "quote">; limit?: number }
  ) => {
    if (!processor) return { facts: [], topics: [], people: [], quotes: [] };
    return processor.searchHumanData(query, options);
  };

  const refreshRooms = async () => {
    if (!processor) return;
    const list = processor.getRoomList();
    setStore("rooms", list);
  };

  const refreshRoomMessages = async () => {
    if (!processor) return;
    const currentRoomId = store.activeRoomId;
    if (!currentRoomId) return;
    const msgs = processor.getRoomMessages(currentRoomId);
    setStore("roomMessages", [...msgs]);
  };

  const refreshRoomActivePath = () => {
    if (!processor) return;
    const roomId = store.activeRoomId;
    if (!roomId) return;
    const path = processor.getRoomActivePath(roomId);
    setStore("roomActivePath", [...path]);
  };

  const selectRoom = (roomId: string) => {
    setStore("activeRoomId", roomId);
    setStore("roomMessages", []);
    setStore("roomActivePath", []);
    setStore("isRoomProcessing", false);
    if (processor) {
      const msgs = processor.getRoomMessages(roomId);
      setStore("roomMessages", [...msgs]);
      refreshRoomActivePath();
      if (readTimer) clearTimeout(readTimer);
      readTimer = setTimeout(async () => {
        if (store.activeRoomId === roomId && processor) {
          await processor.markAllRoomMessagesRead(roomId);
          await refreshRooms();
        }
        readTimer = null;
      }, 5000);
    }
  };

  const sendFfaMessage = async (content: string | null, silenceReason?: string) => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return;
    await processor.sendFfaMessage(roomId, content, silenceReason);
    await refreshRooms();
  };

  const submitHumanRoomMessage = (content: string | null, silenceReason?: string): string | null => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return null;
    const msgId = processor.submitHumanRoomMessage(roomId, content, silenceReason);
    void refreshRoomMessages();
    return msgId;
  };

  const recallHumanRoomMessage = (): boolean => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return false;
    const recalled = processor.recallHumanRoomMessage(roomId);
    void refreshRoomMessages();
    return recalled;
  };

  const activateRoom = async () => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return;
    await processor.activateRoom(roomId);
    await refreshRoomMessages();
    void refreshRoomActivePath();
    void refreshRooms();
  };

  const selectCYPBranch = async (messageId: string) => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return;
    await processor.selectCYPBranch(roomId, messageId);
    await refreshRoomMessages();
    await refreshRoomActivePath();
    void refreshRooms();
  };

  const createRoom = async (input: RoomCreationInput): Promise<string> => {
    if (!processor) return "";
    const roomId = await processor.createRoom(input);
    await refreshRooms();
    selectRoom(roomId);
    return roomId;
  };

  const updateRoom = async (roomId: string, updates: Partial<RoomEntity>) => {
    if (!processor) return;
    await processor.updateRoom(roomId, updates);
    await refreshRooms();
    if (roomId === store.activeRoomId) await refreshRoomMessages();
  };

  const archiveRoom = async (roomId: string) => {
    if (!processor) return;
    await processor.archiveRoom(roomId);
    if (store.activeRoomId === roomId) setStore("activeRoomId", null);
    await refreshRooms();
  };

  const deleteRoom = async (roomId: string) => {
    if (!processor) return;
    await processor.deleteRoom(roomId);
    if (store.activeRoomId === roomId) setStore("activeRoomId", null);
    await refreshRooms();
  };

  const markAllRoomMessagesRead = async (): Promise<number> => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return 0;
    const count = await processor.markAllRoomMessagesRead(roomId);
    await refreshRooms();
    return count;
  };

  const captureRoom = () => {
    const roomId = store.activeRoomId;
    if (!roomId || !processor) return;
    processor.captureRoom(roomId);
  };

  const capturePersona = () => {
    const personaId = store.activePersonaId;
    if (!personaId || !processor) return;
    processor.capturePersona(personaId);
  };

  const captureTargetedPerson = (personId: string): number => {
    if (!processor) return 0;
    const roomId = store.activeRoomId;
    if (roomId) return processor.captureTargetedPerson(personId, '', roomId);
    const personaId = store.activePersonaId;
    if (!personaId) return 0;
    return processor.captureTargetedPerson(personId, personaId);
  };

  const captureTargetedTopic = (topicId: string): number => {
    if (!processor) return 0;
    const roomId = store.activeRoomId;
    if (roomId) return processor.captureTargetedTopic(topicId, '', roomId);
    const personaId = store.activePersonaId;
    if (!personaId) return 0;
    return processor.captureTargetedTopic(topicId, personaId);
  };

  const resolveRoomName = (nameOrAlias: string): string | null => {
    if (!processor) return null;
    return processor.resolveRoomName(nameOrAlias);
  };

  const getArchivedRooms = (): RoomSummary[] => {
    if (!processor) return [];
    return processor.getRoomList(true).filter(r => r.is_archived);
  };

  const getRoom = (roomId: string): RoomEntity | null => {
    if (!processor) return null;
    return processor.getRoom(roomId);
  };

  const humanRoomMessagePending = createMemo(() => {
    const roomId = store.activeRoomId;
    if (!roomId) return false;
    const roomSummary = store.rooms.find(r => r.id === roomId);
    if (!roomSummary?.active_node_id) return false;
    return store.roomMessages.some(m => m.parent_id === roomSummary.active_node_id && m.role === "human");
  });

  const sendSilenceMessage = async (silenceReason?: string) => {
    const currentId = store.activePersonaId;
    if (!currentId || !processor) return;
    await processor.sendMessage(currentId, null, silenceReason);
    await refreshPersonas();
  };

  async function finishBootstrap() {
    if (!processor) return;

    // If env vars provided sync creds, ensure they're written to settings
    // (needed for first-ever-use where bootstrapFirstRun was called)
    const syncUsername = Bun.env.EI_SYNC_USERNAME;
    const syncPassphrase = Bun.env.EI_SYNC_PASSPHRASE;
    if (syncUsername && syncPassphrase) {
      const human = await processor.getHuman();
      if (!human.settings?.sync?.username || !human.settings?.sync?.passphrase) {
        await processor.updateHuman({
          settings: { ...human.settings, sync: { username: syncUsername, passphrase: syncPassphrase } }
        });
        logger.debug("Sync credentials written to settings");
      }
    }
    await refreshPersonas();
    await refreshRooms();
    logger.debug(`refreshPersonas done, count: ${store.personas.length}`);
    const status = await processor.getQueueStatus();
    logger.debug("Initial getQueueStatus:", status);
    setStore("queueStatus", status);
    logger.debug("Initial queueStatus set in store:", store.queueStatus);
    const list = store.personas;
    if (list.length > 0 && !store.activePersonaId && list[0].id) {
      selectPersona(list[0].id);
    }
    // LLM detection: run async after processor starts, don't block ready state
    void (async () => {
      try {
        const human = await processor!.getHuman();
        const hasAccounts = human.settings?.accounts && human.settings.accounts.length > 0;
        if (!hasAccounts && E2E_SKIP_LOCAL_DETECT) {
          logger.info("E2E_SKIP_LOCAL_DETECT active, skipping local LLM check");
          setShowWelcomeOverlay(true);
        } else if (!hasAccounts) {
          logger.info("No LLM accounts configured, checking for local LLMs...");

          const candidates = [
            { name: "LMStudio", url: "http://127.0.0.1:1234/v1" },
            { name: "Ollama", url: "http://127.0.0.1:11434/v1" },
          ];

          const detected = await Promise.all(
            candidates.map(async (candidate) => {
              try {
                const response = await fetch(`${candidate.url}/models`, {
                  method: "GET",
                  signal: AbortSignal.timeout(3000),
                });
                return response.ok ? candidate : null;
              } catch {
                return null;
              }
            })
          );

          const found = detected.filter(Boolean) as typeof candidates;

          if (found.length > 0) {
            const accounts: ProviderAccount[] = found.map((candidate) => {
              const defaultModelId = crypto.randomUUID();
              return {
                id: crypto.randomUUID(),
                name: candidate.name,
                type: "llm" as ProviderType,
                url: candidate.url,
                enabled: true,
                created_at: new Date().toISOString(),
                default_model: defaultModelId,
                models: [{ id: defaultModelId, name: "default" }],
              };
            });
            const firstDefaultModelId = accounts[0].default_model!;
            const currentHuman = await processor!.getHuman();
            await processor!.updateHuman({
              settings: {
                ...currentHuman.settings,
                accounts,
                default_model: firstDefaultModelId,
              },
            });
            const names = found.map((c) => c.name).join(" and ");
            showNotification(`${names} detected and configured!`, "info");
            logger.info(`Auto-configured: ${names}`);
          } else {
            logger.info("No local LLMs found, showing welcome overlay");
            setShowWelcomeOverlay(true);
          }
        }
      } catch (err: any) {
        logger.warn(`LLM detection failed: ${err?.message || err}`);
      }
    })();
    setStore("ready", true);
  }

  const resolveStateConflict = async (resolution: StateConflictResolution): Promise<void> => {
    if (!processor) return;
    logger.info(`Resolving state conflict: ${resolution}`);
    await processor.resolveStateConflict(resolution);
    setConflictData(null);
    await finishBootstrap();
  };
  async function bootstrap() {
    clearLog();
    interceptConsole();
    logger.info("Ei TUI bootstrap starting");
    try {
      const storage = new FileStorage(Bun.env.EI_DATA_PATH);
      // Pre-configure remoteSync from env vars BEFORE processor.start()
      // so the processor's sync decision tree can detect remote state
      const syncUsername = Bun.env.EI_SYNC_USERNAME;
      const syncPassphrase = Bun.env.EI_SYNC_PASSPHRASE;
      if (syncUsername && syncPassphrase) {
        logger.info("Sync credentials found in env, pre-configuring remoteSync");
        await remoteSync.configure({ username: syncUsername, passphrase: syncPassphrase });
        syncConfiguredFromEnv = true;
      }
      const eiInterface: Ei_Interface = {
        onPersonaAdded: () => void refreshPersonas(),
        onPersonaRemoved: () => void refreshPersonas(),
        onPersonaUpdated: () => void refreshPersonas(),
        onMessageAdded: (personaId) => {
          void refreshPersonas();
          if (personaId === store.activePersonaId) {
            void refreshMessages();
          }
        },
        onQueueStateChanged: (state) => {
          logger.debug(`onQueueStateChanged called with state: ${state}`);
          if (processor) {
            processor.getQueueStatus().then((status) => {
              setStore("queueStatus", { state: status.state, pending_count: status.pending_count, dlq_count: status.dlq_count });
              logger.debug(`store.queueStatus after setStore:`, store.queueStatus);
            });
          } else {
            setStore("queueStatus", { state, pending_count: 0, dlq_count: 0 });
          }
        },
        onContextBoundaryChanged: (personaId) => {
          logger.debug(`onContextBoundaryChanged: ${personaId}`);
          void refreshPersonas();
        },
        onQuoteAdded: () => setQuotesVersion(v => v + 1),
        onQuoteUpdated: () => setQuotesVersion(v => v + 1),
        onQuoteRemoved: () => setQuotesVersion(v => v + 1),
        onError: (error) => {
          logger.error(`${error.code}: ${error.message}`);
          showNotification(`${error.code}: ${error.message}`, "error");
        },
        onStateConflict: (data) => {
          logger.info("State conflict detected, waiting for user resolution");
          setConflictData(data);
        },
        onRoomAdded: () => void refreshRooms(),
        onRoomRemoved: () => void refreshRooms(),
        onRoomUpdated: (roomId) => {
          void refreshRooms();
          if (roomId === store.activeRoomId) {
            void refreshRoomMessages();
            refreshRoomActivePath();
          }
        },
        onRoomMessageAdded: (roomId) => {
          void refreshRooms();
          if (roomId === store.activeRoomId) {
            void refreshRoomMessages();
            refreshRoomActivePath();
            setStore("isRoomProcessing", false);
          }
        },
        onRoomMessageQueued: () => {
          void refreshRooms();
        },
        onRoomMessageProcessing: (roomId) => {
          if (roomId === store.activeRoomId) setStore("isRoomProcessing", true);
        },
      };
      processor = new Processor(eiInterface);
      logger.debug("Processor created, calling start()");
      await processor.start(storage);
      logger.debug("Processor started");
      // If start() detected a conflict, it returned without starting the loop.
      // Don't set ready — wait for resolveStateConflict() to be called.
      if (conflictData()) {
        logger.info("Conflict pending, waiting for user resolution before finishing bootstrap");
        return;
      }

      await finishBootstrap();
    } catch (err: any) {
      logger.error(`bootstrap() failed: ${err?.message || err}`);
    }
  }

  onMount(() => {
    void bootstrap();
  });

  onCleanup(() => {
    if (readTimer) clearTimeout(readTimer);
    processor?.stop();
  });

  const value: EiContextValue = {
    personas: () => store.personas,
    activePersonaId: () => store.activePersonaId,
    activeContextBoundary: contextBoundarySignal,
    messages: () => store.messages,
    queueStatus: () => store.queueStatus,
    notification: () => store.notification,
    selectPersona,
    sendMessage,
    refreshPersonas,
    refreshMessages,
    abortCurrentOperation,
    resumeQueue,
    pauseQueue,
    getQueueActiveItems,
    getDLQItems,
    updateQueueItem,
    deleteQueueItems,
    stopProcessor,
    saveAndExit,
    showNotification,
    createPersona,
    archivePersona,
    unarchivePersona,
    deletePersona,
    setContextBoundary,
    updatePersona,
    getPersona,
    resolvePersonaName,
    getHuman,
    updateHuman,
    updateSettings,
    upsertFact,
    upsertTopic,
    upsertPerson,
    removeDataItem,
    syncStatus,
    triggerSync,
    getGroupList,
    getQuotes,
    getQuotesForMessage,
    updateQuote,
    removeQuote,
    quotesVersion,
    searchHumanData,
    showWelcomeOverlay,
    dismissWelcomeOverlay: () => setShowWelcomeOverlay(false),
    deleteMessages,
    setMessageContextStatus,
    deleteRoomMessages,
    setRoomMessageContextStatus,
    recallPendingMessages,
    getToolProviderList,
    getToolList,
    updateToolProvider,
    updateTool,
    queueUserDedup,
    cleanupTimers,
    rooms: () => store.rooms,
    activeRoomId: () => store.activeRoomId,
    roomMessages: () => store.roomMessages,
    roomActivePath: () => store.roomActivePath,
    isRoomProcessing: () => store.isRoomProcessing,
    selectRoom,
    resolveRoomName,
    getRoom,
    createRoom,
    updateRoom,
    archiveRoom,
    deleteRoom,
    sendFfaMessage,
    submitHumanRoomMessage,
    recallHumanRoomMessage,
    activateRoom,
    selectCYPBranch,
    markAllRoomMessagesRead,
    captureRoom,
    capturePersona,
    captureTargetedPerson,
    captureTargetedTopic,
    sendSilenceMessage,
    humanRoomMessagePending,
    getArchivedRooms,
    generatePersonaPreview,
  };
  return (
    <Switch>
      <Match when={conflictData()}>
        <ConflictOverlay
          localTimestamp={conflictData()!.localTimestamp}
          remoteTimestamp={conflictData()!.remoteTimestamp}
          onResolve={(resolution) => void resolveStateConflict(resolution)}
        />
      </Match>
      <Match when={store.ready}>
        <EiContext.Provider value={value}>{props.children}</EiContext.Provider>
      </Match>
      <Match when={!store.ready}>
        <box width="100%" height="100%" justifyContent="center" alignItems="center">
          <text>Loading Ei...</text>
        </box>
      </Match>
    </Switch>
  );
};

export const useEi = () => {
  const ctx = useContext(EiContext);
  if (!ctx) {
    throw new Error("useEi must be used within EiProvider");
  }
  return ctx;
};

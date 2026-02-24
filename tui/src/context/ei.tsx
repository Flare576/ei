import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  Match,
  Switch,
  createSignal,
  type ParentComponent,
} from "solid-js";
import { createStore } from "solid-js/store";
import { Processor } from "../../../src/core/processor.js";
import { FileStorage } from "../storage/file.js";
import { remoteSync } from "../../../src/storage/remote.js";
import { logger, clearLog, interceptConsole } from "../util/logger.js";
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
  Trait,
  Topic,
  Person,
  Quote,
  ProviderAccount,
  ProviderType,
  StateConflictData,
  StateConflictResolution,
  ContextStatus,
} from "../../../src/core/types.js";

interface EiStore {
  ready: boolean;
  personas: PersonaSummary[];
  activePersonaId: string | null;
  activeContextBoundary: string | undefined;
  messages: Message[];
  queueStatus: QueueStatus;
  notification: { message: string; level: "error" | "warn" | "info" } | null;
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
  upsertTrait: (trait: Trait) => Promise<void>;
  upsertTopic: (topic: Topic) => Promise<void>;
  upsertPerson: (person: Person) => Promise<void>;
  removeDataItem: (type: "fact" | "trait" | "topic" | "person", id: string) => Promise<void>;
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
    options?: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number }
  ) => Promise<{
    facts: Fact[];
    traits: Trait[];
    topics: Topic[];
    people: Person[];
    quotes: Quote[];
  }>;
  showWelcomeOverlay: () => boolean;
  dismissWelcomeOverlay: () => void;
  deleteMessages: (personaId: string, messageIds: string[]) => Promise<void>;
  setMessageContextStatus: (personaId: string, messageId: string, status: ContextStatus) => Promise<void>;
  recallPendingMessages: () => Promise<string>;
}

const EiContext = createContext<EiContextValue>();

export const EiProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<EiStore>({
    ready: false,
    personas: [],
    activePersonaId: null,
    activeContextBoundary: undefined,
    messages: [],
    queueStatus: { state: "idle", pending_count: 0 },
    notification: null,
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

  const stopProcessor = async () => {
    if (processor) {
      await processor.stop();
    }
  };

  const createPersona = async (input: { name: string }): Promise<string> => {
    if (!processor) return "";
    return await processor.createPersona(input);
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

  const upsertTrait = async (trait: Trait) => {
    if (!processor) return;
    await processor.upsertTrait(trait);
  };

  const upsertTopic = async (topic: Topic) => {
    if (!processor) return;
    await processor.upsertTopic(topic);
  };

  const upsertPerson = async (person: Person) => {
    if (!processor) return;
    await processor.upsertPerson(person);
  };

  const removeDataItem = async (type: "fact" | "trait" | "topic" | "person", id: string) => {
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
  };

  const setMessageContextStatus = async (personaId: string, messageId: string, status: ContextStatus): Promise<void> => {
    if (!processor) return;
    await processor.setMessageContextStatus(personaId, messageId, status);
  };

  const recallPendingMessages = async (): Promise<string> => {
    if (!processor) return "";
    const personaId = store.activePersonaId;
    if (!personaId) return "";
    return processor.recallPendingMessages(personaId);
  };


  const searchHumanData = async (
    query: string,
    options?: { types?: Array<"fact" | "trait" | "topic" | "person" | "quote">; limit?: number }
  ) => {
    if (!processor) return { facts: [], traits: [], topics: [], people: [], quotes: [] };
    return processor.searchHumanData(query, options);
  };

  // Post-start initialization: refresh UI state, select first persona, detect LLM
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
        if (!hasAccounts) {
          logger.info("No LLM accounts configured, checking for local LLM...");
          try {
            const response = await fetch("http://127.0.0.1:1234/v1/models", {
              method: "GET",
              signal: AbortSignal.timeout(3000),
            });
            if (response.ok) {
              logger.info("Local LLM detected, auto-configuring...");
              const localAccount: ProviderAccount = {
                id: crypto.randomUUID(),
                name: "Local LLM",
                type: "llm" as ProviderType,
                url: "http://127.0.0.1:1234/v1",
                enabled: true,
                created_at: new Date().toISOString(),
              };
              const currentHuman = await processor!.getHuman();
              await processor!.updateHuman({
                settings: {
                  ...currentHuman.settings,
                  accounts: [localAccount],
                  default_model: "Local LLM",
                },
              });
              showNotification("Local LLM detected and configured!", "info");
              logger.info("Local LLM auto-configured successfully");
            } else {
              logger.info("Local LLM check failed, showing welcome overlay");
              setShowWelcomeOverlay(true);
            }
          } catch {
            logger.info("No local LLM found, showing welcome overlay");
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
              setStore("queueStatus", { state: status.state, pending_count: status.pending_count });
              logger.debug(`store.queueStatus after setStore:`, store.queueStatus);
            });
          } else {
            setStore("queueStatus", { state, pending_count: 0 });
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
    upsertTrait,
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
    recallPendingMessages,
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

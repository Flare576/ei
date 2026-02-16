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
import { logger, clearLog, interceptConsole } from "../util/logger.js";
import type {
  Ei_Interface,
  PersonaSummary,
  PersonaEntity,
  Message,
  QueueStatus,
  HumanEntity,
  Fact,
  Trait,
  Topic,
  Person,
} from "../../../src/core/types.js";

interface EiStore {
  ready: boolean;
  personas: PersonaSummary[];
  activePersona: string | null;
  activeContextBoundary: string | undefined;
  messages: Message[];
  queueStatus: QueueStatus;
  notification: { message: string; level: "error" | "warn" | "info" } | null;
}

export interface EiContextValue {
  personas: () => PersonaSummary[];
  activePersona: () => string | null;
  activeContextBoundary: () => string | undefined;
  messages: () => Message[];
  queueStatus: () => QueueStatus;
  notification: () => { message: string; level: "error" | "warn" | "info" } | null;
  selectPersona: (name: string) => void;
  sendMessage: (content: string) => Promise<void>;
  refreshPersonas: () => Promise<void>;
  refreshMessages: () => Promise<void>;
  abortCurrentOperation: () => Promise<void>;
  resumeQueue: () => Promise<void>;
  stopProcessor: () => Promise<void>;
  showNotification: (message: string, level: "error" | "warn" | "info") => void;
  createPersona: (input: { name: string }) => Promise<void>;
  archivePersona: (name: string) => Promise<void>;
  unarchivePersona: (name: string) => Promise<void>;
  setContextBoundary: (personaName: string, timestamp: string | null) => Promise<void>;
  updatePersona: (name: string, updates: Partial<PersonaEntity>) => Promise<void>;
  getPersona: (name: string) => Promise<PersonaEntity | null>;
  getHuman: () => Promise<HumanEntity>;
  updateHuman: (updates: Partial<HumanEntity>) => Promise<void>;
  upsertFact: (fact: Fact) => Promise<void>;
  upsertTrait: (trait: Trait) => Promise<void>;
  upsertTopic: (topic: Topic) => Promise<void>;
  upsertPerson: (person: Person) => Promise<void>;
  removeDataItem: (type: "fact" | "trait" | "topic" | "person", id: string) => Promise<void>;
}

const EiContext = createContext<EiContextValue>();

export const EiProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<EiStore>({
    ready: false,
    personas: [],
    activePersona: null,
    activeContextBoundary: undefined,
    messages: [],
    queueStatus: { state: "idle", pending_count: 0 },
    notification: null,
  });

  const [contextBoundarySignal, setContextBoundarySignal] = createSignal<string | undefined>(undefined);

  let processor: Processor | null = null;
  let notificationTimer: Timer | null = null;

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
    const current = store.activePersona;
    if (!current) return;
    const msgs = await processor.getMessages(current);
    setStore("messages", [...msgs]);
  };

  const selectPersona = (name: string) => {
    setStore("activePersona", name);
    setStore("messages", []);
    const persona = store.personas.find(p => p.name === name);
    setStore("activeContextBoundary", persona?.context_boundary);
    setContextBoundarySignal(persona?.context_boundary);
    if (processor) {
      processor.getMessages(name).then((msgs) => {
        setStore("messages", [...msgs]);
      });
    }
  };

  const sendMessage = async (content: string) => {
    const current = store.activePersona;
    if (!current || !processor) return;
    await processor.sendMessage(current, content);
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

  const createPersona = async (input: { name: string }) => {
    if (!processor) return;
    await processor.createPersona(input);
  };

  const archivePersona = async (name: string) => {
    if (!processor) return;
    await processor.archivePersona(name);
    await refreshPersonas();
  };

  const unarchivePersona = async (name: string) => {
    if (!processor) return;
    await processor.unarchivePersona(name);
    await refreshPersonas();
  };

  const setContextBoundary = async (personaName: string, timestamp: string | null) => {
    if (!processor) return;
    // Set signal BEFORE processor call - processor fires callback synchronously
    // which triggers refreshMessages() that needs the NEW boundary value
    const newValue = timestamp ?? undefined;
    logger.debug(`setContextBoundary: ${personaName}, timestamp=${timestamp}, newValue=${newValue}`);
    if (personaName === store.activePersona) {
      logger.debug(`setContextBoundary: updating signal to ${newValue}`);
      setContextBoundarySignal(newValue);
    }
    await processor.setContextBoundary(personaName, timestamp);
    await refreshPersonas();
    if (personaName === store.activePersona) {
      await refreshMessages();
    }
  };

  const updatePersona = async (name: string, updates: Partial<PersonaEntity>) => {
    if (!processor) return;
    await processor.updatePersona(name, updates);
    await refreshPersonas();
  };

  const getPersona = async (name: string) => {
    if (!processor) return null;
    return processor.getPersona(name);
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

  async function bootstrap() {
    clearLog();
    interceptConsole();
    logger.info("Ei TUI bootstrap starting");
    try {
      const storage = new FileStorage(Bun.env.EI_DATA_PATH);

      const eiInterface: Ei_Interface = {
        onPersonaAdded: () => void refreshPersonas(),
        onPersonaRemoved: () => void refreshPersonas(),
        onPersonaUpdated: () => void refreshPersonas(),
        onMessageAdded: (personaName) => {
          void refreshPersonas();
          if (personaName === store.activePersona) {
            void refreshMessages();
          }
        },
        onQueueStateChanged: (state) => {
          logger.debug(`onQueueStateChanged called with state: ${state}`);
          if (processor) {
            processor.getQueueStatus().then((status) => {
              // Use the state parameter directly - it's authoritative.
              // getQueueStatus() checks queueProcessor.getState() which may not
              // be updated yet when this callback fires.
              setStore("queueStatus", { state, pending_count: status.pending_count });
              logger.debug(`store.queueStatus after setStore:`, store.queueStatus);
            });
          } else {
            setStore("queueStatus", { state, pending_count: 0 });
          }
        },
        onContextBoundaryChanged: (personaName) => {
          logger.debug(`onContextBoundaryChanged: ${personaName}`);
          void refreshPersonas();
        },
        onError: (error) => {
          logger.error(`${error.code}: ${error.message}`);
          showNotification(`${error.code}: ${error.message}`, "error");
        },
      };

      processor = new Processor(eiInterface);
      logger.debug("Processor created, calling start()");
      await processor.start(storage);
      logger.debug("Processor started");

      await refreshPersonas();
      logger.debug(`refreshPersonas done, count: ${store.personas.length}`);
      
      const status = await processor.getQueueStatus();
      logger.debug("Initial getQueueStatus:", status);
      setStore("queueStatus", status);
      logger.debug("Initial queueStatus set in store:", store.queueStatus);

      const list = store.personas;
      if (list.length > 0 && !store.activePersona) {
        selectPersona(list[0].name);
      }

      setStore("ready", true);
    } catch (err: any) {
      logger.error(`bootstrap() failed: ${err?.message || err}`);
    }
  }

  onMount(() => {
    void bootstrap();
  });

  onCleanup(() => {
    processor?.stop();
  });

  const value: EiContextValue = {
    personas: () => store.personas,
    activePersona: () => store.activePersona,
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
    showNotification,
    createPersona,
    archivePersona,
    unarchivePersona,
    setContextBoundary,
    updatePersona,
    getPersona,
    getHuman,
    updateHuman,
    upsertFact,
    upsertTrait,
    upsertTopic,
    upsertPerson,
    removeDataItem,
  };

  return (
    <Switch>
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

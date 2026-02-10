import {
  createContext,
  useContext,
  onMount,
  onCleanup,
  Match,
  Switch,
  type ParentComponent,
} from "solid-js";
import { createStore } from "solid-js/store";
import { Processor } from "../../../src/core/processor.js";
import { FileStorage } from "../storage/file.js";
import { logger, clearLog } from "../util/logger.js";
import type {
  Ei_Interface,
  PersonaSummary,
  Message,
  QueueStatus,
} from "../../../src/core/types.js";

interface EiStore {
  ready: boolean;
  personas: PersonaSummary[];
  activePersona: string | null;
  messages: Message[];
  queueStatus: QueueStatus;
}

interface EiContextValue {
  personas: () => PersonaSummary[];
  activePersona: () => string | null;
  messages: () => Message[];
  queueStatus: () => QueueStatus;
  selectPersona: (name: string) => void;
  sendMessage: (content: string) => Promise<void>;
  refreshPersonas: () => Promise<void>;
  refreshMessages: () => Promise<void>;
}

const EiContext = createContext<EiContextValue>();

export const EiProvider: ParentComponent = (props) => {
  const [store, setStore] = createStore<EiStore>({
    ready: false,
    personas: [],
    activePersona: null,
    messages: [],
    queueStatus: { state: "idle", pending_count: 0 },
  });

  let processor: Processor | null = null;

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
    setStore("messages", msgs);
  };

  const selectPersona = (name: string) => {
    setStore("activePersona", name);
    if (processor) {
      processor.getMessages(name).then((msgs) => setStore("messages", msgs));
    }
  };

  const sendMessage = async (content: string) => {
    const current = store.activePersona;
    if (!current || !processor) return;
    await processor.sendMessage(current, content);
  };

  async function bootstrap() {
    clearLog();
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
          const pending = processor ? 0 : 0;
          setStore("queueStatus", { state, pending_count: pending });
          logger.debug(`store.queueStatus after setStore:`, store.queueStatus);
        },
        onError: (error) => {
          logger.error(`${error.code}: ${error.message}`);
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
    messages: () => store.messages,
    queueStatus: () => store.queueStatus,
    selectPersona,
    sendMessage,
    refreshPersonas,
    refreshMessages,
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

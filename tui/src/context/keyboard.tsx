import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable, KeyEvent, TextareaRenderable, CliRenderer } from "@opentui/core";
import type { PersonaSummary } from "../../../src/core/types.js";
import { useEi } from "./ei";
import { logger } from "../util/logger";

export type Panel = "sidebar" | "messages" | "input";

interface KeyboardContextValue {
  focusedPanel: Accessor<Panel>;
  setFocusedPanel: (panel: Panel) => void;
  registerMessageScroll: (scrollbox: ScrollBoxRenderable) => void;
  registerTextarea: (textarea: TextareaRenderable) => void;
  registerEditorHandler: (handler: () => Promise<void>) => void;
  sidebarVisible: Accessor<boolean>;
  toggleSidebar: () => void;
  exitApp: () => Promise<void>;
  renderer: CliRenderer;
}

const KeyboardContext = createContext<KeyboardContextValue>();

export const KeyboardProvider: ParentComponent = (props) => {
  const [focusedPanel, setFocusedPanel] = createSignal<Panel>("input");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const renderer = useRenderer();
  const { queueStatus, abortCurrentOperation, resumeQueue, personas, activePersonaId, selectPersona, saveAndExit, showNotification } = useEi();
  
  let messageScrollRef: ScrollBoxRenderable | null = null;
  let textareaRef: TextareaRenderable | null = null;
  let editorHandler: (() => Promise<void>) | null = null;

  const registerMessageScroll = (scrollbox: ScrollBoxRenderable) => {
    messageScrollRef = scrollbox;
  };

  const registerTextarea = (textarea: TextareaRenderable) => {
    textareaRef = textarea;
  };

  const registerEditorHandler = (handler: () => Promise<void>) => {
    editorHandler = handler;
  };

  const toggleSidebar = () => setSidebarVisible(!sidebarVisible());

  const exitApp = async () => {
    const result = await saveAndExit();
    if (!result.success) {
      showNotification(`Sync failed: ${result.error}. Use /quit force to exit anyway.`, "error");
      return;
    }
    renderer.setTerminalTitle("");
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((event: KeyEvent) => {
    if (event.name === "tab") {
      event.preventDefault();
      if (textareaRef && textareaRef.plainText.length > 0) return;
      
      const unarchived = personas().filter((p: PersonaSummary) => !p.is_archived);
      if (unarchived.length <= 1) return;
      
      const current = activePersonaId();
      const currentIndex = unarchived.findIndex((p: PersonaSummary) => p.id === current);
      
      let nextIndex: number;
      if (event.shift) {
        nextIndex = (currentIndex - 1 + unarchived.length) % unarchived.length;
      } else {
        nextIndex = (currentIndex + 1) % unarchived.length;
      }
      selectPersona(unarchived[nextIndex].id);
      return;
    }

    if (event.name === "b" && event.ctrl) {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    if (event.name === "e" && event.ctrl) {
      event.preventDefault();
      if (editorHandler) {
        void editorHandler();
      }
      return;
    }

    if (event.name === "c" && event.ctrl) {
      event.preventDefault();
      
      if (textareaRef && textareaRef.plainText.length > 0) {
        logger.info("Ctrl+C pressed - clearing input");
        textareaRef.clear();
      } else {
        void exitApp();
      }
      return;
    }

    if (event.name === "escape") {
      event.preventDefault();
      const status = queueStatus();
      
      if (status.state === "busy") {
        logger.info("Escape pressed - aborting current operation");
        void abortCurrentOperation();
      } else if (status.state === "paused") {
        logger.info("Escape pressed - resuming queue");
        void resumeQueue();
      }
      return;
    }

    if (!messageScrollRef) return;

    const scrollAmount = messageScrollRef.height;
    
    if (event.name === "pageup") {
      event.preventDefault();
      messageScrollRef.scrollBy(-scrollAmount);
    } else if (event.name === "pagedown") {
      event.preventDefault();
      messageScrollRef.scrollBy(scrollAmount);
    }
  });

  const value: KeyboardContextValue = {
    focusedPanel,
    setFocusedPanel,
    registerMessageScroll,
    registerTextarea,
    registerEditorHandler,
    sidebarVisible,
    toggleSidebar,
    exitApp,
    renderer,
  };

  return (
    <KeyboardContext.Provider value={value}>
      {props.children}
    </KeyboardContext.Provider>
  );
};

export const useKeyboardNav = () => {
  const ctx = useContext(KeyboardContext);
  if (!ctx) {
    throw new Error("useKeyboardNav must be used within KeyboardProvider");
  }
  return ctx;
};

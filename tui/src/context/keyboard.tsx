import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKeyboard, useRenderer } from "@opentui/solid";
import type { ScrollBoxRenderable, KeyEvent, TextareaRenderable } from "@opentui/core";
import { useEi } from "./ei";
import { logger } from "../util/logger";

export type Panel = "sidebar" | "messages" | "input";

interface KeyboardContextValue {
  focusedPanel: Accessor<Panel>;
  setFocusedPanel: (panel: Panel) => void;
  registerMessageScroll: (scrollbox: ScrollBoxRenderable) => void;
  registerTextarea: (textarea: TextareaRenderable) => void;
  sidebarVisible: Accessor<boolean>;
  toggleSidebar: () => void;
  exitApp: () => void;
}

const KeyboardContext = createContext<KeyboardContextValue>();

export const KeyboardProvider: ParentComponent = (props) => {
  const [focusedPanel, setFocusedPanel] = createSignal<Panel>("input");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const renderer = useRenderer();
  const { queueStatus, abortCurrentOperation, resumeQueue } = useEi();
  
  let messageScrollRef: ScrollBoxRenderable | null = null;
  let textareaRef: TextareaRenderable | null = null;

  const registerMessageScroll = (scrollbox: ScrollBoxRenderable) => {
    messageScrollRef = scrollbox;
  };

  const registerTextarea = (textarea: TextareaRenderable) => {
    textareaRef = textarea;
  };

  const toggleSidebar = () => setSidebarVisible(!sidebarVisible());

  const exitApp = () => {
    logger.info("Exiting app");
    renderer.destroy();
    process.exit(0);
  };

  useKeyboard((event: KeyEvent) => {
    if (event.name === "b" && event.ctrl) {
      event.preventDefault();
      toggleSidebar();
      return;
    }

    if (event.name === "c" && event.ctrl) {
      event.preventDefault();
      
      if (textareaRef && textareaRef.plainText.length > 0) {
        logger.info("Ctrl+C pressed - clearing input");
        textareaRef.clear();
      } else {
        exitApp();
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
    sidebarVisible,
    toggleSidebar,
    exitApp,
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

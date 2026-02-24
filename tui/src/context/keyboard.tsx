import {
  createContext,
  useContext,
  createSignal,
  type ParentComponent,
  type Accessor,
} from "solid-js";
import { useKeyboard, useRenderer, useSelectionHandler } from "@opentui/solid";
import type { ScrollBoxRenderable, KeyEvent, TextareaRenderable, CliRenderer } from "@opentui/core";
import type { PersonaSummary } from "../../../src/core/types.js";
import { useEi } from "./ei";
import { logger } from "../util/logger";
import { copyToClipboard } from "../util/clipboard";

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
  resetHistoryIndex: () => void;
}

const KeyboardContext = createContext<KeyboardContextValue>();

export const KeyboardProvider: ParentComponent = (props) => {
  const [focusedPanel, setFocusedPanel] = createSignal<Panel>("input");
  const [sidebarVisible, setSidebarVisible] = createSignal(true);
  const renderer = useRenderer();
  const { queueStatus, abortCurrentOperation, resumeQueue, personas, activePersonaId, selectPersona, saveAndExit, showNotification, messages, recallPendingMessages } = useEi();
  
  let messageScrollRef: ScrollBoxRenderable | null = null;
  let textareaRef: TextareaRenderable | null = null;
  let editorHandler: (() => Promise<void>) | null = null;
  let historyIndex = -1;  // -1 = not browsing history
  let savedDraft = "";   // input text saved when history browsing starts

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


    if (event.name === "up" && !event.ctrl && !event.shift && !event.meta) {
      if (!textareaRef) return;
      const cursor = textareaRef.logicalCursor;
      // Only intercept when cursor is at the very beginning (row 0, col 0)
      if (cursor.row !== 0 || cursor.col !== 0) return;
      // Don't intercept when slash-command suggest panel is visible
      if (textareaRef.plainText.startsWith("/")) return;

      event.preventDefault();
      // First Up from fresh state: check for pending (unread) messages to recall
      if (historyIndex === -1) {
        const hasPending = messages().some(m => m.role === "human" && !m.read);
        if (hasPending) {
          savedDraft = textareaRef.plainText;
          void recallPendingMessages().then(recalled => {
            if (recalled) {
              textareaRef!.setText(recalled);
              textareaRef!.gotoBufferHome();
            }
          });
          return;
        }
      }
      // Navigate backward through sent-message history
      const history = messages().filter(m => m.role === "human").map(m => m.content);
      if (history.length === 0) return;
      if (historyIndex === -1) {
        savedDraft = textareaRef.plainText;
      }
      historyIndex = Math.min(historyIndex + 1, history.length - 1);
      // history is newest-last; index 0 = most recent
      const entry = history[history.length - 1 - historyIndex];
      textareaRef.setText(entry);
      textareaRef.gotoBufferHome();  // cursor at start so next Up continues backward
      return;
    }

    if (event.name === "down" && !event.ctrl && !event.shift && !event.meta) {
      if (!textareaRef || historyIndex === -1) return;
      // Only intercept when cursor is at the very end
      if (textareaRef.cursorOffset !== textareaRef.plainText.length) return;
      // Don't intercept when slash-command suggest panel is visible
      if (textareaRef.plainText.startsWith("/")) return;

      event.preventDefault();
      if (historyIndex === 0) {
        // Back to the draft
        historyIndex = -1;
        textareaRef.setText(savedDraft);
        textareaRef.gotoBufferEnd();
      } else {
        historyIndex -= 1;
        const history = messages().filter(m => m.role === "human").map(m => m.content);
        const entry = history[history.length - 1 - historyIndex];
        textareaRef.setText(entry);
        textareaRef.gotoBufferEnd();  // cursor at end so next Down continues forward
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


  useSelectionHandler((selection) => {
    const text = selection.getSelectedText();
    if (!text || text.length === 0) return;
    logger.info(`Selection detected: ${text.length} chars, copying...`);
    void copyToClipboard(text)
      .then(() => {
        showNotification(`Copied ${text.length} chars`, "info");
        renderer.clearSelection();
        logger.info(`Clipboard copy succeeded`);
      })
      .catch((err: unknown) => {
        logger.error(`Clipboard copy failed: ${String(err)}`);
      });
  });

  const resetHistoryIndex = () => {
    historyIndex = -1;
    savedDraft = "";
  };


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
    resetHistoryIndex,
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

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { PersonaList, type PersonaInfo, type PersonaStatusInfo } from "./PersonaList.js";
import { ChatHistory } from "./ChatHistory.js";
import { InputArea } from "./InputArea.js";
import { processEvent } from "../processor.js";
import { LLMAbortedError, LLMTruncatedError } from "../llm.js";
import {
  loadHistory,
  listPersonas,
  findPersonaByNameOrAlias,
  personaExists,
  getDataPath,
  initializeDataDirectory,
} from "../storage.js";
import { createPersonaWithLLM, saveNewPersona } from "../persona-creator.js";
import type { Message, MessageState } from "../types.js";

const LAYOUT_FULL_MIN_COLS = 100;
const LAYOUT_MEDIUM_MIN_COLS = 60;

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = DEBUG ? 600 * 1000 : THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;
const STARTUP_HISTORY_COUNT = 20;

type FocusedPane = "input" | "personas";

interface PersonaState {
  name: string;
  heartbeatTimer: ReturnType<typeof setTimeout> | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  lastActivity: number;
  isProcessing: boolean;
  messageQueue: string[];
  unreadCount: number;
  abortController: AbortController | null;
}

interface AppState {
  personas: PersonaInfo[];
  activePersona: string;
  messages: Message[];
  isProcessing: boolean;
  statusMessage: string | null;
  initialized: boolean;
  focusedPane: FocusedPane;
  personaListIndex: number;
  unreadCounts: Map<string, number>;
  inputClearTrigger: number;
  inputHasText: boolean;
  ctrlCWarningShown: boolean;
  chatScrollOffset: number;
}

function createPersonaState(name: string): PersonaState {
  return {
    name,
    heartbeatTimer: null,
    debounceTimer: null,
    lastActivity: Date.now(),
    isProcessing: false,
    messageQueue: [],
    unreadCount: 0,
    abortController: null,
  };
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;
  
  const [state, setState] = useState<AppState>({
    personas: [],
    activePersona: "ei",
    messages: [],
    isProcessing: false,
    statusMessage: null,
    initialized: false,
    focusedPane: "input",
    personaListIndex: 0,
    unreadCounts: new Map(),
    inputClearTrigger: 0,
    inputHasText: false,
    ctrlCWarningShown: false,
    chatScrollOffset: 0,
  });

  const personaStatesRef = useRef<Map<string, PersonaState>>(new Map());
  const activePersonaRef = useRef<string>("ei");

  const layoutType = columns >= LAYOUT_FULL_MIN_COLS 
    ? "full" 
    : columns >= LAYOUT_MEDIUM_MIN_COLS 
      ? "medium" 
      : "compact";

  const [countdownTick, setCountdownTick] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setCountdownTick(t => t + 1);
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const personaStatusMap = useMemo((): Map<string, PersonaStatusInfo> => {
    const result = new Map<string, PersonaStatusInfo>();
    const now = Date.now();
    
    for (const persona of state.personas) {
      const ps = personaStatesRef.current.get(persona.name);
      if (ps) {
        const heartbeatEndTime = ps.lastActivity + HEARTBEAT_INTERVAL_MS;
        const heartbeatIn = Math.max(0, Math.floor((heartbeatEndTime - now) / 1000));
        
        result.set(persona.name, {
          unreadCount: ps.unreadCount,
          isProcessing: ps.isProcessing,
          heartbeatIn
        });
      }
    }
    return result;
  }, [state.personas, countdownTick, state.isProcessing]);

  const getOrCreatePersonaState = useCallback((personaName: string): PersonaState => {
    let ps = personaStatesRef.current.get(personaName);
    if (!ps) {
      ps = createPersonaState(personaName);
      personaStatesRef.current.set(personaName, ps);
    }
    return ps;
  }, []);

  const debugLog = useCallback((msg: string) => {
    if (DEBUG) {
      setState(s => ({ ...s, statusMessage: `[Debug] ${msg}` }));
    }
  }, []);

  const setStatus = useCallback((msg: string | null) => {
    setState(s => ({ ...s, statusMessage: msg }));
  }, []);

  const addMessageToActive = useCallback((role: "human" | "system", content: string, messageState?: MessageState) => {
    const newMsg: Message = {
      role,
      content,
      timestamp: new Date().toISOString(),
      state: messageState,
    };
    setState(s => ({ ...s, messages: [...s.messages, newMsg], chatScrollOffset: 0 }));
  }, []);

  const updateLastHumanMessageState = useCallback((newState: MessageState | undefined) => {
    setState(s => {
      const messages = [...s.messages];
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === "human" && messages[i].state !== "sent") {
          messages[i] = { ...messages[i], state: newState };
          break;
        }
      }
      return { ...s, messages };
    });
  }, []);

  const updateUnreadCount = useCallback((personaName: string, count: number) => {
    setState(s => {
      const newCounts = new Map(s.unreadCounts);
      if (count === 0) {
        newCounts.delete(personaName);
      } else {
        newCounts.set(personaName, count);
      }
      return { ...s, unreadCounts: newCounts };
    });
  }, []);

  const processPersonaQueue = useCallback(async (personaName: string) => {
    const ps = getOrCreatePersonaState(personaName);
    
    if (ps.debounceTimer) {
      clearTimeout(ps.debounceTimer);
      ps.debounceTimer = null;
    }

    if (ps.messageQueue.length === 0 || ps.isProcessing) return;

    const combinedMessage = ps.messageQueue.join("\n");
    const messageCount = ps.messageQueue.length;

    debugLog(`[${personaName}] Processing ${messageCount} message(s)`);

    ps.abortController = new AbortController();
    ps.isProcessing = true;
    
    if (personaName === activePersonaRef.current) {
      setState(s => ({ ...s, isProcessing: true }));
    }

    try {
      const result = await processEvent(combinedMessage, personaName, DEBUG, ps.abortController.signal);

      if (result.aborted) {
        debugLog(`[${personaName}] Processing aborted - ${messageCount} message(s) preserved`);
      } else {
        ps.messageQueue = [];
        if (personaName === activePersonaRef.current) {
          updateLastHumanMessageState("sent");
        }
        if (result.response) {
          if (personaName === activePersonaRef.current) {
            addMessageToActive("system", result.response);
          } else {
            ps.unreadCount++;
            updateUnreadCount(personaName, ps.unreadCount);
            debugLog(`[${personaName}] Background response received, unread: ${ps.unreadCount}`);
          }
        }
      }
    } catch (err) {
      if (err instanceof LLMAbortedError) {
        debugLog(`[${personaName}] LLM call aborted - messages preserved`);
      } else {
        ps.messageQueue = [];
        if (personaName === activePersonaRef.current) {
          updateLastHumanMessageState("failed");
          setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      ps.isProcessing = false;
      ps.abortController = null;
      
      if (personaName === activePersonaRef.current) {
        setState(s => ({ ...s, isProcessing: false }));
      }

      if (ps.messageQueue.length > 0) {
        debugLog(`[${personaName}] Queue has messages after processing - retriggering`);
        processPersonaQueue(personaName);
      }
    }
  }, [getOrCreatePersonaState, debugLog, addMessageToActive, setStatus, updateUnreadCount, updateLastHumanMessageState]);

  const resetPersonaHeartbeat = useCallback((personaName: string) => {
    const ps = getOrCreatePersonaState(personaName);
    
    if (ps.heartbeatTimer) {
      clearTimeout(ps.heartbeatTimer);
    }
    
    ps.lastActivity = Date.now();
    
    ps.heartbeatTimer = setTimeout(async () => {
      if (ps.messageQueue.length > 0 || ps.isProcessing) {
        debugLog(`[${personaName}] Heartbeat skipped - busy`);
        resetPersonaHeartbeat(personaName);
        return;
      }

      debugLog(`[${personaName}] Heartbeat triggered`);
      ps.abortController = new AbortController();
      ps.isProcessing = true;
      
      if (personaName === activePersonaRef.current) {
        setState(s => ({ ...s, isProcessing: true }));
      }

      try {
        const result = await processEvent(null, personaName, DEBUG, ps.abortController.signal);
        if (!result.aborted && result.response) {
          if (personaName === activePersonaRef.current) {
            addMessageToActive("system", result.response);
          } else {
            ps.unreadCount++;
            updateUnreadCount(personaName, ps.unreadCount);
            debugLog(`[${personaName}] Background heartbeat response, unread: ${ps.unreadCount}`);
          }
        }
      } catch (err) {
        if (!(err instanceof LLMAbortedError)) {
          if (personaName === activePersonaRef.current) {
            setStatus(`Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } finally {
        ps.isProcessing = false;
        ps.abortController = null;
        if (personaName === activePersonaRef.current) {
          setState(s => ({ ...s, isProcessing: false }));
        }
        resetPersonaHeartbeat(personaName);
      }
    }, HEARTBEAT_INTERVAL_MS);
    
    debugLog(`[${personaName}] Heartbeat scheduled in ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  }, [getOrCreatePersonaState, debugLog, addMessageToActive, setStatus, updateUnreadCount]);

  const initializeAllHeartbeats = useCallback((personaNames: string[]) => {
    for (const name of personaNames) {
      resetPersonaHeartbeat(name);
    }
  }, [resetPersonaHeartbeat]);

  const abortPersonaOperation = useCallback((personaName: string) => {
    const ps = personaStatesRef.current.get(personaName);
    if (ps?.abortController) {
      debugLog(`[${personaName}] Aborting current operation`);
      ps.abortController.abort();
      ps.abortController = null;
    }
  }, [debugLog]);

  const schedulePersonaDebounce = useCallback((personaName: string) => {
    const ps = getOrCreatePersonaState(personaName);
    
    if (ps.debounceTimer) {
      clearTimeout(ps.debounceTimer);
    }
    ps.debounceTimer = setTimeout(() => {
      debugLog(`[${personaName}] Debounce timer fired`);
      processPersonaQueue(personaName);
    }, DEBOUNCE_MS);
  }, [getOrCreatePersonaState, debugLog, processPersonaQueue]);

  const queueMessage = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    const personaName = activePersonaRef.current;
    const ps = getOrCreatePersonaState(personaName);

    ps.messageQueue.push(trimmed);
    resetPersonaHeartbeat(personaName);

    if (ps.isProcessing) {
      debugLog(`[${personaName}] Message queued during processing (${ps.messageQueue.length} total) - aborting current`);
      abortPersonaOperation(personaName);
      return;
    }

    if (ps.debounceTimer) {
      clearTimeout(ps.debounceTimer);
      ps.debounceTimer = null;
    }

    const totalLength = ps.messageQueue.join(" ").length;

    if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
      debugLog(`[${personaName}] Message length ${totalLength} >= ${COMPLETE_THOUGHT_LENGTH}, processing immediately`);
      processPersonaQueue(personaName);
    } else {
      debugLog(`[${personaName}] Message length ${totalLength} < ${COMPLETE_THOUGHT_LENGTH}, waiting for more input`);
      schedulePersonaDebounce(personaName);
    }
  }, [getOrCreatePersonaState, resetPersonaHeartbeat, abortPersonaOperation, debugLog, processPersonaQueue, schedulePersonaDebounce]);

  const switchPersona = useCallback(async (personaName: string) => {
    if (personaName === activePersonaRef.current) return;

    try {
      const history = await loadHistory(personaName);
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);
      
      const ps = getOrCreatePersonaState(personaName);
      ps.unreadCount = 0;
      updateUnreadCount(personaName, 0);
      
      activePersonaRef.current = personaName;
      
      const isNewPersonaProcessing = ps.isProcessing;
      
      setState(s => ({
        ...s,
        activePersona: personaName,
        messages: recent,
        isProcessing: isNewPersonaProcessing,
        statusMessage: `Switched to persona: ${personaName}`,
        focusedPane: "input",
      }));
      
      resetPersonaHeartbeat(personaName);
    } catch (err) {
      setStatus(`Error loading persona: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [getOrCreatePersonaState, updateUnreadCount, resetPersonaHeartbeat, setStatus]);

  const handlePersonaCommand = useCallback(async (args: string) => {
    const trimmed = args.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    if (!trimmed) {
      const list = state.personas.map(p => {
        const aliasStr = p.aliases.length > 0 ? ` (${p.aliases.join(", ")})` : "";
        const marker = p.name === state.activePersona ? " [active]" : "";
        const unread = state.unreadCounts.get(p.name);
        const unreadStr = unread ? ` (${unread} unread)` : "";
        const descStr = p.short_description ? `\n    ${p.short_description}` : "";
        return `  ${p.name}${aliasStr}${marker}${unreadStr}${descStr}`;
      }).join("\n");
      setStatus(`Available personas:\n${list}\n\nUsage: /persona <name> to switch`);
      return;
    }

    const foundPersona = await findPersonaByNameOrAlias(lowerTrimmed);

    if (foundPersona) {
      await switchPersona(foundPersona);
      return;
    }

    if (!personaExists(lowerTrimmed)) {
      setStatus(`Persona "${trimmed}" not found. Creating new personas not yet supported in TUI mode.`);
      return;
    }
  }, [state.personas, state.activePersona, state.unreadCounts, setStatus, switchPersona]);

  const handleCommand = useCallback(async (input: string): Promise<boolean> => {
    if (!input.startsWith("/")) return false;

    resetPersonaHeartbeat(activePersonaRef.current);

    const spaceIdx = input.indexOf(" ");
    const command = spaceIdx === -1 ? input.slice(1) : input.slice(1, spaceIdx);
    const args = spaceIdx === -1 ? "" : input.slice(spaceIdx + 1);

    switch (command.toLowerCase()) {
      case "persona":
      case "p":
        await handlePersonaCommand(args);
        return true;
      case "help":
      case "h":
        setStatus(
          "Commands:\n" +
          "  /persona, /p         - List available personas\n" +
          "  /persona <name>      - Switch to persona\n" +
          "  /help, /h            - Show this help\n\n" +
          "Keybindings:\n" +
          "  Ctrl+H               - Focus persona list\n" +
          "  Ctrl+L               - Focus input\n" +
          "  Ctrl+J               - Insert newline (multi-line input)\n" +
          "  j/k                  - Navigate persona list (when focused)\n" +
          "  Enter                - Select persona / submit message\n" +
          "  Esc                  - Return to input\n" +
          "  Ctrl+C               - Exit"
        );
        return true;
      case "editor":
      case "e":
        setStatus("Editor command not yet supported in TUI mode. Use Ctrl+J for multi-line input.");
        return true;
      default:
        setStatus(`Unknown command: /${command}. Type /help for available commands.`);
        return true;
    }
  }, [resetPersonaHeartbeat, handlePersonaCommand, setStatus]);

  const handleSubmit = useCallback(async (text: string) => {
    setStatus(null);

    const isCommand = await handleCommand(text);
    if (isCommand) return;

    addMessageToActive("human", text, "processing");
    queueMessage(text);
  }, [handleCommand, addMessageToActive, queueMessage, setStatus]);

  const cleanupAllPersonaStates = useCallback(() => {
    for (const [, ps] of personaStatesRef.current) {
      if (ps.heartbeatTimer) clearTimeout(ps.heartbeatTimer);
      if (ps.debounceTimer) clearTimeout(ps.debounceTimer);
      if (ps.abortController) ps.abortController.abort();
    }
  }, []);

  const getBackgroundProcessingPersonas = useCallback((): string[] => {
    const result: string[] = [];
    for (const [name, ps] of personaStatesRef.current) {
      if (ps.isProcessing && name !== activePersonaRef.current) {
        result.push(name);
      }
    }
    return result;
  }, []);

  const handleInputHasTextChange = useCallback((hasText: boolean) => {
    setState(s => ({ ...s, inputHasText: hasText }));
  }, []);

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      const activePs = personaStatesRef.current.get(activePersonaRef.current);
      
      if (activePs?.isProcessing) {
        abortPersonaOperation(activePersonaRef.current);
        setStatus("Aborted current operation");
        return;
      }

      if (state.inputHasText) {
        setState(s => ({ 
          ...s, 
          inputClearTrigger: s.inputClearTrigger + 1,
          statusMessage: "Input cleared"
        }));
        return;
      }

      const backgroundProcessing = getBackgroundProcessingPersonas();
      if (backgroundProcessing.length > 0 && !state.ctrlCWarningShown) {
        const names = backgroundProcessing.join(", ");
        setState(s => ({ 
          ...s, 
          ctrlCWarningShown: true,
          statusMessage: `Processing in progress for: ${names}. Press Ctrl+C again to exit.`
        }));
        return;
      }

      cleanupAllPersonaStates();
      exit();
      return;
    }

    setState(s => s.ctrlCWarningShown ? { ...s, ctrlCWarningShown: false } : s);

    if (key.ctrl && input === "h") {
      if (layoutType === "full") {
        const currentActiveIndex = state.personas.findIndex(p => p.name === state.activePersona);
        setState(s => ({ 
          ...s, 
          focusedPane: "personas",
          personaListIndex: currentActiveIndex >= 0 ? currentActiveIndex : 0
        }));
      }
      return;
    }

    if (key.ctrl && input === "l") {
      setState(s => ({ ...s, focusedPane: "input" }));
      return;
    }

    if (key.escape) {
      setState(s => ({ ...s, focusedPane: "input" }));
      return;
    }

    if (state.focusedPane === "personas") {
      if (input === "j" || key.downArrow) {
        setState(s => ({
          ...s,
          personaListIndex: Math.min(s.personaListIndex + 1, s.personas.length - 1)
        }));
        return;
      }

      if (input === "k" || key.upArrow) {
        setState(s => ({
          ...s,
          personaListIndex: Math.max(s.personaListIndex - 1, 0)
        }));
        return;
      }

      if (key.return) {
        const selectedPersona = state.personas[state.personaListIndex];
        if (selectedPersona) {
          switchPersona(selectedPersona.name);
        }
        return;
      }
    }

    const PAGE_SIZE = 5;
    
    if (key.pageUp || (key.ctrl && input === "u")) {
      if (DEBUG) setStatus(`Scroll up: offset will be ${state.chatScrollOffset + PAGE_SIZE}`);
      setState(s => ({
        ...s,
        chatScrollOffset: Math.min(s.chatScrollOffset + PAGE_SIZE, Math.max(0, s.messages.length - 1))
      }));
      return;
    }

    if (key.pageDown || (key.ctrl && input === "d")) {
      if (DEBUG) setStatus(`Scroll down: offset will be ${state.chatScrollOffset - PAGE_SIZE}`);
      setState(s => ({
        ...s,
        chatScrollOffset: Math.max(0, s.chatScrollOffset - PAGE_SIZE)
      }));
      return;
    }

    if (input === "g" && state.focusedPane !== "input") {
      setState(s => ({
        ...s,
        chatScrollOffset: Math.max(0, s.messages.length - 1)
      }));
      return;
    }

    if (input === "G" && state.focusedPane !== "input") {
      setState(s => ({ ...s, chatScrollOffset: 0 }));
      return;
    }

    if (key.home) {
      setState(s => ({
        ...s,
        chatScrollOffset: Math.max(0, s.messages.length - 1)
      }));
      return;
    }

    if (key.end) {
      setState(s => ({ ...s, chatScrollOffset: 0 }));
      return;
    }
  });

  useEffect(() => {
    async function init() {
      const wasCreated = await initializeDataDirectory();
      const personas = await listPersonas();
      const history = await loadHistory("ei");
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);

      activePersonaRef.current = "ei";

      setState(s => ({
        ...s,
        personas,
        messages: recent,
        initialized: true,
        statusMessage: wasCreated ? "[New data directory initialized]" : null,
      }));

      initializeAllHeartbeats(personas.map(p => p.name));
    }
    init();

    return () => {
      cleanupAllPersonaStates();
    };
  }, []);

  if (!state.initialized) {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  const renderFullLayout = () => (
    <Box flexGrow={1} flexDirection="row">
      <PersonaList
        personas={state.personas}
        active={state.activePersona}
        onSelect={switchPersona}
        focused={state.focusedPane === "personas"}
        highlightedIndex={state.personaListIndex}
        personaStatus={personaStatusMap}
      />
      <Box flexDirection="column" flexGrow={1}>
        <ChatHistory
          messages={state.messages}
          persona={state.activePersona}
          scrollOffset={state.chatScrollOffset}
        />
        <InputArea
          onSubmit={handleSubmit}
          hint={state.isProcessing ? "thinking..." : undefined}
          disabled={state.focusedPane !== "input"}
          clearTrigger={state.inputClearTrigger}
          onHasTextChange={handleInputHasTextChange}
        />
      </Box>
    </Box>
  );

  const renderMediumLayout = () => (
    <Box flexGrow={1} flexDirection="column">
      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        {state.personas.map((p) => {
          const unread = state.unreadCounts.get(p.name) || 0;
          return (
            <Box key={p.name} marginRight={1}>
              <Text color={p.name === state.activePersona ? "green" : "gray"}>
                {p.name === state.activePersona ? `[${p.name}]` : p.name}
                {unread > 0 && <Text color="red"> ({unread})</Text>}
              </Text>
            </Box>
          );
        })}
      </Box>
      <ChatHistory
        messages={state.messages}
        persona={state.activePersona}
        scrollOffset={state.chatScrollOffset}
      />
      <InputArea
        onSubmit={handleSubmit}
        hint={state.isProcessing ? "thinking..." : undefined}
        clearTrigger={state.inputClearTrigger}
        onHasTextChange={handleInputHasTextChange}
      />
    </Box>
  );

  const renderCompactLayout = () => (
    <Box flexGrow={1} flexDirection="column">
      <ChatHistory
        messages={state.messages}
        persona={state.activePersona}
        scrollOffset={state.chatScrollOffset}
      />
      <InputArea
        onSubmit={handleSubmit}
        hint={state.isProcessing ? "thinking..." : undefined}
        clearTrigger={state.inputClearTrigger}
        onHasTextChange={handleInputHasTextChange}
      />
    </Box>
  );

  const renderHeader = () => {
    if (layoutType === "compact") {
      return (
        <Box>
          <Text bold color="cyan">EI</Text>
          <Text dimColor> | {state.activePersona}</Text>
          {DEBUG && <Text color="yellow"> [DBG]</Text>}
        </Box>
      );
    }
    return (
      <Box>
        <Text bold color="cyan">EI</Text>
        <Text dimColor> - Emotional Intelligence</Text>
        {DEBUG && <Text color="yellow"> [DEBUG]</Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" height="100%">
      <Box marginBottom={1}>
        {renderHeader()}
      </Box>

      {layoutType === "full" && renderFullLayout()}
      {layoutType === "medium" && renderMediumLayout()}
      {layoutType === "compact" && renderCompactLayout()}

      {state.statusMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text dimColor>{state.statusMessage}</Text>
        </Box>
      )}
    </Box>
  );
}

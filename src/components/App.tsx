import React, { useState, useEffect, useCallback, useRef } from "react";
import { Box, Text, useApp, useInput } from "ink";
import { PersonaList, type PersonaInfo } from "./PersonaList.js";
import { ChatHistory } from "./ChatHistory.js";
import { InputArea } from "./InputArea.js";
import { processEvent } from "../processor.js";
import { LLMAbortedError } from "../llm.js";
import {
  loadHistory,
  listPersonas,
  findPersonaByNameOrAlias,
  personaExists,
  getDataPath,
  initializeDataDirectory,
} from "../storage.js";
import { createPersonaWithLLM, saveNewPersona } from "../persona-creator.js";
import type { Message } from "../types.js";

const DEBUG = process.argv.includes("--debug") || process.argv.includes("-d");
const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = DEBUG ? 300 * 1000 : THIRTY_MINUTES_MS;
const COMPLETE_THOUGHT_LENGTH = 30;
const DEBOUNCE_MS = 2000;
const STARTUP_HISTORY_COUNT = 20;

interface AppState {
  personas: PersonaInfo[];
  activePersona: string;
  messages: Message[];
  isProcessing: boolean;
  statusMessage: string | null;
  initialized: boolean;
}

export function App(): React.ReactElement {
  const { exit } = useApp();
  
  const [state, setState] = useState<AppState>({
    personas: [],
    activePersona: "ei",
    messages: [],
    isProcessing: false,
    statusMessage: null,
    initialized: false,
  });

  const messageQueueRef = useRef<string[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const isProcessingRef = useRef(false);

  const debugLog = useCallback((msg: string) => {
    if (DEBUG) {
      setState(s => ({ ...s, statusMessage: `[Debug] ${msg}` }));
    }
  }, []);

  const setStatus = useCallback((msg: string | null) => {
    setState(s => ({ ...s, statusMessage: msg }));
  }, []);

  const addMessage = useCallback((role: "human" | "system", content: string) => {
    const newMsg: Message = {
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    setState(s => ({ ...s, messages: [...s.messages, newMsg] }));
  }, []);

  const resetHeartbeat = useCallback(() => {
    if (heartbeatTimerRef.current) {
      clearTimeout(heartbeatTimerRef.current);
    }
    heartbeatTimerRef.current = setTimeout(async () => {
      if (messageQueueRef.current.length > 0 || isProcessingRef.current) {
        debugLog("Heartbeat skipped - busy");
        resetHeartbeat();
        return;
      }

      debugLog("Heartbeat triggered");
      abortControllerRef.current = new AbortController();
      isProcessingRef.current = true;
      setState(s => ({ ...s, isProcessing: true }));

      try {
        const result = await processEvent(null, state.activePersona, DEBUG, abortControllerRef.current.signal);
        if (!result.aborted && result.response) {
          addMessage("system", result.response);
        }
      } catch (err) {
        if (!(err instanceof LLMAbortedError)) {
          setStatus(`Heartbeat error: ${err instanceof Error ? err.message : String(err)}`);
        }
      } finally {
        isProcessingRef.current = false;
        abortControllerRef.current = null;
        setState(s => ({ ...s, isProcessing: false }));
        resetHeartbeat();
      }
    }, HEARTBEAT_INTERVAL_MS);
    debugLog(`Heartbeat scheduled in ${HEARTBEAT_INTERVAL_MS / 1000}s`);
  }, [state.activePersona, debugLog, addMessage, setStatus]);

  const abortCurrentOperation = useCallback(() => {
    if (abortControllerRef.current) {
      debugLog("Aborting current operation");
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  }, [debugLog]);

  const processQueue = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (messageQueueRef.current.length === 0) return;

    const combinedMessage = messageQueueRef.current.join("\n");
    const messageCount = messageQueueRef.current.length;

    debugLog(`Processing ${messageCount} message(s)`);

    abortControllerRef.current = new AbortController();
    isProcessingRef.current = true;
    setState(s => ({ ...s, isProcessing: true }));

    try {
      const result = await processEvent(combinedMessage, state.activePersona, DEBUG, abortControllerRef.current.signal);

      if (result.aborted) {
        debugLog(`Processing aborted - ${messageCount} message(s) preserved`);
      } else {
        messageQueueRef.current = [];
        if (result.response) {
          addMessage("system", result.response);
        }
      }
    } catch (err) {
      if (err instanceof LLMAbortedError) {
        debugLog(`LLM call aborted - messages preserved`);
      } else {
        messageQueueRef.current = [];
        setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      isProcessingRef.current = false;
      abortControllerRef.current = null;
      setState(s => ({ ...s, isProcessing: false }));

      if (messageQueueRef.current.length > 0) {
        debugLog(`Queue has messages after processing - retriggering`);
        processQueue();
      } else if (DEBUG) {
        setStatus(null);
      }
    }
  }, [state.activePersona, debugLog, addMessage, setStatus]);

  const scheduleDebounce = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      debugLog("Debounce timer fired");
      processQueue();
    }, DEBOUNCE_MS);
  }, [debugLog, processQueue]);

  const queueMessage = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;

    messageQueueRef.current.push(trimmed);
    resetHeartbeat();

    if (isProcessingRef.current) {
      debugLog(`Message queued during processing (${messageQueueRef.current.length} total) - aborting current`);
      abortCurrentOperation();
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const totalLength = messageQueueRef.current.join(" ").length;

    if (totalLength >= COMPLETE_THOUGHT_LENGTH) {
      debugLog(`Message length ${totalLength} >= ${COMPLETE_THOUGHT_LENGTH}, processing immediately`);
      processQueue();
    } else {
      debugLog(`Message length ${totalLength} < ${COMPLETE_THOUGHT_LENGTH}, waiting for more input`);
      scheduleDebounce();
    }
  }, [resetHeartbeat, abortCurrentOperation, debugLog, processQueue, scheduleDebounce]);

  const switchPersona = useCallback(async (personaName: string) => {
    if (personaName === state.activePersona) return;

    if (isProcessingRef.current || messageQueueRef.current.length > 0) {
      abortCurrentOperation();
      messageQueueRef.current = [];
      debugLog("Persona switch: aborted processing, cleared queue");
    }

    try {
      const history = await loadHistory(personaName);
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);
      setState(s => ({
        ...s,
        activePersona: personaName,
        messages: recent,
        statusMessage: `Switched to persona: ${personaName}`,
      }));
      resetHeartbeat();
    } catch (err) {
      setStatus(`Error loading persona: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [state.activePersona, abortCurrentOperation, debugLog, resetHeartbeat, setStatus]);

  const handlePersonaCommand = useCallback(async (args: string) => {
    const trimmed = args.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    if (!trimmed) {
      // List personas
      const list = state.personas.map(p => {
        const aliasStr = p.aliases.length > 0 ? ` (${p.aliases.join(", ")})` : "";
        const marker = p.name === state.activePersona ? " [active]" : "";
        return `  ${p.name}${aliasStr}${marker}`;
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
  }, [state.personas, state.activePersona, setStatus, switchPersona]);

  const handleCommand = useCallback(async (input: string): Promise<boolean> => {
    if (!input.startsWith("/")) return false;

    resetHeartbeat();

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
          "  /help, /h            - Show this help\n" +
          "  Ctrl+C               - Exit"
        );
        return true;
      case "editor":
      case "e":
        setStatus("Editor command not yet supported in TUI mode. Use multi-line input (coming soon).");
        return true;
      default:
        setStatus(`Unknown command: /${command}. Type /help for available commands.`);
        return true;
    }
  }, [resetHeartbeat, handlePersonaCommand, setStatus]);

  const handleSubmit = useCallback(async (text: string) => {
    // Clear any status message on new input
    setStatus(null);

    const isCommand = await handleCommand(text);
    if (isCommand) return;

    // Add user message to display immediately
    addMessage("human", text);
    queueMessage(text);
  }, [handleCommand, addMessage, queueMessage, setStatus]);

  // Handle Ctrl+C to exit
  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      abortCurrentOperation();
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      exit();
    }
  });

  // Initialize on mount
  useEffect(() => {
    async function init() {
      const wasCreated = await initializeDataDirectory();
      const personas = await listPersonas();
      const history = await loadHistory("ei");
      const recent = history.messages.slice(-STARTUP_HISTORY_COUNT);

      setState(s => ({
        ...s,
        personas,
        messages: recent,
        initialized: true,
        statusMessage: wasCreated ? "[New data directory initialized]" : null,
      }));

      resetHeartbeat();
    }
    init();

    return () => {
      if (heartbeatTimerRef.current) clearTimeout(heartbeatTimerRef.current);
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      abortCurrentOperation();
    };
  }, []);

  if (!state.initialized) {
    return (
      <Box>
        <Text>Loading...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height="100%">
      {/* Header */}
      <Box marginBottom={1}>
        <Text bold color="cyan">EI</Text>
        <Text dimColor> - Emotional Intelligence</Text>
        <Text dimColor> | Data: {getDataPath()}</Text>
        {DEBUG && <Text color="yellow"> [DEBUG]</Text>}
      </Box>

      {/* Main 3-pane layout */}
      <Box flexGrow={1} flexDirection="row">
        <PersonaList
          personas={state.personas}
          active={state.activePersona}
        />
        <Box flexDirection="column" flexGrow={1}>
          <ChatHistory
            messages={state.messages}
            persona={state.activePersona}
          />
          <InputArea
            onSubmit={handleSubmit}
            hint={state.isProcessing ? "thinking..." : undefined}
          />
        </Box>
      </Box>

      {/* Status bar */}
      {state.statusMessage && (
        <Box marginTop={1} paddingX={1}>
          <Text dimColor>{state.statusMessage}</Text>
        </Box>
      )}
    </Box>
  );
}

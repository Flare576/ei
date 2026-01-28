import { useState, useEffect, useCallback, useRef } from "react";
import { Processor } from "../../src/core/processor";
import { LocalStorage } from "../../src/storage/local";
import type { PersonaSummary, QueueStatus, Message, Ei_Interface, Checkpoint } from "../../src/core/types";
import { Layout, PersonaPanel, ChatPanel, ControlArea, HelpModal, type PersonaPanelHandle, type ChatPanelHandle } from "./components/Layout";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import "./styles/layout.css";

function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const processorRef = useRef<Processor | null>(null);
  const activePersonaRef = useRef<string | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    state: "idle",
    pending_count: 0,
  });
  const [activePersona, setActivePersona] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [processingPersona, setProcessingPersona] = useState<string | null>(null);
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [isCheckpointOperationInProgress, setIsCheckpointOperationInProgress] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const personaPanelRef = useRef<PersonaPanelHandle | null>(null);
  const chatPanelRef = useRef<ChatPanelHandle | null>(null);

  useKeyboardNavigation({
    onFocusPersonaPanel: () => personaPanelRef.current?.focusPanel(),
    onFocusInput: () => chatPanelRef.current?.focusInput(),
    onScrollChat: (dir) => chatPanelRef.current?.scrollChat(dir),
  });

  useEffect(() => {
    activePersonaRef.current = activePersona;
  }, [activePersona]);

  useEffect(() => {
    const eiInterface: Ei_Interface = {
      onPersonaAdded: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaRemoved: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaUpdated: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onMessageAdded: (name) => {
        if (name === activePersonaRef.current) {
          processorRef.current?.getMessages(name).then(setMessages);
        }
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onMessageProcessing: (name) => {
        setProcessingPersona(name);
      },
      onMessageQueued: () => {
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onHumanUpdated: () => {},
      onQueueStateChanged: (state) => {
        if (state === "idle") {
          setProcessingPersona(null);
        }
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onError: (error) => {
        console.error(`[EI Error] ${error.code}: ${error.message}`);
      },
      onCheckpointStart: () => {
        setIsCheckpointOperationInProgress(true);
      },
      onCheckpointCreated: () => {
        setIsCheckpointOperationInProgress(false);
        processorRef.current?.getCheckpoints().then(setCheckpoints);
      },
      onCheckpointDeleted: () => {
        setIsCheckpointOperationInProgress(false);
        processorRef.current?.getCheckpoints().then(setCheckpoints);
      },
      onCheckpointRestored: () => {
        setIsCheckpointOperationInProgress(false);
        processorRef.current?.getCheckpoints().then(setCheckpoints);
        processorRef.current?.getPersonaList().then((list) => {
          setPersonas(list);
          if (list.length > 0) {
            const currentPersona = activePersonaRef.current;
            const personaExists = list.find(p => p.name === currentPersona);
            if (!personaExists) {
              setActivePersona(list[0].name);
              processorRef.current?.getMessages(list[0].name).then(setMessages);
            } else if (currentPersona) {
              processorRef.current?.getMessages(currentPersona).then(setMessages);
            }
          }
        });
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
    };

    const p = new Processor(eiInterface);
    const storage = new LocalStorage();

    p.start(storage).then(() => {
      processorRef.current = p;
      setProcessor(p);
      p.getPersonaList().then((list) => {
        setPersonas(list);
        if (list.length > 0) {
          setActivePersona(list[0].name);
          p.getMessages(list[0].name).then(setMessages);
        }
      });
      p.getQueueStatus().then(setQueueStatus);
      p.getCheckpoints().then(setCheckpoints);
    });

    return () => {
      p.stop();
    };
  }, []);

  useEffect(() => {
    if (processor && activePersona) {
      processor.getMessages(activePersona).then(setMessages);
    }
  }, [processor, activePersona]);

  const handleSendMessage = useCallback(async () => {
    if (!processor || !activePersona || !inputValue.trim()) return;
    await processor.sendMessage(activePersona, inputValue.trim());
    setInputValue("");
    chatPanelRef.current?.focusInput();
  }, [processor, activePersona, inputValue]);

  const handleCreatePersona = useCallback(async () => {
    if (!processor) return;
    const name = prompt("Enter persona name:");
    if (!name) return;
    const description = prompt("Enter persona description:");
    if (!description) return;
    await processor.createPersona(name, description);
  }, [processor]);

  const handleSelectPersona = useCallback((name: string) => {
    setActivePersona(name);
    chatPanelRef.current?.focusInput();
  }, []);

  const handleMarkMessageRead = useCallback(async (messageId: string) => {
    if (!processor || !activePersona) return;
    await processor.markMessageRead(activePersona, messageId);
    processor.getMessages(activePersona).then(setMessages);
  }, [processor, activePersona]);

  const handlePauseToggle = useCallback(async () => {
    if (!processor) return;
    const status = await processor.getQueueStatus();
    if (status.state === "paused") {
      await processor.resumeQueue();
    } else {
      await processor.abortCurrentOperation();
    }
    processor.getQueueStatus().then(setQueueStatus);
  }, [processor]);

  const handlePausePersona = useCallback(async (name: string, pauseUntil?: string) => {
    if (!processor) return;
    const persona = await processor.getPersona(name);
    if (!persona) return;
    await processor.updatePersona(name, {
      is_paused: !persona.is_paused,
      pause_until: pauseUntil,
    });
    processor.getPersonaList().then(setPersonas);
  }, [processor]);

  const handleArchivePersona = useCallback(async (name: string) => {
    if (!processor) return;
    await processor.archivePersona(name);
    processor.getPersonaList().then(setPersonas);
    if (activePersona === name) {
      const list = await processor.getPersonaList();
      setActivePersona(list.length > 0 ? list[0].name : null);
    }
  }, [processor, activePersona]);

  const handleDeletePersona = useCallback(async (name: string, _deleteData: boolean) => {
    if (!processor) return;
    await processor.deletePersona(name, _deleteData);
    processor.getPersonaList().then(setPersonas);
    if (activePersona === name) {
      const list = await processor.getPersonaList();
      setActivePersona(list.length > 0 ? list[0].name : null);
    }
  }, [processor, activePersona]);

  const handleEditPersona = useCallback((name: string) => {
    alert(`Edit persona: ${name}\n(Persona editor modal coming in ticket 0086)`);
  }, []);

  const handleRecallPending = useCallback(async () => {
    if (!processor || !activePersona) return;
    const recalled = await processor.recallPendingMessages(activePersona);
    if (recalled) {
      setInputValue((prev) => prev ? `${prev}\n\n${recalled}` : recalled);
      processor.getMessages(activePersona).then(setMessages);
    }
  }, [processor, activePersona]);

  const handleSaveCheckpoint = useCallback(async (index: number, name: string) => {
    if (!processor) return;
    await processor.createCheckpoint(index, name);
  }, [processor]);

  const handleLoadCheckpoint = useCallback(async (index: number) => {
    if (!processor) return;
    await processor.restoreCheckpoint(index);
    processor.getPersonaList().then((list) => {
      setPersonas(list);
      if (list.length > 0 && (!activePersona || !list.find(p => p.name === activePersona))) {
        setActivePersona(list[0].name);
        processor.getMessages(list[0].name).then(setMessages);
      } else if (activePersona) {
        processor.getMessages(activePersona).then(setMessages);
      }
    });
  }, [processor, activePersona]);

  const handleDeleteCheckpoint = useCallback(async (index: number) => {
    if (!processor) return;
    await processor.deleteCheckpoint(index);
  }, [processor]);

  const handleUndo = useCallback(async () => {
    if (!processor) return;
    const autoSaves = checkpoints.filter(c => c.index < 10).sort((a, b) => b.index - a.index);
    if (autoSaves.length > 0) {
      await handleLoadCheckpoint(autoSaves[0].index);
    }
  }, [processor, checkpoints, handleLoadCheckpoint]);

  const handleRefreshCheckpoints = useCallback(() => {
    processor?.getCheckpoints().then(setCheckpoints);
  }, [processor]);

  const handleHelpClick = useCallback(() => {
    setShowHelp(true);
  }, []);

  return (
    <>
    <Layout
      controlArea={
        <ControlArea 
          queueStatus={queueStatus} 
          checkpoints={checkpoints}
          isCheckpointOperationInProgress={isCheckpointOperationInProgress}
          onPauseToggle={handlePauseToggle}
          onSave={handleSaveCheckpoint}
          onLoad={handleLoadCheckpoint}
          onDeleteCheckpoint={handleDeleteCheckpoint}
          onUndo={handleUndo}
          onRefreshCheckpoints={handleRefreshCheckpoints}
          onHelpClick={handleHelpClick}
        />
      }
      leftPanel={
        <PersonaPanel
          ref={personaPanelRef}
          personas={personas}
          activePersona={activePersona}
          processingPersona={processingPersona}
          onSelectPersona={handleSelectPersona}
          onCreatePersona={handleCreatePersona}
          onPausePersona={handlePausePersona}
          onArchivePersona={handleArchivePersona}
          onDeletePersona={handleDeletePersona}
          onEditPersona={handleEditPersona}
        />
      }
      centerPanel={
        <ChatPanel
          ref={chatPanelRef}
          activePersona={activePersona}
          messages={messages}
          inputValue={inputValue}
          isProcessing={processingPersona !== null}
          onInputChange={setInputValue}
          onSendMessage={handleSendMessage}
          onMarkMessageRead={handleMarkMessageRead}
          onRecallPending={handleRecallPending}
        />
      }
    />
    <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
  </>
  );
}

export default App;

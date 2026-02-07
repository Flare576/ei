import { useState, useEffect, useCallback, useRef } from "react";
import { Processor } from "../../src/core/processor";
import { LocalStorage } from "../../src/storage/local";
import { remoteSync } from "../../src/storage/remote";
import type { 
  PersonaSummary, 
  QueueStatus, 
  Message, 
  Ei_Interface, 
  Checkpoint,
  HumanEntity,
  PersonaEntity,
  Fact,
  Trait,
  Topic,
  PersonaTopic,
  Person,
  ContextStatus,
  Quote,
  ProviderAccount,
  StorageState,
} from "../../src/core/types";
import { Layout, PersonaPanel, ChatPanel, ControlArea, HelpModal, type PersonaPanelHandle, type ChatPanelHandle } from "./components/Layout";
import { HumanEditor, PersonaEditor, PersonaCreatorModal, ArchivedPersonasModal } from "./components/EntityEditor";
import { QuoteCaptureModal, QuoteManagementModal } from "./components/Quote";
import { ConflictResolutionModal } from "./components/Sync/ConflictResolutionModal";
import { Onboarding } from "./components/Onboarding";
import { yoloMerge } from "../../src/storage/merge";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import "./styles/layout.css";
import "./styles/entity-editor.css";
import "./styles/onboarding.css";

function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const processorRef = useRef<Processor | null>(null);
  const activePersonaRef = useRef<string | null>(null);
  const editingPersonaNameRef = useRef<string | null>(null);
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
  const [showHumanEditor, setShowHumanEditor] = useState(false);
  const [showPersonaEditor, setShowPersonaEditor] = useState(false);
  const [showPersonaCreator, setShowPersonaCreator] = useState(false);
  const [showArchivedPersonas, setShowArchivedPersonas] = useState(false);
  const [editingPersonaName, setEditingPersonaName] = useState<string | null>(null);
  const [human, setHuman] = useState<HumanEntity | null>(null);
  const [editingPersona, setEditingPersona] = useState<PersonaEntity | null>(null);
  const [editingPersonaMessages, setEditingPersonaMessages] = useState<Message[]>([]);
  const [archivedPersonas, setArchivedPersonas] = useState<PersonaSummary[]>([]);
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
   const [activePersonaEntity, setActivePersonaEntity] = useState<PersonaEntity | null>(null);
   const [quotes, setQuotes] = useState<Quote[]>([]);
   const [captureMessage, setCaptureMessage] = useState<Message | null>(null);
   const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
   const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
   const [showConflictModal, setShowConflictModal] = useState(false);
   const [conflictData, setConflictData] = useState<{ localTimestamp: Date; remoteTimestamp: Date } | null>(null);
   const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  const personaPanelRef = useRef<PersonaPanelHandle | null>(null);
  const chatPanelRef = useRef<ChatPanelHandle | null>(null);

  useKeyboardNavigation({
    onFocusPersonaPanel: () => personaPanelRef.current?.focusPanel(),
    onFocusInput: () => chatPanelRef.current?.focusInput(),
    onScrollChat: (dir) => chatPanelRef.current?.scrollChat(dir),
  });

  // Check for first-run on mount (before Processor starts)
  useEffect(() => {
    const storage = new LocalStorage();
    storage.listCheckpoints().then((checkpoints) => {
      setShowOnboarding(checkpoints.length === 0);
    });
  }, []);

  useEffect(() => {
    activePersonaRef.current = activePersona;
  }, [activePersona]);

  useEffect(() => {
    editingPersonaNameRef.current = editingPersonaName;
  }, [editingPersonaName]);

  useEffect(() => {
    if (showOnboarding !== false) return;
    
    const eiInterface: Ei_Interface = {
      onPersonaAdded: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaRemoved: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onPersonaUpdated: () => {
        processorRef.current?.getPersonaList().then(setPersonas);
        processorRef.current?.getGroupList().then(setAvailableGroups);
        if (editingPersonaNameRef.current) {
          processorRef.current?.getPersona(editingPersonaNameRef.current).then(p => {
            if (p) setEditingPersona(p);
          });
          processorRef.current?.getMessages(editingPersonaNameRef.current).then(setEditingPersonaMessages);
        }
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
      onHumanUpdated: () => {
        processorRef.current?.getHuman().then(setHuman);
      },
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
      onContextBoundaryChanged: (name) => {
        if (name === activePersonaRef.current) {
          processorRef.current?.getPersona(name).then(setActivePersonaEntity);
          processorRef.current?.getMessages(name).then(setMessages);
        }
      },
      onQuoteAdded: () => {
        processorRef.current?.getQuotes().then(setQuotes);
      },
      onQuoteUpdated: () => {
        processorRef.current?.getQuotes().then(setQuotes);
      },
      onQuoteRemoved: () => {
        processorRef.current?.getQuotes().then(setQuotes);
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
      p.getHuman().then(async (h) => {
        setHuman(h);
        if (h.settings?.sync) {
          await remoteSync.configure(h.settings.sync);
          const remoteInfo = await remoteSync.checkRemote();
          if (remoteInfo.exists && remoteInfo.lastModified) {
            const localTimestamp = new Date(h.last_updated);
            const remoteTimestamp = remoteInfo.lastModified;
            if (remoteTimestamp > localTimestamp) {
              setConflictData({ localTimestamp, remoteTimestamp });
              setShowConflictModal(true);
            }
          }
        }
      });
      p.getGroupList().then(setAvailableGroups);
      p.getQuotes().then(setQuotes);
    });

    return () => {
      p.stop();
    };
  }, [showOnboarding]);

  useEffect(() => {
    if (processor && activePersona) {
      processor.getMessages(activePersona).then(setMessages);
      processor.getPersona(activePersona).then(setActivePersonaEntity);
    } else {
      setActivePersonaEntity(null);
    }
  }, [processor, activePersona]);

  const handleSendMessage = useCallback(async () => {
    if (!processor || !activePersona || !inputValue.trim()) return;
    await processor.sendMessage(activePersona, inputValue.trim());
    setInputValue("");
    chatPanelRef.current?.focusInput();
  }, [processor, activePersona, inputValue]);

  

  const handleSelectPersona = useCallback(async (name: string) => {
    if (processor && activePersona && activePersona !== name) {
      await processor.markAllMessagesRead(activePersona);
      processor.getPersonaList().then(setPersonas);
    }
    setActivePersona(name);
    chatPanelRef.current?.focusInput();
  }, [processor, activePersona]);

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

  const handleClearQueue = useCallback(async () => {
    if (!processor) return;
    const confirmed = window.confirm(
      "Clear all pending queue items? This will stop any pending responses, extractions, and ceremony tasks."
    );
    if (!confirmed) return;
    const cleared = await processor.clearQueue();
    console.log(`[App] Cleared ${cleared} queue items`);
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

  const handleSettingsClick = useCallback(() => {
    setShowHumanEditor(true);
  }, []);

  const handleSaveAndExit = useCallback(async () => {
    if (!processor) return;
    
    if (remoteSync.isConfigured()) {
      const state = await processor.getStorageState();
      const result = await remoteSync.sync(state);
      if (!result.success) {
        const proceed = window.confirm(`Remote backup failed: ${result.error}\n\nExit anyway?`);
        if (!proceed) return;
      } else {
        globalThis.localStorage?.removeItem('ei_autosaves');
      }
    }
    
    await processor.stop();
    setQueueStatus({ state: "idle", pending_count: 0 });
    setProcessingPersona(null);
  }, [processor]);

  const handleEditPersona = useCallback(async (name: string) => {
    if (!processor) return;
    const persona = await processor.getPersona(name);
    if (persona) {
      const personaMessages = await processor.getMessages(name);
      setEditingPersonaName(name);
      setEditingPersona(persona);
      setEditingPersonaMessages(personaMessages);
      setShowPersonaEditor(true);
    }
  }, [processor]);

  const handleCreatePersona = useCallback(() => {
    setShowPersonaCreator(true);
  }, []);

  const handleShowArchivedPersonas = useCallback(async () => {
    if (!processor) return;
    const allPersonas = await processor.getPersonaList();
    setArchivedPersonas(allPersonas.filter(p => p.is_archived));
    setShowArchivedPersonas(true);
  }, [processor]);

  const handleHumanUpdate = useCallback(async (updates: Record<string, unknown>) => {
    if (!processor) return;
    const { auto_save_interval_ms, default_model, queue_paused, name_display, name_color, time_mode, accounts, sync, ...rest } = updates;
    const settingsFields = { auto_save_interval_ms, default_model, queue_paused, name_display, name_color, time_mode, accounts, sync };
    const hasSettings = Object.values(settingsFields).some(v => v !== undefined);
    const coreUpdates: Partial<HumanEntity> = {
      ...(rest as Partial<HumanEntity>),
      ...(hasSettings ? { settings: { ...human?.settings, ...settingsFields } as HumanEntity['settings'] } : {}),
    };
    
    if (sync && typeof sync === 'object' && 'username' in sync && 'passphrase' in sync) {
      await remoteSync.configure({ username: sync.username as string, passphrase: sync.passphrase as string });
    } else if (sync === undefined && updates.hasOwnProperty('sync')) {
      remoteSync.clear();
    }
    
    await processor.updateHuman(coreUpdates);
    processor.getHuman().then(setHuman);
  }, [processor, human]);

  const handleConflictKeepLocal = useCallback(async (updateRemote: boolean) => {
    setShowConflictModal(false);
    setConflictData(null);
    if (updateRemote && processor) {
      const state = await processor.getStorageState();
      await remoteSync.sync(state);
    }
  }, [processor]);

  const handleConflictKeepRemote = useCallback(async () => {
    if (!processor) return;
    const result = await remoteSync.fetch();
    if (result.success && result.state) {
      await processor.restoreFromState(result.state);
      processor.getHuman().then(setHuman);
      processor.getPersonaList().then(setPersonas);
      processor.getQuotes().then(setQuotes);
    }
    setShowConflictModal(false);
    setConflictData(null);
  }, [processor]);

  const handleConflictYoloMerge = useCallback(async () => {
    if (!processor) return;
    const localState = await processor.getStorageState();
    const remoteResult = await remoteSync.fetch();
    if (remoteResult.success && remoteResult.state) {
      const merged = yoloMerge(localState, remoteResult.state);
      await processor.restoreFromState(merged);
      await remoteSync.sync(merged);
      processor.getHuman().then(setHuman);
      processor.getPersonaList().then(setPersonas);
      processor.getQuotes().then(setQuotes);
    }
    setShowConflictModal(false);
    setConflictData(null);
  }, [processor]);

  const handleFactSave = useCallback(async (fact: Fact) => {
    if (!processor) return;
    await processor.upsertFact(fact);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleFactDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("fact", id);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleTraitSave = useCallback(async (trait: Trait) => {
    if (!processor) return;
    await processor.upsertTrait(trait);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleTraitDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("trait", id);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleTopicSave = useCallback(async (topic: Topic) => {
    if (!processor) return;
    await processor.upsertTopic(topic);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleTopicDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("topic", id);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handlePersonSave = useCallback(async (person: Person) => {
    if (!processor) return;
    await processor.upsertPerson(person);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handlePersonDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeDataItem("person", id);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handlePersonaUpdate = useCallback(async (updates: Partial<PersonaEntity>) => {
    if (!processor || !editingPersonaName) return;
    await processor.updatePersona(editingPersonaName, updates);
    const updated = await processor.getPersona(editingPersonaName);
    if (updated) setEditingPersona(updated);
    processor.getPersonaList().then(setPersonas);
  }, [processor, editingPersonaName]);

  const handlePersonaTraitSave = useCallback(async (trait: Trait) => {
    if (!processor || !editingPersonaName) return;
    const persona = await processor.getPersona(editingPersonaName);
    if (!persona) return;
    const existingIndex = persona.traits.findIndex(t => t.id === trait.id);
    const newTraits = existingIndex >= 0
      ? persona.traits.map((t, i) => i === existingIndex ? trait : t)
      : [...persona.traits, trait];
    await processor.updatePersona(editingPersonaName, { traits: newTraits });
    const updated = await processor.getPersona(editingPersonaName);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaName]);

  const handlePersonaTraitDelete = useCallback(async (id: string) => {
    if (!processor || !editingPersonaName) return;
    const persona = await processor.getPersona(editingPersonaName);
    if (!persona) return;
    await processor.updatePersona(editingPersonaName, {
      traits: persona.traits.filter(t => t.id !== id)
    });
    const updated = await processor.getPersona(editingPersonaName);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaName]);

  const handlePersonaTopicSave = useCallback(async (topic: PersonaTopic) => {
    if (!processor || !editingPersonaName) return;
    const persona = await processor.getPersona(editingPersonaName);
    if (!persona) return;
    const existingIndex = persona.topics.findIndex(t => t.id === topic.id);
    const newTopics = existingIndex >= 0
      ? persona.topics.map((t, i) => i === existingIndex ? topic : t)
      : [...persona.topics, topic];
    await processor.updatePersona(editingPersonaName, { topics: newTopics });
    const updated = await processor.getPersona(editingPersonaName);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaName]);

  const handlePersonaTopicDelete = useCallback(async (id: string) => {
    if (!processor || !editingPersonaName) return;
    const persona = await processor.getPersona(editingPersonaName);
    if (!persona) return;
    await processor.updatePersona(editingPersonaName, {
      topics: persona.topics.filter(t => t.id !== id)
    });
    const updated = await processor.getPersona(editingPersonaName);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaName]);

  const handleContextStatusChange = useCallback(async (messageId: string, status: ContextStatus) => {
    if (!processor || !editingPersonaName) return;
    await processor.setMessageContextStatus(editingPersonaName, messageId, status);
    processor.getMessages(editingPersonaName).then(setEditingPersonaMessages);
  }, [processor, editingPersonaName]);

  const handleBulkContextStatusChange = useCallback(async (messageIds: string[], status: ContextStatus) => {
    if (!processor || !editingPersonaName) return;
    for (const id of messageIds) {
      await processor.setMessageContextStatus(editingPersonaName, id, status);
    }
    processor.getMessages(editingPersonaName).then(setEditingPersonaMessages);
  }, [processor, editingPersonaName]);

  const handleContextBoundaryChange = useCallback(async (timestamp: string | null) => {
    if (!processor || !activePersona) return;
    await processor.setContextBoundary(activePersona, timestamp);
  }, [processor, activePersona]);

  const handlePersonaCreate = useCallback(async (data: {
    name: string;
    aliases: string[];
    description: string;
    short_description?: string;
    traits?: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
    topics?: Array<{ name?: string; description?: string; exposure_current?: number; exposure_desired?: number }>;
    model?: string;
    group_primary?: string;
  }) => {
    if (!processor) return;
    await processor.createPersona({
      name: data.name,
      aliases: data.aliases,
      long_description: data.description,
      short_description: data.short_description,
      traits: data.traits,
      topics: data.topics,
      model: data.model,
      group_primary: data.group_primary,
    });
    processor.getPersonaList().then(setPersonas);
    setShowPersonaCreator(false);
  }, [processor]);

  const handleUnarchivePersona = useCallback(async (name: string) => {
    if (!processor) return;
    await processor.unarchivePersona(name);
    processor.getPersonaList().then(setPersonas);
    const allPersonas = await processor.getPersonaList();
    setArchivedPersonas(allPersonas.filter(p => p.is_archived));
  }, [processor]);

  const handleDeleteArchivedPersona = useCallback(async (name: string) => {
    if (!processor) return;
    await processor.deletePersona(name, false);
    const allPersonas = await processor.getPersonaList();
    setArchivedPersonas(allPersonas.filter(p => p.is_archived));
  }, [processor]);

  const getDeduplicatedDataItems = useCallback(() => {
    const DEFAULT_GROUP = "General";
    const personaName = activePersonaEntity?.aliases?.[0] ?? "";
    const isEi = personaName.toLowerCase() === "ei";

    const visibleGroups = new Set<string>();
    if (activePersonaEntity?.group_primary) {
      visibleGroups.add(activePersonaEntity.group_primary);
    }
    (activePersonaEntity?.groups_visible ?? []).forEach(g => visibleGroups.add(g));

    const isVisible = (itemGroups: string[] | undefined): boolean => {
      if (isEi) return true;
      const effectiveGroups = !itemGroups || itemGroups.length === 0 ? [DEFAULT_GROUP] : itemGroups;
      return effectiveGroups.some(g => visibleGroups.has(g));
    };

    const allItems = [
      ...(human?.topics || []).filter(i => isVisible(i.persona_groups)).map(i => ({ id: i.id, name: i.name, type: 'Topic' })),
      ...(human?.people || []).filter(i => isVisible(i.persona_groups)).map(i => ({ id: i.id, name: i.name, type: 'Person' })),
      ...(human?.traits || []).filter(i => isVisible(i.persona_groups)).map(i => ({ id: i.id, name: i.name, type: 'Trait' })),
      ...(human?.facts || []).filter(i => isVisible(i.persona_groups)).map(i => ({ id: i.id, name: i.name, type: 'Fact' })),
    ];

    const seen = new Set<string>();
    return allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [human, activePersonaEntity]);

  const handleQuoteSave = useCallback(async (quoteData: Omit<Quote, 'id' | 'created_at'>) => {
    if (!processor) return;
    const quote: Quote = {
      ...quoteData,
      id: crypto.randomUUID(),
      created_at: new Date().toISOString(),
    };
    await processor.addQuote(quote);
    setCaptureMessage(null);
  }, [processor]);

  const handleQuoteUpdate = useCallback(async (id: string, updates: Partial<Quote>) => {
    if (!processor) return;
    await processor.updateQuote(id, updates);
    setEditingQuote(null);
  }, [processor]);

  const handleQuoteDelete = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeQuote(id);
    setEditingQuote(null);
  }, [processor]);

  const handleDownloadBackup = useCallback(async () => {
    if (!processor) return;
    
    const state = await processor.exportState();
    const blob = new Blob([state], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ei-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [processor]);

  const handleUploadBackup = useCallback(async (file: File) => {
    if (!processor) return;
    
    try {
      const text = await file.text();
      await processor.importState(text);
      setShowHumanEditor(false);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Unknown error';
      alert(`Failed to restore backup: ${message}`);
    }
  }, [processor]);

  const handleOnboardingComplete = useCallback(async (
    accounts: ProviderAccount[],
    syncCredentials?: { username: string; passphrase: string },
    restoredState?: StorageState
  ) => {
    const storage = new LocalStorage();
    
    if (restoredState) {
      await storage.saveAutoCheckpoint(restoredState);
      if (syncCredentials) {
        await remoteSync.configure(syncCredentials);
      }
    }
    
    setShowOnboarding(false);
    
    if (!restoredState && accounts.length > 0) {
      const checkProcessor = setInterval(async () => {
        if (processorRef.current) {
          clearInterval(checkProcessor);
          const h = await processorRef.current.getHuman();
          const firstEnabled = accounts.find(a => a.enabled);
          const defaultModel = firstEnabled?.name;
          const newSettings = { ...h.settings, accounts, default_model: defaultModel };
          if (syncCredentials) {
            Object.assign(newSettings, { sync: syncCredentials });
            await remoteSync.configure(syncCredentials);
          }
          await processorRef.current.updateHuman({ settings: newSettings });
        }
      }, 100);
    }
  }, []);

  if (showOnboarding === null) {
    return (
      <div className="ei-loading">
        <div className="ei-loading__spinner" />
      </div>
    );
  }

  if (showOnboarding) {
    return <Onboarding onComplete={handleOnboardingComplete} />;
  }

  return (
    <>
    <Layout
      controlArea={
        <ControlArea 
          queueStatus={queueStatus} 
          checkpoints={checkpoints}
          isCheckpointOperationInProgress={isCheckpointOperationInProgress}
          onPauseToggle={handlePauseToggle}
          onClearQueue={handleClearQueue}
          onSave={handleSaveCheckpoint}
          onLoad={handleLoadCheckpoint}
          onDeleteCheckpoint={handleDeleteCheckpoint}
          onUndo={handleUndo}
          onRefreshCheckpoints={handleRefreshCheckpoints}
          onHelpClick={handleHelpClick}
          onSettingsClick={handleSettingsClick}
          onSaveAndExit={human?.settings?.sync ? handleSaveAndExit : undefined}
        />
      }
      leftPanel={
        <PersonaPanel
          ref={personaPanelRef}
          personas={personas.filter(p => !p.is_archived)}
          activePersona={activePersona}
          processingPersona={processingPersona}
          onSelectPersona={handleSelectPersona}
          onCreatePersona={handleCreatePersona}
          onPausePersona={handlePausePersona}
          onArchivePersona={handleArchivePersona}
          onDeletePersona={handleDeletePersona}
          onEditPersona={handleEditPersona}
          onShowArchived={handleShowArchivedPersonas}
        />
      }
      centerPanel={
        <ChatPanel
          ref={chatPanelRef}
          activePersona={activePersona}
          messages={messages}
          inputValue={inputValue}
          isProcessing={processingPersona !== null}
          contextBoundary={activePersonaEntity?.context_boundary}
          quotes={quotes}
          onInputChange={setInputValue}
          onSendMessage={handleSendMessage}
          onMarkMessageRead={handleMarkMessageRead}
          onRecallPending={handleRecallPending}
          onSetContextBoundary={handleContextBoundaryChange}
           onQuoteClick={(quote) => {
             setShowPersonaEditor(false);
             setEditingQuote(quote);
           }}
           onScissorsClick={(message) => {
             setShowPersonaEditor(false);
             setCaptureMessage(message);
           }}
        />
      }
    />
    <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    
    {human && (
      <HumanEditor
        isOpen={showHumanEditor}
        onClose={() => setShowHumanEditor(false)}
        human={{
          id: "human",
          auto_save_interval_ms: human.settings?.auto_save_interval_ms,
          default_model: human.settings?.default_model,
          queue_paused: human.settings?.queue_paused,
          name_display: human.settings?.name_display,
          name_color: human.settings?.name_color,
          time_mode: human.settings?.time_mode,
          facts: human.facts,
          traits: human.traits,
          topics: human.topics,
          people: human.people,
          quotes: quotes,
          accounts: human.settings?.accounts,
          sync: human.settings?.sync,
        }}
         onUpdate={handleHumanUpdate}
         onFactSave={handleFactSave}
         onFactDelete={handleFactDelete}
         onTraitSave={handleTraitSave}
         onTraitDelete={handleTraitDelete}
         onTopicSave={handleTopicSave}
         onTopicDelete={handleTopicDelete}
         onPersonSave={handlePersonSave}
         onPersonDelete={handlePersonDelete}
         onQuoteSave={handleQuoteUpdate}
         onQuoteDelete={handleQuoteDelete}
         onDownloadBackup={handleDownloadBackup}
         onUploadBackup={handleUploadBackup}
       />
    )}

    {editingPersona && editingPersonaName && (
      <PersonaEditor
        isOpen={showPersonaEditor}
        onClose={() => {
          setShowPersonaEditor(false);
          setEditingPersonaName(null);
          setEditingPersona(null);
        }}
        personaName={editingPersonaName}
        persona={editingPersona}
        messages={editingPersonaMessages}
        availableGroups={availableGroups}
        onUpdate={handlePersonaUpdate}
        onTraitSave={handlePersonaTraitSave}
        onTraitDelete={handlePersonaTraitDelete}
        onTopicSave={handlePersonaTopicSave}
        onTopicDelete={handlePersonaTopicDelete}
        onContextStatusChange={handleContextStatusChange}
        onBulkContextStatusChange={handleBulkContextStatusChange}
        onContextBoundaryChange={handleContextBoundaryChange}
      />
    )}

    <PersonaCreatorModal
      isOpen={showPersonaCreator}
      onClose={() => setShowPersonaCreator(false)}
      onCreate={handlePersonaCreate}
    />

    <ArchivedPersonasModal
       isOpen={showArchivedPersonas}
       onClose={() => setShowArchivedPersonas(false)}
       archivedPersonas={archivedPersonas.map(p => ({
         name: p.name,
         aliases: p.aliases,
         short_description: p.short_description,
         archived_at: new Date().toISOString(),
       }))}
       onUnarchive={handleUnarchivePersona}
       onDelete={handleDeleteArchivedPersona}
     />

     <QuoteCaptureModal
        isOpen={captureMessage !== null}
        message={captureMessage}
        personaName={activePersona || ''}
        groupPrimary={activePersonaEntity?.group_primary || undefined}
        dataItems={getDeduplicatedDataItems()}
        onClose={() => setCaptureMessage(null)}
        onSave={handleQuoteSave}
      />

     {editingQuote && (
       <QuoteManagementModal
         isOpen={editingQuote !== null}
         quote={editingQuote}
         message={messages.find(m => m.id === editingQuote.message_id) || null}
         personaName={activePersona || ''}
         dataItems={getDeduplicatedDataItems()}
         skipDeleteConfirm={skipDeleteConfirm}
         onClose={() => setEditingQuote(null)}
         onSave={handleQuoteUpdate}
         onDelete={handleQuoteDelete}
         onSkipDeleteConfirmChange={setSkipDeleteConfirm}
       />
     )}

     {conflictData && (
       <ConflictResolutionModal
         isOpen={showConflictModal}
         onClose={() => setShowConflictModal(false)}
         localTimestamp={conflictData.localTimestamp}
         remoteTimestamp={conflictData.remoteTimestamp}
         onKeepLocal={handleConflictKeepLocal}
         onKeepRemote={handleConflictKeepRemote}
         onYoloMerge={handleConflictYoloMerge}
       />
     )}
    </>
    );
}

export default App;

import { useState, useEffect, useCallback, useRef } from "react";
import { Processor } from "../../src/core/processor";
import { LocalStorage } from "../../src/storage/local";
import { remoteSync } from "../../src/storage/remote";
import type { 
  PersonaSummary, 
  QueueStatus, 
  Message, 
  Ei_Interface, 
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
  StateConflictData,
  StateConflictResolution,
} from "../../src/core/types";
import { Layout, PersonaPanel, ChatPanel, ControlArea, HelpModal, type PersonaPanelHandle, type ChatPanelHandle } from "./components/Layout";
import { HumanEditor, PersonaEditor, PersonaCreatorModal, ArchivedPersonasModal } from "./components/EntityEditor";
import { QuoteCaptureModal, QuoteManagementModal } from "./components/Quote";
import { SettingsModal } from "./components/Settings";
import { ConflictResolutionModal } from "./components/Sync/ConflictResolutionModal";
import { Onboarding } from "./components/Onboarding";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";

import "./styles/layout.css";
import "./styles/entity-editor.css";
import "./styles/onboarding.css";

function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const processorRef = useRef<Processor | null>(null);
  const activePersonaIdRef = useRef<string | null>(null);
  const editingPersonaIdRef = useRef<string | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    state: "idle",
    pending_count: 0,
  });
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [processingPersona, setProcessingPersona] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHumanEditor, setShowHumanEditor] = useState(false);
  const [showPersonaEditor, setShowPersonaEditor] = useState(false);
  const [showPersonaCreator, setShowPersonaCreator] = useState(false);
  const [showArchivedPersonas, setShowArchivedPersonas] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
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
    storage.load().then(async (existingState) => {
      if (existingState !== null) {
        // Primary state exists — skip onboarding
        setShowOnboarding(false);
        return;
      }
      // No primary state — check backup for sync creds
      const backup = await storage.loadBackup();
      if (backup?.human?.settings?.sync?.username && backup?.human?.settings?.sync?.passphrase) {
        // Backup has sync creds — processor.start() will handle sync pull
        setShowOnboarding(false);
        return;
      }
      // No state, no backup with creds — show onboarding
      setShowOnboarding(true);
    });
  }, []);

  useEffect(() => {
    activePersonaIdRef.current = activePersonaId;
  }, [activePersonaId]);

  useEffect(() => {
    editingPersonaIdRef.current = editingPersonaId;
  }, [editingPersonaId]);

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
        if (editingPersonaIdRef.current) {
          processorRef.current?.getPersona(editingPersonaIdRef.current).then(p => {
            if (p) setEditingPersona(p);
          });
          processorRef.current?.getMessages(editingPersonaIdRef.current).then(setEditingPersonaMessages);
        }
      },
      onMessageAdded: (personaId) => {
        if (personaId === activePersonaIdRef.current) {
          processorRef.current?.getMessages(personaId).then(setMessages);
        }
        processorRef.current?.getPersonaList().then(setPersonas);
      },
      onMessageProcessing: (personaId) => {
        setProcessingPersona(personaId);
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
      onStateImported: () => {
        processorRef.current?.getPersonaList().then((list) => {
          setPersonas(list);
          if (list.length > 0) {
            const currentPersonaId = activePersonaIdRef.current;
            const personaExists = list.find(p => p.id === currentPersonaId);
            if (!personaExists) {
              setActivePersonaId(list[0].id);
              processorRef.current?.getMessages(list[0].id).then(setMessages);
            } else if (currentPersonaId) {
              processorRef.current?.getMessages(currentPersonaId).then(setMessages);
            }
          }
        });
        processorRef.current?.getHuman().then(setHuman);
        processorRef.current?.getQuotes().then(setQuotes);
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onContextBoundaryChanged: (personaId) => {
        if (personaId === activePersonaIdRef.current) {
          processorRef.current?.getPersona(personaId).then(setActivePersonaEntity);
          processorRef.current?.getMessages(personaId).then(setMessages);
        }
      },
      onStateConflict: (data: StateConflictData) => {
        setConflictData({ localTimestamp: data.localTimestamp, remoteTimestamp: data.remoteTimestamp });
        setShowConflictModal(true);
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
          setActivePersonaId(list[0].id);
          p.getMessages(list[0].id).then(setMessages);
        }
      });
      p.getQueueStatus().then(setQueueStatus);
      p.getHuman().then(setHuman);
      p.getGroupList().then(setAvailableGroups);
      p.getQuotes().then(setQuotes);
    });

    return () => {
      p.stop();
    };
  }, [showOnboarding]);

  useEffect(() => {
    if (processor && activePersonaId) {
      processor.getMessages(activePersonaId).then(setMessages);
      processor.getPersona(activePersonaId).then(setActivePersonaEntity);
    } else {
      setActivePersonaEntity(null);
    }
  }, [processor, activePersonaId]);

  const handleSendMessage = useCallback(async () => {
    if (!processor || !activePersonaId || !inputValue.trim()) return;
    await processor.sendMessage(activePersonaId, inputValue.trim());
    setInputValue("");
    chatPanelRef.current?.focusInput();
  }, [processor, activePersonaId, inputValue]);

  

  const handleSelectPersona = useCallback(async (personaId: string) => {
    if (processor && activePersonaId && activePersonaId !== personaId) {
      await processor.markAllMessagesRead(activePersonaId);
      processor.getPersonaList().then(setPersonas);
    }
    setActivePersonaId(personaId);
    chatPanelRef.current?.focusInput();
  }, [processor, activePersonaId]);

  const handleMarkMessageRead = useCallback(async (messageId: string) => {
    if (!processor || !activePersonaId) return;
    await processor.markMessageRead(activePersonaId, messageId);
    processor.getMessages(activePersonaId).then(setMessages);
  }, [processor, activePersonaId]);

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

  const handlePausePersona = useCallback(async (personaId: string, pauseUntil?: string) => {
    if (!processor) return;
    const persona = await processor.getPersona(personaId);
    if (!persona) return;
    await processor.updatePersona(personaId, {
      is_paused: !persona.is_paused,
      pause_until: pauseUntil,
    });
    processor.getPersonaList().then(setPersonas);
  }, [processor]);

  const handleArchivePersona = useCallback(async (personaId: string) => {
    if (!processor) return;
    await processor.archivePersona(personaId);
    processor.getPersonaList().then(setPersonas);
    if (activePersonaId === personaId) {
      const list = await processor.getPersonaList();
      setActivePersonaId(list.length > 0 ? list[0].id : null);
    }
  }, [processor, activePersonaId]);

  const handleDeletePersona = useCallback(async (personaId: string, _deleteData: boolean) => {
    if (!processor) return;
    await processor.deletePersona(personaId, _deleteData);
    processor.getPersonaList().then(setPersonas);
    if (activePersonaId === personaId) {
      const list = await processor.getPersonaList();
      setActivePersonaId(list.length > 0 ? list[0].id : null);
    }
  }, [processor, activePersonaId]);

  

  const handleRecallPending = useCallback(async () => {
    if (!processor || !activePersonaId) return;
    const recalled = await processor.recallPendingMessages(activePersonaId);
    if (recalled) {
      setInputValue((prev) => prev ? `${prev}\n\n${recalled}` : recalled);
      processor.getMessages(activePersonaId).then(setMessages);
    }
  }, [processor, activePersonaId]);

  const handleHelpClick = useCallback(() => {
    setShowHelp(true);
  }, []);

  const handleSettingsClick = useCallback(() => {
    setShowSettingsModal(true);
  }, []);

  const handleMyDataClick = useCallback(() => {
    setShowHumanEditor(true);
  }, []);

  const handleSaveAndExit = useCallback(async () => {
    if (!processor) return;
    
    const result = await processor.saveAndExit();
    if (!result.success) {
      const proceed = window.confirm(`Remote backup failed: ${result.error}\n\nExit anyway?`);
      if (!proceed) return;
      await processor.stop();
    }
    
    setQueueStatus({ state: "idle", pending_count: 0 });
    setProcessingPersona(null);
    setShowOnboarding(true);
  }, [processor]);

  const handleEditPersona = useCallback(async (personaId: string) => {
    if (!processor) return;
    const persona = await processor.getPersona(personaId);
    if (persona) {
      const personaMessages = await processor.getMessages(personaId);
      setEditingPersonaId(personaId);
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
    const { default_model, queue_paused, name_display, time_mode, accounts, sync, ceremony_time, ...rest } = updates;
    
    const settingsUpdates: Record<string, unknown> = {};
    if (default_model !== undefined) settingsUpdates.default_model = default_model;
    if (queue_paused !== undefined) settingsUpdates.queue_paused = queue_paused;
    if (name_display !== undefined) settingsUpdates.name_display = name_display;
    if (time_mode !== undefined) settingsUpdates.time_mode = time_mode;
    if (accounts !== undefined) settingsUpdates.accounts = accounts;
    if (sync !== undefined || updates.hasOwnProperty('sync')) settingsUpdates.sync = sync;
    if (ceremony_time !== undefined) {
      settingsUpdates.ceremony = { ...human?.settings?.ceremony, time: ceremony_time as string };
    }
    
    const hasSettings = Object.keys(settingsUpdates).length > 0;
    const coreUpdates: Partial<HumanEntity> = {
      ...(rest as Partial<HumanEntity>),
      ...(hasSettings ? { settings: { ...human?.settings, ...settingsUpdates } as HumanEntity['settings'] } : {}),
    };
    
    if (sync && typeof sync === 'object' && 'username' in sync && 'passphrase' in sync) {
      await remoteSync.configure({ username: sync.username as string, passphrase: sync.passphrase as string });
    } else if (sync === undefined && updates.hasOwnProperty('sync')) {
      remoteSync.clear();
    }
    
    await processor.updateHuman(coreUpdates);
    processor.getHuman().then(setHuman);
  }, [processor, human]);

  const handleConflictResolve = useCallback(async (resolution: StateConflictResolution) => {
    if (!processor) return;
    await processor.resolveStateConflict(resolution);
    // The processor fires onStateImported which refreshes UI
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
    if (!processor || !editingPersonaId) return;
    await processor.updatePersona(editingPersonaId, updates);
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) setEditingPersona(updated);
    processor.getPersonaList().then(setPersonas);
  }, [processor, editingPersonaId]);

  const handlePersonaTraitSave = useCallback(async (trait: Trait) => {
    if (!processor || !editingPersonaId) return;
    const persona = await processor.getPersona(editingPersonaId);
    if (!persona) return;
    const existingIndex = persona.traits.findIndex(t => t.id === trait.id);
    const newTraits = existingIndex >= 0
      ? persona.traits.map((t, i) => i === existingIndex ? trait : t)
      : [...persona.traits, trait];
    await processor.updatePersona(editingPersonaId, { traits: newTraits });
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaId]);

  const handlePersonaTraitDelete = useCallback(async (id: string) => {
    if (!processor || !editingPersonaId) return;
    const persona = await processor.getPersona(editingPersonaId);
    if (!persona) return;
    await processor.updatePersona(editingPersonaId, {
      traits: persona.traits.filter(t => t.id !== id)
    });
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaId]);

  const handlePersonaTopicSave = useCallback(async (topic: PersonaTopic) => {
    if (!processor || !editingPersonaId) return;
    const persona = await processor.getPersona(editingPersonaId);
    if (!persona) return;
    const existingIndex = persona.topics.findIndex(t => t.id === topic.id);
    const newTopics = existingIndex >= 0
      ? persona.topics.map((t, i) => i === existingIndex ? topic : t)
      : [...persona.topics, topic];
    await processor.updatePersona(editingPersonaId, { topics: newTopics });
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaId]);

  const handlePersonaTopicDelete = useCallback(async (id: string) => {
    if (!processor || !editingPersonaId) return;
    const persona = await processor.getPersona(editingPersonaId);
    if (!persona) return;
    await processor.updatePersona(editingPersonaId, {
      topics: persona.topics.filter(t => t.id !== id)
    });
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) setEditingPersona(updated);
  }, [processor, editingPersonaId]);

  const handleContextStatusChange = useCallback(async (messageId: string, status: ContextStatus) => {
    if (!processor || !editingPersonaId) return;
    await processor.setMessageContextStatus(editingPersonaId, messageId, status);
    processor.getMessages(editingPersonaId).then(setEditingPersonaMessages);
  }, [processor, editingPersonaId]);

  const handleBulkContextStatusChange = useCallback(async (messageIds: string[], status: ContextStatus) => {
    if (!processor || !editingPersonaId) return;
    for (const id of messageIds) {
      await processor.setMessageContextStatus(editingPersonaId, id, status);
    }
    processor.getMessages(editingPersonaId).then(setEditingPersonaMessages);
  }, [processor, editingPersonaId]);

  const handleContextBoundaryChange = useCallback(async (timestamp: string | null) => {
    if (!processor || !activePersonaId) return;
    await processor.setContextBoundary(activePersonaId, timestamp);
  }, [processor, activePersonaId]);

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

  const handleUnarchivePersona = useCallback(async (personaId: string) => {
    if (!processor) return;
    await processor.unarchivePersona(personaId);
    processor.getPersonaList().then(setPersonas);
    const allPersonas = await processor.getPersonaList();
    setArchivedPersonas(allPersonas.filter(p => p.is_archived));
  }, [processor]);

  const handleDeleteArchivedPersona = useCallback(async (personaId: string) => {
    if (!processor) return;
    await processor.deletePersona(personaId, false);
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
  ) => {
    // Pre-configure remoteSync if creds provided (onboarding restore path)
    // This must happen BEFORE processor.start() so the sync decision tree can find remote
    if (syncCredentials) {
      await remoteSync.configure(syncCredentials);
    }

    setShowOnboarding(false);

    if (accounts.length > 0 || syncCredentials) {
      const checkProcessor = setInterval(async () => {
        if (processorRef.current) {
          clearInterval(checkProcessor);
          const h = await processorRef.current.getHuman();
          const firstEnabled = accounts.find(a => a.enabled);
          const defaultModel = firstEnabled?.name;
          const newSettings = { ...h.settings };
          if (accounts.length > 0) {
            Object.assign(newSettings, { accounts, default_model: defaultModel });
          }
          if (syncCredentials) {
            Object.assign(newSettings, { sync: syncCredentials });
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
          onPauseToggle={handlePauseToggle}
          onMyDataClick={handleMyDataClick}
          onSettingsClick={handleSettingsClick}
          onHelpClick={handleHelpClick}
          onSyncAndExit={human?.settings?.sync ? handleSaveAndExit : undefined}
        />
      }
      leftPanel={
        <PersonaPanel
          ref={personaPanelRef}
          personas={personas.filter(p => !p.is_archived)}
          activePersonaId={activePersonaId}
          processingPersonaId={processingPersona}
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
          activePersonaId={activePersonaId}
          activePersonaDisplayName={personas.find(p => p.id === activePersonaId)?.display_name ?? null}
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
      <>
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          settings={{
            name_display: human.settings?.name_display,
            time_mode: human.settings?.time_mode,
            ceremony_time: human.settings?.ceremony?.time ?? "09:00",
            default_model: human.settings?.default_model,
            accounts: human.settings?.accounts,
            sync: human.settings?.sync,
          }}
          onUpdate={handleHumanUpdate}
          onDownloadBackup={handleDownloadBackup}
          onUploadBackup={handleUploadBackup}
        />

        <HumanEditor
          isOpen={showHumanEditor}
          onClose={() => setShowHumanEditor(false)}
          human={{
            id: "human",
            name_display: human.settings?.name_display,
            facts: human.facts,
            traits: human.traits,
            topics: human.topics,
            people: human.people,
            quotes: quotes,
          }}
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
        />
      </>
    )}

    {editingPersona && editingPersonaId && (
      <PersonaEditor
        isOpen={showPersonaEditor}
        onClose={() => {
          setShowPersonaEditor(false);
          setEditingPersonaId(null);
          setEditingPersona(null);
        }}
        personaId={editingPersonaId}
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
         id: p.id,
         display_name: p.display_name,
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
        personaName={activePersonaEntity?.display_name || ''}
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
         personaName={activePersonaEntity?.display_name || ''}
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
         onKeepLocal={() => handleConflictResolve("local")}
         onKeepRemote={() => handleConflictResolve("server")}
         onYoloMerge={() => handleConflictResolve("yolo")}
       />
     )}
    </>
    );
}

export default App;

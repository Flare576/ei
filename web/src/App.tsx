import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Processor } from "../../src/core/processor";
import { LocalStorage } from "../../src/storage/local";
import { IndexedDBStorage } from "../../src/storage/indexed";
import type { Storage } from "../../src/storage/interface";
import { remoteSync } from "../../src/storage/remote";
import type { 
  PersonaSummary, 
  QueueStatus, 
  Message, 
  Ei_Interface, 
  HumanEntity,
  PersonaEntity,
   PersonaTrait,
  PersonaTopic,
  Quote,
  ProviderAccount,
  StateConflictData,
  ToolProvider,
  ToolDefinition,
  } from "../../src/core/types";
import { decodeTheme, themeToStyleString, isBuiltInTheme } from '../../src/core/utils/theme-codec.js';
import type { ThemeDefinition } from '../../src/core/types/entities.js';
import { ContextStatus, LLMNextStep } from "../../src/core/types";
import { Layout, PersonaPanel, ChatPanel, RoomChatPanel, ControlArea, HelpModal, ImagePreviewModal, type PersonaPanelHandle, type ChatPanelHandle, type RoomChatPanelHandle } from "./components/Layout";

function applyTheme(activeThemeId: string | undefined, customThemes: ThemeDefinition[]): void {
  const el = document.documentElement;
  // Remove any previously injected custom theme style
  document.getElementById('ei-custom-theme')?.remove();

  if (!activeThemeId || activeThemeId === 'default') {
    el.removeAttribute('data-theme');
    return;
  }

  if (isBuiltInTheme(activeThemeId)) {
    el.setAttribute('data-theme', activeThemeId);
    return;
  }

  // Custom theme — find by UUID and inject <style>
  const custom = customThemes.find(t => t.id === activeThemeId);
  if (!custom) {
    el.removeAttribute('data-theme');
    return;
  }

  const tokens = decodeTheme(custom.encoded);
  if (!tokens) {
    el.removeAttribute('data-theme');
    return;
  }

  el.setAttribute('data-theme', 'custom');
  const style = document.createElement('style');
  style.id = 'ei-custom-theme';
  style.textContent = `[data-theme="custom"] {\n${themeToStyleString(tokens)}\n}`;
  document.head.appendChild(style);
}
import { HumanEditor, PersonaEditor, PersonaCreatorModal, PersonaReflectionModal, RoomCreatorModal, RoomEditorModal, ArchivedPersonasModal, ArchivedRoomsModal } from "./components/EntityEditor";
import { RoomOverviewOverlay, CYPTreeView, FFAContextView, MAPScoreView } from "./components/Rooms";
import { QuoteCaptureModal, QuoteManagementModal } from "./components/Quote";
import { SettingsModal } from "./components/Settings";
import { MessageSelectorModal } from "./components/Modals/MessageSelectorModal";
import { TargetedCaptureModal } from "./components/Modals/TargetedCaptureModal";
import { KnowledgeSearchModal } from "./components/Modals/KnowledgeSearchModal";
import { ConflictResolutionModal } from "./components/Sync/ConflictResolutionModal";
import { Onboarding } from "./components/Onboarding";
import { QueuePanel } from "./components/Queue/QueuePanel";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { useReflection } from "./hooks/useReflection";
import { useQueueHandlers } from "./hooks/useQueueHandlers";
import { useHumanDataHandlers } from "./hooks/useHumanDataHandlers";
import { useOAuthCallbacks } from "./hooks/useOAuthCallbacks";
import { useImageGeneration } from "./hooks/useImageGeneration";
import { useRoomHandlers } from "./hooks/useRoomHandlers";
import { clearTokenCache } from '../../src/core/tools/builtin/spotify-auth.js';
import { clearLikedSongsCache } from '../../src/core/tools/builtin/spotify-liked-songs.js';
import { SLACK_CLIENT_ID, SLACK_WEB_REDIRECT_URI } from '../../src/core/tools/builtin/slack-auth.js';

import "./styles/index.css";
import "./styles/entity-editor.css";
import "./styles/onboarding.css";
import "./styles/queue-panel.css";
import "./styles/theme-editor.css";

function getContent(msg: { content?: string }): string {
  return msg.content ?? '';
}

// System prompt for multi-message image synthesis
const SYNTHESIS_SYSTEM_PROMPT = `You are building an image generation prompt from the user's conversation.

Return a JSON object with these fields:
{
  "image_prompt": "The actual prompt for the image generator (concise, descriptive)",
  "explanation": "Why you made these creative choices (this is for the user, not the generator)",
  "negative_prompt": "What to avoid in the generation (optional)"
}

IMPORTANT: The "explanation" field is your outlet for creative reasoning. Put ALL narrative there, keep image_prompt concise.

Focus on visual elements: subjects, setting, style, lighting, mood. Skip abstract concepts unless they translate to concrete visuals.
`;

export async function initializeStorage(): Promise<Storage> {
  const indexedStorage = new IndexedDBStorage();

  try {
    if (await indexedStorage.isAvailable()) {
      const existingState = await indexedStorage.load();

      if (!existingState) {
        // No IDB data — check localStorage for data to migrate
        const legacyStorage = new LocalStorage();
        if (await legacyStorage.isAvailable()) {
          const legacyState = await legacyStorage.load();
          if (legacyState) {
            console.log("[Storage] Migrating from localStorage → IndexedDB");
            await indexedStorage.save(legacyState);
            const legacyBackup = await legacyStorage.loadBackup();
            if (legacyBackup) {
              // Migrate backup: save to IDB backup key directly via moveToBackup pattern.
              // Save backup as primary then move it, to reuse the moveToBackup flow.
              // Simpler: just save primary (already done), backup is nice-to-have.
              // Store the raw compressed backup string if possible; just save the state.
              const backupStorage = new IndexedDBStorage();
              await backupStorage.save(legacyBackup);
              await backupStorage.moveToBackup();
              // Restore primary from migration
              await indexedStorage.save(legacyState);
            }
          }
        }
      }

      return indexedStorage;
    }

    console.warn("[Storage] IndexedDB unavailable, falling back to localStorage");
    return new LocalStorage();
  } catch (e) {
    // A real IndexedDB failure (open/read/write/migration) must never surface as a
    // successful-but-empty load — that would let a later save overwrite recoverable data
    // with the empty state. Fall back to a fresh LocalStorage for the session instead of
    // rejecting/hanging startup, mirroring the isAvailable()-false branch above. This
    // fallback still reads whatever real data localStorage has (via its own load()) —
    // nothing here treats the failure as "no data".
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[Storage] IndexedDB initialization failed, falling back to localStorage: ${message}`, e);
    alert(
      `Ei couldn't access its usual browser storage (IndexedDB) and switched to a limited fallback for this session. Your data has not been erased. (${message})`
    );
    return new LocalStorage();
  }
}

function App() {
  const [processor, setProcessor] = useState<Processor | null>(null);
  const processorRef = useRef<Processor | null>(null);
  const activePersonaIdRef = useRef<string | null>(null);
  const editingPersonaIdRef = useRef<string | null>(null);
  const [personas, setPersonas] = useState<PersonaSummary[]>([]);
  const [queueStatus, setQueueStatus] = useState<QueueStatus>({
    state: "idle",
    pending_count: 0,
    dlq_count: 0,
  });
  const [activePersonaId, setActivePersonaId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const switchPersona = useCallback((personaId: string | null) => {
    setMessages([]);
    setActivePersonaId(personaId);
  }, []);
  const [inputValue, setInputValue] = useState("");
  const [processingPersona, setProcessingPersona] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showHumanEditor, setShowHumanEditor] = useState(false);
  const [showPersonaEditor, setShowPersonaEditor] = useState(false);
  const [showPersonaCreator, setShowPersonaCreator] = useState(false);
  const [personaCreatorInitialData, setPersonaCreatorInitialData] = useState<{
    mode: 'create' | 'update';
    name?: string;
    description: string;
    relationship?: string;
    personaId?: string;
    linkedPersonId?: string;
  } | undefined>(undefined);
  const [showArchivedPersonas, setShowArchivedPersonas] = useState(false);
  const [showArchivedRooms, setShowArchivedRooms] = useState(false);
  const [editingPersonaId, setEditingPersonaId] = useState<string | null>(null);
  const [human, setHuman] = useState<HumanEntity | null>(null);
  const [editingPersona, setEditingPersona] = useState<PersonaEntity | null>(null);
  const [editingPersonaMessages, setEditingPersonaMessages] = useState<Message[]>([]);
  const [archivedPersonas, setArchivedPersonas] = useState<PersonaSummary[]>([]);
  const [availableGroups, setAvailableGroups] = useState<string[]>([]);
   const [activePersonaEntity, setActivePersonaEntity] = useState<PersonaEntity | null>(null);
   const [quotes, setQuotes] = useState<Quote[]>([]);
   const [toolProviders, setToolProviders] = useState<ToolProvider[]>([]);
   const [toolDefinitions, setToolDefinitions] = useState<ToolDefinition[]>([]);
   const [captureMessage, setCaptureMessage] = useState<Message | null>(null);
   const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
   const [skipDeleteConfirm, setSkipDeleteConfirm] = useState(false);
   const [showCaptureModal, setShowCaptureModal] = useState(false);
   const [showKnowledgeModal, setShowKnowledgeModal] = useState(false);
   const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const { spotifyAuthError, setSpotifyAuthError } = useOAuthCallbacks(processorRef);

  const {
    showReflectionModal,
    reflectionPersonaId,
    reflectionPersona,
    reflectionMessages,
    reflectionInputValue,
    reflectionPersonaIdRef,
    setReflectionMessages,
    setReflectionInputValue,
    handleOpenReflection,
    handleReflectionSendMessage,
    handleReflectionSaveAndApply,
    handleReflectionDismiss,
    handleReflectionClose,
    handleReflectionPendingUpdateChange,
  } = useReflection(processor, setPersonas);

  const {
    showQueuePanel,
    queuePanelItems,
    handlePauseToggle,
    handleQueuePanelOpen,
    handleQueuePanelClose,
    handleQueueItemsUpdate,
    handleQueueItemsDelete,
  } = useQueueHandlers(processorRef, queueStatus, setQueueStatus);

  const {
    showConflictModal,
    conflictData,
    setShowConflictModal,
    setConflictData,
    handleHumanUpdate,
    handleConflictResolve,
    handleFactSave,
    handleFactDelete,
    handleTopicSave,
    handleTopicDelete,
    handlePersonSave,
    handlePersonDelete,
    handleQuoteSave: handleQuoteSaveBase,
     handleQuoteDelete: handleQuoteDeleteBase,
  } = useHumanDataHandlers(processor, setHuman);

  const {
    currentImageResult,
    imageGenerationError,
    messageImages,
    generatingImageFor,
    imageErrors,
    showImagePreview,
    currentViewingMessageId,
    handleImageGenerate,
    handleImageRegenerate,
    handleImagePreviewClose,
    handleImageRemove,
    handleImageClick,
    handlePromptUpdate,
  } = useImageGeneration(processorRef, activePersonaId, messages, setMessages);

  const [showMessageSelector, setShowMessageSelector] = useState(false);

  const {
    rooms,
    setRooms,
    activeRoomId,
    setActiveRoomId,
    activeRoom,
    setActiveRoom,
    roomMessages,
    setRoomMessages,
    activeRoomPath,
    setActiveRoomPath,
    processingRoomId,
    setProcessingRoomId,
    roomActivating,
    showRoomCreator,
    setShowRoomCreator,
    showRoomEditor,
    setShowRoomEditor,
    editingRoom,
    setEditingRoom,
    showRoomOverview,
    setShowRoomOverview,
    overviewRoomId,
    setOverviewRoomId,
    roomInputValue,
    setRoomInputValue,
    activeRoomIdRef,
    refreshRoomActivating,
    handleSelectRoom,
    handleCreateRoom,
    handleArchiveRoom,
    handleEditRoom,
    handleShowRoomOverview,
    handleSaveRoomEdits,
    handleUnarchiveRoom,
    handleDeleteArchivedRoom,
    handleSubmitHumanRoomMessage,
    handleActivateRoom,
    handleRecallHumanRoomMessage,
    handleSelectCYPBranch,
    handleSetRoomMessageContextStatus,
    handleDeleteRoomMessages,
  } = useRoomHandlers(processorRef, processor, switchPersona);

  const personaPanelRef = useRef<PersonaPanelHandle | null>(null);
  const chatPanelRef = useRef<ChatPanelHandle | null>(null);
  const roomChatPanelRef = useRef<RoomChatPanelHandle | null>(null);
  const oneShotResolvers = useRef<Map<string, (result: string) => void>>(new Map());
  const oneShotJSONResolvers = useRef<Map<string, (result: unknown) => void>>(new Map());
  const storageRef = useRef<Storage | null>(null);

  useKeyboardNavigation({
    onFocusPersonaPanel: () => personaPanelRef.current?.focusPanel(),
    onFocusInput: () => {
      if (activeRoomId) roomChatPanelRef.current?.focusInput();
      else chatPanelRef.current?.focusInput();
    },
    onScrollChat: (dir) => {
      if (activeRoomId) roomChatPanelRef.current?.scrollChat(dir);
      else chatPanelRef.current?.scrollChat(dir);
    },
  });

  // Check for first-run on mount (before Processor starts)
  useEffect(() => {
    initializeStorage().then(async (storage) => {
      storageRef.current = storage;
      const existingState = await storage.load();
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
    applyTheme(
      human?.settings?.active_theme,
      human?.settings?.custom_themes ?? []
    );
  }, [human?.settings?.active_theme, human?.settings?.custom_themes]);

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
        if (personaId === reflectionPersonaIdRef.current) {
          processorRef.current?.getMessages(personaId).then(setReflectionMessages);
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
          setProcessingRoomId(null);
        }
        processorRef.current?.getQueueStatus().then(setQueueStatus);
        if (activeRoomIdRef.current) refreshRoomActivating(activeRoomIdRef.current);
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
              switchPersona(list[0].id);
            } else if (currentPersonaId) {
              setMessages([]);
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
      onOneShotReturned: (guid, content) => {
        const resolve = oneShotResolvers.current.get(guid);
        if (resolve) {
          oneShotResolvers.current.delete(guid);
          resolve(content);
        }
      },
      onOneShotJSONReturned: (guid, parsed) => {
        const resolve = oneShotJSONResolvers.current.get(guid);
        if (resolve) {
          oneShotJSONResolvers.current.delete(guid);
          resolve(parsed);
        }
      },
      onToolProviderAdded: () => {
        setToolProviders(processorRef.current?.getToolProviderList() ?? []);
      },
      onToolProviderUpdated: () => {
        setToolProviders(processorRef.current?.getToolProviderList() ?? []);
      },
      onToolProviderRemoved: () => {
        setToolProviders(processorRef.current?.getToolProviderList() ?? []);
      },
      onToolAdded: () => {
        setToolDefinitions(processorRef.current?.getToolList() ?? []);
      },
      onToolUpdated: () => {
        setToolDefinitions(processorRef.current?.getToolList() ?? []);
      },
      onToolRemoved: () => {
        setToolDefinitions(processorRef.current?.getToolList() ?? []);
      },
      onRoomAdded: () => {
        setRooms(processorRef.current?.getRoomList() ?? []);
      },
      onRoomRemoved: () => {
        setRooms(processorRef.current?.getRoomList() ?? []);
        if (activeRoomIdRef.current) {
          const exists = processorRef.current?.getRoom(activeRoomIdRef.current);
          if (!exists) {
            setActiveRoomId(null);
            setActiveRoom(null);
            setRoomMessages([]);
            setActiveRoomPath([]);
          }
        }
      },
      onRoomUpdated: (roomId) => {
        setRooms(processorRef.current?.getRoomList() ?? []);
        if (roomId === activeRoomIdRef.current) {
          const room = processorRef.current?.getRoom(roomId);
          setActiveRoom(room ?? null);
          setRoomMessages(processorRef.current?.getRoomMessages(roomId) ?? []);
          setActiveRoomPath(processorRef.current?.getRoomActivePath(roomId) ?? []);
        }
      },
      onRoomMessageAdded: (roomId) => {
        setRooms(processorRef.current?.getRoomList() ?? []);
        if (roomId === activeRoomIdRef.current) {
          setRoomMessages(processorRef.current?.getRoomMessages(roomId) ?? []);
          setActiveRoomPath(processorRef.current?.getRoomActivePath(roomId) ?? []);
          processorRef.current?.markAllRoomMessagesRead(roomId).then(() => {
            setRooms(processorRef.current?.getRoomList() ?? []);
          });
        }
      },
      onRoomMessageQueued: () => {
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
      onRoomMessageProcessing: (roomId) => {
        setProcessingRoomId(roomId);
      },
      onDocumentGenerated: () => {
        processorRef.current?.getHuman().then(setHuman);
        processorRef.current?.getQueueStatus().then(setQueueStatus);
      },
    };

    const p = new Processor(eiInterface);
    const getStorage = storageRef.current
      ? Promise.resolve(storageRef.current)
      : initializeStorage();

    getStorage.then((storage) => {
      storageRef.current = storage;
      p.start(storage).then(() => {
        processorRef.current = p;
        setProcessor(p);
        // Expose processor for E2E testing
        if (import.meta.env.MODE === 'test' || import.meta.env.DEV) {
          (window as any).__processor = p;
        }
        p.getPersonaList().then((list) => {
          setPersonas(list);
          if (list.length > 0) {
            switchPersona(list[0].id);
          }
        });
        p.getQueueStatus().then(setQueueStatus);
        p.getHuman().then(setHuman);
        p.getGroupList().then(setAvailableGroups);
        p.getQuotes().then(setQuotes);
        setToolProviders(p.getToolProviderList());
        setToolDefinitions(p.getToolList());
        setRooms(p.getRoomList());
      });
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

  const handleSendMessage = useCallback(async (content: string | null, silenceReason?: string) => {
    if (!processor || !activePersonaId) return;
    if (content !== null && !content.trim()) return;
    await processor.sendMessage(activePersonaId, content !== null ? content.trim() : null, silenceReason);
    setInputValue("");
    if (!activeRoomId) chatPanelRef.current?.focusInput();
  }, [processor, activePersonaId, activeRoomId]);

  

  const handleSelectPersona = useCallback(async (personaId: string) => {
    if (personaId === activePersonaId) {
      chatPanelRef.current?.scrollToBottom();
      return;
    }
    if (processor && activePersonaId) {
      await processor.markAllMessagesRead(activePersonaId);
      processor.getPersonaList().then(setPersonas);
    }
    switchPersona(personaId);
    setActiveRoomId(null);
    if (!activeRoomId) chatPanelRef.current?.focusInput();
  }, [processor, activePersonaId, activeRoomId, switchPersona]);

  const handleMarkMessageRead = useCallback(async (messageId: string) => {
    if (!processor || !activePersonaId) return;
    await processor.markMessageRead(activePersonaId, messageId);
    processor.getMessages(activePersonaId).then(setMessages);
  }, [processor, activePersonaId]);

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
      switchPersona(list.length > 0 ? list[0].id : null);
    }
  }, [processor, activePersonaId, switchPersona]);

  const handleDeletePersona = useCallback(async (personaId: string, _deleteData: boolean) => {
    if (!processor) return;
    await processor.deletePersona(personaId, _deleteData);
    processor.getPersonaList().then(setPersonas);
    if (activePersonaId === personaId) {
      const list = await processor.getPersonaList();
      switchPersona(list.length > 0 ? list[0].id : null);
    }
  }, [processor, activePersonaId, switchPersona]);

  

  const handleRecallPending = useCallback(async () => {
    if (!processor || !activePersonaId) return;
    const recalled = await processor.recallPendingMessages(activePersonaId);
    if (recalled) {
      setInputValue((prev) => prev ? `${prev}\n\n${recalled}` : recalled);
      processor.getMessages(activePersonaId).then(setMessages);
    }
  }, [processor, activePersonaId]);


  const handleImagePromptClick = useCallback(() => {
    setShowMessageSelector(true);
  }, []);
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
    setIsSaving(true);
    try {
      const result = await processor.saveAndExit();
      if (!result.success) {
        const proceed = window.confirm(`Remote backup failed: ${result.error}\n\nExit anyway?`);
        if (!proceed) return;
        await processor.stop();
      }
      setQueueStatus({ state: "idle", pending_count: 0, dlq_count: 0 });
      setProcessingPersona(null);
      setShowOnboarding(true);
    } finally {
      setIsSaving(false);
    }
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

  const handleImportDocument = useCallback(async (file: File) => {
    if (!processor) return;
    const content = await file.text();
    await processor.importDocument(content, file.name);
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handleGenerateDocument = useCallback(async (subject: string) => {
    if (!processor) return;
    try {
      await processor.generateDocument(subject);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Generate] ${message}`);
    }
  }, [processor]);

  const handleDownloadGenerated = useCallback(async (slug: string) => {
    if (!processor) return;
    const content = await processor.getGeneratedDocumentContent(slug);
    if (!content) return;
    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [processor]);

  const handleReRunDocument = useCallback(async (slug: string) => {
    if (!processor) return;
    await processor.reRunDocument(slug);
  }, [processor]);

  const handleUnsource = useCallback(async (sourceOrFilename: string) => {
    if (!processor) return;
    const isFullSourceTag = sourceOrFilename.includes(':');
    const sourceTag = isFullSourceTag
      ? sourceOrFilename
      : `import:document:${sourceOrFilename}`;
    const preview = processor.getUnsourcePreview(sourceTag);
    const result = await processor.executeUnsource(preview);
    if (!sourceOrFilename.startsWith('generate:')) {
      const { generateInvoiceMarkdown } = await import('../../src/integrations/document/invoice.js');
      const markdown = generateInvoiceMarkdown(preview, result);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `unsource-${sourceOrFilename}.md`;
      a.click();
      URL.revokeObjectURL(url);
    }
    processor.getHuman().then(setHuman);
  }, [processor]);

  const handlePersonaUpdate = useCallback(async (updates: Partial<PersonaEntity>) => {
    if (!processor || !editingPersonaId) return;
    await processor.updatePersona(editingPersonaId, updates);
    const updated = await processor.getPersona(editingPersonaId);
    if (updated) {
      setEditingPersona(updated);
      if (editingPersonaId === activePersonaId) setActivePersonaEntity(updated);
    }
    processor.getPersonaList().then(setPersonas);
  }, [processor, editingPersonaId, activePersonaId]);

  const handlePersonaTraitSave = useCallback(async (trait: PersonaTrait) => {
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

  const handleDeleteMessage = useCallback(async (messageId: string) => {
    if (!processor || !editingPersonaId) return;
    await processor.deleteMessages(editingPersonaId, [messageId]);
    processor.getMessages(editingPersonaId).then(setEditingPersonaMessages);
  }, [processor, editingPersonaId]);

  const handleAiAssist = useCallback(async (systemPrompt: string, userPrompt: string): Promise<string> => {
    if (!processorRef.current) throw new Error('Processor not ready');
    const guid = crypto.randomUUID();
    return new Promise<string>((resolve, reject) => {
      oneShotResolvers.current.set(guid, resolve);
      processorRef.current!.submitOneShot(guid, systemPrompt, userPrompt).catch((err) => {
        oneShotResolvers.current.delete(guid);
        reject(err);
      });
    });
  }, []);

  const handleAiAssistJSON = useCallback(async (systemPrompt: string, userPrompt: string): Promise<unknown> => {
    if (!processorRef.current) throw new Error('Processor not ready');
    const guid = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      oneShotJSONResolvers.current.set(guid, resolve);
      processorRef.current!.submitOneShotJSON(guid, systemPrompt, userPrompt).catch((err) => {
        oneShotJSONResolvers.current.delete(guid);
        reject(err);
      });
    });
  }, []);

  const handleSynthesisRequest = useCallback(async (selectedMessageIds: string[], instructions: string) => {
    if (!processor || !activePersonaId) return;
    
    try {
      // Build conversation text from selected messages
      const selectedMessages = messages.filter(m => selectedMessageIds.includes(m.id));
      const conversationText = selectedMessages
        .map(m => {
          const content = getContent(m);
          return `${m.role}: ${content}`;
        })
        .join('\n\n');
      
      const userPrompt = instructions
        ? `${conversationText}\n\nUser instructions: ${instructions}`
        : conversationText;
      
      const raw = await handleAiAssistJSON(SYNTHESIS_SYSTEM_PROMPT, userPrompt);
      const parsed = raw as { image_prompt: string; explanation?: string; negative_prompt?: string };
      
      if (!parsed?.image_prompt) {
        console.error('No image_prompt in synthesis result:', parsed);
        alert('Failed to generate image prompt. Please try again.');
        return;
      }
      
      // Create synthesis message
      const synthesisMessage: Message = {
        id: crypto.randomUUID(),
        role: 'human',
        content: parsed.image_prompt,
        _synthesis: true,
        timestamp: new Date().toISOString(),
        read: true,
        context_status: ContextStatus.Always,
      };
      
      // Add to conversation
      await processor.addMessageOnly(activePersonaId, synthesisMessage);
      
      // Refresh messages
      const updatedMessages = await processor.getMessages(activePersonaId);
      setMessages(updatedMessages);
      
      // Auto-trigger image generation
      handleImageGenerate(synthesisMessage);
      
    } catch (error) {
      console.error('Synthesis request failed:', error);
      alert('Failed to generate image prompt. Please try again.');
    }
  }, [processor, activePersonaId, messages, handleAiAssistJSON, handleImageGenerate]);


  const linkPersonaToPersonRecord = useCallback(async (personaId: string, personId: string) => {
    if (!processor) return;
    const human = await processor.getHuman();
    const person = human.people?.find(p => p.id === personId);
    if (!person) return;
    const identifiers = person.identifiers ?? [];
    if (identifiers.some(id => id.type === 'Ei Persona' && id.value === personaId)) return;
    const isPrimaryFirst = identifiers.length === 0;
    const updated = [...identifiers, { type: 'Ei Persona', value: personaId, ...(isPrimaryFirst ? { is_primary: true } : {}) }];
    await processor.upsertPerson({ ...person, identifiers: updated });
    setHuman(await processor.getHuman());
  }, [processor]);

  const handlePersonaCreate = useCallback(async (data: {
    name: string;
    aliases: string[];
    description: string;
    short_description?: string;
    traits?: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
    topics?: Array<{ name?: string; perspective?: string; approach?: string; personal_stake?: string; sentiment?: number; exposure_current?: number; exposure_desired?: number }>;
    model?: string;
    group_primary?: string;
    tools?: string[];
  }) => {
    if (!processor) return;
    const newPersonaId = await processor.createPersona({
      name: data.name,
      aliases: data.aliases,
      long_description: data.description,
      short_description: data.short_description,
      traits: data.traits,
      topics: data.topics?.map(t => ({
        ...t,
        sentiment: t.sentiment ?? 0,
        exposure_current: t.exposure_current ?? 0.5,
        exposure_desired: t.exposure_desired ?? 0.5,
      })),
      model: data.model,
      group_primary: data.group_primary,
      tools: data.tools,
    });
    const linkedPersonId = personaCreatorInitialData?.linkedPersonId;
    if (linkedPersonId) await linkPersonaToPersonRecord(newPersonaId, linkedPersonId);
    processor.getPersonaList().then(setPersonas);
    setShowPersonaCreator(false);
  }, [processor, personaCreatorInitialData, linkPersonaToPersonRecord]);

  const handlePersonaUpdateFromPreview = useCallback(async (personaId: string, data: {
    name: string;
    aliases: string[];
    description: string;
    short_description?: string;
    traits?: Array<{ name?: string; description?: string; sentiment?: number; strength?: number }>;
    topics?: Array<{ name?: string; perspective?: string; approach?: string; personal_stake?: string; sentiment?: number; exposure_current?: number; exposure_desired?: number }>;
    model?: string;
    group_primary?: string;
    tools?: string[];
  }) => {
    if (!processor) return;
    const persona = await processor.getPersona(personaId);
    if (!persona) return;
    const updates: Record<string, unknown> = {};
    if (data.description) updates.long_description = data.description;
    if (data.short_description) updates.short_description = data.short_description;
    if (data.traits && data.traits.length > 0) {
      const seen = new Set<string>();
      updates.traits = data.traits.filter(t => {
        const key = (t.name ?? '').toLowerCase().trim();
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }
    if (data.topics && data.topics.length > 0) {
      const seen = new Set<string>();
      updates.topics = data.topics
        .filter(t => {
          const key = (t.name ?? '').toLowerCase().trim();
          if (!key || seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map(t => ({
          ...t,
          sentiment: t.sentiment ?? 0,
          exposure_current: t.exposure_current ?? 0.5,
          exposure_desired: t.exposure_desired ?? 0.5,
        }));
    }
    if (data.name && data.aliases !== undefined) {
      updates.aliases = data.aliases;
    }
    await processor.updatePersona(personaId, updates);
    const linkedPersonId = personaCreatorInitialData?.linkedPersonId;
    if (linkedPersonId) await linkPersonaToPersonRecord(personaId, linkedPersonId);
    processor.getPersonaList().then(setPersonas);
    setShowPersonaCreator(false);
    setPersonaCreatorInitialData(undefined);
  }, [processor, personaCreatorInitialData, linkPersonaToPersonRecord]);

  const handleGeneratePersonaPreview = useCallback(async (name: string, description: string, relationship?: string, personaId?: string) => {
    if (!processor) throw new Error('Processor not ready');
    return processor.generatePersonaPreview(name, description, relationship, personaId);
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
      ...(human?.facts || []).filter(i => isVisible(i.persona_groups)).map(i => ({ id: i.id, name: i.name, type: 'Fact' })),
    ];

    const seen = new Set<string>();
    return allItems.filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [human, activePersonaEntity]);

  const captureModalItems = useMemo(() => {
    const seen = new Set<string>();
    return [
      ...(human?.people || []).map(i => ({ id: i.id, name: i.name, type: 'Person' as const })),
      ...(human?.topics || []).map(i => ({ id: i.id, name: i.name, type: 'Topic' as const })),
    ].filter(item => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    });
  }, [human]);

  const handleTargetedCapture = useCallback((item: { id: string; name: string; type: 'Person' | 'Topic' }) => {
    if (!processorRef.current) return;
    if (activeRoomId) {
      if (item.type === 'Person') {
        processorRef.current.captureTargetedPerson(item.id, '', activeRoomId);
      } else {
        processorRef.current.captureTargetedTopic(item.id, '', activeRoomId);
      }
    } else if (activePersonaId) {
      if (item.type === 'Person') {
        processorRef.current.captureTargetedPerson(item.id, activePersonaId);
      } else {
        processorRef.current.captureTargetedTopic(item.id, activePersonaId);
      }
    }
    setShowCaptureModal(false);
  }, [activeRoomId, activePersonaId]);

  const handleCaptureAll = useCallback(() => {
    if (!processorRef.current) return;
    if (activeRoomId) {
      processorRef.current.captureRoom(activeRoomId);
    } else if (activePersonaId) {
      processorRef.current.capturePersona(activePersonaId);
    }
    setShowCaptureModal(false);
  }, [activeRoomId, activePersonaId]);

  const handleQuoteSave = useCallback(async (quoteData: Omit<Quote, 'id' | 'created_at'>) => {
    await handleQuoteSaveBase(quoteData);
    setCaptureMessage(null);
  }, [handleQuoteSaveBase]);

  const handleQuoteUpdate = useCallback(async (id: string, updates: Partial<Quote>) => {
    if (!processor) return;
    await processor.updateQuote(id, updates);
    setEditingQuote(null);
  }, [processor]);

  const handleQuoteDelete = useCallback(async (id: string) => {
    await handleQuoteDeleteBase(id);
    setEditingQuote(null);
  }, [handleQuoteDeleteBase]);

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
          const firstEnabled = accounts.find(a => a.enabled && a.type === 'llm');
          const defaultModel = firstEnabled?.name;
          const newSettings = { ...h.settings };
          if (accounts.length > 0) {
            Object.assign(newSettings, { accounts, conversation_model: defaultModel, extraction_model: defaultModel });
          }
          if (syncCredentials) {
            Object.assign(newSettings, { sync: syncCredentials });
          }
          await processorRef.current.updateHuman({ settings: newSettings });
        }
      }, 100);
    }
  }, []);

  const handleToolProviderUpdate = useCallback(async (id: string, updates: Partial<Omit<ToolProvider, 'id' | 'created_at'>>) => {
    if (!processor) return;
    await processor.updateToolProvider(id, updates);
    setToolProviders(processor.getToolProviderList());
  }, [processor]);

  const handleToolProviderRemove = useCallback(async (id: string) => {
    if (!processor) return;
    await processor.removeToolProvider(id);
    setToolProviders(processor.getToolProviderList());
  }, [processor]);

  const handleToolUpdate = useCallback(async (id: string, updates: Partial<Omit<ToolDefinition, 'id' | 'created_at'>>) => {
    if (!processor) return;
    await processor.updateTool(id, updates);
    setToolDefinitions(processor.getToolList());
  }, [processor]);

  const handleSpotifyConfigChange = useCallback(async (refreshToken: string) => {
    if (!processor) return;
    clearTokenCache();
    clearLikedSongsCache();
    if (refreshToken) {
      await processor.updateToolProvider('spotify', {
        config: { spotify_refresh_token: refreshToken },
        enabled: true,
      });
    } else {
      // Disconnect: clear the refresh token
      await processor.updateToolProvider('spotify', {
        config: {},
        enabled: false,
      });
    }
    setToolProviders(processor.getToolProviderList());
  }, [processor]);

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
    {spotifyAuthError && (
      <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999, background: '#b91c1c', color: '#fff', padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>{spotifyAuthError}</span>
        <button onClick={() => setSpotifyAuthError(null)} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontSize: '1.2em', lineHeight: 1 }}>×</button>
      </div>
    )}
    <Layout
      controlArea={
        <ControlArea 
          queueStatus={queueStatus} 
          onPauseToggle={handlePauseToggle}
          onMyDataClick={handleMyDataClick}
          onSettingsClick={handleSettingsClick}
          onHelpClick={handleHelpClick}
          onSyncAndExit={human?.settings?.sync ? handleSaveAndExit : undefined}
          isSaving={isSaving}
          onQueueClick={handleQueuePanelOpen}
          pendingReflectionPersonas={personas.filter(p => !p.is_archived && p.has_pending_update).map(p => ({ id: p.id, display_name: p.display_name }))}
          onReflectionClick={handleOpenReflection}
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
          onReflectionClick={handleOpenReflection}
          onShowArchived={handleShowArchivedPersonas}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelectRoom={handleSelectRoom}
          onCreateRoom={() => setShowRoomCreator(true)}
          onArchiveRoom={handleArchiveRoom}
          onEditRoom={handleEditRoom}
          onShowArchivedRooms={() => setShowArchivedRooms(true)}
          customThemes={human?.settings?.custom_themes ?? []}
        />
      }
      centerPanel={
        activeRoomId ? (
          <RoomChatPanel
            ref={roomChatPanelRef}
            activeRoomId={activeRoomId}
            room={activeRoom}
            activeRoomPath={activeRoomPath}
            allRoomMessages={roomMessages}
            personas={personas}
            inputValue={roomInputValue}
            onInputChange={setRoomInputValue}
            onSubmitHumanMessage={handleSubmitHumanRoomMessage}
            onActivateRoom={handleActivateRoom}
            onSelectCYPBranch={handleSelectCYPBranch}
             onRecallMessage={handleRecallHumanRoomMessage}
             isProcessing={processingRoomId === activeRoomId}
             isActivating={roomActivating}
              onCapture={activeRoomId ? () => setShowCaptureModal(true) : undefined}
              onShowOverview={activeRoomId ? () => handleShowRoomOverview(activeRoomId) : undefined}
              onKnowledgeSearch={activeRoomId ? () => setShowKnowledgeModal(true) : undefined}
          />
        ) : (
          <ChatPanel
            key={activePersonaId ?? ''}
            ref={chatPanelRef}
            activePersonaId={activePersonaId}
            activePersonaDisplayName={personas.find(p => p.id === activePersonaId)?.display_name ?? null}
            messages={messages}
            inputValue={inputValue}
            personaTheme={activePersonaEntity?.preferred_theme}
            customThemes={human?.settings?.custom_themes ?? []}
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
             onImageGenerate={handleImageGenerate}
             messageImages={messageImages}
             generatingImageFor={generatingImageFor}
             imageErrors={imageErrors}
             onImageClick={handleImageClick}
             onImagePromptClick={handleImagePromptClick}
              onCapture={activePersonaId ? () => setShowCaptureModal(true) : undefined}
              onKnowledgeSearch={activePersonaId ? () => setShowKnowledgeModal(true) : undefined}
          />
        )
      }
    />
    <HelpModal isOpen={showHelp} onClose={() => setShowHelp(false)} />
    <QueuePanel
      isOpen={showQueuePanel}
      pendingItems={queuePanelItems.pending}
      dlqItems={queuePanelItems.dlq}
      personas={personas}
      accounts={human?.settings?.accounts ?? []}
      onClose={handleQueuePanelClose}
      onUpdateItems={handleQueueItemsUpdate}
      onDeleteItems={handleQueueItemsDelete}
    />
    
    {human && (
      <>
        <SettingsModal
          isOpen={showSettingsModal}
          onClose={() => setShowSettingsModal(false)}
          settings={{
            name_display: human.settings?.name_display,
            ceremony_time: human.settings?.ceremony?.time ?? "09:00",
            conversation_model: human.settings?.conversation_model,
            extraction_model: human.settings?.extraction_model,
            oneshot_model: human.settings?.oneshot_model,
            rewrite_model: human.settings?.rewrite_model,
            accounts: human.settings?.accounts,
            sync: human.settings?.sync,
            default_heartbeat_ms: human.settings?.default_heartbeat_ms,
            default_context_window_ms: human.settings?.default_context_window_ms,
            message_min_count: human.settings?.message_min_count,
            message_max_age_days: human.settings?.message_max_age_days,
            event_window_hours: human.settings?.ceremony?.event_window_hours,
          }}
          onUpdate={handleHumanUpdate}
          onDownloadBackup={handleDownloadBackup}
          processor={processor}
          onUploadBackup={handleUploadBackup}
          toolProviders={toolProviders}
          toolDefinitions={toolDefinitions}
          onToolProviderUpdate={handleToolProviderUpdate}
          onToolProviderRemove={handleToolProviderRemove}
          onToolUpdate={handleToolUpdate}
          onSpotifyConfigChange={handleSpotifyConfigChange}
          activeTheme={human.settings?.active_theme}
          customThemes={human.settings?.custom_themes ?? []}
          onThemeChange={(id) => handleHumanUpdate({ active_theme: id })}
          onCustomThemeUpsert={(theme) => handleHumanUpdate({
            custom_themes: [...(human.settings?.custom_themes ?? []).filter(t => t.id !== theme.id), theme],
            active_theme: theme.id,
          })}
          onCustomThemeRemove={(id) => handleHumanUpdate({ custom_themes: (human.settings?.custom_themes ?? []).filter(t => t.id !== id) })}
        />

        <HumanEditor
          isOpen={showHumanEditor}
          onClose={() => setShowHumanEditor(false)}
          human={{
            id: "human",
            name_display: human.settings?.name_display,
            facts: human.facts,
            topics: human.topics,
            people: human.people,
            quotes: quotes,
            settings: { rewrite_model: human.settings?.rewrite_model },
          }}
          onFactSave={handleFactSave}
          onFactDelete={handleFactDelete}
          onTopicSave={handleTopicSave}
          onTopicDelete={handleTopicDelete}
          onPersonSave={handlePersonSave}
          onPersonDelete={handlePersonDelete}
          onQuoteSave={handleQuoteUpdate}
          onQuoteDelete={handleQuoteDelete}
          onQueueDedupe={async (type, ids) => {
            if (!processor) return;
            await processor.queueUserDedup(type, ids);
          }}
          resolvePersonaName={(id) => {
            if (id === 'ei') return 'Ei';
            return personas.find(p => p.id === id)?.display_name ?? id;
          }}
          personas={personas.map(p => ({ id: p.id, display_name: p.display_name }))}
          onCreatePersona={(person) => {
            setPersonaCreatorInitialData({ mode: 'create', name: person.name, description: person.description, relationship: person.relationship, linkedPersonId: person.id });
            setShowPersonaCreator(true);
          }}
          onUpdatePersona={(person) => {
            setPersonaCreatorInitialData({ mode: 'update', description: person.description, relationship: person.relationship, linkedPersonId: person.id });
            setShowPersonaCreator(true);
          }}
          availableGroups={availableGroups}
          allDocuments={human?.settings?.document?.processed_documents ?? {}}
          pendingDocuments={queueStatus?.pending_documents ?? []}
          extractingDocuments={queueStatus?.extracting_documents ?? []}
          onImport={handleImportDocument}
          onUnsource={handleUnsource}
          generatingDocuments={queueStatus?.generating_documents ?? []}
          onGenerate={handleGenerateDocument}
          onDownloadGenerated={handleDownloadGenerated}
          onReRunDocument={handleReRunDocument}
          checkGenerationModel={() => processor?.checkGenerationModel() ?? { model: 'unknown', isRewriteModel: false }}
          slackAuth={(() => {
            const workspaces = human?.settings?.slack?.workspaces ?? {};
            const connected = Object.values(workspaces).find(ws => ws.auth);
            if (!connected) return undefined;
            const name = connected.auth.type === 'oauth' ? connected.auth.workspace_name :
                         connected.auth.type === 'browser' ? connected.auth.workspace_name : undefined;
            return { isConnected: true, workspace_name: name };
          })()}
          onSlackConnect={() => { window.location.href = `https://slack.com/oauth/v2/authorize?client_id=${SLACK_CLIENT_ID}&scope=&user_scope=${['channels:history','channels:read','groups:history','groups:read','im:history','im:read','mpim:history','mpim:read','users:read','users:read.email'].join(',')}&redirect_uri=${encodeURIComponent(SLACK_WEB_REDIRECT_URI)}`; }}
          onSlackDisconnect={() => {
            if (!processor || !human) return;
            const updated = { ...human.settings?.slack };
            updated.workspaces = {};
            processor.updateHuman({ settings: { ...human.settings, slack: updated } });
          }}
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
        onDeleteMessage={handleDeleteMessage}
        onAiAssist={handleAiAssist}
        toolProviders={toolProviders}
        toolDefinitions={toolDefinitions}
        accounts={human?.settings?.accounts ?? []}
        customThemes={human?.settings?.custom_themes ?? []}
      />
    )}

    <PersonaCreatorModal
      isOpen={showPersonaCreator}
      onClose={() => {
        setShowPersonaCreator(false);
        setPersonaCreatorInitialData(undefined);
      }}
      onCreate={handlePersonaCreate}
      onAiAssist={handleAiAssist}
      toolProviders={toolProviders}
      toolDefinitions={toolDefinitions}
      accounts={human?.settings?.accounts ?? []}
      initialData={personaCreatorInitialData}
      generatePersonaPreview={handleGeneratePersonaPreview}
      onUpdate={personaCreatorInitialData?.mode === 'update' ? handlePersonaUpdateFromPreview : undefined}
      personas={personas.map(p => ({ id: p.id, display_name: p.display_name }))}
    />

    {showReflectionModal && reflectionPersonaId && reflectionPersona?.pending_update && (
      <PersonaReflectionModal
        isOpen={showReflectionModal}
        personaName={reflectionPersona.display_name}
        currentIdentity={{
          long_description: reflectionPersona.long_description ?? '',
          short_description: reflectionPersona.short_description ?? '',
          traits: reflectionPersona.traits,
          topics: reflectionPersona.topics,
        }}
        pendingUpdate={reflectionPersona.pending_update}
        activePersonaId={reflectionPersonaId}
        messages={reflectionMessages}
        inputValue={reflectionInputValue}
        quotes={quotes}
        onInputChange={setReflectionInputValue}
        onSendMessage={handleReflectionSendMessage}
        onMarkMessageRead={handleMarkMessageRead}
        onRecallPending={handleRecallPending}
        onSaveAndApply={handleReflectionSaveAndApply}
        onDismiss={handleReflectionDismiss}
        onClose={handleReflectionClose}
        onPendingUpdateChange={handleReflectionPendingUpdateChange}
      />
    )}

    <ArchivedRoomsModal
      isOpen={showArchivedRooms}
      onClose={() => setShowArchivedRooms(false)}
      archivedRooms={processor ? processor.getRoomList(true).filter(r => r.is_archived) : []}
      personas={personas}
      onUnarchive={handleUnarchiveRoom}
      onDelete={handleDeleteArchivedRoom}
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
         personaName={activePersonaEntity?.display_name || ''}
         humanDisplayName={
           human?.settings?.name_display ||
           human?.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
           "Human"
         }
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

     <TargetedCaptureModal
       isOpen={showCaptureModal}
       items={captureModalItems}
       onCapture={handleTargetedCapture}
       onCaptureAll={handleCaptureAll}
       onClose={() => setShowCaptureModal(false)}
     />

      <KnowledgeSearchModal
        isOpen={showKnowledgeModal}
        onClose={() => setShowKnowledgeModal(false)}
        onSearch={async (query) => {
          if (!processorRef.current) return { facts: [], topics: [], people: [], quotes: [] };
          return processorRef.current.searchHumanData(query);
        }}
      />

    {showImagePreview && currentViewingMessageId && (() => {
      const currentMessage = messages.find(m => m.id === currentViewingMessageId);
      if (!currentMessage) return null;
      
      return (
        <ImagePreviewModal
          message={currentMessage}
          imageUrl={messageImages[currentViewingMessageId]?.blobUrl || null}
          generationResult={currentImageResult}
          isGenerating={generatingImageFor === currentViewingMessageId}
          onPromptUpdate={handlePromptUpdate}
          onRegenerate={handleImageRegenerate}
          onClose={handleImagePreviewClose}
          onRemove={handleImageRemove}
          error={imageGenerationError}
        />
      );
    })()}

    {showMessageSelector && activePersonaId && (
      <MessageSelectorModal
        isOpen={showMessageSelector}
        messages={messages}
        personaName={personas.find(p => p.id === activePersonaId)?.display_name || 'Persona'}
        onClose={() => setShowMessageSelector(false)}
        onSubmit={async (selectedMessageIds, instructions) => {
          setShowMessageSelector(false);
          await handleSynthesisRequest(selectedMessageIds, instructions);
        }}
      />
    )}

    <RoomCreatorModal
      isOpen={showRoomCreator}
      onClose={() => setShowRoomCreator(false)}
      onCreate={handleCreateRoom}
      personas={personas.filter(p => !p.is_archived)}
    />
    {editingRoom && (
      <RoomEditorModal
        isOpen={showRoomEditor}
        onClose={() => { setShowRoomEditor(false); setEditingRoom(null); }}
        onSave={handleSaveRoomEdits}
        room={editingRoom}
        personas={personas.filter(p => !p.is_archived)}
      />
    )}
    {showRoomOverview && overviewRoomId && activeRoom && overviewRoomId === activeRoom.id && (
      <RoomOverviewOverlay
        isOpen={showRoomOverview}
        onClose={() => { setShowRoomOverview(false); setOverviewRoomId(null); }}
        room={activeRoom}
      >
        {activeRoom.mode === 'choose_your_path' ? (
          <CYPTreeView
            allMessages={roomMessages}
            activeNodeId={activeRoom.active_node_id ?? ''}
            activeRoomPath={activeRoomPath}
            personas={personas}
            onSelectBranch={handleSelectCYPBranch}
            onClose={() => { setShowRoomOverview(false); setOverviewRoomId(null); }}
            pendingQueueItems={
              (processorRef.current?.getQueueActiveItems() ?? [])
                .filter(item => item.next_step === LLMNextStep.HandleRoomResponse)
                .map(item => ({
                  parentMessageId: item.data.parentMessageId as string,
                  personaId: item.data.personaId as string,
                }))
            }
            roomPersonaIds={activeRoom.persona_ids}
          />
        ) : activeRoom.mode === 'free_for_all' ? (
          <FFAContextView
            room={activeRoom}
            allMessages={roomMessages}
            personas={personas}
            humanName={
              human?.settings?.name_display ||
              human?.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
              "You"
            }
            defaultContextWindowMs={human?.settings?.default_context_window_ms}
            onUpdateRoom={(updates) => processorRef.current?.updateRoom(activeRoom.id, updates) ?? Promise.resolve()}
            onDeleteMessages={(ids) => handleDeleteRoomMessages(activeRoom.id, ids)}
            onSetMessageContextStatus={(msgId, status) =>
              handleSetRoomMessageContextStatus(activeRoom.id, msgId, status)
            }
          />
        ) : activeRoom.mode === 'messages_against_persona' ? (
          <MAPScoreView
            room={activeRoom}
            allMessages={roomMessages}
            personas={personas}
            humanName={
              human?.settings?.name_display ||
              human?.facts?.find(f => f.name === "Nickname/Preferred Name")?.description ||
              "You"
            }
            judgePersonaId={activeRoom.judge_persona_id ?? ''}
            onSetMessageContextStatus={(msgId, status) =>
              handleSetRoomMessageContextStatus(activeRoom.id, msgId, status)
            }
          />
        ) : null}
      </RoomOverviewOverlay>
    )}
    </>
    );
}

export default App;


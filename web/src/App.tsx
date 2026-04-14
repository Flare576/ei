import { useState, useEffect, useCallback, useRef } from "react";
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
  Fact,
  PersonaTrait,
  Topic,
  PersonaTopic,
  Person,
  Quote,
  ProviderAccount,
  StateConflictData,
  StateConflictResolution,
  ToolProvider,
  ToolDefinition,
  RoomSummary,
  RoomEntity,
  RoomMessage,
  RoomCreationInput,
  LLMRequest,
  } from "../../src/core/types";
import { decodeTheme, themeToStyleString, isBuiltInTheme } from '../../src/core/utils/theme-codec.js';
import type { ThemeDefinition } from '../../src/core/types/entities.js';
import { ContextStatus, LLMNextStep, RoomMode } from "../../src/core/types";
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
import { HumanEditor, PersonaEditor, PersonaCreatorModal, RoomCreatorModal, RoomEditorModal, ArchivedPersonasModal, ArchivedRoomsModal } from "./components/EntityEditor";
import { RoomOverviewOverlay, CYPTreeView } from "./components/Rooms";
import { QuoteCaptureModal, QuoteManagementModal } from "./components/Quote";
import { SettingsModal } from "./components/Settings";
import { MessageSelectorModal } from "./components/Modals/MessageSelectorModal";
import { ConflictResolutionModal } from "./components/Sync/ConflictResolutionModal";
import { Onboarding } from "./components/Onboarding";
import { QueuePanel } from "./components/Queue/QueuePanel";
import { useKeyboardNavigation } from "./hooks/useKeyboardNavigation";
import { generateImage, type GenerationResult } from "./comfyui";
import { exchangeCode } from '../../src/core/tools/builtin/pkce.js';
import { SPOTIFY_CLIENT_ID, SPOTIFY_WEB_REDIRECT_URI, clearTokenCache } from '../../src/core/tools/builtin/spotify-auth.js';
import { clearLikedSongsCache } from '../../src/core/tools/builtin/spotify-liked-songs.js';

import "./styles/index.css";
import "./styles/entity-editor.css";
import "./styles/onboarding.css";
import "./styles/queue-panel.css";
import "./styles/theme-editor.css";

function getContent(msg: { content?: string; verbal_response?: string; action_response?: string }): string {
  if (msg.content) return msg.content;
  const parts: string[] = [];
  if (msg.action_response) parts.push(`_${msg.action_response}_`);
  if (msg.verbal_response) parts.push(msg.verbal_response);
  return parts.join('\n\n');
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

async function initializeStorage(): Promise<Storage> {
  const indexedStorage = new IndexedDBStorage();

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
   const [showConflictModal, setShowConflictModal] = useState(false);
   const [conflictData, setConflictData] = useState<{ localTimestamp: Date; remoteTimestamp: Date } | null>(null);
   const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showQueuePanel, setShowQueuePanel] = useState(false);
  const [queuePanelItems, setQueuePanelItems] = useState<{ pending: LLMRequest[]; dlq: LLMRequest[] }>({ pending: [], dlq: [] });
  const [queueWasPaused, setQueueWasPaused] = useState(false);
  const [spotifyAuthError, setSpotifyAuthError] = useState<string | null>(null);
  const [showImagePreview, setShowImagePreview] = useState(false);
  const [currentImageResult, setCurrentImageResult] = useState<GenerationResult | null>(null);
  const [imageGenerationError, setImageGenerationError] = useState<string | null>(null);
  const [messageImages, setMessageImages] = useState<Record<string, {blobUrl: string, result: GenerationResult}>>({});
  const [generatingImageFor, setGeneratingImageFor] = useState<string | null>(null);
  const [imageErrors, setImageErrors] = useState<Record<string, string>>({});
  const [currentViewingMessageId, setCurrentViewingMessageId] = useState<string | null>(null);
  const [showMessageSelector, setShowMessageSelector] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [activeRoom, setActiveRoom] = useState<RoomEntity | null>(null);
  const [roomMessages, setRoomMessages] = useState<RoomMessage[]>([]);
  const [activeRoomPath, setActiveRoomPath] = useState<RoomMessage[]>([]);
  const [processingRoomId, setProcessingRoomId] = useState<string | null>(null);
  const [roomActivating, setRoomActivating] = useState(false);
  const refreshRoomActivating = useCallback((roomId: string) => {
    const pending = processorRef.current?.getQueueActiveItems().some(
      item => item.next_step === LLMNextStep.HandleRoomJudge &&
              (item.data.roomId as string) === roomId
    ) ?? false;
    setRoomActivating(pending);
  }, []);
  const [showRoomCreator, setShowRoomCreator] = useState(false);
  const [showRoomEditor, setShowRoomEditor] = useState(false);
  const [editingRoom, setEditingRoom] = useState<RoomEntity | null>(null);
  const [showRoomOverview, setShowRoomOverview] = useState(false);
  const [overviewRoomId, setOverviewRoomId] = useState<string | null>(null);
  const [roomInputValue, setRoomInputValue] = useState("");

  const personaPanelRef = useRef<PersonaPanelHandle | null>(null);
  const chatPanelRef = useRef<ChatPanelHandle | null>(null);
  const roomChatPanelRef = useRef<RoomChatPanelHandle | null>(null);
  const activeRoomIdRef = useRef<string | null>(null);
  const oneShotResolvers = useRef<Map<string, (result: string) => void>>(new Map());
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

  // Cleanup Blob URLs when component unmounts
  useEffect(() => {
    return () => {
      Object.values(messageImages).forEach(imageData => URL.revokeObjectURL(imageData.blobUrl));
    };
  }, [messageImages]);

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
    activeRoomIdRef.current = activeRoomId;
  }, [activeRoomId]);

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

  // Detect OAuth callbacks via /callback/:provider path
  useEffect(() => {
    const path = window.location.pathname;
    const providerMatch = path.match(/^\/callback\/([^/]+)/);
    if (!providerMatch) return;

    const provider = providerMatch[1];
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    if (!code) return;

    if (provider === 'spotify') {
      const verifier = sessionStorage.getItem('spotify_pkce_verifier');
      if (!verifier) {
        window.history.replaceState({}, '', '/');
        setSpotifyAuthError('Spotify auth failed: session expired or opened in a new tab. Please try connecting again.');
        return;
      }
      sessionStorage.removeItem('spotify_pkce_verifier');

      exchangeCode({
        code,
        verifier,
        redirectUri: SPOTIFY_WEB_REDIRECT_URI,
        clientId: SPOTIFY_CLIENT_ID,
      }).then((tokens) => {
        // MED-1: clean URL only after successful token exchange
        window.history.replaceState({}, '', '/');
        clearTokenCache();
        clearLikedSongsCache();
        let elapsed = 0;
        const MAX_WAIT_MS = 10_000;
        const checkReady = setInterval(() => {
          elapsed += 100;
          if (processorRef.current) {
            clearInterval(checkReady);
            processorRef.current.updateToolProvider('spotify', {
              config: { spotify_refresh_token: tokens.refresh_token },
              enabled: true,
            });
          } else if (elapsed >= MAX_WAIT_MS) {
            clearInterval(checkReady);
            console.error('[Spotify] Processor never initialized; token not stored.');
          }
        }, 100);
      }).catch((err) => {
        window.history.replaceState({}, '', '/');
        console.error('[Spotify] Token exchange failed:', err);
        setSpotifyAuthError(`Spotify auth failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
    // Future providers: add `else if (provider === 'github') { ... }` here
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const handleQueuePanelOpen = useCallback(async () => {
    if (!processorRef.current) return;
    const status = await processorRef.current.getQueueStatus();
    setQueueWasPaused(status.state === "paused");
    if (status.state !== "paused") {
      await processorRef.current.abortCurrentOperation();
    }
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    setShowQueuePanel(true);
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, []);

  const handleQueuePanelClose = useCallback(async () => {
    setShowQueuePanel(false);
    if (!processorRef.current) return;
    if (!queueWasPaused) {
      await processorRef.current.resumeQueue();
    }
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [queueWasPaused]);

  const handleQueueItemsUpdate = useCallback(async (ids: string[], model: string) => {
    if (!processorRef.current) return;
    for (const id of ids) {
      const allItems = [...queuePanelItems.pending, ...queuePanelItems.dlq];
      const item = allItems.find(i => i.id === id);
      const updates: Partial<LLMRequest> = {
        model,
        attempts: 0,
        retry_after: undefined,
      };
      if (item?.state === "dlq") {
        updates.state = "pending";
      }
      processorRef.current.updateQueueItem(id, updates);
    }
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, [queuePanelItems]);

  const handleQueueItemsDelete = useCallback((ids: string[]) => {
    if (!processorRef.current) return;
    processorRef.current.deleteQueueItems(ids);
    const pending = processorRef.current.getQueueActiveItems();
    const dlq = processorRef.current.getDLQItems();
    setQueuePanelItems({ pending, dlq });
    processorRef.current.getQueueStatus().then(setQueueStatus);
  }, []);

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


  const handleImageGenerate = useCallback(async (message: Message) => {
    // Extract prompt from message
    const prompt = getContent(message);
    
    if (!prompt.trim()) {
      alert("No prompt text found in this message");
      return;
    }
    
    setGeneratingImageFor(message.id);
    setImageErrors(prev => {
      const updated = { ...prev };
      delete updated[message.id];
      return updated;
    });
    
    // If modal is open for this message, clear modal error state
    if (currentViewingMessageId === message.id) {
      setImageGenerationError(null);
    }
    
    try {
      const result = await generateImage(prompt, processorRef.current?.getStateManager());
      const blobUrl = URL.createObjectURL(result.image);
      setMessageImages(prev => ({ ...prev, [message.id]: { blobUrl, result } }));
      
      // If modal is open for this message, update modal result state
      if (currentViewingMessageId === message.id) {
        setCurrentImageResult(result);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      setImageErrors(prev => ({ ...prev, [message.id]: errorMessage }));
      
      // If modal is open for this message, update modal error state
      if (currentViewingMessageId === message.id) {
        setImageGenerationError(errorMessage);
      }
      console.error("Image generation failed:", error);
    } finally {
      setGeneratingImageFor(null);
    }
  }, [currentViewingMessageId]);
  
  const handleImageRegenerate = useCallback(async () => {
    if (!currentViewingMessageId) return;
    
    // Find the message being viewed
    const message = messages.find(m => m.id === currentViewingMessageId);
    if (!message) return;
    
    // Revoke old Blob URL before regenerating
    const oldImageData = messageImages[currentViewingMessageId];
    if (oldImageData) {
      URL.revokeObjectURL(oldImageData.blobUrl);
    }
    
    // Regenerate using the same flow as initial generation
    await handleImageGenerate(message);
  }, [currentViewingMessageId, messages, messageImages, handleImageGenerate]);
  
  const handleImagePreviewClose = useCallback(() => {
    setShowImagePreview(false);
    setCurrentImageResult(null);
    setImageGenerationError(null);
    setCurrentViewingMessageId(null);
  }, []);
  
  const handleImageRemove = useCallback(() => {
    if (!currentViewingMessageId) return;
    
    // Revoke the blob URL to free memory
    const imageData = messageImages[currentViewingMessageId];
    if (imageData?.blobUrl) {
      URL.revokeObjectURL(imageData.blobUrl);
    }
    
    // Remove from messageImages state
    setMessageImages(prev => {
      const newImages = { ...prev };
      delete newImages[currentViewingMessageId];
      return newImages;
    });
    
    // Clear any error for this message
    setImageErrors(prev => {
      const newErrors = { ...prev };
      delete newErrors[currentViewingMessageId];
      return newErrors;
    });
    
    // Close the modal
    handleImagePreviewClose();
  }, [currentViewingMessageId, messageImages, handleImagePreviewClose]);
  
  const handleImageClick = useCallback((messageId: string) => {
    const message = messages.find(m => m.id === messageId);
    const imageData = messageImages[messageId];
    
    // For synthesis messages, always open modal (they have editable prompts)
    if (message?._synthesis) {
      setImageGenerationError(null);
      setCurrentViewingMessageId(messageId);
      setShowImagePreview(true);
      // Set result if available (for synthesis messages with generated images)
      if (imageData) {
        setCurrentImageResult(imageData.result);
      }
      return;
    }
    
    if (!imageData) {
      // If no image, might be error - show error in modal
      const error = imageErrors[messageId];
      if (error) {
        setImageGenerationError(error);
        setCurrentViewingMessageId(messageId);
        setShowImagePreview(true);
      }
      return;
    }
    
    // Open modal with generation result for normal messages
    setImageGenerationError(null);
    setCurrentImageResult(imageData.result);
    setCurrentViewingMessageId(messageId);
    setShowImagePreview(true);
  }, [messageImages, imageErrors, messages]);

  const handlePromptUpdate = useCallback((newPrompt: string) => {
    if (!currentViewingMessageId || !activePersonaId) return;
    
    processor?.updateMessage(activePersonaId, currentViewingMessageId, {
      verbal_response: newPrompt
    });
    
    // Update local messages state to reflect change immediately
    setMessages(prev => prev.map(msg => 
      msg.id === currentViewingMessageId 
        ? { ...msg, verbal_response: newPrompt }
        : msg
    ));
  }, [currentViewingMessageId, activePersonaId, processor]);


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

  const handleSelectRoom = useCallback(async (roomId: string) => {
    if (processor && activeRoomId && activeRoomId !== roomId) {
      await processor.markAllRoomMessagesRead(activeRoomId);
    }
    switchPersona(null);
    setActiveRoomId(roomId);
    refreshRoomActivating(roomId);
    if (processor) {
      const room = processor.getRoom(roomId);
      setActiveRoom(room ?? null);
      setRoomMessages(processor.getRoomMessages(roomId));
      setActiveRoomPath(processor.getRoomActivePath(roomId));
      processor.markAllRoomMessagesRead(roomId).then(() => {
        setRooms(processor.getRoomList());
      });
    }
  }, [processor, activeRoomId]);

  const handleCreateRoom = useCallback(async (input: RoomCreationInput) => {
    if (!processor) return;
    const roomId = await processor.createRoom(input);
    setRooms(processor.getRoomList());
    setShowRoomCreator(false);
    const room = processor.getRoom(roomId);
    setActiveRoom(room ?? null);
    switchPersona(null);
    setActiveRoomId(roomId);
    setRoomMessages(processor.getRoomMessages(roomId));
    setActiveRoomPath(processor.getRoomActivePath(roomId));
  }, [processor]);

  const handleArchiveRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.archiveRoom(roomId);
    setRooms(processor.getRoomList());
    if (activeRoomId === roomId) {
      setActiveRoomId(null);
      setActiveRoom(null);
      setRoomMessages([]);
      setActiveRoomPath([]);
    }
  }, [processor, activeRoomId]);

  const handleEditRoom = useCallback((roomId: string) => {
    if (!processor) return;
    const room = processor.getRoom(roomId);
    if (room) {
      setEditingRoom(room);
      setShowRoomEditor(true);
    }
  }, [processor]);

  const handleShowRoomOverview = useCallback((roomId: string) => {
    setOverviewRoomId(roomId);
    setShowRoomOverview(true);
  }, []);

  const handleSaveRoomEdits = useCallback(async (roomId: string, updates: Partial<RoomEntity>) => {
    if (!processor) return;
    await processor.updateRoom(roomId, updates);
    setRooms(processor.getRoomList());
    setShowRoomEditor(false);
    setEditingRoom(null);
  }, [processor]);

  const handleUnarchiveRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.unarchiveRoom(roomId);
    setRooms(processor.getRoomList());
  }, [processor]);

  const handleDeleteArchivedRoom = useCallback(async (roomId: string) => {
    if (!processor) return;
    await processor.deleteRoom(roomId);
    setRooms(processor.getRoomList());
  }, [processor]);

  const handleSubmitHumanRoomMessage = useCallback(async (content: string | null, silenceReason?: string) => {
    if (!activeRoomId || !processorRef.current) return;
    const currentRoom = processorRef.current.getRoom(activeRoomId);
    if (!currentRoom) return;
    if (currentRoom.mode === RoomMode.FreeForAll) {
      await processorRef.current.sendFfaMessage(activeRoomId, content, silenceReason);
    } else {
      processorRef.current.submitHumanRoomMessage(activeRoomId, content, silenceReason);
    }
    setRoomInputValue("");
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId]);

  const handleActivateRoom = useCallback(async () => {
    if (!activeRoomId || !processorRef.current) return;
    await processorRef.current.activateRoom(activeRoomId);
    refreshRoomActivating(activeRoomId);
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId]);

  const handleRecallHumanRoomMessage = useCallback(() => {
    if (!activeRoomId || !processorRef.current) return;
    const allMsgs = processorRef.current.getRoomMessages(activeRoomId);
    const humanMsg = allMsgs.find(
      m => m.role === "human" && m.parent_id === activeRoom?.active_node_id
    );
    if (humanMsg) {
      const childIds = new Set(allMsgs.filter(m => m.parent_id === humanMsg.id).map(m => m.id));
      const hasGrandchildren = allMsgs.some(m => m.parent_id && childIds.has(m.parent_id));
      if (hasGrandchildren) return;
    }
    const recalledText = humanMsg?.content ?? humanMsg?.verbal_response ?? humanMsg?.silence_reason ?? "";
    const ok = processorRef.current.recallHumanRoomMessage(activeRoomId);
    if (ok) {
      setRoomInputValue(recalledText);
      setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    }
  }, [activeRoomId, activeRoom]);

  const handleSelectCYPBranch = useCallback(async (messageId: string) => {
    if (!activeRoomId || !processorRef.current) return;
    await processorRef.current.selectCYPBranch(activeRoomId, messageId);
    const updatedRoom = processorRef.current.getRoom(activeRoomId);
    if (updatedRoom) setActiveRoom(updatedRoom);
    setRoomMessages(processorRef.current.getRoomMessages(activeRoomId));
    setActiveRoomPath(processorRef.current.getRoomActivePath(activeRoomId));
  }, [activeRoomId]);

  const handleHumanUpdate = useCallback(async (updates: Record<string, unknown>) => {
    if (!processor) return;
    const { default_model, oneshot_model, rewrite_model, queue_paused, name_display, time_mode, accounts, sync, ceremony_time, default_heartbeat_ms, default_context_window_hours, message_min_count, message_max_age_days, event_window_hours, active_theme, custom_themes, ...rest } = updates;
    
    const settingsUpdates: Record<string, unknown> = {};
    if (default_model !== undefined) settingsUpdates.default_model = default_model;
    if (oneshot_model !== undefined) settingsUpdates.oneshot_model = oneshot_model;
    if (rewrite_model !== undefined) settingsUpdates.rewrite_model = rewrite_model;
    if (queue_paused !== undefined) settingsUpdates.queue_paused = queue_paused;
    if (name_display !== undefined) settingsUpdates.name_display = name_display;
    if (time_mode !== undefined) settingsUpdates.time_mode = time_mode;
    if (default_heartbeat_ms !== undefined) settingsUpdates.default_heartbeat_ms = default_heartbeat_ms;
    if (default_context_window_hours !== undefined) settingsUpdates.default_context_window_hours = default_context_window_hours;
    if (message_min_count !== undefined) settingsUpdates.message_min_count = message_min_count;
    if (message_max_age_days !== undefined) settingsUpdates.message_max_age_days = message_max_age_days;
    if (accounts !== undefined) settingsUpdates.accounts = accounts;
    if (sync !== undefined || updates.hasOwnProperty('sync')) settingsUpdates.sync = sync;
    if (active_theme !== undefined) settingsUpdates.active_theme = active_theme;
    if (custom_themes !== undefined) settingsUpdates.custom_themes = custom_themes;
    if (ceremony_time !== undefined) {
      settingsUpdates.ceremony = { ...human?.settings?.ceremony, time: ceremony_time as string };
    }
    if (event_window_hours !== undefined) {
      settingsUpdates.ceremony = { ...human?.settings?.ceremony, ...settingsUpdates.ceremony as object, event_window_hours: event_window_hours as number | undefined };
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
      
      // Call OneShot for synthesis
      const result = await handleAiAssist(SYNTHESIS_SYSTEM_PROMPT, userPrompt);
      
      // Parse JSON response
      let parsed: { image_prompt: string; explanation?: string; negative_prompt?: string };
      try {
        parsed = JSON.parse(result);
      } catch (e) {
        console.error('Failed to parse synthesis JSON:', result);
        alert('Failed to generate image prompt. Please try again.');
        return;
      }
      
      if (!parsed.image_prompt) {
        console.error('No image_prompt in synthesis result:', parsed);
        alert('Failed to generate image prompt. Please try again.');
        return;
      }
      
      // Create synthesis message
      const synthesisMessage: Message = {
        id: crypto.randomUUID(),
        role: 'human',
        verbal_response: parsed.image_prompt,
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
      setGeneratingImageFor(synthesisMessage.id);
      handleImageGenerate(synthesisMessage);
      
    } catch (error) {
      console.error('Synthesis request failed:', error);
      alert('Failed to generate image prompt. Please try again.');
    }
  }, [processor, activePersonaId, messages, handleAiAssist, handleImageGenerate]);


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
          const firstEnabled = accounts.find(a => a.enabled && a.type === 'llm');
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
             onCapture={activeRoomId ? () => processorRef.current?.captureRoom(activeRoomId) : undefined}
             onShowOverview={activeRoomId ? () => handleShowRoomOverview(activeRoomId) : undefined}
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
              onCapture={activePersonaId ? () => processorRef.current?.capturePersona(activePersonaId) : undefined}
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
            time_mode: human.settings?.time_mode,
            ceremony_time: human.settings?.ceremony?.time ?? "09:00",
            default_model: human.settings?.default_model,
            oneshot_model: human.settings?.oneshot_model,
            rewrite_model: human.settings?.rewrite_model,
            accounts: human.settings?.accounts,
            sync: human.settings?.sync,
            default_heartbeat_ms: human.settings?.default_heartbeat_ms,
            default_context_window_hours: human.settings?.default_context_window_hours,
            message_min_count: human.settings?.message_min_count,
            message_max_age_days: human.settings?.message_max_age_days,
            event_window_hours: human.settings?.ceremony?.event_window_hours,
          }}
          onUpdate={handleHumanUpdate}
          onDownloadBackup={handleDownloadBackup}
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
        ) : (
          <div className="ei-room-overview__placeholder">Coming soon…</div>
        )}
      </RoomOverviewOverlay>
    )}
    </>
    );
}

export default App;


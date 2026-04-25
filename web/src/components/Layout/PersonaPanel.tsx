import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback, useMemo } from "react";
import type { PersonaSummary, RoomSummary } from "../../../../src/core/types";
import type { ThemeDefinition } from "../../../../src/core/types/entities.js";
import { RoomMode } from "../../../../src/core/types";
import { PersonaAvatar } from "../Avatar";
import { decodeTheme } from "../../../../src/core/utils/theme-codec.js";

interface PersonaPanelProps {
  personas: PersonaSummary[];
  activePersonaId: string | null;
  processingPersonaId: string | null;
  onSelectPersona: (personaId: string) => void;
  onCreatePersona: () => void;
  onPausePersona?: (personaId: string, pauseUntil?: string) => void;
  onArchivePersona?: (personaId: string) => void;
  onDeletePersona?: (personaId: string, deleteData: boolean) => void;
  onEditPersona?: (personaId: string) => void;
  onReflectionClick?: (personaId: string) => void;
  onShowArchived?: () => void;
  rooms?: RoomSummary[];
  activeRoomId?: string | null;
  onSelectRoom?: (roomId: string) => void;
  onCreateRoom?: () => void;
  onArchiveRoom?: (roomId: string) => void;
  onEditRoom?: (roomId: string) => void;
  onShowArchivedRooms?: () => void;
  customThemes?: ThemeDefinition[];
}

export interface PersonaPanelHandle {
  focusPanel: () => void;
}

const BUILTIN_ACCENT_COLORS: Record<string, string> = {
  'default': '#007bff',
  'dark': '#4dabf7',
  'coder': '#98971a',
  'depressing': '#81a1c1',
  'cotton-candy': '#ea76cb',
  'crimuh': '#c41e3a',
  'spoopy': '#fab387',
  'lovey-dovey': '#f5c2e7',
  'lucky': '#b8bb26',
};

const MODE_BADGE_LABEL: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: "CYP",
  [RoomMode.FreeForAll]: "FFA",
  [RoomMode.MessagesAgainstPersona]: "MAP",
};

const MODE_BADGE_CLASS: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: "ei-room-pill__mode-badge--cyp",
  [RoomMode.FreeForAll]: "ei-room-pill__mode-badge--ffa",
  [RoomMode.MessagesAgainstPersona]: "ei-room-pill__mode-badge--map",
};

export const PersonaPanel = forwardRef<PersonaPanelHandle, PersonaPanelProps>(function PersonaPanel({
  personas,
  activePersonaId,
  processingPersonaId,
  onSelectPersona,
  onCreatePersona,
  onPausePersona,
  onArchivePersona,
  onDeletePersona,
  onEditPersona,
  onReflectionClick,
  onShowArchived,
  rooms = [],
  activeRoomId = null,
  onSelectRoom,
  onCreateRoom,
  onArchiveRoom,
  onEditRoom,
  onShowArchivedRooms,
  customThemes = [],
}, ref) {
  const [activeTab, setActiveTab] = useState<"personas" | "rooms">("personas");
  const [expanded, setExpanded] = useState(false);

  const accentColors = useMemo(() => {
    const map: Record<string, string> = { ...BUILTIN_ACCENT_COLORS };
    for (const t of customThemes) {
      const tokens = decodeTheme(t.encoded);
      if (tokens?.['--ei-accent']) map[t.id] = tokens['--ei-accent'];
    }
    return map;
  }, [customThemes]);
  const [hoveredPersonaId, setHoveredPersonaId] = useState<string | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [showPauseOptions, setShowPauseOptions] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleteWithData, setDeleteWithData] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const pauseOptionsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusPanel: () => {
      if (activeTab === "rooms") {
        const pills = listRef.current?.querySelectorAll(".ei-room-pill");
        const index = Math.max(0, rooms.findIndex(r => r.id === activeRoomId));
        const pill = pills?.[index] as HTMLElement | undefined;
        pill?.focus();
      } else {
        const currentIndex = personas.findIndex(p => p.id === activePersonaId);
        const index = currentIndex >= 0 ? currentIndex : 0;
        setFocusedIndex(index);
        const pills = listRef.current?.querySelectorAll(".ei-persona-pill");
        const pill = pills?.[index] as HTMLElement | undefined;
        pill?.focus();
      }
    },
  }), [activeTab, rooms, activeRoomId, personas, activePersonaId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (pauseOptionsRef.current && !pauseOptionsRef.current.contains(e.target as Node)) {
        setShowPauseOptions(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const getStatusClass = (persona: PersonaSummary) => {
    if (persona.is_paused) return "paused";
    if (processingPersonaId === persona.id) return "thinking";
    if (persona.unread_count > 0) return "unread";
    return "";
  };

  const handlePause = (personaId: string, hours?: number) => {
    if (!onPausePersona) return;
    const pauseUntil = hours 
      ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      : undefined;
    onPausePersona(personaId, pauseUntil);
    setShowPauseOptions(null);
  };

  const handleArchive = (personaId: string, displayName: string) => {
    if (!onArchivePersona) return;
    onArchivePersona(personaId);
    setToast(`${displayName} archived. View archived personas in settings.`);
  };

  const handleDelete = (personaId: string) => {
    if (!onDeletePersona) return;
    onDeletePersona(personaId, deleteWithData);
    setShowDeleteConfirm(null);
    setDeleteWithData(false);
  };

  const handleControlClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

  const handleRoomPillKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.min(index + 1, rooms.length - 1);
      const pills = listRef.current?.querySelectorAll(".ei-room-pill");
      (pills?.[newIndex] as HTMLElement)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.max(index - 1, 0);
      const pills = listRef.current?.querySelectorAll(".ei-room-pill");
      (pills?.[newIndex] as HTMLElement)?.focus();
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      setActiveTab("personas");
      setTimeout(() => {
        const destIndex = Math.max(0, personas.findIndex(p => p.id === activePersonaId));
        const pills = listRef.current?.querySelectorAll(".ei-persona-pill");
        (pills?.[destIndex] as HTMLElement)?.focus();
      }, 0);
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectRoom?.(rooms[index].id);
    }
  }, [rooms, onSelectRoom, personas, activePersonaId, setActiveTab]);

  const handlePillKeyDown = useCallback((e: React.KeyboardEvent, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIndex = Math.min(index + 1, personas.length - 1);
      setFocusedIndex(newIndex);
      const pills = listRef.current?.querySelectorAll(".ei-persona-pill");
      (pills?.[newIndex] as HTMLElement)?.focus();
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIndex = Math.max(index - 1, 0);
      setFocusedIndex(newIndex);
      const pills = listRef.current?.querySelectorAll(".ei-persona-pill");
      (pills?.[newIndex] as HTMLElement)?.focus();
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      setActiveTab("rooms");
      setTimeout(() => {
        const destIndex = Math.max(0, rooms.findIndex(r => r.id === activeRoomId));
        const pills = listRef.current?.querySelectorAll(".ei-room-pill");
        (pills?.[destIndex] as HTMLElement)?.focus();
      }, 0);
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectPersona(personas[index].id);
      setExpanded(false);
    }
  }, [personas, onSelectPersona, rooms, activeRoomId, setActiveTab]);

  const getActiveDisplayName = () => {
    const activePersona = personas.find(p => p.id === activePersonaId);
    return activePersona?.display_name || "Select persona";
  };

  return (
    <div className={`ei-persona-panel ${expanded ? "expanded" : ""}`}>
      <div className="ei-persona-panel__header">
        <div className="ei-panel-tabs">
          <button
            className={`ei-panel-tab ${activeTab === "personas" ? "ei-panel-tab--active" : ""}`}
            onClick={() => setActiveTab("personas")}
          >
            Personas
          </button>
          <button
            className={`ei-panel-tab ${activeTab === "rooms" ? "ei-panel-tab--active" : ""}`}
            onClick={() => setActiveTab("rooms")}
          >
            Rooms
          </button>
        </div>
        <div className="ei-persona-panel__actions">
          {activeTab === "personas" ? (
            <>
              {onShowArchived && (
                <button className="ei-btn ei-btn--icon ei-btn--archive" onClick={onShowArchived} title="View Archived">
                  📦
                </button>
              )}
              <button className="ei-btn ei-btn--primary" onClick={onCreatePersona}>
                + New
              </button>
            </>
          ) : (
            <>
              {onShowArchivedRooms && (
                <button className="ei-btn ei-btn--icon ei-btn--archive" onClick={onShowArchivedRooms} title="View Archived Rooms">
                  📦
                </button>
              )}
              <button className="ei-btn ei-btn--primary" onClick={onCreateRoom}>
                + New
              </button>
            </>
          )}
        </div>
      </div>

      {activeTab === "personas" && (
        <div className="ei-persona-dropdown">
          <button 
            className="ei-persona-dropdown__toggle"
            onClick={() => setExpanded(!expanded)}
          >
            <span>{getActiveDisplayName()}</span>
            <span>{expanded ? "▲" : "▼"}</span>
          </button>
        </div>
      )}

      <div className="ei-persona-panel__list" ref={listRef}>
        {activeTab === "personas" ? (
          personas.length === 0 ? (
            <div className="ei-persona-panel__empty">
              No personas yet. Create one to get started!
            </div>
          ) : (
            personas.map((persona, index) => (
              <div
                key={persona.id}
                className={`ei-persona-pill ${persona.id === activePersonaId ? "active" : ""} ${index === focusedIndex ? "focused" : ""}`}
                style={persona.preferred_theme && accentColors[persona.preferred_theme]
                  ? { '--persona-accent': accentColors[persona.preferred_theme] } as React.CSSProperties
                  : undefined}
                onClick={() => {
                  onSelectPersona(persona.id);
                  setExpanded(false);
                }}
                onMouseEnter={() => setHoveredPersonaId(persona.id)}
                onMouseLeave={() => {
                  setHoveredPersonaId(null);
                  setShowPauseOptions(null);
                }}
                onKeyDown={(e) => handlePillKeyDown(e, index)}
                tabIndex={0}
                role="button"
              >
                <PersonaAvatar
                  personaId={persona.id}
                  displayName={persona.display_name}
                  avatarEmoji={persona.avatar_emoji}
                  avatarImage={persona.avatar_image}
                  size={36}
                  className={`ei-persona-pill__avatar${persona.is_paused ? " paused" : ""}`}
                  showStatus
                  statusClass={getStatusClass(persona)}
                  style={persona.preferred_theme && accentColors[persona.preferred_theme]
                    ? { background: accentColors[persona.preferred_theme] }
                    : undefined}
                />
                <div className="ei-persona-pill__info">
                  <div className="ei-persona-pill__name">{persona.display_name}</div>
                  {persona.short_description && (
                    <div className="ei-persona-pill__desc">{persona.short_description}</div>
                  )}
                </div>
                {persona.unread_count > 0 && !persona.is_paused && (
                  <span className="ei-persona-pill__badge">{persona.unread_count}</span>
                )}
                {persona.has_pending_update && (
                  <span
                    className="ei-persona-pill__reflection-badge"
                    title="Pending reflection — talk it over"
                    onClick={(e) => { e.stopPropagation(); onReflectionClick?.(persona.id); }}
                    role="button"
                  >✦</span>
                )}
                
                {hoveredPersonaId === persona.id && (
                  <div className="ei-persona-pill__controls" onClick={handleControlClick}>
                    <button
                      className={`ei-control-btn ${persona.is_paused ? "active" : ""}`}
                      onClick={() => persona.is_paused 
                        ? handlePause(persona.id) 
                        : setShowPauseOptions(persona.id)
                      }
                      title={persona.is_paused ? "Resume" : "Pause"}
                    >
                      {persona.is_paused ? "▶" : "⏸"}
                    </button>
                    
                    {showPauseOptions === persona.id && (
                      <div className="ei-pause-options" ref={pauseOptionsRef}>
                        <button onClick={() => handlePause(persona.id, 1)}>1 hour</button>
                        <button onClick={() => handlePause(persona.id, 8)}>8 hours</button>
                        <button onClick={() => handlePause(persona.id, 24)}>24 hours</button>
                        <button onClick={() => handlePause(persona.id)}>Forever</button>
                      </div>
                    )}
                    
                    <button
                      className="ei-control-btn"
                      onClick={() => onEditPersona?.(persona.id)}
                      title="Edit"
                    >
                      ✏️
                    </button>
                    
                    <button
                      className="ei-control-btn ei-control-btn--archive"
                      onClick={() => handleArchive(persona.id, persona.display_name)}
                      title="Archive"
                    >
                      📦
                    </button>
                    
                    <button
                      className="ei-control-btn ei-control-btn--danger"
                      onClick={() => setShowDeleteConfirm(persona.id)}
                      title="Delete"
                    >
                      🗑️
                    </button>
                  </div>
                )}
              </div>
            ))
          )
        ) : (
          rooms.length === 0 ? (
            <div className="ei-room-panel__empty">
              No rooms yet. Create one to start a group chat!
            </div>
          ) : (
            rooms.map((room, index) => (
              <div
                key={room.id}
                className={`ei-room-pill ${room.id === activeRoomId ? "active" : ""}`}
                onClick={() => onSelectRoom?.(room.id)}
                onMouseEnter={() => setHoveredRoomId(room.id)}
                onMouseLeave={() => setHoveredRoomId(null)}
                tabIndex={0}
                role="button"
                 onKeyDown={(e) => handleRoomPillKeyDown(e, index)}
              >
                <PersonaAvatar
                  personaId={room.id}
                  displayName={room.display_name}
                  size={36}
                  className="ei-room-pill__avatar"
                />
                <div className="ei-room-pill__info">
                  <div className="ei-room-pill__name">{room.display_name}</div>
                  <div className="ei-room-pill__meta">
                    <span className={`ei-room-pill__mode-badge ${MODE_BADGE_CLASS[room.mode]}`}>
                      {MODE_BADGE_LABEL[room.mode]}
                    </span>
                  </div>
                </div>
                {room.unread_count > 0 && (
                  <span className="ei-room-pill__badge">{room.unread_count}</span>
                )}
                {hoveredRoomId === room.id && (onEditRoom || onArchiveRoom) && (
                  <div className="ei-room-pill__controls" onClick={(e) => e.stopPropagation()}>
                    {onEditRoom && (
                      <button
                        className="ei-control-btn"
                        onClick={() => onEditRoom(room.id)}
                        title="Edit Room"
                      >
                        ✏️
                      </button>
                    )}
                    {onArchiveRoom && (
                      <button
                        className="ei-control-btn ei-control-btn--archive"
                        onClick={() => onArchiveRoom(room.id)}
                        title="Archive Room"
                      >
                        📦
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))
          )
        )}
      </div>

      {showDeleteConfirm && (
        <div className="ei-modal-overlay" onClick={() => setShowDeleteConfirm(null)}>
          <div className="ei-delete-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>Delete {showDeleteConfirm}?</h3>
            <p>This action cannot be undone (but you can restore from a checkpoint).</p>
            <label className="ei-checkbox">
              <input
                type="checkbox"
                checked={deleteWithData}
                onChange={(e) => setDeleteWithData(e.target.checked)}
              />
              Also delete facts, topics, and people this persona learned about you
            </label>
            <div className="ei-delete-confirm__actions">
              <button 
                className="ei-btn ei-btn--secondary"
                onClick={() => setShowDeleteConfirm(null)}
              >
                Cancel
              </button>
              <button 
                className="ei-btn ei-btn--danger"
                onClick={() => handleDelete(showDeleteConfirm)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="ei-toast">
          {toast}
        </div>
      )}
    </div>
  );
});

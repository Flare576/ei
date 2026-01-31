import { useState, useRef, useEffect, forwardRef, useImperativeHandle, useCallback } from "react";
import type { PersonaSummary } from "../../../../src/core/types";

interface PersonaPanelProps {
  personas: PersonaSummary[];
  activePersona: string | null;
  processingPersona: string | null;
  onSelectPersona: (name: string) => void;
  onCreatePersona: () => void;
  onPausePersona?: (name: string, pauseUntil?: string) => void;
  onArchivePersona?: (name: string) => void;
  onDeletePersona?: (name: string, deleteData: boolean) => void;
  onEditPersona?: (name: string) => void;
  onShowArchived?: () => void;
}

export interface PersonaPanelHandle {
  focusPanel: () => void;
}

export const PersonaPanel = forwardRef<PersonaPanelHandle, PersonaPanelProps>(function PersonaPanel({
  personas,
  activePersona,
  processingPersona,
  onSelectPersona,
  onCreatePersona,
  onPausePersona,
  onArchivePersona,
  onDeletePersona,
  onEditPersona,
  onShowArchived,
}, ref) {
  const [expanded, setExpanded] = useState(false);
  const [hoveredPersona, setHoveredPersona] = useState<string | null>(null);
  const [showPauseOptions, setShowPauseOptions] = useState<string | null>(null);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
  const [deleteWithData, setDeleteWithData] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const pauseOptionsRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    focusPanel: () => {
      const currentIndex = personas.findIndex(p => p.name === activePersona);
      const index = currentIndex >= 0 ? currentIndex : 0;
      setFocusedIndex(index);
      const pills = listRef.current?.querySelectorAll(".ei-persona-pill");
      const pill = pills?.[index] as HTMLElement | undefined;
      pill?.focus();
    },
  }));

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
    if (processingPersona === persona.name) return "thinking";
    if (persona.unread_count > 0) return "unread";
    return "";
  };

  const getInitials = (name: string) => {
    return name
      .split(/\s+/)
      .map(w => w[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const handlePause = (name: string, hours?: number) => {
    if (!onPausePersona) return;
    const pauseUntil = hours 
      ? new Date(Date.now() + hours * 60 * 60 * 1000).toISOString()
      : undefined;
    onPausePersona(name, pauseUntil);
    setShowPauseOptions(null);
  };

  const handleArchive = (name: string) => {
    if (!onArchivePersona) return;
    onArchivePersona(name);
    setToast(`${name} archived. View archived personas in settings.`);
  };

  const handleDelete = (name: string) => {
    if (!onDeletePersona) return;
    onDeletePersona(name, deleteWithData);
    setShowDeleteConfirm(null);
    setDeleteWithData(false);
  };

  const handleControlClick = (e: React.MouseEvent) => {
    e.stopPropagation();
  };

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
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelectPersona(personas[index].name);
      setExpanded(false);
    }
  }, [personas, onSelectPersona]);

  return (
    <div className={`ei-persona-panel ${expanded ? "expanded" : ""}`}>
      <div className="ei-persona-panel__header">
        <h2 className="ei-persona-panel__title">Personas</h2>
        <div className="ei-persona-panel__actions">
          {onShowArchived && (
            <button className="ei-btn ei-btn--icon ei-btn--archive" onClick={onShowArchived} title="View Archived">
              📦
            </button>
          )}
          <button className="ei-btn ei-btn--primary" onClick={onCreatePersona}>
            + New
          </button>
        </div>
      </div>

      <div className="ei-persona-dropdown">
        <button 
          className="ei-persona-dropdown__toggle"
          onClick={() => setExpanded(!expanded)}
        >
          <span>{activePersona || "Select persona"}</span>
          <span>{expanded ? "▲" : "▼"}</span>
        </button>
      </div>

      <div className="ei-persona-panel__list" ref={listRef}>
        {personas.length === 0 ? (
          <div className="ei-persona-panel__empty">
            No personas yet. Create one to get started!
          </div>
        ) : (
          personas.map((persona, index) => (
            <div
              key={persona.name}
              className={`ei-persona-pill ${persona.name === activePersona ? "active" : ""} ${index === focusedIndex ? "focused" : ""}`}
              onClick={() => {
                onSelectPersona(persona.name);
                setExpanded(false);
              }}
              onMouseEnter={() => setHoveredPersona(persona.name)}
              onMouseLeave={() => {
                setHoveredPersona(null);
                setShowPauseOptions(null);
              }}
              onKeyDown={(e) => handlePillKeyDown(e, index)}
              tabIndex={0}
              role="button"
            >
              <div className={`ei-persona-pill__avatar ${persona.is_paused ? "paused" : ""}`}>
                {getInitials(persona.name)}
                <span className={`ei-persona-pill__status ${getStatusClass(persona)}`} />
              </div>
              <div className="ei-persona-pill__info">
                <div className="ei-persona-pill__name">{persona.name}</div>
                {persona.short_description && (
                  <div className="ei-persona-pill__desc">{persona.short_description}</div>
                )}
              </div>
              {persona.unread_count > 0 && !persona.is_paused && (
                <span className="ei-persona-pill__badge">{persona.unread_count}</span>
              )}
              
              {hoveredPersona === persona.name && (
                <div className="ei-persona-pill__controls" onClick={handleControlClick}>
                  <button
                    className={`ei-control-btn ${persona.is_paused ? "active" : ""}`}
                    onClick={() => persona.is_paused 
                      ? handlePause(persona.name) 
                      : setShowPauseOptions(persona.name)
                    }
                    title={persona.is_paused ? "Resume" : "Pause"}
                  >
                    {persona.is_paused ? "▶" : "⏸"}
                  </button>
                  
                  {showPauseOptions === persona.name && (
                    <div className="ei-pause-options" ref={pauseOptionsRef}>
                      <button onClick={() => handlePause(persona.name, 1)}>1 hour</button>
                      <button onClick={() => handlePause(persona.name, 8)}>8 hours</button>
                      <button onClick={() => handlePause(persona.name, 24)}>24 hours</button>
                      <button onClick={() => handlePause(persona.name)}>Forever</button>
                    </div>
                  )}
                  
                  <button
                    className="ei-control-btn"
                    onClick={() => onEditPersona?.(persona.name)}
                    title="Edit"
                  >
                    ✏️
                  </button>
                  
                  <button
                    className="ei-control-btn ei-control-btn--archive"
                    onClick={() => handleArchive(persona.name)}
                    title="Archive"
                  >
                    📦
                  </button>
                  
                  <button
                    className="ei-control-btn ei-control-btn--danger"
                    onClick={() => setShowDeleteConfirm(persona.name)}
                    title="Delete"
                  >
                    🗑️
                  </button>
                </div>
              )}
            </div>
          ))
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
              Also delete traits this persona learned about you
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

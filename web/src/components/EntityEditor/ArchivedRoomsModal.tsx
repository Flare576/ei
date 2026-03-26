import { useEffect, useRef, useState } from "react";
import type { RoomSummary, PersonaSummary } from "../../../../src/core/types";

const MODE_LABELS: Record<string, string> = {
  choose_your_path: "CYP",
  free_for_all: "FFA",
  messages_against_persona: "MAP",
};

const MODE_BADGE_CLASS: Record<string, string> = {
  choose_your_path: "ei-room-pill__mode-badge--cyp",
  free_for_all: "ei-room-pill__mode-badge--ffa",
  messages_against_persona: "ei-room-pill__mode-badge--map",
};

interface ArchivedRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  archivedRooms: RoomSummary[];
  personas: PersonaSummary[];
  onUnarchive: (roomId: string) => void;
  onDelete: (roomId: string) => void;
}

export function ArchivedRoomsModal({
  isOpen,
  onClose,
  archivedRooms,
  personas,
  onUnarchive,
  onDelete,
}: ArchivedRoomsModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
    } else if (previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (deleteConfirm) {
          setDeleteConfirm(null);
        } else {
          onClose();
        }
      }
      if (e.key === "Tab") {
        const focusableElements = modalRef.current?.querySelectorAll(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusableElements?.length) return;

        const first = focusableElements[0] as HTMLElement;
        const last = focusableElements[focusableElements.length - 1] as HTMLElement;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, deleteConfirm]);

  const confirmDelete = () => {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  const formatDate = (isoString: string): string => {
    try {
      return new Date(isoString).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  const getParticipantNames = (personaIds: string[]): string => {
    if (personaIds.length === 0) return "No participants";
    const names = personaIds.map(id => personas.find(p => p.id === id)?.display_name ?? id);
    return "with " + names.join(", ");
  };

  const getInitials = (name: string): string =>
    name.split(/\s+/).map(w => w[0]).join("").toUpperCase().slice(0, 2);

  if (!isOpen) return null;

  return (
    <div
      className="ei-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="archived-rooms-modal-title"
    >
      <div
        className="ei-archived-modal"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-archived-modal__header">
          <h2 id="archived-rooms-modal-title">Archived Rooms</h2>
          <button
            className="ei-btn ei-btn--icon"
            onClick={onClose}
            aria-label="Close archived rooms"
          >
            ✕
          </button>
        </div>

        <div className="ei-archived-modal__content">
          {archivedRooms.length === 0 ? (
            <div className="ei-archived-empty">
              <div className="ei-archived-empty__icon">📦</div>
              <div className="ei-archived-empty__text">No archived rooms</div>
            </div>
          ) : (
            <div className="ei-archived-grid">
              {archivedRooms.map((room) => (
                <div key={room.id} className="ei-persona-card">
                  <div className="ei-persona-card__identity">
                    <div className="ei-persona-card__image">
                      <div className="ei-persona-card__image-placeholder">
                        {getInitials(room.display_name)}
                      </div>
                    </div>
                    <div className="ei-persona-card__name-section">
                      <div className="ei-persona-card__name">
                        {room.display_name}
                        <span className={`ei-room-pill__mode-badge ${MODE_BADGE_CLASS[room.mode] ?? ""}`} style={{ marginLeft: 8 }}>
                          {MODE_LABELS[room.mode] ?? room.mode}
                        </span>
                      </div>
                      <div className="ei-persona-card__aliases">
                        {getParticipantNames(room.persona_ids)}
                      </div>
                    </div>
                  </div>

                  <div className="ei-persona-card__footer">
                    <div className="ei-persona-card__archived-date">
                      Last activity: {formatDate(room.last_activity)}
                    </div>
                    <div className="ei-persona-card__actions">
                      <button
                        className="ei-btn ei-btn--secondary ei-btn--sm"
                        onClick={() => onUnarchive(room.id)}
                      >
                        Unarchive
                      </button>
                      {deleteConfirm === room.id ? (
                        <div className="ei-persona-card__delete-confirm">
                          <span className="ei-persona-card__delete-confirm-text">Sure?</span>
                          <button
                            className="ei-btn ei-btn--danger ei-btn--sm"
                            onClick={confirmDelete}
                          >
                            Yes
                          </button>
                          <button
                            className="ei-btn ei-btn--secondary ei-btn--sm"
                            onClick={() => setDeleteConfirm(null)}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <button
                          className="ei-btn ei-btn--secondary ei-btn--sm"
                          onClick={() => setDeleteConfirm(room.id)}
                          aria-label={`Delete ${room.display_name}`}
                        >
                          🗑️
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

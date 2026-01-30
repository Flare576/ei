import { useEffect, useRef, useState } from "react";

export interface ArchivedPersonaSummary {
  name: string;
  aliases: string[];
  short_description?: string;
  long_description?: string;
  image_url?: string;
  archived_at: string;
}

interface ArchivedPersonasModalProps {
  isOpen: boolean;
  onClose: () => void;
  archivedPersonas: ArchivedPersonaSummary[];
  onUnarchive: (name: string) => void;
  onDelete: (name: string) => void;
}

export function ArchivedPersonasModal({
  isOpen,
  onClose,
  archivedPersonas,
  onUnarchive,
  onDelete,
}: ArchivedPersonasModalProps) {
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

  const handleDelete = (name: string) => {
    setDeleteConfirm(name);
  };

  const confirmDelete = () => {
    if (deleteConfirm) {
      onDelete(deleteConfirm);
      setDeleteConfirm(null);
    }
  };

  const formatDate = (isoString: string): string => {
    try {
      const date = new Date(isoString);
      return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return isoString;
    }
  };

  const truncateText = (text: string | undefined, maxLength: number): string => {
    if (!text) return "";
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + "...";
  };

  if (!isOpen) return null;

  return (
    <div
      className="ei-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="archived-modal-title"
    >
      <div
        className="ei-archived-modal"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-archived-modal__header">
          <h2 id="archived-modal-title">Archived Personas</h2>
          <button
            className="ei-btn ei-btn--icon"
            onClick={onClose}
            aria-label="Close archived personas"
          >
            ✕
          </button>
        </div>

        <div className="ei-archived-modal__content">
          {archivedPersonas.length === 0 ? (
            <div className="ei-archived-empty">
              <div className="ei-archived-empty__icon">📦</div>
              <div className="ei-archived-empty__text">No archived personas</div>
            </div>
          ) : (
            <div className="ei-archived-grid">
              {archivedPersonas.map((persona) => (
                <div key={persona.name} className="ei-persona-card">
                  <div className="ei-persona-card__identity">
                    <div className="ei-persona-card__image">
                      {persona.image_url ? (
                        <img
                          src={persona.image_url}
                          alt={persona.name}
                          className="ei-persona-card__image-img"
                        />
                      ) : (
                        <div className="ei-persona-card__image-placeholder">
                          {persona.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                    </div>
                    <div className="ei-persona-card__name-section">
                      <div className="ei-persona-card__name">{persona.name}</div>
                      {persona.aliases.length > 0 && (
                        <div className="ei-persona-card__aliases">
                          {persona.aliases.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>

                  {(persona.short_description || persona.long_description) && (
                    <div className="ei-persona-card__description">
                      {persona.short_description && (
                        <p className="ei-persona-card__short-desc">
                          {truncateText(persona.short_description, 80)}
                        </p>
                      )}
                      {persona.long_description && (
                        <p className="ei-persona-card__long-desc">
                          {truncateText(persona.long_description, 120)}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="ei-persona-card__footer">
                    <div className="ei-persona-card__archived-date">
                      Archived: {formatDate(persona.archived_at)}
                    </div>
                    <div className="ei-persona-card__actions">
                      <button
                        className="ei-btn ei-btn--secondary ei-btn--sm"
                        onClick={() => onUnarchive(persona.name)}
                      >
                        Unarchive
                      </button>
                      {deleteConfirm === persona.name ? (
                        <div className="ei-persona-card__delete-confirm">
                          <span className="ei-persona-card__delete-confirm-text">
                            Sure?
                          </span>
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
                          onClick={() => handleDelete(persona.name)}
                          aria-label={`Delete ${persona.name}`}
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

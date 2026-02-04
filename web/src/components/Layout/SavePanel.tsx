import { useState, useEffect, useRef } from "react";
import type { Checkpoint } from "../../../../src/core/types";

interface SavePanelProps {
  isOpen: boolean;
  checkpoints: Checkpoint[];
  isOperationInProgress: boolean;
  onSave: (index: number, name: string) => void;
  onLoad: (index: number) => void;
  onDelete: (index: number) => void;
  onUndo: () => void;
  onRefresh: () => void;
  onClose: () => void;
}

export function SavePanel({
  isOpen,
  checkpoints,
  isOperationInProgress,
  onSave,
  onLoad,
  onDelete,
  onUndo,
  onRefresh,
  onClose,
}: SavePanelProps) {
  const [showAutoSaves, setShowAutoSaves] = useState(false);
  const [saveDialogSlot, setSaveDialogSlot] = useState<number | null>(null);
  const [loadDialogSlot, setLoadDialogSlot] = useState<number | null>(null);
  const [deleteDialogSlot, setDeleteDialogSlot] = useState<number | null>(null);
  const [saveName, setSaveName] = useState("");
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
      onRefresh();
    } else if (previousActiveElement.current instanceof HTMLElement) {
      previousActiveElement.current.focus();
    }
  }, [isOpen, onRefresh]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // If a sub-dialog is open, close it; otherwise close main modal
        if (saveDialogSlot !== null) {
          setSaveDialogSlot(null);
        } else if (loadDialogSlot !== null) {
          setLoadDialogSlot(null);
        } else if (deleteDialogSlot !== null) {
          setDeleteDialogSlot(null);
        } else {
          onClose();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, saveDialogSlot, loadDialogSlot, deleteDialogSlot]);

  if (!isOpen) return null;

  const manualSlots = [10, 11, 12, 13, 14];
  const autoSlots = [9, 8, 7, 6, 5, 4, 3, 2, 1, 0];

  const getCheckpoint = (index: number) => checkpoints.find(c => c.index === index);

  const formatTimestamp = (ts: string) => {
    const date = new Date(ts);
    return date.toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const handleSave = () => {
    if (saveDialogSlot === null) return;
    onSave(saveDialogSlot, saveName || `Save ${saveDialogSlot - 9}`);
    setSaveDialogSlot(null);
    setSaveName("");
  };

  const handleLoad = () => {
    if (loadDialogSlot === null) return;
    onLoad(loadDialogSlot);
    setLoadDialogSlot(null);
  };

  const handleDelete = () => {
    if (deleteDialogSlot === null) return;
    onDelete(deleteDialogSlot);
    setDeleteDialogSlot(null);
  };

  const newestAutoSave = autoSlots.map(getCheckpoint).find(c => c);

  return (
    <div 
      className="ei-modal-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="save-panel-title"
    >
      <div 
        className={`ei-save-modal ${isOperationInProgress ? "disabled" : ""}`}
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-save-modal__header">
          <h2 id="save-panel-title">Checkpoints</h2>
          <button 
            className="ei-btn ei-btn--icon" 
            onClick={onClose}
            aria-label="Close checkpoints"
          >
            ✕
          </button>
        </div>

        <div className="ei-save-modal__content">
          <div className="ei-save-panel__section">
            <h4>Manual Saves</h4>
            <div className="ei-save-slots">
              {manualSlots.map((slot) => {
                const cp = getCheckpoint(slot);
                return (
                  <div key={slot} className={`ei-save-slot ${cp ? "filled" : "empty"}`}>
                    <div className="ei-save-slot__info">
                      <span className="ei-save-slot__name">
                        {cp?.name || `Slot ${slot - 9}`}
                      </span>
                      {cp && (
                        <span className="ei-save-slot__time">
                          {formatTimestamp(cp.timestamp)}
                        </span>
                      )}
                    </div>
                    <div className="ei-save-slot__actions">
                      <button
                        className="ei-btn ei-btn--secondary ei-btn--sm"
                        onClick={() => setSaveDialogSlot(slot)}
                        disabled={isOperationInProgress}
                      >
                        Save
                      </button>
                      {cp && (
                        <>
                          <button
                            className="ei-btn ei-btn--secondary ei-btn--sm"
                            onClick={() => setLoadDialogSlot(slot)}
                            disabled={isOperationInProgress}
                          >
                            Load
                          </button>
                          <button
                            className="ei-btn ei-btn--danger ei-btn--sm"
                            onClick={() => setDeleteDialogSlot(slot)}
                            disabled={isOperationInProgress}
                          >
                            ✕
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="ei-save-panel__section">
            <button
              className="ei-save-panel__toggle"
              onClick={() => setShowAutoSaves(!showAutoSaves)}
            >
              <span>Auto-saves ({checkpoints.filter(c => c.index < 10).length})</span>
              <span>{showAutoSaves ? "▲" : "▼"}</span>
            </button>
            
            {showAutoSaves && (
              <div className="ei-save-slots ei-save-slots--auto">
                {autoSlots.map((slot) => {
                  const cp = getCheckpoint(slot);
                  if (!cp) return null;
                  return (
                    <div key={slot} className="ei-save-slot ei-save-slot--auto">
                      <div className="ei-save-slot__info">
                        <span className="ei-save-slot__name">
                          Auto #{slot}
                        </span>
                        <span className="ei-save-slot__time">
                          {formatTimestamp(cp.timestamp)}
                        </span>
                      </div>
                      <div className="ei-save-slot__actions">
                        <button
                          className="ei-btn ei-btn--secondary ei-btn--sm"
                          onClick={() => setLoadDialogSlot(slot)}
                          disabled={isOperationInProgress}
                        >
                          Load
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div className="ei-save-panel__undo">
            <button
              className="ei-btn ei-btn--secondary ei-undo-btn"
              onClick={onUndo}
              disabled={isOperationInProgress || !newestAutoSave}
              title="Step back one auto-save (no redo!)"
            >
              ↩ Undo
            </button>
            <span className="ei-save-panel__undo-note">No redo available</span>
          </div>
        </div>

        {saveDialogSlot !== null && (
          <div className="ei-modal-overlay ei-modal-overlay--nested" onClick={() => setSaveDialogSlot(null)}>
            <div className="ei-save-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>Save to Slot {saveDialogSlot - 9}</h3>
              {getCheckpoint(saveDialogSlot) && (
                <p className="ei-save-dialog__warning">
                  This will overwrite the existing save.
                </p>
              )}
              <input
                type="text"
                className="ei-input"
                placeholder="Enter save name..."
                value={saveName}
                onChange={(e) => setSaveName(e.target.value)}
                autoFocus
              />
              <div className="ei-save-dialog__actions">
                <button
                  className="ei-btn ei-btn--secondary"
                  onClick={() => setSaveDialogSlot(null)}
                >
                  Cancel
                </button>
                <button
                  className="ei-btn ei-btn--primary"
                  onClick={handleSave}
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        )}

        {loadDialogSlot !== null && (
          <div className="ei-modal-overlay ei-modal-overlay--nested" onClick={() => setLoadDialogSlot(null)}>
            <div className="ei-save-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>Load from {loadDialogSlot < 10 ? `Auto #${loadDialogSlot}` : `Slot ${loadDialogSlot - 9}`}?</h3>
              <p>Current state will be lost. Make sure to save first if needed.</p>
              <div className="ei-save-dialog__actions">
                <button
                  className="ei-btn ei-btn--secondary"
                  onClick={() => setLoadDialogSlot(null)}
                >
                  Cancel
                </button>
                <button
                  className="ei-btn ei-btn--primary"
                  onClick={handleLoad}
                >
                  Load
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteDialogSlot !== null && (
          <div className="ei-modal-overlay ei-modal-overlay--nested" onClick={() => setDeleteDialogSlot(null)}>
            <div className="ei-save-dialog" onClick={(e) => e.stopPropagation()}>
              <h3>Delete Save?</h3>
              <p>This cannot be undone.</p>
              <div className="ei-save-dialog__actions">
                <button
                  className="ei-btn ei-btn--secondary"
                  onClick={() => setDeleteDialogSlot(null)}
                >
                  Cancel
                </button>
                <button
                  className="ei-btn ei-btn--danger"
                  onClick={handleDelete}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

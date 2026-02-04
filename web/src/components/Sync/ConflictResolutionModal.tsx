import { useEffect, useRef, useState } from "react";

interface ConflictResolutionModalProps {
  isOpen: boolean;
  onClose: () => void;
  localTimestamp: Date;
  remoteTimestamp: Date;
  onKeepLocal: (updateRemote: boolean) => void;
  onKeepRemote: () => void;
  onYoloMerge: () => void;
}

export function ConflictResolutionModal({
  isOpen,
  onClose,
  localTimestamp,
  remoteTimestamp,
  onKeepLocal,
  onKeepRemote,
  onYoloMerge,
}: ConflictResolutionModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);
  const [updateRemote, setUpdateRemote] = useState(false);

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
        onClose();
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
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const isRemoteNewer = remoteTimestamp > localTimestamp;

  return (
    <div
      className="ei-modal-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-modal-title"
    >
      <div
        className="ei-conflict-modal"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-conflict-modal__header">
          <h2 id="conflict-modal-title">Sync Conflict Detected</h2>
          <button
            className="ei-btn ei-btn--icon"
            onClick={onClose}
            aria-label="Close conflict resolution"
          >
            ✕
          </button>
        </div>

        <div className="ei-conflict-modal__content">
          <div className="ei-conflict-modal__timestamps">
            <div className={`ei-conflict-modal__timestamp ${!isRemoteNewer ? "newer" : ""}`}>
              <span className="ei-conflict-modal__timestamp-label">Local</span>
              <span className="ei-conflict-modal__timestamp-value">
                {localTimestamp.toLocaleString()}
              </span>
              {!isRemoteNewer && (
                <span className="ei-conflict-modal__timestamp-badge">Newer</span>
              )}
            </div>
            <div className={`ei-conflict-modal__timestamp ${isRemoteNewer ? "newer" : ""}`}>
              <span className="ei-conflict-modal__timestamp-label">Remote</span>
              <span className="ei-conflict-modal__timestamp-value">
                {remoteTimestamp.toLocaleString()}
              </span>
              {isRemoteNewer && (
                <span className="ei-conflict-modal__timestamp-badge">Newer</span>
              )}
            </div>
          </div>

          <div className="ei-conflict-modal__actions">
            <div className="ei-conflict-modal__action">
              <button
                className="ei-btn ei-btn--primary"
                onClick={() => onKeepLocal(updateRemote)}
              >
                Keep Local
              </button>
              <label className="ei-conflict-modal__checkbox">
                <input
                  type="checkbox"
                  checked={updateRemote}
                  onChange={(e) => setUpdateRemote(e.target.checked)}
                />
                <span>Also update remote?</span>
              </label>
            </div>

            <div className="ei-conflict-modal__action ei-conflict-modal__action--warning">
              <button
                className="ei-btn ei-btn--secondary ei-conflict-modal__btn-warning"
                onClick={onKeepRemote}
              >
                Keep Remote
              </button>
              <p className="ei-conflict-modal__warning-text">
                Local changes will be lost
              </p>
            </div>

            <div className="ei-conflict-modal__action ei-conflict-modal__action--warning">
              <button
                className="ei-btn ei-btn--secondary ei-conflict-modal__btn-warning"
                onClick={onYoloMerge}
              >
                YOLO Merge
              </button>
              <p className="ei-conflict-modal__warning-text">
                Combine both (experimental)
              </p>
            </div>
          </div>
        </div>

        <div className="ei-conflict-modal__footer">
          <button className="ei-btn ei-btn--secondary" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

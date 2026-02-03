import { useEffect, useCallback, useState, useRef } from "react";
import { createPortal } from "react-dom";
import type { QueueStatus, Checkpoint } from "../../../../src/core/types";
import { SavePanel } from "./SavePanel";

interface ControlAreaProps {
  queueStatus: QueueStatus;
  checkpoints: Checkpoint[];
  isCheckpointOperationInProgress: boolean;
  onPauseToggle: () => void;
  onClearQueue?: () => void;
  onSave: (index: number, name: string) => void;
  onLoad: (index: number) => void;
  onDeleteCheckpoint: (index: number) => void;
  onUndo: () => void;
  onRefreshCheckpoints: () => void;
  onHelpClick?: () => void;
  onSettingsClick?: () => void;
}

export function ControlArea({ 
  queueStatus, 
  checkpoints,
  isCheckpointOperationInProgress,
  onPauseToggle,
  onClearQueue,
  onSave,
  onLoad,
  onDeleteCheckpoint,
  onUndo,
  onRefreshCheckpoints,
  onHelpClick,
  onSettingsClick,
}: ControlAreaProps) {
  const [showSavePanel, setShowSavePanel] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const savePanelRef = useRef<HTMLDivElement>(null);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  
  const isPaused = queueStatus.state === "paused";
  const isBusy = queueStatus.state === "busy";
  
  const statusText = isPaused
    ? "Paused"
    : isBusy
    ? `Processing... (${queueStatus.pending_count} pending)`
    : queueStatus.pending_count > 0
    ? `${queueStatus.pending_count} pending`
    : "Ready";

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      if (showSavePanel) {
        setShowSavePanel(false);
      } else {
        onPauseToggle();
      }
    }
  }, [onPauseToggle, showSavePanel]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      const portalPopover = document.querySelector('.ei-save-popover--portal');
      const clickedInsideButton = savePanelRef.current?.contains(target);
      const clickedInsidePortal = portalPopover?.contains(target);
      if (!clickedInsideButton && !clickedInsidePortal) {
        setShowSavePanel(false);
      }
    };
    if (showSavePanel) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showSavePanel]);

  return (
    <div className="ei-control-area">
      <div className="ei-control-area__status">
        <span 
          className={`ei-control-area__indicator ${isBusy ? "busy" : ""} ${isPaused ? "paused" : ""}`}
        />
        <span>{statusText}</span>
      </div>
      <div className="ei-control-area__buttons">
        <button
          className={`ei-btn ei-btn--icon ei-pause-btn ${isPaused ? "paused" : ""}`}
          onClick={onPauseToggle}
          title={isPaused ? "Resume (Escape)" : "Pause (Escape)"}
          aria-label={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? "▶" : "⏸"}
        </button>
        {queueStatus.pending_count > 10 && onClearQueue && (
          <button
            className="ei-btn ei-btn--icon ei-btn--danger"
            onClick={onClearQueue}
            title={`Clear queue (${queueStatus.pending_count} items)`}
            aria-label="Clear queue"
          >
            🗑️
          </button>
        )}
        <div ref={savePanelRef}>
          <button
            ref={saveButtonRef}
            className="ei-btn ei-btn--icon"
            onClick={() => {
              if (!showSavePanel && saveButtonRef.current) {
                const rect = saveButtonRef.current.getBoundingClientRect();
                const popoverWidth = 280;
                const viewportPadding = 8;
                const maxLeft = window.innerWidth - popoverWidth - viewportPadding;
                setPopoverPosition({
                  top: rect.bottom + 8,
                  left: Math.min(rect.left, maxLeft),
                });
              }
              setShowSavePanel(!showSavePanel);
            }}
            title="Save/Load"
            aria-label="Save/Load"
          >
            💾
          </button>
          {showSavePanel && createPortal(
            <div 
              className="ei-save-popover ei-save-popover--portal"
              style={{ top: popoverPosition.top, left: popoverPosition.left }}
            >
              <SavePanel
                checkpoints={checkpoints}
                isOperationInProgress={isCheckpointOperationInProgress}
                onSave={onSave}
                onLoad={onLoad}
                onDelete={onDeleteCheckpoint}
                onUndo={onUndo}
                onRefresh={onRefreshCheckpoints}
              />
            </div>,
            document.body
          )}
        </div>
        {onSettingsClick && (
          <button
            className="ei-btn ei-btn--icon"
            onClick={onSettingsClick}
            title="Settings"
            aria-label="Settings"
          >
            ⚙️
          </button>
        )}
        {onHelpClick && (
          <button
            className="ei-btn ei-btn--icon"
            onClick={onHelpClick}
            title="Help"
            aria-label="Help"
          >
            ?
          </button>
        )}
      </div>
    </div>
  );
}

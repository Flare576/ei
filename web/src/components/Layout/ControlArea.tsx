import { useEffect, useCallback, useState } from "react";
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
  onSaveAndExit?: () => void;
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
  onSaveAndExit,
}: ControlAreaProps) {
  const [showSavePanel, setShowSavePanel] = useState(false);
  
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
    if (e.key === "Escape" && !showSavePanel) {
      onPauseToggle();
    }
  }, [onPauseToggle, showSavePanel]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <>
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
          <button
            className="ei-btn ei-btn--icon"
            onClick={() => setShowSavePanel(true)}
            title="Save/Load"
            aria-label="Save/Load"
          >
            💾
          </button>
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
          {onSaveAndExit && (
            <button
              className="ei-btn ei-btn--icon"
              onClick={onSaveAndExit}
              title="Save and Exit"
              aria-label="Save and Exit"
            >
              🚪
            </button>
          )}
        </div>
      </div>

      <SavePanel
        isOpen={showSavePanel}
        checkpoints={checkpoints}
        isOperationInProgress={isCheckpointOperationInProgress}
        onSave={onSave}
        onLoad={onLoad}
        onDelete={onDeleteCheckpoint}
        onUndo={onUndo}
        onRefresh={onRefreshCheckpoints}
        onClose={() => setShowSavePanel(false)}
      />
    </>
  );
}

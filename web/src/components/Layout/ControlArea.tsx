import { useEffect, useCallback } from "react";
import { HamburgerMenu } from "./HamburgerMenu";
import type { QueueStatus } from "../../../../src/core/types";

export interface ControlAreaProps {
  queueStatus: QueueStatus;
  onPauseToggle: () => void;
  onMyDataClick?: () => void;
  onSettingsClick?: () => void;
  onHelpClick?: () => void;
  onSyncAndExit?: () => void;
  isSaving?: boolean;
  onQueueClick?: () => void;
}

export function ControlArea({ 
  queueStatus, 
  onPauseToggle,
  onMyDataClick,
  onSettingsClick,
  onHelpClick,
  onSyncAndExit,
  isSaving,
  onQueueClick,
}: ControlAreaProps) {
  const isPaused = queueStatus.state === "paused";
  const isBusy = queueStatus.state === "busy";
  const isWaiting = !isBusy && !isPaused && queueStatus.pending_count > 0;
  
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onPauseToggle();
    }
  }, [onPauseToggle]);

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="ei-control-area">
      <div className="ei-control-area__status">
        <span className="ei-control-area__status-text">
          <span 
            className={`ei-control-area__indicator ${isBusy ? "busy" : ""} ${isPaused ? "paused" : ""} ${isWaiting ? "waiting" : ""} ${isSaving ? "saving" : ""}`}
          />
          <span>{isSaving ? "Saving..." : isPaused ? "Paused" : isBusy ? "Processing..." : isWaiting ? "Waiting on server..." : "Ready"}</span>
          {(isBusy || isWaiting) && onQueueClick && (
            <span
              className="ei-control-area__status-text--clickable"
              onClick={onQueueClick}
              role="button"
              title="View queue"
            >
              {` (${queueStatus.pending_count} pending)`}
            </span>
          )}
          {queueStatus.dlq_count > 0 && (
            <span
              className={`ei-control-area__dlq${onQueueClick ? " ei-control-area__status-text--clickable" : ""}`}
              onClick={onQueueClick}
              role={onQueueClick ? "button" : undefined}
              title={onQueueClick ? "View queue" : undefined}
            >[DLQ:{queueStatus.dlq_count}]</span>
          )}
          {queueStatus.embedding_warning && (
            <span className="ei-control-area__dlq" title="Embedding service unavailable — topic/person matching using recent items">⚠ embed</span>
          )}
        </span>
        <button
          className={`ei-btn ei-btn--icon ${isPaused ? "ei-play-btn" : "ei-pause-btn"}`}
          onClick={onPauseToggle}
          title={isPaused ? "Resume (Escape)" : "Pause (Escape)"}
          aria-label={isPaused ? "Resume" : "Pause"}
        >
          {isPaused ? "▶" : "⏸"}
        </button>
      </div>
      <div className="ei-control-area__buttons">
        {(onMyDataClick || onSettingsClick || onHelpClick || onSyncAndExit) && (
          <HamburgerMenu
            onMyDataClick={onMyDataClick || (() => {})}
            onSettingsClick={onSettingsClick || (() => {})}
            onHelpClick={onHelpClick || (() => {})}
            onSyncAndExit={onSyncAndExit}
            isSaving={isSaving}
          />
        )}
      </div>
    </div>
  );
}

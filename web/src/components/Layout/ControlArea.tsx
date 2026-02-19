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
}

export function ControlArea({ 
  queueStatus, 
  onPauseToggle,
  onMyDataClick,
  onSettingsClick,
  onHelpClick,
  onSyncAndExit,
}: ControlAreaProps) {
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
        <span 
          className={`ei-control-area__indicator ${isBusy ? "busy" : ""} ${isPaused ? "paused" : ""}`}
        />
        <span>{statusText}</span>
        {isPaused && (
          <button
            className="ei-btn ei-btn--icon ei-play-btn"
            onClick={onPauseToggle}
            title="Resume (Escape)"
            aria-label="Resume"
          >
            ▶
          </button>
        )}
      </div>
      <div className="ei-control-area__buttons">
        {(onMyDataClick || onSettingsClick || onHelpClick || onSyncAndExit) && (
          <HamburgerMenu
            onMyDataClick={onMyDataClick || (() => {})}
            onSettingsClick={onSettingsClick || (() => {})}
            onHelpClick={onHelpClick || (() => {})}
            onSyncAndExit={onSyncAndExit}
          />
        )}
      </div>
    </div>
  );
}

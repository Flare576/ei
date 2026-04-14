import { useRef, useEffect } from 'react';
import type { RoomEntity } from '../../../../src/core/types';
import { RoomMode } from '../../../../src/core/types';
import { useOverlayClose } from '../../hooks/useOverlayClose';
import '../../styles/room-overview.css';

const MODE_LABEL: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: 'CYP',
  [RoomMode.FreeForAll]: 'FFA',
  [RoomMode.MessagesAgainstPersona]: 'MAP',
};

const MODE_CLASS: Record<RoomMode, string> = {
  [RoomMode.ChooseYourPath]: 'ei-room-overview__mode-badge--cyp',
  [RoomMode.FreeForAll]: 'ei-room-overview__mode-badge--ffa',
  [RoomMode.MessagesAgainstPersona]: 'ei-room-overview__mode-badge--map',
};

interface RoomOverviewOverlayProps {
  isOpen: boolean;
  onClose: () => void;
  room: RoomEntity;
  children: React.ReactNode;
}

export function RoomOverviewOverlay({ isOpen, onClose, room, children }: RoomOverviewOverlayProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      containerRef.current?.focus();
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const overlayProps = useOverlayClose(onClose);

  if (!isOpen) return null;

  return (
    <div className="ei-room-overview-overlay" {...overlayProps}>
      <div
        className="ei-room-overview"
        onClick={(e) => e.stopPropagation()}
        ref={containerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-overview-title"
      >
        <div className="ei-room-overview__header">
          <div className="ei-room-overview__title-group">
            <h2 id="room-overview-title" className="ei-room-overview__title">
              {room.display_name}
            </h2>
            <span className={`ei-room-overview__mode-badge ${MODE_CLASS[room.mode]}`}>
              {MODE_LABEL[room.mode]}
            </span>
          </div>
          <button
            className="ei-room-overview__close"
            onClick={onClose}
            aria-label="Close overview"
          >
            ✕
          </button>
        </div>
        <div className="ei-room-overview__body">
          {children}
        </div>
      </div>
    </div>
  );
}

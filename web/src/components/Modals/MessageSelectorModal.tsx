import { useState, useRef, useEffect } from 'react';
import type { Message } from '../../../../src/core/types';

interface MessageSelectorModalProps {
  isOpen: boolean;
  messages: Message[];
  personaName: string;
  onClose: () => void;
  onSubmit: (selectedMessageIds: string[], instructions: string) => void;
}

export function MessageSelectorModal({
  isOpen,
  messages,
  personaName,
  onClose,
  onSubmit,
}: MessageSelectorModalProps) {
  const [selectedMessageIds, setSelectedMessageIds] = useState<string[]>([]);
  const [instructions, setInstructions] = useState('');
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSelectedMessageIds([]);
      setInstructions('');
    }
  }, [isOpen]);

  // Focus management
  useEffect(() => {
    if (isOpen) {
      previousActiveElement.current = document.activeElement;
      modalRef.current?.focus();
    } else {
      if (previousActiveElement.current instanceof HTMLElement) {
        previousActiveElement.current.focus();
      }
    }
  }, [isOpen]);

  // Keyboard handling
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

  if (!isOpen) return null;

  const handleToggleMessage = (messageId: string) => {
    setSelectedMessageIds(prev =>
      prev.includes(messageId)
        ? prev.filter(id => id !== messageId)
        : [...prev, messageId]
    );
  };

  const handleSubmit = () => {
    if (selectedMessageIds.length === 0) return;
    onSubmit(selectedMessageIds, instructions);
    onClose();
  };

  // Filter to human and system messages only
  const selectableMessages = messages.filter(m => m.role === 'human' || m.role === 'system');

  return (
    <div className="ei-modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="ei-modal-content ei-message-selector-modal"
        onClick={(e) => e.stopPropagation()}
        tabIndex={-1}
      >
        <div className="ei-modal-header">
          <h2>Generate Image from Conversation</h2>
          <button 
            className="ei-modal-close" 
            onClick={onClose}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        <div className="ei-modal-body">
          <p className="ei-message-selector__hint">
            Select messages from your conversation with <strong>{personaName}</strong> to synthesize into an image prompt.
          </p>

          <div className="ei-message-selector__list">
            {selectableMessages.map(msg => {
              const text = msg.verbal_response || msg.action_response || '';
              const preview = text.length > 100 ? text.substring(0, 100) + '...' : text;
              const isSelected = selectedMessageIds.includes(msg.id);

              return (
                <label
                  key={msg.id}
                  className={`ei-message-selector__item ${isSelected ? 'selected' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleToggleMessage(msg.id)}
                  />
                  <div className="ei-message-selector__item-content">
                    <span className={`ei-message-selector__role ${msg.role}`}>
                      {msg.role === 'human' ? 'You' : personaName}
                    </span>
                    <span className="ei-message-selector__text">{preview}</span>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="ei-message-selector__instructions">
            <label htmlFor="instructions">
              Additional Instructions (optional)
            </label>
            <textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., 'Make it look like a watercolor painting' or 'Focus on the emotions'"
              rows={3}
            />
          </div>
        </div>

        <div className="ei-modal-footer">
          <button 
            className="ei-btn ei-btn-secondary" 
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="ei-btn ei-btn-primary"
            onClick={handleSubmit}
            disabled={selectedMessageIds.length === 0}
          >
            Generate Image ({selectedMessageIds.length} selected)
          </button>
        </div>
      </div>
    </div>
  );
}

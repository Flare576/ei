import { useEffect, useRef } from "react";

interface HelpModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function HelpModal({ isOpen, onClose }: HelpModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

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

  return (
    <div 
      className="ei-modal-overlay" 
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="help-modal-title"
    >
      <div 
        className="ei-help-modal" 
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
      >
        <div className="ei-help-modal__header">
          <h2 id="help-modal-title">EI Help</h2>
          <button 
            className="ei-btn ei-btn--icon" 
            onClick={onClose}
            aria-label="Close help"
          >
            ✕
          </button>
        </div>

        <div className="ei-help-modal__content">
          <section className="ei-help-section">
            <h3>Keyboard Shortcuts</h3>
            <dl className="ei-shortcut-list">
              <div className="ei-shortcut">
                <dt><kbd>Escape</kbd></dt>
                <dd>Toggle system pause</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Ctrl</kbd> + <kbd>H</kbd></dt>
                <dd>Focus persona panel</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Ctrl</kbd> + <kbd>L</kbd></dt>
                <dd>Focus input box</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>↑</kbd> / <kbd>↓</kbd></dt>
                <dd>Navigate personas (when panel focused)</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Enter</kbd></dt>
                <dd>Select persona / Send message</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Shift</kbd> + <kbd>Enter</kbd></dt>
                <dd>New line in message</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Ctrl</kbd> + <kbd>C</kbd></dt>
                <dd>Clear input</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>↑</kbd> (at start of input)</dt>
                <dd>Recall pending messages</dd>
              </div>
              <div className="ei-shortcut">
                <dt><kbd>Page Up</kbd> / <kbd>Page Down</kbd></dt>
                <dd>Scroll chat history</dd>
              </div>
            </dl>
          </section>

          <section className="ei-help-section">
            <h3>Core Concepts</h3>
            <dl className="ei-concept-list">
              <dt>Personas</dt>
              <dd>AI personalities you create and chat with. Each has unique traits and topics.</dd>
              
              <dt>Ei</dt>
              <dd>Your default companion persona. Ei helps manage other personas and learns about you.</dd>
              
              <dt>Checkpoints</dt>
              <dd>Save/restore points like video game saves. Auto-saves happen every minute (slots 0-9). Manual saves go to slots 1-5.</dd>
              
              <dt>Pending Messages</dt>
              <dd>Messages waiting to be processed. Click or press ↑ to recall them for editing.</dd>
              
              <dt>Pause</dt>
              <dd>Stops all processing immediately. Press Escape or click the pause button.</dd>
            </dl>
          </section>

          <section className="ei-help-section">
            <h3>Tips</h3>
            <ul className="ei-tips-list">
              <li>Hover over a persona to see quick actions (pause, edit, archive, delete)</li>
              <li>Click on unread messages to mark them as read</li>
              <li>Use the save system before making big changes - you can always undo!</li>
              <li>Pausing aborts current AI processing but preserves your messages</li>
            </ul>
          </section>
        </div>

        <div className="ei-help-modal__footer">
          <a 
            href="https://github.com/Flare576/ei" 
            target="_blank" 
            rel="noopener noreferrer"
            className="ei-btn ei-btn--secondary"
          >
            Full Documentation ↗
          </a>
          <button className="ei-btn ei-btn--primary" onClick={onClose}>
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useRef } from "react";
import { ZoneMap } from "./ZoneMap";

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
            <h3>UI Map</h3>
            <ZoneMap />
          </section>

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
            <h3>Rooms</h3>
            <p className="ei-help-text">
              Rooms let you have a conversation with multiple personas at once.
              Create one from the persona panel (<kbd>+</kbd> → Room). Three modes:
            </p>
            <dl className="ei-shortcut-list">
              <div className="ei-shortcut">
                <dt><strong>FFA</strong></dt>
                <dd>Free For All — every persona responds to every message. Loud. Great for brainstorming.</dd>
              </div>
              <div className="ei-shortcut">
                <dt><strong>CYP</strong></dt>
                <dd>Choose Your Path — all personas respond, you pick which branch continues. Forks the conversation.</dd>
              </div>
              <div className="ei-shortcut">
                <dt><strong>MAP</strong></dt>
                <dd>Messages Against Persona — everyone submits a response, a Judge persona picks the winner. The losing responses are discarded.</dd>
              </div>
            </dl>
            <p className="ei-help-text">
              In CYP and MAP, the <strong>Activate</strong> button appears once all participants have responded.
              Click it (or press Enter) to reveal the responses and advance the conversation.
            </p>
          </section>

          <section className="ei-help-section">
            <h3>Reflections</h3>
            <p className="ei-help-text">
              After enough conversations, Ei notices patterns — things a persona consistently cares about,
              ways they've grown, traits that have shifted. When that happens, Ei generates a <strong>reflection</strong>:
              a proposed update to the persona's identity (description, traits, topics).
            </p>
            <p className="ei-help-text">
              A badge (✦) appears on the persona pill in the left panel when a reflection is pending.
              Click it to open the Reflection Review — you'll see the current identity side-by-side with
              the proposed changes, a chat window to discuss it with the persona, and the option to
              apply, edit, or dismiss.
            </p>
            <p className="ei-help-text">
              Nothing changes automatically. You're always in the driver's seat.
            </p>
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

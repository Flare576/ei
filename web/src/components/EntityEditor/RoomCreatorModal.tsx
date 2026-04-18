import { useState, useRef, useEffect } from 'react';
import type { PersonaSummary, RoomCreationInput } from '../../../../src/core/types';
import { RoomMode } from '../../../../src/core/types';
import { useOverlayClose } from '../../hooks/useOverlayClose';

interface RoomCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreate: (input: RoomCreationInput) => void;
  personas: PersonaSummary[];
}

const MODE_INFO: Record<RoomMode, { label: string; description: string; note?: string }> = {
  [RoomMode.ChooseYourPath]: {
    label: "Choose Your Path (CYP)",
    description: "Each persona responds independently. You pick whose response to continue with.",
    note: "Because of how CYP branching works, Ei will not automatically scan for Topics and People as you progress. When you reach an important moment — or whenever you like — use the 💡 bulb button in the chat to extract data and share it with your personas.",
  },
  [RoomMode.FreeForAll]: {
    label: "Free For All (FFA)",
    description: "All personas respond to every message. Conversation flows naturally as a group.",
  },
  [RoomMode.MessagesAgainstPersona]: {
    label: "Messages Against Persona (MAP)",
    description: "Personas debate a topic. A designated judge persona evaluates the responses.",
  },
};

export function RoomCreatorModal({ isOpen, onClose, onCreate, personas }: RoomCreatorModalProps) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState<RoomMode>(RoomMode.FreeForAll);
  const [selectedPersonaIds, setSelectedPersonaIds] = useState<string[]>([]);
  const [judgePersonaId, setJudgePersonaId] = useState<string>('');
  const [initialMessage, setInitialMessage] = useState('');
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false);

  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      setName('');
      setMode(RoomMode.FreeForAll);
      setSelectedPersonaIds([]);
      setJudgePersonaId('');
      setInitialMessage('');
    }
  }, [isOpen]);

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

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
        return;
      }
      if (e.key === 'Tab') {
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
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const handleClose = () => {
    if (name || selectedPersonaIds.length > 0 || initialMessage) {
      setShowDiscardConfirm(true);
      return;
    }
    onClose();
  };

  const togglePersona = (id: string) => {
    setSelectedPersonaIds(prev => {
      const next = prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id];
      if (judgePersonaId && !next.includes(judgePersonaId)) {
        setJudgePersonaId('');
      }
      return next;
    });
  };

  const handleSubmit = () => {
    if (!name.trim()) {
      alert('Please provide a name for the room.');
      return;
    }
    if (selectedPersonaIds.length < 1) {
      alert('Please select at least one participant.');
      return;
    }
    if (mode === RoomMode.MessagesAgainstPersona && !judgePersonaId) {
      alert('Please select a judge persona for MAP mode.');
      return;
    }
    if (!initialMessage.trim()) {
      alert('Please provide an initial message to start the room.');
      return;
    }

    const input: RoomCreationInput = {
      display_name: name.trim(),
      mode,
      persona_ids: selectedPersonaIds,
      judge_persona_id: mode === RoomMode.MessagesAgainstPersona ? judgePersonaId : undefined,
      initial_message: initialMessage.trim(),
    };
    onCreate(input);
  };

  const overlayProps = useOverlayClose(handleClose);

  if (!isOpen) return null;

  const activePersonas = personas.filter(p => !p.is_archived);
  const judgeEligiblePersonas = activePersonas.filter(p => selectedPersonaIds.includes(p.id));

  return (
    <div className="ei-modal-overlay" {...overlayProps}>
      <div
        className="ei-creator-modal"
        onClick={(e) => e.stopPropagation()}
        ref={modalRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="room-creator-modal-title"
      >
        <div className="ei-creator-modal__header">
          <h2 id="room-creator-modal-title" className="ei-creator-modal__title">
            Create New Room
          </h2>
          <button className="ei-btn ei-btn--icon" onClick={handleClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="ei-creator-modal__content">
          <div className="ei-creator-modal__core">
            <div className="ei-form-group">
              <label className="ei-form-label">Room Name</label>
              <input
                type="text"
                className="ei-input"
                placeholder="e.g., Philosophy Debate, Story Workshop..."
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="ei-form-group">
              <label className="ei-form-label">Mode</label>
              {(Object.values(RoomMode) as RoomMode[]).map((m) => (
                <label
                  key={m}
                  className="ei-checkbox"
                  style={{ alignItems: 'flex-start', marginBottom: '8px' }}
                >
                  <input
                    type="radio"
                    name="room-mode"
                    value={m}
                    checked={mode === m}
                    onChange={() => setMode(m)}
                    style={{ marginTop: '3px', flexShrink: 0 }}
                  />
                  <div>
                    <div style={{ fontWeight: 500 }}>{MODE_INFO[m].label}</div>
                    <div className="ei-form-hint" style={{ marginBottom: 0 }}>
                      {MODE_INFO[m].description}
                    </div>
                    {MODE_INFO[m].note && mode === m && (
                      <div className="ei-form-hint ei-form-hint--note" style={{ marginTop: '6px' }}>
                        {MODE_INFO[m].note}
                      </div>
                    )}
                  </div>
                </label>
              ))}
            </div>

            <div className="ei-form-group">
              <label className="ei-form-label">Participants</label>
              {activePersonas.length === 0 ? (
                <p className="ei-creator-help-text">No personas available. Create some first.</p>
              ) : (
                activePersonas.map((persona) => (
                  <label key={persona.id} className="ei-checkbox">
                    <input
                      type="checkbox"
                      checked={selectedPersonaIds.includes(persona.id)}
                      onChange={() => togglePersona(persona.id)}
                    />
                    {persona.display_name}
                  </label>
                ))
              )}
            </div>

            {mode === RoomMode.MessagesAgainstPersona && (
              <div className="ei-form-group">
                <label className="ei-form-label">Judge</label>
                {judgeEligiblePersonas.length === 0 ? (
                  <p className="ei-creator-help-text">Select participants first to pick a judge.</p>
                ) : (
                  <select
                    className="ei-input"
                    value={judgePersonaId}
                    onChange={(e) => setJudgePersonaId(e.target.value)}
                  >
                    <option value="">— Select judge —</option>
                    {judgeEligiblePersonas.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.display_name}
                      </option>
                    ))}
                  </select>
                )}
                <span className="ei-form-hint">
                  The judge evaluates all participant responses.
                </span>
              </div>
            )}

            <div className="ei-form-group">
              <label className="ei-form-label">Initial Message</label>
              <textarea
                className="ei-textarea"
                placeholder="What would you like to discuss or ask in this room?"
                rows={4}
                value={initialMessage}
                onChange={(e) => setInitialMessage(e.target.value)}
              />
              <span className="ei-form-hint">
                This message will be sent to all participants when the room is created.
              </span>
            </div>
          </div>
        </div>

        <div className="ei-creator-modal__footer">
          {showDiscardConfirm ? (
            <>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary, #888)', marginRight: 'auto' }}>
                Discard room creation?
              </span>
              <button
                className="ei-btn ei-btn--secondary"
                onClick={() => setShowDiscardConfirm(false)}
              >
                Keep Editing
              </button>
              <button
                className="ei-btn ei-btn--primary"
                onClick={() => { setShowDiscardConfirm(false); onClose(); }}
              >
                Discard
              </button>
            </>
          ) : (
            <>
              <button className="ei-btn ei-btn--secondary" onClick={handleClose}>
                Cancel
              </button>
              <button className="ei-btn ei-btn--primary" onClick={handleSubmit}>
                Create Room
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

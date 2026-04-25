import React, { useState, useRef, useCallback } from 'react';
import type { PersonaTrait, PersonaTopic, Message, Quote } from '../../../../src/core/types';
import { SliderControl } from './SliderControl';
import { ChatPanel } from '../Layout/ChatPanel';
import '../../styles/reflection-modal.css';

interface EditedIdentity {
  long_description: string;
  short_description: string;
  traits: PersonaTrait[];
  topics: PersonaTopic[];
}

interface PersonaReflectionModalProps {
  isOpen: boolean;
  personaName: string;
  currentIdentity: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
  };
  pendingUpdate: {
    long_description: string;
    short_description: string;
    traits: PersonaTrait[];
    topics: PersonaTopic[];
    critique: string;
  };
  activePersonaId: string;
  messages: Message[];
  inputValue: string;
  quotes?: Quote[];
  onInputChange: (value: string) => void;
  onSendMessage: (content: string | null, silenceReason?: string) => void;
  onMarkMessageRead?: (messageId: string) => void;
  onRecallPending?: () => void;
  onSaveAndApply: (updatedIdentity: EditedIdentity) => void;
  onDismiss: () => void;
  onClose: (currentEdits: EditedIdentity) => void;
  onPendingUpdateChange?: (updated: EditedIdentity) => void;
}

function sentimentColor(value: number): string {
  if (value > 0.1) return 'var(--ei-success)';
  if (value < -0.1) return 'var(--ei-danger)';
  return 'var(--ei-text-secondary)';
}

function makeTrait(index: number): PersonaTrait {
  return {
    id: `new-trait-${Date.now()}-${index}`,
    name: '',
    description: '',
    sentiment: 0,
    strength: 0.5,
    last_updated: new Date().toISOString(),
  };
}

function makeTopic(index: number): PersonaTopic {
  return {
    id: `new-topic-${Date.now()}-${index}`,
    name: '',
    perspective: '',
    approach: '',
    personal_stake: '',
    sentiment: 0,
    exposure_current: 0,
    exposure_desired: 0.5,
    last_updated: new Date().toISOString(),
  };
}

export const PersonaReflectionModal: React.FC<PersonaReflectionModalProps> = ({
  isOpen,
  personaName,
  currentIdentity,
  pendingUpdate,
  activePersonaId,
  messages,
  inputValue,
  quotes,
  onInputChange,
  onSendMessage,
  onMarkMessageRead,
  onRecallPending,
  onSaveAndApply,
  onDismiss,
  onClose,
  onPendingUpdateChange,
}) => {
  const [edited, setEdited] = useState<EditedIdentity>(() => ({
    long_description: pendingUpdate.long_description,
    short_description: pendingUpdate.short_description,
    traits: pendingUpdate.traits.map((t, i) => ({
      ...t,
      id: t.id || `pending-trait-${i}`,
    })),
    topics: pendingUpdate.topics.map((t, i) => ({
      ...t,
      id: t.id || `pending-topic-${i}`,
    })),
  }));

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const propagateChange = useCallback(
    (next: EditedIdentity) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        onPendingUpdateChange?.(next);
      }, 800);
    },
    [onPendingUpdateChange],
  );

  const updateEdited = useCallback(
    (next: EditedIdentity) => {
      setEdited(next);
      propagateChange(next);
    },
    [propagateChange],
  );

  const handleDismiss = useCallback(() => {
    if (window.confirm('Discard the pending reflection? This cannot be undone.')) {
      onDismiss();
    }
  }, [onDismiss]);

  const handleSave = useCallback(() => {
    onSaveAndApply(edited);
  }, [edited, onSaveAndApply]);

  if (!isOpen) return null;

  const updateTrait = (index: number, patch: Partial<PersonaTrait>) => {
    const next: EditedIdentity = {
      ...edited,
      traits: edited.traits.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    };
    updateEdited(next);
  };

  const removeTrait = (index: number) => {
    const next: EditedIdentity = {
      ...edited,
      traits: edited.traits.filter((_, i) => i !== index),
    };
    updateEdited(next);
  };

  const addTrait = () => {
    const next: EditedIdentity = {
      ...edited,
      traits: [...edited.traits, makeTrait(edited.traits.length)],
    };
    updateEdited(next);
  };

  const updateTopic = (index: number, patch: Partial<PersonaTopic>) => {
    const next: EditedIdentity = {
      ...edited,
      topics: edited.topics.map((t, i) => (i === index ? { ...t, ...patch } : t)),
    };
    updateEdited(next);
  };

  const removeTopic = (index: number) => {
    const next: EditedIdentity = {
      ...edited,
      topics: edited.topics.filter((_, i) => i !== index),
    };
    updateEdited(next);
  };

  const addTopic = () => {
    const next: EditedIdentity = {
      ...edited,
      topics: [...edited.topics, makeTopic(edited.topics.length)],
    };
    updateEdited(next);
  };

  return (
    <div
      className="ei-reflection-modal"
      role="dialog"
      aria-modal="true"
      aria-label={`${personaName} — Reflection Review`}
    >
      <div className="ei-reflection-modal__container">
        <div className="ei-reflection-modal__header">
          <h2 className="ei-reflection-modal__title">
            {personaName} — Reflection Review
          </h2>
          <div className="ei-reflection-modal__actions">
            <button
              className="ei-reflection-modal__btn ei-reflection-modal__btn--secondary"
              onClick={() => onClose(edited)}
              title="Save progress and close"
            >
              Close
            </button>
            <button
              className="ei-reflection-modal__btn ei-reflection-modal__btn--danger"
              onClick={handleDismiss}
              title="Discard the pending reflection"
            >
              Dismiss
            </button>
            <button
              className="ei-reflection-modal__btn ei-reflection-modal__btn--primary"
              onClick={handleSave}
            >
              Save and Apply
            </button>
          </div>
        </div>

        <div className="ei-reflection-modal__panes">
          <div className="ei-reflection-modal__pane ei-reflection-modal__pane--current">
            <div className="ei-reflection-modal__pane-header">Current</div>
            <div className="ei-reflection-modal__pane-content">
              <p className="ei-reflection-modal__short-desc ei-reflection-modal__short-desc--muted">
                {currentIdentity.short_description}
              </p>
              <p className="ei-reflection-modal__long-desc">
                {currentIdentity.long_description}
              </p>

              <div className="ei-reflection-modal__section-title">Traits</div>
              {currentIdentity.traits.map((trait, i) => (
                <div
                  key={trait.id || `cur-trait-${i}`}
                  className="ei-reflection-modal__card"
                >
                  <div className="ei-reflection-modal__card-name">{trait.name}</div>
                  <div className="ei-reflection-modal__card-desc">{trait.description}</div>
                  <div className="ei-reflection-modal__field-row">
                    <span className="ei-reflection-modal__field-label">Strength</span>
                    <div className="ei-reflection-modal__progress-bar-wrap">
                      <div
                        className="ei-reflection-modal__progress-bar-fill"
                        style={{ width: `${((trait.strength ?? 0) * 100).toFixed(0)}%` }}
                      />
                    </div>
                    <span className="ei-reflection-modal__field-value">
                      {(trait.strength ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="ei-reflection-modal__field-row">
                    <span className="ei-reflection-modal__field-label">Sentiment</span>
                    <span
                      className="ei-reflection-modal__field-value"
                      style={{ color: sentimentColor(trait.sentiment) }}
                    >
                      {trait.sentiment > 0 ? '+' : ''}
                      {trait.sentiment.toFixed(2)}
                    </span>
                  </div>
                  <button
                    className="ei-reflection-modal__clipboard-btn"
                    title="Copy description to chat input"
                    onClick={() => onInputChange(trait.description)}
                  >
                    📋
                  </button>
                </div>
              ))}

              <div className="ei-reflection-modal__section-title">Topics</div>
              {currentIdentity.topics.map((topic, i) => (
                <div
                  key={topic.id || `cur-topic-${i}`}
                  className="ei-reflection-modal__card"
                >
                  <div className="ei-reflection-modal__card-name">{topic.name}</div>
                  <div className="ei-reflection-modal__labeled-field">
                    <span className="ei-reflection-modal__field-label">Perspective</span>
                    <span className="ei-reflection-modal__field-text">{topic.perspective}</span>
                  </div>
                  <div className="ei-reflection-modal__labeled-field">
                    <span className="ei-reflection-modal__field-label">Approach</span>
                    <span className="ei-reflection-modal__field-text">{topic.approach}</span>
                  </div>
                  <div className="ei-reflection-modal__labeled-field">
                    <span className="ei-reflection-modal__field-label">Personal Stake</span>
                    <span className="ei-reflection-modal__field-text">{topic.personal_stake}</span>
                  </div>
                  <div className="ei-reflection-modal__field-row">
                    <span className="ei-reflection-modal__field-label">Sentiment</span>
                    <span
                      className="ei-reflection-modal__field-value"
                      style={{ color: sentimentColor(topic.sentiment) }}
                    >
                      {topic.sentiment > 0 ? '+' : ''}
                      {topic.sentiment.toFixed(2)}
                    </span>
                  </div>
                  <div className="ei-reflection-modal__field-row">
                    <span className="ei-reflection-modal__field-label">Exp. current</span>
                    <span className="ei-reflection-modal__field-value">
                      {topic.exposure_current.toFixed(2)}
                    </span>
                  </div>
                  <div className="ei-reflection-modal__field-row">
                    <span className="ei-reflection-modal__field-label">Exp. desired</span>
                    <span className="ei-reflection-modal__field-value">
                      {topic.exposure_desired.toFixed(2)}
                    </span>
                  </div>
                  <button
                    className="ei-reflection-modal__clipboard-btn"
                    title="Copy topic to chat input"
                    onClick={() => onInputChange(`${topic.name}: ${topic.perspective}`)}
                  >
                    📋
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="ei-reflection-modal__pane ei-reflection-modal__pane--proposed">
            <div className="ei-reflection-modal__pane-header">Proposed</div>
            <div className="ei-reflection-modal__pane-content">
              <blockquote className="ei-reflection-modal__critique">
                {pendingUpdate.critique}
              </blockquote>

              <label className="ei-reflection-modal__field-label" htmlFor="rm-short-desc">
                Short Description
              </label>
              <input
                id="rm-short-desc"
                type="text"
                className="ei-reflection-modal__input"
                value={edited.short_description}
                onChange={(e) =>
                  updateEdited({ ...edited, short_description: e.target.value })
                }
              />

              <label className="ei-reflection-modal__field-label" htmlFor="rm-long-desc">
                Long Description
              </label>
              <textarea
                id="rm-long-desc"
                className="ei-reflection-modal__textarea"
                rows={4}
                value={edited.long_description}
                onChange={(e) =>
                  updateEdited({ ...edited, long_description: e.target.value })
                }
              />

              <div className="ei-reflection-modal__section-title">Traits</div>
              {edited.traits.map((trait, i) => (
                <div
                  key={trait.id || `edit-trait-${i}`}
                  className="ei-reflection-modal__card ei-reflection-modal__card--editable"
                >
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Name</label>
                    <input
                      type="text"
                      className="ei-reflection-modal__input"
                      value={trait.name}
                      onChange={(e) => updateTrait(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Description</label>
                    <textarea
                      className="ei-reflection-modal__textarea ei-reflection-modal__textarea--sm"
                      rows={2}
                      value={trait.description}
                      onChange={(e) => updateTrait(i, { description: e.target.value })}
                    />
                  </div>
                  <SliderControl
                    label="Strength"
                    value={trait.strength ?? 0}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateTrait(i, { strength: v })}
                  />
                  <SliderControl
                    label="Sentiment"
                    value={trait.sentiment}
                    min={-1}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateTrait(i, { sentiment: v })}
                  />
                  <button
                    className="ei-reflection-modal__btn ei-reflection-modal__btn--remove"
                    onClick={() => removeTrait(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="ei-reflection-modal__btn ei-reflection-modal__btn--add"
                onClick={addTrait}
              >
                + Add Trait
              </button>

              <div className="ei-reflection-modal__section-title">Topics</div>
              {edited.topics.map((topic, i) => (
                <div
                  key={topic.id || `edit-topic-${i}`}
                  className="ei-reflection-modal__card ei-reflection-modal__card--editable"
                >
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Name</label>
                    <input
                      type="text"
                      className="ei-reflection-modal__input"
                      value={topic.name}
                      onChange={(e) => updateTopic(i, { name: e.target.value })}
                    />
                  </div>
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Perspective</label>
                    <textarea
                      className="ei-reflection-modal__textarea ei-reflection-modal__textarea--sm"
                      rows={2}
                      value={topic.perspective}
                      onChange={(e) => updateTopic(i, { perspective: e.target.value })}
                    />
                  </div>
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Approach</label>
                    <textarea
                      className="ei-reflection-modal__textarea ei-reflection-modal__textarea--sm"
                      rows={2}
                      value={topic.approach}
                      onChange={(e) => updateTopic(i, { approach: e.target.value })}
                    />
                  </div>
                  <div className="ei-reflection-modal__card-row">
                    <label className="ei-reflection-modal__field-label">Personal Stake</label>
                    <textarea
                      className="ei-reflection-modal__textarea ei-reflection-modal__textarea--sm"
                      rows={2}
                      value={topic.personal_stake}
                      onChange={(e) => updateTopic(i, { personal_stake: e.target.value })}
                    />
                  </div>
                  <SliderControl
                    label="Sentiment"
                    value={topic.sentiment}
                    min={-1}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateTopic(i, { sentiment: v })}
                  />
                  <SliderControl
                    label="Exposure (Current)"
                    value={topic.exposure_current}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateTopic(i, { exposure_current: v })}
                  />
                  <SliderControl
                    label="Exposure (Desired)"
                    value={topic.exposure_desired}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(v) => updateTopic(i, { exposure_desired: v })}
                  />
                  <button
                    className="ei-reflection-modal__btn ei-reflection-modal__btn--remove"
                    onClick={() => removeTopic(i)}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                className="ei-reflection-modal__btn ei-reflection-modal__btn--add"
                onClick={addTopic}
              >
                + Add Topic
              </button>
            </div>
          </div>

          <div className="ei-reflection-modal__pane ei-reflection-modal__pane--chat">
            <div className="ei-reflection-modal__pane-header">
              Chat with {personaName}
            </div>
            <div className="ei-reflection-modal__chat-wrap">
              <ChatPanel
                activePersonaId={activePersonaId}
                activePersonaDisplayName={personaName}
                messages={messages}
                inputValue={inputValue}
                quotes={quotes}
                onInputChange={onInputChange}
                onSendMessage={onSendMessage}
                onMarkMessageRead={onMarkMessageRead}
                onRecallPending={onRecallPending}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
};

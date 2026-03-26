import React from 'react';
import { SliderControl } from './SliderControl';

interface Person {
  id: string;
  name: string;
  relationship: string;
  description: string;
  sentiment: number;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
  learned_by?: string;
  last_changed_by?: string;
  persona_groups?: string[];
}

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  formatValue?: (v: number) => string;
}

interface PersonCardProps {
  person: Person;
  sliders: SliderConfig[];
  onChange: (field: keyof Person, value: Person[keyof Person]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty?: boolean;
  showMeta?: boolean;
  resolvePersonaName?: (id: string) => string;
  selectionMode?: boolean;
  isSelected?: boolean;
  onSelectionChange?: () => void;
  onCreatePersona?: (person: Person) => void;
  onUpdatePersona?: (person: Person) => void;
}

const defaultFormat = (v: number) => v.toFixed(2);

const getEngagementGapInfo = (current: number, desired: number) => {
  const gap = desired - current;
  const gapPercent = Math.round(gap * 100);
  const threshold = 0.1;

  if (Math.abs(gap) < threshold) {
    return {
      className: 'ei-engagement-gap--neutral',
      label: '≈',
      description: 'Balanced engagement',
    };
  }

  if (gap > 0) {
    return {
      className: 'ei-engagement-gap--positive',
      label: '↑',
      description: `Wants more discussion (+${gapPercent}%)`,
    };
  }

  return {
    className: 'ei-engagement-gap--negative',
    label: '↓',
    description: `Avoiding discussion (${gapPercent}%)`,
  };
};

export const PersonCard = ({
  person,
  sliders,
  onChange,
  onSave,
  onDelete,
  isDirty = false,
  showMeta = true,
  resolvePersonaName,
  selectionMode = false,
  isSelected = false,
  onSelectionChange,
  onCreatePersona,
  onUpdatePersona,
}: PersonCardProps): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      onSave();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('name', e.target.value);
  };

  const handleRelationshipChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('relationship', e.target.value);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange('description', e.target.value);
  };

  const handleSliderChange = (field: string, value: number) => {
    onChange(field as keyof Person, value);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };

  const gapInfo = getEngagementGapInfo(person.exposure_current, person.exposure_desired);

  const cardClassName = [
    'ei-data-card',
    isDirty ? 'ei-data-card--dirty' : '',
    selectionMode ? 'ei-data-card--selection-mode' : '',
    isSelected ? 'ei-data-card--selected' : '',
  ].filter(Boolean).join(' ');

  return (
    <div 
      ref={cardRef}
      className={cardClassName}
      style={{ position: 'relative' }}
      onBlur={handleBlur}
      onClick={selectionMode ? onSelectionChange : undefined}
    >
      {selectionMode && (
        <div className="ei-data-card__checkbox">
          <input type="checkbox" checked={isSelected} readOnly />
        </div>
      )}
      {!selectionMode && (
        <div
          className={`ei-engagement-gap ${gapInfo.className}`}
          style={{ position: 'absolute', top: '12px', right: '12px' }}
          title={gapInfo.description}
        >
          {gapInfo.label}
        </div>
      )}
      <div className="ei-data-card__content">
        <div className="ei-data-card__header">
          <input
            type="text"
            className="ei-data-card__name"
            value={person.name}
            onChange={handleNameChange}
            placeholder="Name"
            readOnly={selectionMode}
          />
        </div>

        <div className="ei-data-card__body">
          {!selectionMode && (
            <input
              type="text"
              className="ei-data-card__relationship"
              value={person.relationship}
              onChange={handleRelationshipChange}
              placeholder="Relationship (e.g., friend, coworker, family)"
            />
          )}

          <textarea
            className="ei-data-card__description"
            value={person.description}
            onChange={handleDescriptionChange}
            placeholder="Description"
            rows={selectionMode ? 2 : undefined}
            readOnly={selectionMode}
          />

          {!selectionMode && (
            <div className="ei-data-card__sliders">
              {sliders.map((slider) => (
                <SliderControl
                  key={slider.field}
                  label={slider.label}
                  value={person[slider.field as keyof Person] as number}
                  min={slider.min}
                  max={slider.max}
                  onChange={(value) => handleSliderChange(slider.field, value)}
                  formatValue={slider.formatValue || defaultFormat}
                />
              ))}
            </div>
          )}
        </div>

        {!selectionMode && (
          <div className="ei-data-card__footer">
            {showMeta && (
              <div className="ei-data-card__meta">
                {person.learned_by && <span>Learned by: {resolvePersonaName ? resolvePersonaName(person.learned_by) : person.learned_by} • </span>}
                <span>Updated: {formatTimestamp(person.last_updated)}</span>
              </div>
            )}
            <div className="ei-data-card__actions">
              {onCreatePersona && (
                <button
                  className="ei-control-btn"
                  onClick={() => onCreatePersona(person)}
                  title="Create Persona from this person"
                >
                  +
                </button>
              )}
              {onUpdatePersona && (
                <button
                  className="ei-control-btn"
                  onClick={() => onUpdatePersona(person)}
                  title="Update Persona from this person"
                >
                  ↑
                </button>
              )}
              <button 
                className="ei-control-btn ei-control-btn--danger" 
                onClick={onDelete}
                title="Delete"
              >
                🗑️
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

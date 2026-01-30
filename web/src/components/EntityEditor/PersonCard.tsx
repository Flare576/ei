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
}: PersonCardProps): React.ReactElement => {
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

  return (
    <div className={`ei-data-card ${isDirty ? 'ei-data-card--dirty' : ''}`} style={{ position: 'relative' }}>
      <div
        className={`ei-engagement-gap ${gapInfo.className}`}
        style={{ position: 'absolute', top: '12px', right: '12px' }}
        title={gapInfo.description}
      >
        {gapInfo.label}
      </div>
      <div className="ei-data-card__header">
        <input
          type="text"
          className="ei-data-card__name"
          value={person.name}
          onChange={handleNameChange}
          placeholder="Name"
        />
      </div>

      <div className="ei-data-card__body">
        <input
          type="text"
          className="ei-data-card__relationship"
          value={person.relationship}
          onChange={handleRelationshipChange}
          placeholder="Relationship (e.g., friend, coworker, family)"
        />

        <textarea
          className="ei-data-card__description"
          value={person.description}
          onChange={handleDescriptionChange}
          placeholder="Description"
        />

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
      </div>

      <div className="ei-data-card__footer">
        {showMeta && (
          <div className="ei-data-card__meta">
            {person.learned_by && <span>Learned by: {person.learned_by} • </span>}
            <span>Updated: {formatTimestamp(person.last_updated)}</span>
          </div>
        )}
        <div className="ei-data-card__actions">
          <button onClick={onSave} disabled={!isDirty}>
            Save
          </button>
          <button onClick={onDelete}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
};

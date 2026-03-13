import React from 'react';
import { SliderControl } from './SliderControl';
import type { Fact } from '../../../../src/core/types';

interface SliderConfig {
  field: string;
  label: string;
  min?: number;
  max?: number;
  formatValue?: (v: number) => string;
}

interface FactCardProps {
  fact: Fact;
  sliders: SliderConfig[];
  onChange: (field: keyof Fact, value: Fact[keyof Fact]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty?: boolean;
  showMeta?: boolean;
  resolvePersonaName?: (id: string) => string;
  isBuiltIn?: boolean;
}

const defaultFormat = (v: number) => v.toFixed(2);

export const FactCard = ({
  fact,
  sliders,
  onChange,
  onSave,
  onDelete,
  isDirty = false,
  showMeta = true,
  resolvePersonaName,
  isBuiltIn = false,
}: FactCardProps): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      onSave();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('name', e.target.value);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange('description', e.target.value);
    onChange('validated_date', new Date().toISOString());
  };

  const handleSliderChange = (field: string, value: number) => {
    onChange(field as keyof Fact, value as Fact[keyof Fact]);
  };


  const formatTimestamp = (timestamp: string) => {
    try {
      return new Date(timestamp).toLocaleString();
    } catch {
      return timestamp;
    }
  };


  return (
    <div 
      ref={cardRef}
      className={`ei-data-card ${isDirty ? 'ei-data-card--dirty' : ''}`}
      onBlur={handleBlur}
    >
      <div className="ei-data-card__header">
        <input
          type="text"
          className="ei-data-card__name"
          value={fact.name}
          onChange={handleNameChange}
          placeholder="Name"
        />
      </div>

      <div className="ei-data-card__body">
        <textarea
          className="ei-data-card__description"
          value={fact.description}
          onChange={handleDescriptionChange}
          placeholder="Description"
        />

        <div className="ei-data-card__sliders">
          {sliders.map((slider) => (
            <SliderControl
              key={slider.field}
              label={slider.label}
              value={fact[slider.field as keyof Fact] as number}
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
            {fact.learned_by && <span>Learned by: {resolvePersonaName ? resolvePersonaName(fact.learned_by) : fact.learned_by} • </span>}
            <span>Updated: {formatTimestamp(fact.last_updated)}</span>
          </div>
        )}
        <div className="ei-data-card__actions">
          {!isBuiltIn && (
            <button
              className="ei-control-btn ei-control-btn--danger"
              onClick={onDelete}
              title="Delete"
            >
              🗑️
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

import React from 'react';
import { SliderControl } from './SliderControl';

interface DataItemBase {
  id: string;
  name: string;
  description: string;
  sentiment: number;
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
  tooltip?: string;
}

interface DataItemCardProps<T extends DataItemBase> {
  item: T;
  sliders: SliderConfig[];
  onChange: (field: keyof T, value: T[keyof T]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty?: boolean;
  showMeta?: boolean;
  renderAfterHeader?: () => React.ReactNode;
}

const defaultFormat = (v: number) => v.toFixed(2);

export const DataItemCard = <T extends DataItemBase>({
  item,
  sliders,
  onChange,
  onSave,
  onDelete,
  isDirty = false,
  showMeta = true,
  renderAfterHeader,
}: DataItemCardProps<T>): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      onSave();
    }
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('name' as keyof T, e.target.value as T[keyof T]);
  };

  const handleDescriptionChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    onChange('description' as keyof T, e.target.value as T[keyof T]);
  };

  const handleSliderChange = (field: string, value: number) => {
    onChange(field as keyof T, value as T[keyof T]);
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
          value={item.name}
          onChange={handleNameChange}
          placeholder="Name"
        />
      </div>

      {renderAfterHeader?.()}

      <div className="ei-data-card__body">
        <textarea
          className="ei-data-card__description"
          value={item.description}
          onChange={handleDescriptionChange}
          placeholder="Description"
        />

        <div className="ei-data-card__sliders">
          {sliders.map((slider) => (
            <SliderControl
              key={slider.field}
              label={slider.label}
              value={item[slider.field as keyof T] as number}
              min={slider.min}
              max={slider.max}
              onChange={(value) => handleSliderChange(slider.field, value)}
              formatValue={slider.formatValue || defaultFormat}
              tooltip={slider.tooltip}
            />
          ))}
        </div>
      </div>

      <div className="ei-data-card__footer">
        {showMeta && (
          <div className="ei-data-card__meta">
            {item.learned_by && <span>Learned by: {item.learned_by} • </span>}
            <span>Updated: {formatTimestamp(item.last_updated)}</span>
          </div>
        )}
        {item.persona_groups && item.persona_groups.length > 0 && (
          <div className="ei-data-card__groups">
            {item.persona_groups.map((group, idx) => (
              <span key={group} className={`ei-data-card__group-badge ${idx === 0 ? 'ei-data-card__group-badge--primary' : ''}`}>
                {group}
              </span>
            ))}
          </div>
        )}
        <div className="ei-data-card__actions">
          <button 
            className="ei-control-btn ei-control-btn--danger" 
            onClick={onDelete}
            title="Delete"
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
};

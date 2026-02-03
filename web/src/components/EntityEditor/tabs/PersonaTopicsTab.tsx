import React from 'react';
import { SliderControl } from '../SliderControl';

interface Topic {
  id: string;
  name: string;
  perspective: string;         // Their view/opinion on this topic
  approach: string;            // How they prefer to engage
  personal_stake: string;      // Why it matters to them
  sentiment: number;           // -1 to 1
  exposure_current: number;    // 0 to 1
  exposure_desired: number;    // 0 to 1
  last_updated: string;
}

interface PersonaTopicsTabProps {
  topics: Topic[];
  onChange: (id: string, field: keyof Topic, value: Topic[keyof Topic]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
}

const topicSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How does this persona feel about this topic? -1: They hate it! | 0: Neutral | 1: They love it!' },
  { field: 'exposure_current', label: 'Current Exposure', min: 0, max: 1 },
  { field: 'exposure_desired', label: 'Desired Exposure', min: 0, max: 1 },
];

/**
 * Calculate engagement gap and return CSS class + label
 */
const getEngagementGapInfo = (current: number, desired: number) => {
  const gap = desired - current;
  const threshold = 0.1; // Consider ±0.1 as "neutral"

  if (Math.abs(gap) < threshold) {
    return {
      className: 'ei-engagement-gap--neutral',
      label: '≈',
      description: 'Balanced',
    };
  }

  if (gap > 0) {
    return {
      className: 'ei-engagement-gap--positive',
      label: '↑',
      description: 'Wants more',
    };
  }

  return {
    className: 'ei-engagement-gap--negative',
    label: '↓',
    description: 'Wants less',
  };
};

const PersonaTopicCard = ({
  topic,
  onChange,
  onSave,
  onDelete,
  isDirty,
}: {
  topic: Topic;
  onChange: (field: keyof Topic, value: Topic[keyof Topic]) => void;
  onSave: () => void;
  onDelete: () => void;
  isDirty: boolean;
}): React.ReactElement => {
  const cardRef = React.useRef<HTMLDivElement>(null);
  
  const gapInfo = getEngagementGapInfo(
    topic.exposure_current,
    topic.exposure_desired
  );

  const handleBlur = (e: React.FocusEvent) => {
    if (isDirty && cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      onSave();
    }
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
      style={{ position: 'relative' }}
    >
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
          value={topic.name}
          onChange={(e) => onChange('name', e.target.value)}
          placeholder="Topic Name"
        />
      </div>

      <div className="ei-data-card__body">
        <div className="ei-form-group">
          <label className="ei-form-label ei-form-label--sm">Perspective</label>
          <textarea
            className="ei-data-card__description"
            value={topic.perspective || ''}
            onChange={(e) => onChange('perspective', e.target.value)}
            placeholder="Their view or opinion on this topic..."
            rows={2}
          />
        </div>

        <div className="ei-form-group">
          <label className="ei-form-label ei-form-label--sm">Approach</label>
          <textarea
            className="ei-data-card__description"
            value={topic.approach || ''}
            onChange={(e) => onChange('approach', e.target.value)}
            placeholder="How they prefer to engage with this topic... (optional)"
            rows={2}
          />
        </div>

        <div className="ei-form-group">
          <label className="ei-form-label ei-form-label--sm">Personal Stake</label>
          <textarea
            className="ei-data-card__description"
            value={topic.personal_stake || ''}
            onChange={(e) => onChange('personal_stake', e.target.value)}
            placeholder="Why this topic matters to them personally... (optional)"
            rows={2}
          />
        </div>

        <div className="ei-data-card__sliders">
          {topicSliders.map((slider) => (
            <SliderControl
              key={slider.field}
              label={slider.label}
              value={topic[slider.field as keyof Topic] as number}
              min={slider.min}
              max={slider.max}
              onChange={(value) => onChange(slider.field as keyof Topic, value)}
              formatValue={(v) => v.toFixed(2)}
              tooltip={slider.tooltip}
            />
          ))}
        </div>
      </div>

      <div className="ei-data-card__footer">
        <div className="ei-data-card__meta">
          <span>Updated: {formatTimestamp(topic.last_updated)}</span>
        </div>
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

export const PersonaTopicsTab = ({
  topics,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
}: PersonaTopicsTabProps) => {
  if (topics.length === 0) {
    return (
      <div>
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--ei-text-muted)' }}>
          No topics yet. Click "Add New" to create one.
        </div>
        <button
          className="ei-grouped-list__add-btn"
          onClick={onAdd}
          style={{ marginTop: '1rem' }}
        >
          + Add New Topic
        </button>
      </div>
    );
  }

  return (
    <div className="ei-grouped-list">
      <div className="ei-grouped-list__flat">
        {topics.map((topic) => (
          <PersonaTopicCard
            key={topic.id}
            topic={topic}
            onChange={(field: keyof Topic, value: Topic[keyof Topic]) => onChange(topic.id, field, value)}
            onSave={() => onSave(topic.id)}
            onDelete={() => onDelete(topic.id)}
            isDirty={dirtyIds.has(topic.id)}
          />
        ))}
      </div>
      <button className="ei-grouped-list__add-btn" onClick={onAdd}>
        + Add New Topic
      </button>
    </div>
  );
};

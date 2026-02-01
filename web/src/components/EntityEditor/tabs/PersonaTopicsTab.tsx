import React from 'react';
import { DataItemCard } from '../DataItemCard';

interface Topic {
  id: string;
  name: string;
  description: string;
  sentiment: number;           // -1 to 1
  exposure_current: number;    // 0 to 1
  exposure_desired: number;    // 0 to 1
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
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

const TopicCard = ({
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
  const gapInfo = getEngagementGapInfo(
    topic.exposure_current,
    topic.exposure_desired
  );

  return (
    <div style={{ position: 'relative' }}>
      <DataItemCard
        item={topic}
        sliders={topicSliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={onDelete}
        isDirty={isDirty}
      />
      <div
        className={`ei-engagement-gap ${gapInfo.className}`}
        style={{
          position: 'absolute',
          top: '12px',
          right: '12px',
        }}
        title={gapInfo.description}
      >
        {gapInfo.label}
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
          <TopicCard
            key={topic.id}
            topic={topic}
            onChange={(field, value) => onChange(topic.id, field, value)}
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

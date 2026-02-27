import React from 'react';
import { GroupedCardList } from '../GroupedCardList';
import { DataItemCard } from '../DataItemCard';

interface Topic {
  id: string;
  name: string;
  description: string;
  sentiment: number;
  category?: string;
  exposure_current: number;
  exposure_desired: number;
  last_updated: string;
  learned_by?: string;
  persona_groups?: string[];
}

interface HumanTopicsTabProps {
  topics: Topic[];
  onChange: (id: string, field: keyof Topic, value: Topic[keyof Topic]) => void;
  onSave: (id: string) => void;
  onDelete: (id: string) => void;
  onAdd: () => void;
  dirtyIds: Set<string>;
  resolvePersonaName?: (id: string) => string;
}

const topicSliders = [
  { field: 'sentiment', label: 'Sentiment', min: -1, max: 1, tooltip: 'How do you feel about this topic? -1: Hate it! | 0: Neutral | 1: Love it!' },
  { field: 'exposure_current', label: 'Current Exposure', min: 0, max: 1 },
  { field: 'exposure_desired', label: 'Desired Exposure', min: 0, max: 1 },
];

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

const CATEGORY_SUGGESTIONS = [
  'Interest', 'Goal', 'Dream', 'Conflict', 'Concern', 'Fear', 'Hope', 'Plan', 'Project'
];

const renderTopicCard = (
  topic: Topic,
  onChange: (field: keyof Topic, value: Topic[keyof Topic]) => void,
  onSave: () => void,
  onDelete: () => void,
  isDirty: boolean,
  sliders: { field: string; label: string; min?: number; max?: number }[],
  resolvePersonaName?: (id: string) => string
) => {
  const gapInfo = getEngagementGapInfo(topic.exposure_current, topic.exposure_desired);

  const handleCategoryChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange('category', e.target.value);
  };

  const renderCategoryInput = () => (
    <div style={{ 
      padding: '0 12px 8px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    }}>
      <label 
        style={{ 
          fontSize: '0.75rem', 
          color: 'var(--ei-text-secondary, #8b9aa8)',
          whiteSpace: 'nowrap',
        }}
      >
        Category:
      </label>
      <input
        type="text"
        value={topic.category || ''}
        onChange={handleCategoryChange}
        placeholder="Interest, Goal, Conflict..."
        list={`category-suggestions-${topic.id}`}
        style={{
          flex: 1,
          fontSize: '0.8rem',
          padding: '4px 8px',
          border: '1px solid var(--ei-border, #3d4f5f)',
          borderRadius: '4px',
          backgroundColor: 'var(--ei-bg-secondary, #1a2332)',
          color: 'var(--ei-text-primary, #e8eef4)',
        }}
      />
      <datalist id={`category-suggestions-${topic.id}`}>
        {CATEGORY_SUGGESTIONS.map(cat => (
          <option key={cat} value={cat} />
        ))}
      </datalist>
    </div>
  );

  return (
    <div style={{ position: 'relative' }}>
      <DataItemCard
        item={topic}
        sliders={sliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={onDelete}
        isDirty={isDirty}
        renderAfterHeader={renderCategoryInput}
        resolvePersonaName={resolvePersonaName}
      />
      <div
        className={`ei-engagement-gap ${gapInfo.className}`}
        style={{ position: 'absolute', top: '12px', right: '12px' }}
        title={gapInfo.description}
      >
        {gapInfo.label}
      </div>
    </div>
  );
};

export const HumanTopicsTab = ({
  topics,
  onChange,
  onSave,
  onDelete,
  onAdd,
  dirtyIds,
  resolvePersonaName,
}: HumanTopicsTabProps) => {
  return (
    <GroupedCardList
      items={topics}
      sliders={topicSliders}
      onChange={onChange}
      onSave={onSave}
      onDelete={onDelete}
      onAdd={onAdd}
      dirtyIds={dirtyIds}
      renderCard={renderTopicCard}
      resolvePersonaName={resolvePersonaName}
    />
  );
};

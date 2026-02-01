import { GroupedCardList } from '../GroupedCardList';
import { DataItemCard } from '../DataItemCard';

interface Topic {
  id: string;
  name: string;
  description: string;
  sentiment: number;
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

const renderTopicCard = (
  topic: Topic,
  onChange: (field: keyof Topic, value: Topic[keyof Topic]) => void,
  onSave: () => void,
  onDelete: () => void,
  isDirty: boolean,
  sliders: { field: string; label: string; min?: number; max?: number }[]
) => {
  const gapInfo = getEngagementGapInfo(topic.exposure_current, topic.exposure_desired);

  return (
    <div style={{ position: 'relative' }}>
      <DataItemCard
        item={topic}
        sliders={sliders}
        onChange={onChange}
        onSave={onSave}
        onDelete={onDelete}
        isDirty={isDirty}
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
    />
  );
};
